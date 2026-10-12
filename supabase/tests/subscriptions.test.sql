-- Subscription test (step 3). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/subscriptions.test.sql
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
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
  ('eeeeeeee-0000-0000-0000-000000000001', 'sub-platform@test.dev'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'sub-principal@test.dev'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'sub-accountant@test.dev'),
  ('eeeeeeee-0000-0000-0000-000000000004', 'self-signup@test.dev')
on conflict do nothing;
insert into public.platform_admins values ('eeeeeeee-0000-0000-0000-000000000001') on conflict do nothing;

do $$
declare sid uuid; tsid uuid; inv uuid; r record; n int; ok boolean; newsid uuid; today date := public.today_ist();
  pa uuid := 'eeeeeeee-0000-0000-0000-000000000001'; pr uuid := 'eeeeeeee-0000-0000-0000-000000000002'; ac uuid := 'eeeeeeee-0000-0000-0000-000000000003';
begin
  -- Paid plan, monthly
  perform pg_temp.act_as(pa);
  sid := public.create_school('Sub Test School', 'sub-test-' || substr(md5(random()::text), 1, 6), 'CBSE', 'Lucknow', 'starter', 'monthly');
  tsid := public.create_school('Trial Test School', 'trial-test-' || substr(md5(random()::text), 1, 6));
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (sid, pr, 'P'), (sid, ac, 'A');
  insert into public.member_roles (school_id, user_id, role_id) select sid, pr, id from public.roles where school_id = sid and code = 'principal';
  insert into public.member_roles (school_id, user_id, role_id) select sid, ac, id from public.roles where school_id = sid and code = 'accountant';

  select * into r from public.school_subscriptions where school_id = sid;
  perform pg_temp.check(public.subscription_state(sid) = 'ok' and r.current_period_end = public.cycle_end(today, 'monthly'), 'starter monthly: active, period ends in one month');
  perform pg_temp.check((select student_limit from public.schools where id = sid) = 500, 'plan sets the student limit');
  perform pg_temp.check(not (select licensed from public.school_modules where school_id = sid and module_code = 'hostel')
                        and (select licensed from public.school_modules where school_id = sid and module_code = 'fees'), 'plan licenses its modules only (fees yes, hostel no)');
  perform pg_temp.check(public.subscription_state(tsid) = 'trial' and (select current_period_end from public.school_subscriptions where school_id = tsid) = today + 29, 'new school starts a 30-day trial');

  -- Grace and read-only
  update public.school_subscriptions set current_period_end = today - 3 where school_id = sid;
  perform pg_temp.check(public.subscription_state(sid) = 'grace' and public.school_writable(sid), 'expired 3 days ago: grace, still writable');
  update public.school_subscriptions set current_period_end = today - 10 where school_id = sid;
  perform pg_temp.act_as(pr);
  perform pg_temp.check(public.subscription_state(sid) = 'expired' and public.has_perm(sid, 'students.profile.view') and not public.has_perm(sid, 'students.profile.create'), 'expired beyond grace: principal can view but not create');
  begin
    insert into public.students (school_id, admission_no, first_name) values (sid, 'X1', 'Late');
    perform pg_temp.check(false, 'student added while expired');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'adding a student is refused while expired'); end;
  perform pg_temp.check((select count(*) from public.subscription_invoices where school_id = sid) = 0, 'principal can read billing (none yet)');
  perform pg_temp.act_admin();
  update public.school_subscriptions set current_period_end = today - 3 where school_id = sid;
  update public.school_subscriptions set status = 'trialing' where school_id = tsid;
  update public.school_subscriptions set current_period_end = today - 2 where school_id = tsid;
  perform pg_temp.check(public.subscription_state(tsid) = 'expired', 'trials get no grace period');

  -- Invoice: min 100 students × ₹10 = ₹1,000 + 18% GST
  perform pg_temp.act_as(pa);
  inv := public.create_subscription_invoice(sid);
  select * into r from public.subscription_invoices where id = inv;
  perform pg_temp.check(r.students = 100 and r.amount = 1000 and r.gst_amount = 180 and r.total = 1180 and r.number ~ '^CDS/\d{4}-\d{2}/\d{4}$', format('invoice %s: 100 students x 10 = 1000 + 180 GST', r.number));
  perform pg_temp.check(r.period_start = today and r.period_end = public.cycle_end(today, 'monthly'), 'invoice after expiry covers today onward');
  perform pg_temp.check(public.create_subscription_invoice(sid) = inv, 'creating it again returns the same invoice');
  perform public.mark_subscription_invoice_paid(inv, 'UTR-1');
  perform pg_temp.check(public.subscription_state(sid) = 'ok' and (select current_period_end from public.school_subscriptions where school_id = sid) = r.period_end, 'paid: active until the invoice period end');
  perform pg_temp.act_admin();

  -- Accountant has no billing access; principal does
  perform pg_temp.act_as(ac);
  perform pg_temp.check((select count(*) from public.subscription_invoices where school_id = sid) = 0, 'accountant cannot see subscription invoices');
  begin
    perform public.mark_subscription_invoice_paid(inv);
    perform pg_temp.check(false, 'school user marked invoice paid');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'only the platform can mark invoices paid'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select count(*) from public.subscription_invoices where school_id = sid) = 1, 'principal sees the invoice');
  perform pg_temp.act_admin();

  -- Renewal run: 5 days before end creates one invoice, and only once
  update public.school_subscriptions set current_period_end = today + 5 where school_id = sid;
  perform pg_temp.act_service();
  select count(*) into n from public.billing_run();
  perform pg_temp.check(n >= 1 and exists (select 1 from public.subscription_invoices where school_id = sid and period_start = today + 6), 'billing run creates the renewal invoice');
  select count(*) into n from public.billing_run() x where x in (select id from public.subscription_invoices where school_id = sid);
  perform pg_temp.check(n = 0, 'billing run does not duplicate it');

  -- Self-registration (server with the secret key)
  newsid := public.register_school('Green Valley Public School', 'CBSE', 'Kanpur', 'eeeeeeee-0000-0000-0000-000000000004', 'Mrs Rao', 'self-signup@test.dev', '9876500000');
  perform pg_temp.check(public.subscription_state(newsid) = 'pending' and (select code from public.schools where id = newsid) like 'green-valley-public-sc%', 'self-registered school waits for approval');
  perform pg_temp.check(exists (select 1 from public.member_roles mr join public.roles ro on ro.id = mr.role_id where mr.user_id = 'eeeeeeee-0000-0000-0000-000000000004' and ro.code = 'principal'), 'registrant becomes Principal');
  begin
    perform public.register_school('Again', 'CBSE', 'X', 'eeeeeeee-0000-0000-0000-000000000004', 'x', 'x@x', '1');
    perform pg_temp.check(false, 'registered twice');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'same login cannot register a second school'); end;
  perform pg_temp.act_as(pr);
  begin
    perform public.register_school('Hack', 'CBSE', 'X', pr, 'x', 'x@x', '1');
    perform pg_temp.check(false, 'signed-in user called register_school');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'register_school is server-only'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pa);
  perform public.approve_school(newsid);
  perform pg_temp.check(public.subscription_state(newsid) = 'trial', 'approved: trial starts');
  perform pg_temp.act_admin();
end $$;

select 'ALL SUBSCRIPTION TESTS PASSED' as result;
rollback;
