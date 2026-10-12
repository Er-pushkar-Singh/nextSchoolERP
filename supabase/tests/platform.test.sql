-- Platform & multi-tenancy test. Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/platform.test.sql
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000001', 'p-owner@test.dev'),
  ('ffffffff-0000-0000-0000-000000000002', 'p-support@test.dev'),
  ('ffffffff-0000-0000-0000-000000000003', 'p-billing@test.dev'),
  ('ffffffff-0000-0000-0000-000000000004', 'p-viewer@test.dev'),
  ('ffffffff-0000-0000-0000-000000000005', 's-principal@test.dev'),
  ('ffffffff-0000-0000-0000-000000000006', 's-teacher@test.dev'),
  ('ffffffff-0000-0000-0000-000000000007', 'g-owner@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values
  ('ffffffff-0000-0000-0000-000000000001', 'owner'), ('ffffffff-0000-0000-0000-000000000002', 'support'),
  ('ffffffff-0000-0000-0000-000000000003', 'billing'), ('ffffffff-0000-0000-0000-000000000004', 'viewer')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'ffffffff-0000-0000-0000-000000000001'; sup uuid := 'ffffffff-0000-0000-0000-000000000002';
  bil uuid := 'ffffffff-0000-0000-0000-000000000003'; vw uuid := 'ffffffff-0000-0000-0000-000000000004';
  pr uuid := 'ffffffff-0000-0000-0000-000000000005'; te uuid := 'ffffffff-0000-0000-0000-000000000006'; go_ uuid := 'ffffffff-0000-0000-0000-000000000007';
  a uuid; b uuid; grp uuid; tk uuid; sess uuid; n int; ok boolean; j json; sfx text := substr(md5(random()::text), 1, 6);
begin
  -- Platform roles
  perform pg_temp.act_as(ow);
  a := public.create_school('Alpha School', 'alpha-' || sfx, 'CBSE', 'Lucknow', 'starter', 'yearly');
  b := public.create_school('Beta School', 'beta-' || sfx);
  perform pg_temp.act_admin();
  perform pg_temp.act_as(sup);
  begin perform public.create_school('X', 'x-' || sfx); perform pg_temp.check(false, 'support created a school');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'support role cannot create schools'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(vw);
  begin perform public.start_support_session(a, 'look around'); perform pg_temp.check(false, 'viewer opened a support session');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'viewer cannot open a support session'); end;
  perform pg_temp.check((select count(*) from public.schools where id in (a, b)) = 2, 'viewer can read every school');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(bil);
  perform pg_temp.check(public.create_subscription_invoice(a) is not null, 'billing role can invoice');
  begin perform public.archive_school(b, 'x'); perform pg_temp.check(false, 'billing archived a school');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'billing role cannot archive schools'); end;
  perform pg_temp.act_admin();

  -- Support sessions gate every platform write inside a school
  perform pg_temp.act_as(ow);
  perform pg_temp.check(public.has_perm(a, 'students.profile.view') and not public.has_perm(a, 'students.profile.create'), 'platform owner: read-only inside a school without a support session');
  sess := public.start_support_session(a, 'Help principal import students', 30);
  perform pg_temp.check(public.has_perm(a, 'students.profile.create') and not public.has_perm(b, 'students.profile.create'), 'support session opens writes for that school only');
  insert into public.students (school_id, admission_no, first_name) values (a, 'S1', 'Session Kid');
  perform pg_temp.act_admin();
  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and entity = 'students' and action = 'insert' and support_session = sess and actor_kind = 'platform'),
                        'audit log ties the change to the support session');
  update public.support_sessions set expires_at = now() - interval '1 minute' where id = sess;
  perform pg_temp.act_as(ow);
  perform pg_temp.check(not public.has_perm(a, 'students.profile.create'), 'expired support session closes writes again');
  perform pg_temp.act_admin();
  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and action = 'support.start') and exists (select 1 from public.audit_log where school_id = a and action = 'plan.applied'),
                        'support start and plan changes are logged');

  -- School staff
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal A'), (a, te, 'Teacher A');
  insert into public.member_roles (school_id, user_id, role_id) select a, pr, id from public.roles where school_id = a and code = 'principal';
  insert into public.member_roles (school_id, user_id, role_id) select a, te, id from public.roles where school_id = a and code = 'subject_teacher';
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select count(*) from public.audit_log where school_id = a) > 0 and (select count(*) from public.audit_log where school_id = b) = 0, 'principal reads own school audit only');
  perform pg_temp.act_admin();

  -- Tickets
  perform pg_temp.act_as(te);
  insert into public.tickets (school_id, created_by, created_by_name, subject) values (a, te, 'Teacher A', 'Marks page slow') returning id into tk;
  insert into public.ticket_messages (ticket_id, author, author_name, body) values (tk, te, 'Teacher A', 'It takes 10 seconds');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select count(*) from public.tickets where id = tk) = 1, 'principal sees staff tickets');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(sup);
  insert into public.ticket_messages (ticket_id, author, author_name, from_platform, internal, body) values (tk, sup, 'Support', true, true, 'Check index on marks');
  insert into public.ticket_messages (ticket_id, author, author_name, from_platform, body) values (tk, sup, 'Support', true, 'Fixed, please retry');
  perform pg_temp.act_admin();
  perform pg_temp.check((select status from public.tickets where id = tk) = 'pending', 'platform reply sets ticket to pending');
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.ticket_messages where ticket_id = tk) = 2, 'school does not see internal notes');
  begin
    insert into public.ticket_messages (ticket_id, author, author_name, from_platform, body) values (tk, te, 'T', true, 'fake');
    perform pg_temp.check(false, 'school posted as platform');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'school cannot post as platform'); end;
  insert into public.ticket_messages (ticket_id, author, author_name, body) values (tk, te, 'Teacher A', 'Still slow');
  perform pg_temp.act_admin();
  perform pg_temp.check((select status from public.tickets where id = tk) = 'open', 'school reply re-opens the ticket');

  -- Announcements
  insert into public.announcements (title, audience) values ('Maintenance Sunday', 'all');
  insert into public.announcements (title, audience, plan_codes) values ('Starter offer', 'plan', array['starter']);
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select count(*) from public.my_announcements(a)) = 2, 'starter school sees both announcements');
  perform pg_temp.act_admin();
  perform pg_temp.check((select count(*) from public.announcements a2 where a2.audience = 'plan' and (select plan from public.schools where id = b) = any(a2.plan_codes)) = 0, 'trial school is not targeted by the starter offer');

  -- Domains
  update public.platform_settings set value = '{"root_domain": "erp.test", "app_host": "app.erp.test"}' where key = 'tenancy';
  update public.schools set custom_domain = 'erp.alpha-school.in' where id = a;
  perform pg_temp.act_anon();
  perform pg_temp.check((select id from public.tenant_by_host('beta-' || sfx || '.erp.test')) = b, 'subdomain resolves before login');
  perform pg_temp.check((select id from public.tenant_by_host('erp.alpha-school.in:443')) = a, 'custom domain resolves');
  perform pg_temp.check(not exists (select 1 from public.tenant_by_host('nobody.erp.test')), 'unknown host resolves to nothing');
  perform pg_temp.act_admin();

  -- Groups
  insert into public.school_groups (name) values ('Alpha Trust') returning id into grp;
  update public.schools set group_id = grp where id in (a, b);
  insert into public.group_members (group_id, user_id, name) values (grp, go_, 'Trustee');
  perform pg_temp.act_as(go_);
  perform pg_temp.check(public.is_member(a) and public.is_member(b), 'group owner belongs to both branches');
  perform pg_temp.check(public.has_perm(b, 'fees.collection.view') and not public.has_perm(b, 'fees.collection.create'), 'group owner reads branches, cannot change them');
  perform pg_temp.check((select count(*) from public.group_overview()) = 2, 'group overview lists both branches');
  perform pg_temp.act_admin();

  -- Dashboard and archive
  perform pg_temp.act_as(vw);
  j := public.platform_dashboard();
  perform pg_temp.check((j ->> 'schools')::int >= 2 and json_array_length(j -> 'revenue') = 12 and json_array_length(j -> 'signups') = 12, 'platform dashboard returns KPIs and 12-month series');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(ow);
  perform public.archive_school(b, 'closed');
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.tenant_by_host('beta-' || sfx || '.erp.test')) and public.subscription_state(b) = 'suspended', 'archived school stops resolving and is suspended');
end $$;

select 'ALL PLATFORM TESTS PASSED' as result;
rollback;
