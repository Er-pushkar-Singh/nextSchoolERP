-- Students & staff management test (step 12). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/people.test.sql
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
  ('bebebebe-0000-0000-0000-000000000001', 'pp-owner@test.dev'),
  ('bebebebe-0000-0000-0000-000000000002', 'pp-principal@test.dev'),
  ('bebebebe-0000-0000-0000-000000000003', 'pp-front@test.dev'),
  ('bebebebe-0000-0000-0000-000000000004', 'pp-teacher@test.dev'),
  ('bebebebe-0000-0000-0000-000000000005', 'pp-other@test.dev'),
  ('bebebebe-0000-0000-0000-000000000006', 'pp-clerk@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('bebebebe-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'bebebebe-0000-0000-0000-000000000001'; pr uuid := 'bebebebe-0000-0000-0000-000000000002';
  fo uuid := 'bebebebe-0000-0000-0000-000000000003'; te uuid := 'bebebebe-0000-0000-0000-000000000004'; ot uuid := 'bebebebe-0000-0000-0000-000000000005';
  cl uuid := 'bebebebe-0000-0000-0000-000000000006';
  a uuid; b uuid; c5 uuid; c6 uuid; secA uuid; secB uuid; sec6 uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; st1 uuid; st2 uuid; st3 uuid; n bigint; i int;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('People A', 'ppla-' || sfx);
  b := public.create_school('People B', 'pplb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fo, 'Front'), (a, te, 'Teacher'), (a, cl, 'Clerk'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fo, 'front_office'), (te, 'class_teacher'), (cl, 'office_admin')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into c5 from public.classes where school_id = a and name = '5';
  select id into c6 from public.classes where school_id = a and name = '6';
  select id into secA from public.sections where class_id = c5 limit 1;
  insert into public.sections (school_id, class_id, name) values (a, c5, 'B') returning id into secB;
  select id into sec6 from public.sections where class_id = c6 limit 1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, father_name, guardian_phone, gender, category, roll_no)
    values (a, 'P1', 'Aarav', 'Sharma', c5, secA, 'Rajesh Sharma', '9811100001', 'M', 'General', 1) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, father_name, guardian_phone, gender, category, roll_no)
    values (a, 'P2', 'Diya', 'Verma', c5, secB, 'Sunil Verma', '9811100002', 'F', 'OBC', 2) returning id into s2;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, father_name, guardian_phone, gender, category, roll_no)
    values (a, 'P3', 'Kabir', 'Khan', c6, sec6, 'Imran Khan', '9811100003', 'M', 'General', 1) returning id into s3;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, father_name, status, left_on, left_reason)
    values (a, 'P4', 'Neha', 'Gupta', c6, 'Ajay Gupta', 'left', current_date, 'Moved') returning id into s4;
  -- 40 more so pagination has something to do
  for i in 1..40 loop
    insert into public.students (school_id, admission_no, first_name, last_name, class_id, father_name) values (a, 'Q' || lpad(i::text, 3, '0'), 'Bulk' || lpad(i::text, 2, '0'), 'Student', c6, 'Father ' || i);
  end loop;
  insert into public.fee_dues (school_id, session_id, student_id, label, due_date, amount)
    select a, id, s1, 'Old', current_date - 5, 700 from public.sessions where school_id = a and is_current;
  insert into public.staff (school_id, name, emp_code, designation, department, kind, phone, user_id, earnings) values
    (a, 'Meena Rani', 'E01', 'PGT Physics', 'Science', 'teaching', '9822200001', te, '[{"name":"Basic","amount":30000}]') returning id into st1;
  insert into public.staff (school_id, name, emp_code, designation, department, kind, phone, earnings) values
    (a, 'Ravi Kumar', 'E02', 'Clerk', 'Office', 'non_teaching', '9822200002', '[{"name":"Basic","amount":15000}]') returning id into st2;
  insert into public.staff (school_id, name, emp_code, designation, department, kind, phone, status) values
    (a, 'Sita Devi', 'E03', 'Helper', 'Support', 'support', '9822200003', 'left') returning id into st3;
  insert into public.staff_assignments (school_id, user_id, section_id) values (a, te, secA);

  -- ── Student list: search, filter, sort, pagination in the database ──
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select count(*) = 25 and min(total) = 43 from public.student_list(a)), 'active students: first page has 25 rows and the total is 43');
  perform pg_temp.check((select count(*) = 18 from public.student_list(a, null, null, null, 'active', null, null, null, null, 'name', 25, 25)), 'second page has the remaining 18');
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P1' from public.student_list(a, 'aarav')), 'search by name (case-insensitive)');
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P2' from public.student_list(a, '9811100002')), 'search by phone');
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P3' from public.student_list(a, 'imran')), 'search by father name');
  perform pg_temp.check((select count(*) = 1 from public.student_list(a, 'P1')), 'search by admission number');
  perform pg_temp.check((select count(*) = 0 from public.student_list(a, '100%')), 'a percent sign in the search is literal, not a wildcard');
  perform pg_temp.check((select count(*) = 2 from public.student_list(a, null, c5)), 'filter by class');
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P2' from public.student_list(a, null, c5, secB)), 'filter by section');
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P4' from public.student_list(a, null, null, null, 'left')), 'filter by status');
  perform pg_temp.check((select min(total) = 44 from public.student_list(a, null, null, null, 'all')), 'status "all" counts every student');
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P2' from public.student_list(a, null, null, null, 'active', 'F')), 'filter by gender');
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P2' from public.student_list(a, null, null, null, 'active', null, 'OBC')), 'filter by category');
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P1' and min(balance) = 700 from public.student_list(a, null, null, null, 'active', null, null, null, 'yes')), 'filter students with dues, with the balance');
  perform pg_temp.check((select admission_no from public.student_list(a, null, null, null, 'active', null, null, null, null, 'dues', 1)) = 'P1', 'sort by dues puts the highest balance first');
  perform pg_temp.check((select first_name from public.student_list(a, null, null, null, 'active', null, null, null, null, 'class', 1)) in ('Aarav', 'Diya'), 'sort by class');

  -- ── Teacher sees only the assigned section (RLS) ──
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) = 1 and min(admission_no) = 'P1' from public.student_list(a)), 'a class teacher''s list contains only the assigned section');
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) = 0 from public.student_list(a)), 'another school sees nobody');

  -- ── Block a student ──
  perform pg_temp.act_as(fo);
  begin perform public.block_student(a, s1, 'Misconduct', null); perform pg_temp.check(false, 'front block');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot block a student'); end;
  perform pg_temp.act_as(pr);
  begin perform public.block_student(a, s1, '', null); perform pg_temp.check(false, 'no reason');
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'blocking needs a reason'); end;
  perform public.block_student(a, s1, 'Misconduct in exam', current_date + 5);
  perform pg_temp.check((select blocked and block_reason = 'Misconduct in exam' from public.student_list(a, 'aarav')), 'the list shows the block and the reason');
  perform pg_temp.check((select count(*) = 1 from public.student_list(a, null, null, null, 'active', null, null, 'yes')), 'filter blocked students');
  begin update public.students set blocked_at = null where id = s1; perform pg_temp.check(false, 'direct');
  exception when others then perform pg_temp.check(sqlerrm like '%Block / Unblock%', 'the block cannot be lifted by a plain update'); end;
  perform pg_temp.act_admin();
  update public.students set blocked_till = current_date - 1 where id = s1;
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select not blocked from public.student_list(a, 'aarav')), 'a block past its end date is no longer in force');
  perform public.unblock_student(a, s1);
  perform pg_temp.check((select block_reason is null from public.student_list(a, 'aarav')), 'unblock clears the block');
  perform pg_temp.check(public.bulk_block_students(a, array[s1, s2], true, 'Fee default', null) = 2, 'bulk block');
  perform pg_temp.check(public.bulk_block_students(a, array[s1, s2], false) = 2, 'bulk unblock');
  n := public.bulk_set_section(a, array[s1], secB);
  perform pg_temp.check(n = 1 and (select section_id = secB from public.students where id = s1), 'bulk move to a section of the same class');
  perform pg_temp.check(public.bulk_set_section(a, array[s3], secB) = 0, 'a student of another class is not moved into that section');

  -- ── Delete a student ──
  begin perform public.delete_student(a, s3, 'WRONG'); perform pg_temp.check(false, 'confirm');
  exception when others then perform pg_temp.check(sqlerrm like '%admission number%', 'delete needs the admission number typed'); end;
  perform pg_temp.act_as(fo);
  begin perform public.delete_student(a, s3, 'P3'); perform pg_temp.check(false, 'front delete');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot delete a student'); end;
  perform pg_temp.act_as(pr);
  insert into public.attendance (school_id, student_id, class_id, date, status) values (a, s3, c6, current_date, 'P');
  begin perform public.delete_student(a, s3, 'P3'); perform pg_temp.check(false, 'history');
  exception when others then perform pg_temp.check(sqlerrm like '%attendance%', 'a student with attendance cannot be deleted'); end;
  perform public.delete_student(a, s4, 'P4');
  perform pg_temp.check(not exists (select 1 from public.students where id = s4), 'a student with no history is deleted');
  perform pg_temp.act_as(ot);
  begin perform public.delete_student(a, s2, 'P2'); perform pg_temp.check(false, 'cross');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot delete our student'); end;

  -- ── Staff list ──
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select count(*) = 2 and min(total) = 2 from public.staff_list(a)), 'working staff: 2');
  perform pg_temp.check((select count(*) = 1 and min(name) = 'Meena Rani' from public.staff_list(a, 'physics')), 'search by designation');
  perform pg_temp.check((select count(*) = 1 and min(name) = 'Ravi Kumar' from public.staff_list(a, null, 'non_teaching')), 'filter by type');
  perform pg_temp.check((select count(*) = 1 and min(name) = 'Sita Devi' from public.staff_list(a, null, null, null, 'left')), 'filter by status');
  perform pg_temp.check((select count(*) = 1 and min(name) = 'Meena Rani' from public.staff_list(a, null, null, null, 'active', 'yes')), 'filter staff with an ERP login');
  perform pg_temp.check((select count(*) = 1 and min(department) = 'Office' from public.staff_list(a, null, null, 'Office')), 'filter by department');
  perform pg_temp.check((select gross = 30000 from public.staff_list(a, 'Meena')), 'gross salary is computed from the structure');

  -- ── Block a staff login: really cuts access ──
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.has_perm_school(a, 'students.profile.view') or public.has_perm(a, 'students.profile.view'), 'before the block the teacher can view students');
  perform pg_temp.act_as(fo);
  begin perform public.block_staff(a, st1, 'x', null); perform pg_temp.check(false, 'front blocks staff');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot block staff'); end;
  perform pg_temp.act_as(cl);
  perform public.block_staff(a, st1, 'Suspended pending inquiry', null);
  perform pg_temp.check((select blocked and block_reason like 'Suspended%' from public.staff_list(a, 'Meena')), 'the office admin blocks a staff member');
  perform pg_temp.act_as(te);
  perform pg_temp.check(not public.has_perm(a, 'students.profile.view'), 'a blocked login has no permissions');
  perform pg_temp.check((select count(*) = 0 from public.my_permissions(a)), 'my_permissions is empty for a blocked login');
  perform pg_temp.check((select count(*) = 0 from public.student_list(a)), 'a blocked login sees no students');
  perform pg_temp.act_as(pr);
  begin perform public.block_staff(a, st1, 'x', null); perform pg_temp.check(true, 'principal blocks'); exception when others then perform pg_temp.check(false, 'principal block raised ' || sqlerrm); end;
  perform public.unblock_staff(a, st1);
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.has_perm(a, 'students.profile.view'), 'unblocking restores access');
  perform pg_temp.act_as(pr);
  begin perform public.set_member_blocked(a, pr, true); perform pg_temp.check(false, 'self'); exception when others then perform pg_temp.check(sqlerrm like '%own login%', 'you cannot block your own login'); end;

  -- ── Delete staff ──
  begin perform public.delete_staff(a, st2, 'someone'); perform pg_temp.check(false, 'confirm'); exception when others then perform pg_temp.check(sqlerrm like '%full name%', 'delete needs the full name typed'); end;
  insert into public.staff_leaves (school_id, staff_id, kind, from_date, to_date, status) values (a, st1, 'CL', current_date, current_date, 'approved');
  begin perform public.delete_staff(a, st1, 'Meena Rani'); perform pg_temp.check(false, 'has leave'); exception when others then perform pg_temp.check(sqlerrm like '%leave%', 'staff with leave records cannot be deleted'); end;
  perform public.delete_staff(a, st2, 'ravi kumar');
  perform pg_temp.check(not exists (select 1 from public.staff where id = st2), 'staff with no history is deleted (name match ignores case)');
  perform pg_temp.act_as(ot);
  begin perform public.delete_staff(a, st3, 'Sita Devi'); perform pg_temp.check(false, 'cross'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot delete our staff'); end;
  perform pg_temp.check((select count(*) = 0 from public.staff_list(a, null, null, null, 'all')), 'another school sees no staff');
end $$;

rollback;
