-- Payroll v2: attendance LOP, PF / ESI / PT, advances, salary history (step 24).
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email) values
  ('f6f6f6f6-0000-0000-0000-000000000001', 'pr-owner@test.dev'), ('f6f6f6f6-0000-0000-0000-000000000002', 'pr-principal@test.dev'),
  ('f6f6f6f6-0000-0000-0000-000000000003', 'pr-accountant@test.dev'), ('f6f6f6f6-0000-0000-0000-000000000004', 'pr-teacher@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('f6f6f6f6-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'f6f6f6f6-0000-0000-0000-000000000001'; pr uuid := 'f6f6f6f6-0000-0000-0000-000000000002'; ac uuid := 'f6f6f6f6-0000-0000-0000-000000000003';
  te uuid := 'f6f6f6f6-0000-0000-0000-000000000004';
  a uuid; s1 uuid; s2 uuid; s3 uuid; run uuid; adv uuid; m date := date_trunc('month', current_date)::date; rw record; n int; ps record;
  sfx text := substr(md5(random()::text), 1, 6); d1 date;
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('PR A', 'pra-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, ac, 'Accountant'), (a, te, 'Teacher');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (ac, 'accountant'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  -- three staff: 30,000 (Basic 20,000 + HRA 10,000), 14,000 (Basic only), 60,000
  insert into public.staff (school_id, name, kind, earnings, deductions, joining_date) values
    (a, 'Meena', 'teaching', '[{"name":"Basic","amount":20000},{"name":"HRA","amount":10000}]', '[]', date '2020-01-01') returning id into s1;
  insert into public.staff (school_id, name, kind, earnings, deductions, joining_date) values
    (a, 'Ravi', 'non_teaching', '[{"name":"Basic","amount":14000}]', '[{"name":"Tea fund","amount":100}]', date '2020-01-01') returning id into s2;
  insert into public.staff (school_id, name, kind, earnings, deductions, joining_date, pf_applicable) values
    (a, 'Sunita', 'teaching', '[{"name":"Basic","amount":40000},{"name":"HRA","amount":20000}]', '[]', date '2020-01-01', false) returning id into s3;
  -- 4 working days in the month marked: Meena absent 2 days, half day 1
  d1 := m;
  insert into public.staff_attendance (school_id, staff_id, date, status) values (a, s1, d1, 'A'), (a, s1, d1 + 1, 'A'), (a, s1, d1 + 2, 'H'), (a, s1, d1 + 3, 'P');

  -- accountant cannot change statutory settings, principal can
  perform pg_temp.act_as(ac);
  begin insert into public.payroll_settings (school_id) values (a); perform pg_temp.check(false, 'acc settings');
  exception when insufficient_privilege then perform pg_temp.check(true, 'an accountant cannot change payroll settings'); end;
  perform pg_temp.act_as(pr);
  insert into public.payroll_settings (school_id, use_attendance, pf_on, esi_on, pt_on) values (a, true, true, true, true);

  -- generate with 30 working days
  run := public.generate_payroll(a, m, 30);
  select * into ps from public.payslips where run_id = run and staff_id = s1;
  perform pg_temp.check(ps.att_lop = 2.5 and ps.lop_days = 2.5, 'absent days from attendance become unpaid days (2 absent + 1 half = 2.5)');
  -- earned basic = 20000 * 27.5/30 = 18333; PF 12% of min(18333,15000) = 1800
  perform pg_temp.check(ps.pf_employee = 1800 and ps.employer_pf = 1800, 'PF is 12% of basic capped at the ceiling');
  perform pg_temp.check(ps.esi_employee = 0, 'ESI does not apply above the wage ceiling');
  perform pg_temp.check(ps.prof_tax = 200, 'professional tax uses the slab (above 15,000)');
  perform pg_temp.check(ps.total_deductions = 1800 + 200 and ps.gross = round(20000 * 27.5 / 30) + round(10000 * 27.5 / 30), 'deductions and gross add up');

  select * into ps from public.payslips where run_id = run and staff_id = s2;
  -- gross 14000, ESI 0.75% = 105, PF 12% of 14000 = 1680, PT slab upto 15000 = 0
  perform pg_temp.check(ps.pf_employee = 1680 and ps.esi_employee = 105 and ps.employer_esi = 455 and ps.prof_tax = 0, 'ESI applies under the ceiling with employer share; PF below the cap');
  perform pg_temp.check(ps.total_deductions = 1680 + 105 + 100, 'the fixed deduction (tea fund) is kept next to the automatic ones');

  select * into ps from public.payslips where run_id = run and staff_id = s3;
  perform pg_temp.check(ps.pf_employee = 0 and ps.prof_tax = 200 and ps.esi_employee = 0, 'a staff member marked not PF applicable pays no PF');

  -- editing unpaid days recomputes the automatic lines
  update public.payslips set lop_days = 0 where run_id = run and staff_id = s1;
  select * into ps from public.payslips where run_id = run and staff_id = s1;
  perform pg_temp.check(ps.gross = 30000 and ps.pf_employee = 1800 and ps.total_deductions = 2000, 'editing unpaid days recalculates gross and deductions');

  -- advances
  adv := public.add_advance(a, s2, 3000, 1000, current_date, 'Medical');
  begin perform public.add_advance(a, s2, 1000, 2000, null, null); perform pg_temp.check(false, 'emi');
  exception when others then perform pg_temp.check(sqlerrm like '%monthly recovery%', 'the monthly recovery cannot exceed the advance'); end;
  perform pg_temp.act_as(te);
  begin perform public.add_advance(a, s2, 1000, 100, null, null); perform pg_temp.check(false, 'teacher adv');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a teacher cannot record advances'); end;
  perform pg_temp.act_as(pr);
  run := public.generate_payroll(a, m, 30);
  select * into ps from public.payslips where run_id = run and staff_id = s2;
  perform pg_temp.check(ps.advance_recovery = 1000 and ps.total_deductions = 1680 + 105 + 100 + 1000, 'the monthly instalment is deducted on the payslip');
  update public.payroll_runs set status = 'approved' where id = run;
  perform pg_temp.check((select balance = 2000 and status = 'active' from public.staff_advances where id = adv), 'approving the payroll reduces the advance balance');
  perform pg_temp.check((select count(*) from public.advance_recoveries) = 1, 'the recovery is recorded against the payslip');
  begin perform public.cancel_advance(adv); perform pg_temp.check(false, 'cancel');
  exception when others then perform pg_temp.check(sqlerrm like '%already been recovered%', 'a partly recovered advance cannot be cancelled'); end;
  update public.payroll_runs set status = 'draft' where id = run;
  perform pg_temp.check((select balance = 3000 from public.staff_advances where id = adv) and (select count(*) from public.advance_recoveries) = 0, 'reopening the payroll gives the instalment back');

  -- approved slips keep their figures if settings change
  update public.payroll_runs set status = 'approved' where id = run;
  update public.payroll_settings set pf_rate = 20 where school_id = a;
  update public.payslips set paid_on = current_date, pay_mode = 'bank_transfer' where run_id = run and staff_id = s1;
  select * into ps from public.payslips where run_id = run and staff_id = s1;
  perform pg_temp.check(ps.pf_employee = 1800, 'an approved payslip is not recalculated when settings change');

  -- salary history
  update public.staff set earnings = '[{"name":"Basic","amount":22000},{"name":"HRA","amount":10000}]' where id = s1;
  select * into rw from public.staff_salary_history where staff_id = s1 order by created_at desc limit 1;
  perform pg_temp.check(rw.old_gross = 30000 and rw.new_gross = 32000, 'a salary change is logged with old and new gross');
end $$;

rollback;
