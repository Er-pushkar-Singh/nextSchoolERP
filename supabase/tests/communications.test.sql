-- Communications 2.0 (step 35): outbox, dedupe, claim / finish with back-off, permissions, school isolation, platform messages.
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create or replace function pg_temp.act_service() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email) values
  ('d6d6d6d6-0000-0000-0000-000000000001', 'cm-owner@test.dev'), ('d6d6d6d6-0000-0000-0000-000000000002', 'cm-principal@test.dev'),
  ('d6d6d6d6-0000-0000-0000-000000000003', 'cm-teacher@test.dev'), ('d6d6d6d6-0000-0000-0000-000000000004', 'cm-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('d6d6d6d6-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'd6d6d6d6-0000-0000-0000-000000000001'; pr uuid := 'd6d6d6d6-0000-0000-0000-000000000002'; te uuid := 'd6d6d6d6-0000-0000-0000-000000000003'; ot uuid := 'd6d6d6d6-0000-0000-0000-000000000004';
  a uuid; b uuid; n int; m public.message_outbox; mid uuid; st text; j jsonb; rw record; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('CM A', 'cma-' || sfx);
  b := public.create_school('CM B', 'cmb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';

  -- only the server's secret key can queue
  perform pg_temp.act_as(pr);
  begin perform public.enqueue_messages('[]'::jsonb); perform pg_temp.check(false, 'principal enqueue');
  exception when others then perform pg_temp.check(true, 'a signed-in user cannot call the queue functions directly'); end;

  perform pg_temp.act_service();
  n := public.enqueue_messages(jsonb_build_array(
    jsonb_build_object('school_id', a, 'channel', 'sms', 'event', 'fee_receipt', 'to_addr', '9811100001', 'recipient_name', 'Mr Sharma', 'body', 'Fee received', 'variables', jsonb_build_array('Aarav', '2500'), 'dedupe_key', 'fee_receipt:r1:sms'),
    jsonb_build_object('school_id', a, 'channel', 'email', 'event', 'fee_receipt', 'to_addr', 'p@x.in', 'recipient_name', 'Mr Sharma', 'subject', 'Receipt', 'body', 'Fee received', 'dedupe_key', 'fee_receipt:r1:email'),
    jsonb_build_object('school_id', a, 'channel', 'whatsapp', 'event', 'absent', 'to_addr', '9811100002', 'body', 'Absent', 'status', 'skipped', 'last_error', 'No account'),
    jsonb_build_object('school_id', b, 'channel', 'sms', 'event', 'absent', 'to_addr', '9811100003', 'body', 'Other school')));
  perform pg_temp.check(n = 4, 'four messages were queued');
  n := public.enqueue_messages(jsonb_build_array(jsonb_build_object('school_id', a, 'channel', 'sms', 'event', 'fee_receipt', 'to_addr', '9811100001', 'body', 'again', 'dedupe_key', 'fee_receipt:r1:sms')));
  perform pg_temp.check(n = 0, 'the same dedupe key is never queued twice');
  n := public.enqueue_messages(jsonb_build_array(jsonb_build_object('school_id', null, 'channel', 'email', 'event', 'invoice_issued', 'to_addr', 'school@x.in', 'body', 'Invoice', 'dedupe_key', 'invoice_issued:i1')));
  perform pg_temp.check(n = 1, 'a platform message (no school) is queued');
  n := public.enqueue_messages(jsonb_build_array(jsonb_build_object('school_id', null, 'channel', 'email', 'event', 'invoice_issued', 'to_addr', 'school@x.in', 'body', 'Invoice', 'dedupe_key', 'invoice_issued:i1')));
  perform pg_temp.check(n = 0, 'platform messages are de-duplicated too');

  -- worker: claim, fail twice (back-off), then fail for good; a success is logged
  select count(*) into n from public.claim_messages(10, a);
  perform pg_temp.check(n = 2, 'the worker claims only the due messages of the school (skipped ones are left alone)');
  select id into mid from public.message_outbox where school_id = a and channel = 'sms' and event = 'fee_receipt';
  perform pg_temp.check((select status = 'sending' and attempts = 1 from public.message_outbox where id = mid), 'a claimed message is "sending" with one attempt');
  st := public.finish_message(mid, false, null, 'Provider timeout');
  perform pg_temp.check(st = 'queued' and (select send_after > now() + interval '5 minutes' from public.message_outbox where id = mid), 'a failed attempt is retried later (back-off)');
  update public.message_outbox set send_after = now() - interval '1 minute' where id = mid;
  perform public.claim_messages(10, a);
  st := public.finish_message(mid, false, null, 'Provider timeout');
  update public.message_outbox set send_after = now() - interval '1 minute' where id = mid;
  perform public.claim_messages(10, a);
  st := public.finish_message(mid, false, null, 'Provider timeout');
  perform pg_temp.check(st = 'failed', 'after the third attempt it is failed');
  select id into mid from public.message_outbox where school_id = a and channel = 'email';
  st := public.finish_message(mid, true, 'msg-123', null, 'school');
  perform pg_temp.check(st = 'sent' and (select provider_ref = 'msg-123' and account_source = 'school' and sent_at is not null from public.message_outbox where id = mid), 'a success records the provider reference and whose account carried it');
  perform pg_temp.check((select count(*) from public.message_log where school_id = a and event = 'fee_receipt') = 2, 'sent and failed messages are written to the message log');

  -- staff side
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select count(*) from public.outbox_list(a)) = 3, 'the principal sees the school''s messages');
  perform pg_temp.check((select count(*) from public.outbox_list(a, 'failed')) = 1, 'filter by status in the database');
  perform pg_temp.check((select count(*) from public.outbox_list(a, null, 'email')) = 1, 'filter by channel');
  perform pg_temp.check((select count(*) from public.outbox_list(a, null, null, null, 'sharma')) = 2, 'search by recipient');
  j := public.outbox_stats(a);
  perform pg_temp.check((j ->> 'sent_30')::int = 1 and (j ->> 'failed_30')::int = 1 and (j ->> 'skipped_30')::int = 1, 'stats count sent, failed and skipped');
  perform public.outbox_retry(a, (select id from public.message_outbox where school_id = a and status = 'failed'));
  perform pg_temp.check((select status = 'queued' and attempts = 0 from public.message_outbox where school_id = a and channel = 'sms' and event = 'fee_receipt'), 'retry puts a failed message back in the queue');
  perform public.outbox_cancel(a, (select id from public.message_outbox where school_id = a and status = 'queued'));
  perform pg_temp.check((select status = 'cancelled' from public.message_outbox where school_id = a and channel = 'sms' and event = 'fee_receipt'), 'a waiting message can be cancelled');

  -- isolation and permissions
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.outbox_list(a)) = 0, 'a class teacher cannot see the outbox');
  begin perform public.outbox_retry(a, mid); perform pg_temp.check(false, 'teacher retry');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot retry a message'); end;
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.outbox_list(a)) = 0, 'another school sees nothing of this school''s messages');
  perform pg_temp.check((select count(*) from public.message_outbox) = 1, 'and only its own row through the table');
  perform pg_temp.check((select count(*) from public.outbox_list(null)) = 0, 'a school user cannot read the platform outbox');
  perform pg_temp.act_as(ow);
  perform pg_temp.check((select count(*) from public.outbox_list(null)) = 1, 'the platform owner reads the platform outbox');
  perform pg_temp.check((select count(*) from public.message_outbox where school_id is null) = 1, 'platform messages are visible through the table to the platform team');

  -- a school's own template wording
  perform pg_temp.act_as(pr);
  insert into public.message_templates (school_id, event, channel, language, body) values (a, 'absent', 'whatsapp', 'en', '{{student}} is absent today');
  perform pg_temp.check((select count(*) from public.message_templates where school_id = a) = 1, 'the principal can write a template');
  perform pg_temp.act_as(te);
  begin insert into public.message_templates (school_id, event, channel, language, body) values (a, 'absent', 'sms', 'en', 'x'); perform pg_temp.check(false, 'teacher template');
  exception when insufficient_privilege then perform pg_temp.check(true, 'a class teacher cannot write templates'); end;
end $$;

rollback;
