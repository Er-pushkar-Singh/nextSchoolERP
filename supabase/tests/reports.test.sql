-- Reports & analysis (step 33).
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
  ('b4b4b4b4-0000-0000-0000-000000000001', 'rp-owner@test.dev'), ('b4b4b4b4-0000-0000-0000-000000000002', 'rp-principal@test.dev'),
  ('b4b4b4b4-0000-0000-0000-000000000003', 'rp-teacher@test.dev'), ('b4b4b4b4-0000-0000-0000-000000000004', 'rp-accountant@test.dev'),
  ('b4b4b4b4-0000-0000-0000-000000000005', 'rp-warden@test.dev'), ('b4b4b4b4-0000-0000-0000-000000000006', 'rp-nobody@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('b4b4b4b4-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'b4b4b4b4-0000-0000-0000-000000000001'; pr uuid := 'b4b4b4b4-0000-0000-0000-000000000002'; te uuid := 'b4b4b4b4-0000-0000-0000-000000000003'; ac uuid := 'b4b4b4b4-0000-0000-0000-000000000004';
  wd uuid := 'b4b4b4b4-0000-0000-0000-000000000005'; nb uuid := 'b4b4b4b4-0000-0000-0000-000000000006';
  a uuid; cls uuid; sess uuid; s1 uuid; s2 uuid; s3 uuid; ex uuid; sub uuid; j jsonb; n int; rw record; d date := public.today_ist(); sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('RP A', 'rpa-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher'), (a, ac, 'Accountant'), (a, wd, 'Warden'), (a, nb, 'Nobody');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher'), (ac, 'accountant'), (wd, 'hostel_warden')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into cls from public.classes where school_id = a and name = '5';
  select id into sess from public.sessions where school_id = a and is_current;
  select id into sub from public.subjects where school_id = a order by name limit 1;
  insert into public.students (school_id, admission_no, first_name, class_id, gender, category, admission_date) values (a, 'R1', 'Aarav', cls, 'M', 'General', d) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, gender, category, admission_date) values (a, 'R2', 'Diya', cls, 'F', 'OBC', d) returning id into s2;
  insert into public.students (school_id, admission_no, first_name, class_id, gender, category, admission_date) values (a, 'R3', 'Isha', cls, 'F', 'SC', d) returning id into s3;
  insert into public.attendance (school_id, student_id, class_id, date, status) values (a, s1, cls, d, 'P'), (a, s2, cls, d, 'P'), (a, s3, cls, d, 'A');
  insert into public.exams (school_id, session_id, name, sort) values (a, sess, 'Unit Test', 1) returning id into ex;
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, max_marks) values (a, ex, cls, sub, 100);
  insert into public.marks (school_id, exam_id, student_id, subject_id, marks) values (a, ex, s1, sub, 90), (a, ex, s2, sub, 60), (a, ex, s3, sub, 20);

  perform pg_temp.act_as(pr);
  perform public.declare_exam_result(a, ex, cls, true);
  j := public.report_overview(a, d - 30, d);
  perform pg_temp.check((j ->> 'students')::int = 3 and (j ->> 'girls')::int = 2 and (j ->> 'admitted')::int = 3, 'overview counts students, girls and new admissions');
  perform pg_temp.check((j ->> 'student_att_pct')::numeric = 66.7 and j ->> 'last_exam' = 'Unit Test', 'overview: attendance 66.7% and the latest declared exam');
  perform pg_temp.check((j ->> 'last_exam_avg')::numeric = 56.7 and (j ->> 'last_exam_pass')::numeric = 66.7, 'overview: exam average 56.7% and pass rate 66.7%');
  select * into rw from public.report_enrolment(a) where class_id = cls;
  perform pg_temp.check(rw.total = 3 and rw.boys = 1 and rw.girls = 2 and rw.general = 1 and rw.obc = 1 and rw.sc = 1, 'enrolment splits gender and category');
  select * into rw from public.report_attendance_by_class(a, d, d) where class_id = cls;
  perform pg_temp.check(rw.present = 2 and rw.absent = 1 and rw.pct = 66.7 and rw.low_students = 1, 'attendance by class with one student below 75%');
  select * into rw from public.report_exam_by_class(a, ex) where class_id = cls;
  perform pg_temp.check(rw.students = 3 and rw.pass_percent = 66.7 and rw.topper = 'Aarav' and rw.failed = 1, 'exam by class: pass %, topper and failures');
  select count(*) into n from public.report_exam_by_subject(a, ex);
  perform pg_temp.check(n >= 1, 'exam by subject returns a row per class and subject');
  perform pg_temp.check((select count(*) from public.report_fee_monthly(a, 6)) = 6, 'fee by month returns six months');
  perform pg_temp.check((select sum(total) from public.report_udise_strength(a)) = 3, 'UDISE strength totals the active students');

  -- an assigned teacher sees the result analysis of own class only
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.report_exam_by_class(a, ex)) = 0, 'a teacher with no section assigned sees no class in the exam analysis');
  perform pg_temp.act_admin();
  insert into public.staff_assignments (school_id, user_id, section_id, is_class_teacher) select a, te, id, true from public.sections where class_id = cls order by name limit 1;
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.report_exam_by_class(a, ex)) = 1, 'after assignment the teacher sees own class in the exam analysis');
  perform pg_temp.check((select count(*) from public.report_enrolment(a)) = 1, 'and only own class in enrolment');
  begin perform public.report_overview(a, d, d); perform pg_temp.check(false, 'teacher overview');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot open the principal dashboard'); end;
  perform pg_temp.act_as(ac);
  begin perform public.report_overview(a, d, d); perform pg_temp.check(true, 'accountant overview allowed (view)'); exception when others then perform pg_temp.check(false, 'accountant overview'); end;
  perform pg_temp.check((select count(*) from public.report_fee_by_class(a)) >= 1, 'the accountant can read the fee report');
  begin perform public.report_exam_by_class(a, ex); perform pg_temp.check(false, 'acc exam');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'the accountant cannot read exam analysis'); end;
  -- pickers for people who have no student-profile access
  perform pg_temp.act_as(wd);
  perform pg_temp.check((select count(*) from public.student_lookup(a, 'aar')) = 1, 'a hostel warden finds a student by name for a bed');
  perform pg_temp.check((select count(*) from public.staff_lookup(a, 'a')) >= 0, 'the warden may use the staff finder');
  perform pg_temp.act_as(nb);
  perform pg_temp.check((select count(*) from public.student_lookup(a, 'aar')) = 0, 'someone with no role finds no students');
end $$;

rollback;

