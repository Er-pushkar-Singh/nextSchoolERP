-- Standard-plan modules test (homework, transport, staff & payroll, library). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/standard_modules.test.sql
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
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
  ('cccccccc-0000-0000-0000-000000000001', 'std-owner@test.dev'),
  ('cccccccc-0000-0000-0000-000000000002', 'std-principal@test.dev'),
  ('cccccccc-0000-0000-0000-000000000003', 'std-maths@test.dev'),
  ('cccccccc-0000-0000-0000-000000000004', 'std-parent@test.dev'),
  ('cccccccc-0000-0000-0000-000000000005', 'std-transport@test.dev'),
  ('cccccccc-0000-0000-0000-000000000006', 'std-accountant@test.dev'),
  ('cccccccc-0000-0000-0000-000000000007', 'std-hr@test.dev'),
  ('cccccccc-0000-0000-0000-000000000008', 'std-librarian@test.dev'),
  ('cccccccc-0000-0000-0000-000000000009', 'std-other-principal@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('cccccccc-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'cccccccc-0000-0000-0000-000000000001'; pr uuid := 'cccccccc-0000-0000-0000-000000000002';
  te uuid := 'cccccccc-0000-0000-0000-000000000003'; pa uuid := 'cccccccc-0000-0000-0000-000000000004';
  tm uuid := 'cccccccc-0000-0000-0000-000000000005'; ac uuid := 'cccccccc-0000-0000-0000-000000000006';
  hr uuid := 'cccccccc-0000-0000-0000-000000000007'; li uuid := 'cccccccc-0000-0000-0000-000000000008';
  pb uuid := 'cccccccc-0000-0000-0000-000000000009';
  a uuid; b uuid; cls uuid; secA uuid; secB uuid; maths uuid; eng uuid; s1 uuid; s2 uuid; g uuid; sess uuid;
  hw uuid; v uuid; r uuid; stop1 uuid; al uuid; n int; x numeric; stf_te uuid; stf_dr uuid; lv uuid; run uuid; bk uuid; iss uuid;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Std A', 'stda-' || sfx);
  b := public.create_school('Std B', 'stdb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Maths Teacher'), (a, tm, 'Transport'),
    (a, ac, 'Accountant'), (a, hr, 'HR'), (a, li, 'Librarian'), (b, pb, 'Principal B');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'subject_teacher'), (tm, 'transport_manager'), (ac, 'accountant'), (hr, 'office_admin'), (li, 'librarian')) x(u, c)
    join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, pb, id from public.roles where school_id = b and code = 'principal';
  insert into public.member_roles (school_id, user_id, role_id) select a, pa, id from public.roles where school_id = a and code = 'parent';
  select id into cls from public.classes where school_id = a and name = '6';
  select id into secA from public.sections where class_id = cls and name = 'A';
  insert into public.sections (school_id, class_id, name) values (a, cls, 'B') returning id into secB;
  select id into maths from public.subjects where school_id = a and name = 'Mathematics';
  select id into eng from public.subjects where school_id = a and name = 'English';
  select id into sess from public.sessions where school_id = a and is_current;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'S1', 'Asha', cls, secA) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'S2', 'Bilal', cls, secB) returning id into s2;
  insert into public.staff_assignments (school_id, user_id, section_id, subject_id) values (a, te, secA, maths);
  insert into public.guardians (school_id, user_id, name) values (a, pa, 'Asha''s mother') returning id into g;
  insert into public.student_guardians (school_id, student_id, guardian_id) values (a, s1, g);

  -- ───────── Regression: server functions refuse users with no grant at all ─────────
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.has_perm_school(a, 'fees.collection.create') = false, 'has_perm_school is false (not null) without a grant');
  begin
    perform public.collect_fee(a, s1, 100, 'cash', null, null, null, 0, 'x');
    perform pg_temp.check(false, 'teacher collected a fee');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'a teacher cannot call collect_fee()'); end;
  begin
    perform public.promote_students(a);
    perform pg_temp.check(false, 'teacher promoted the school');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'a teacher cannot call promote_students()'); end;
  perform pg_temp.act_admin();

  -- ───────── Homework ─────────
  perform pg_temp.act_as(te);
  insert into public.homework (school_id, session_id, class_id, section_id, subject_id, title, due_on) values (a, sess, cls, secA, maths, 'Ex 3.1', current_date + 2) returning id into hw;
  perform pg_temp.check(hw is not null, 'subject teacher sets homework for their section and subject');
  begin
    insert into public.homework (school_id, class_id, section_id, subject_id, title) values (a, cls, secB, maths, 'Not mine');
    perform pg_temp.check(false, 'teacher wrote homework for another section');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'teacher cannot set homework for a section they do not teach'); end;
  begin
    insert into public.homework (school_id, class_id, section_id, subject_id, title) values (a, cls, secA, eng, 'Not my subject');
    perform pg_temp.check(false, 'teacher wrote homework for another subject');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'teacher cannot set homework for a subject they do not teach'); end;
  begin
    insert into public.homework (school_id, class_id, section_id, subject_id, title) values (a, cls, null, maths, 'Whole class');
    perform pg_temp.check(false, 'teacher of one section wrote for the whole class');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'teacher of one section cannot post to the whole class'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  insert into public.homework (school_id, kind, class_id, title, link_url) values (a, 'material', cls, 'Syllabus', 'https://example.com/s.pdf');
  insert into public.homework (school_id, class_id, section_id, title) values (a, cls, secB, 'B only');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pa);
  perform pg_temp.check((select count(*) from public.homework where school_id = a) = 2, 'parent sees their child''s section homework and class material, not other sections');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pb);
  perform pg_temp.check((select count(*) from public.homework where school_id = a) = 0, 'another school sees no homework');
  perform pg_temp.act_admin();

  -- ───────── Transport ─────────
  perform pg_temp.act_as(tm);
  insert into public.transport_vehicles (school_id, reg_no, capacity, driver_name, driver_phone) values (a, 'UP32 AB 1234', 1, 'Ramesh', '9999999999') returning id into v;
  insert into public.transport_routes (school_id, name, vehicle_id) values (a, 'Route 1', v) returning id into r;
  insert into public.transport_stops (school_id, route_id, name, sort, pickup_time, monthly_fee) values (a, r, 'Hazratganj', 1, '07:10', 900) returning id into stop1;
  insert into public.transport_allocations (school_id, session_id, student_id, route_id, stop_id) values (a, sess, s1, r, stop1) returning id into al;
  perform pg_temp.check(al is not null, 'transport manager sets up a vehicle, route, stop and allocates a student');
  begin
    insert into public.transport_allocations (school_id, session_id, student_id, route_id, stop_id) values (a, sess, s2, r, stop1);
    perform pg_temp.check(false, 'over capacity');
  exception when others then perform pg_temp.check(sqlerrm like '%full%', 'vehicle capacity is enforced'); end;
  begin
    perform public.generate_transport_dues(a, sess, 'Apr-Jun', current_date, 3);
    perform pg_temp.check(false, 'transport manager generated fees');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'transport manager cannot bill fees'); end;
  perform pg_temp.act_admin();
  insert into public.student_concessions (school_id, student_id, kind, value) values (a, s1, 'percent', 10);
  perform pg_temp.act_as(pr);
  n := public.generate_transport_dues(a, sess, 'Apr-Jun', current_date, 3);
  perform pg_temp.check(n = 1, 'principal bills transport fees for allocated students');
  perform pg_temp.check((select amount = 2700 and concession = 270 from public.fee_dues where student_id = s1 and source_key is not null), 'transport due = stop fee × months, concession applied');
  n := public.generate_transport_dues(a, sess, 'apr-jun', current_date, 3);
  perform pg_temp.check(n = 0, 'billing the same period again creates nothing');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pa);
  perform pg_temp.check((select count(*) from public.transport_allocations) = 1 and (select count(*) from public.transport_routes where school_id = a) = 1, 'parent sees their child''s route');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.transport_allocations where school_id = a) = 0, 'subject teacher sees no transport data');
  perform pg_temp.act_admin();

  -- ───────── Staff, leave & payroll ─────────
  perform pg_temp.act_as(hr);
  insert into public.staff (school_id, user_id, emp_code, name, earnings, deductions) values
    (a, te, 'E1', 'Maths Teacher', '[{"name":"Basic","amount":30000},{"name":"HRA","amount":6000}]', '[{"name":"PF","amount":1800}]') returning id into stf_te;
  insert into public.staff (school_id, emp_code, name, kind, earnings, joining_date) values
    (a, 'E2', 'Driver', 'support', '[{"name":"Basic","amount":15000}]', date_trunc('month', current_date)::date + 10) returning id into stf_dr;
  perform pg_temp.check(stf_te is not null and stf_dr is not null, 'HR adds staff with and without a login');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.staff where school_id = a) = 1, 'a teacher sees only their own staff record');
  insert into public.staff_leaves (school_id, staff_id, kind, from_date, to_date, reason)
    values (a, stf_te, 'LWP', date_trunc('month', current_date)::date + 2, date_trunc('month', current_date)::date + 3, 'Family') returning id into lv;
  perform pg_temp.check(lv is not null, 'teacher applies for their own leave');
  begin
    insert into public.staff_leaves (school_id, staff_id, from_date, to_date) values (a, stf_dr, current_date, current_date);
    perform pg_temp.check(false, 'teacher applied leave for someone else');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'teacher cannot apply leave for someone else'); end;
  begin
    update public.staff_leaves set status = 'approved' where id = lv;
    perform pg_temp.check(false, 'teacher approved own leave');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'teacher cannot approve their own leave'); end;
  begin
    insert into public.staff_leaves (school_id, staff_id, from_date, to_date) values (a, stf_te, date_trunc('month', current_date)::date + 3, date_trunc('month', current_date)::date + 4);
    perform pg_temp.check(false, 'overlap accepted');
  exception when others then perform pg_temp.check(sqlerrm like '%already%', 'overlapping leave is refused'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  update public.staff_leaves set status = 'approved' where id = lv;
  perform pg_temp.check((select status = 'approved' and decided_by = pr from public.staff_leaves where id = lv), 'principal approves the leave (stamped)');
  run := public.generate_payroll(a, current_date, 30);
  perform pg_temp.check((select count(*) from public.payslips where run_id = run) = 2, 'payroll creates a payslip per salaried employee');
  perform pg_temp.check((select lop_days = 2 and gross = 33600 and total_deductions = 1800 and net = 31800 from public.payslips where run_id = run and staff_id = stf_te),
    'leave without pay is deducted pro rata (36000 × 28/30 − 1800)');
  perform pg_temp.check((select lop_days = 10 from public.payslips where run_id = run and staff_id = stf_dr), 'days before joining are unpaid');
  update public.payslips set adjustment = 500, adjustment_note = 'Bonus' where run_id = run and staff_id = stf_te;
  perform pg_temp.check((select net = 32300 from public.payslips where run_id = run and staff_id = stf_te), 'adjustment changes net pay');
  begin
    update public.payslips set paid_on = current_date where run_id = run;
    perform pg_temp.check(false, 'paid before approval');
  exception when others then perform pg_temp.check(sqlerrm like '%Approve%', 'salaries cannot be marked paid before approval'); end;
  update public.payroll_runs set status = 'approved' where id = run;
  begin
    update public.payslips set lop_days = 0 where run_id = run;
    perform pg_temp.check(false, 'edited approved payroll');
  exception when others then perform pg_temp.check(sqlerrm like '%locked%', 'approved payroll is locked'); end;
  update public.payslips set paid_on = current_date, pay_mode = 'bank_transfer' where run_id = run and staff_id = stf_te;
  begin
    update public.payroll_runs set status = 'draft' where id = run;
    perform pg_temp.check(false, 'reopened a paid month');
  exception when others then perform pg_temp.check(sqlerrm like '%paid%', 'a month with paid salaries cannot be reopened'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.payslips where school_id = a) = 1, 'a teacher sees only their own payslip once approved');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(ac);
  begin
    update public.payroll_runs set status = 'draft' where id = run;
    get diagnostics n = row_count;
    perform pg_temp.check(n = 0, 'accountant cannot reopen payroll');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'accountant cannot reopen payroll'); end;
  perform pg_temp.act_admin();

  -- ───────── Library ─────────
  perform pg_temp.act_as(li);
  insert into public.library_books (school_id, accession_no, title, author, copies) values (a, 'A-1', 'Wings of Fire', 'A. P. J. Abdul Kalam', 1) returning id into bk;
  insert into public.library_issues (school_id, book_id, student_id, due_on) values (a, bk, s1, current_date + 14) returning id into iss;
  perform pg_temp.check(iss is not null, 'librarian adds a book and issues it');
  begin
    insert into public.library_issues (school_id, book_id, student_id, due_on) values (a, bk, s2, current_date + 14);
    perform pg_temp.check(false, 'issued more copies than exist');
  exception when others then perform pg_temp.check(sqlerrm like '%copies%', 'cannot issue more copies than the library has'); end;
  update public.library_issues set returned_on = current_date where id = iss;
  insert into public.library_issues (school_id, book_id, student_id, due_on) values (a, bk, s2, current_date + 14);
  perform pg_temp.check(true, 'a returned copy can be issued again');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pa);
  perform pg_temp.check((select count(*) from public.library_issues where school_id = a) = 1, 'parent sees only their child''s library history');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pb);
  perform pg_temp.check((select count(*) from public.library_books where school_id = a) + (select count(*) from public.staff where school_id = a) = 0, 'another school sees no books or staff');
  perform pg_temp.act_admin();

  -- ───────── Module switched off / read-only ─────────
  update public.school_modules set licensed = false where school_id = a and module_code = 'library';
  perform pg_temp.act_as(li);
  begin
    insert into public.library_books (school_id, title) values (a, 'Unlicensed');
    perform pg_temp.check(false, 'wrote into an unlicensed module');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'an unlicensed module refuses writes'); end;
  perform pg_temp.act_admin();
  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and entity = 'payslips'), 'payroll changes are audited');
end $$;

select 'ALL STANDARD MODULE TESTS PASSED' as result;
rollback;
