-- Offline exams: marks progress, lock, result declaration (step 27).
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
  ('a7a7a7a7-0000-0000-0000-000000000001', 'er-owner@test.dev'), ('a7a7a7a7-0000-0000-0000-000000000002', 'er-principal@test.dev'),
  ('a7a7a7a7-0000-0000-0000-000000000003', 'er-teacher@test.dev'), ('a7a7a7a7-0000-0000-0000-000000000004', 'er-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('a7a7a7a7-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'a7a7a7a7-0000-0000-0000-000000000001'; pr uuid := 'a7a7a7a7-0000-0000-0000-000000000002'; te uuid := 'a7a7a7a7-0000-0000-0000-000000000003';
  ot uuid := 'a7a7a7a7-0000-0000-0000-000000000004';
  a uuid; b uuid; cls uuid; sess uuid; ex uuid; m uuid; e uuid; s1 uuid; s2 uuid; s3 uuid; j jsonb; rw record; n int; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('ER A', 'era-' || sfx);
  b := public.create_school('ER B', 'erb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'subject_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  select id into sess from public.sessions where school_id = a and is_current;
  select id into m from public.subjects where school_id = a order by name limit 1;
  select id into e from public.subjects where school_id = a and id <> m order by name limit 1;
  insert into public.students (school_id, admission_no, first_name, class_id) values (a, 'R1', 'Aarav', cls) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id) values (a, 'R2', 'Diya', cls) returning id into s2;
  insert into public.students (school_id, admission_no, first_name, class_id) values (a, 'R3', 'Kabir', cls) returning id into s3;
  insert into public.exams (school_id, session_id, name) values (a, sess, 'Half Yearly') returning id into ex;
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, max_marks, pass_marks) values (a, ex, cls, m, 100, 40), (a, ex, cls, e, 50, null);

  perform pg_temp.act_as(pr);
  select * into rw from public.exam_marks_progress(a, ex) where class_id = cls;
  perform pg_temp.check(rw.students = 3 and rw.subjects = 2 and rw.expected = 6 and rw.entered = 0 and not rw.locked, 'progress: nothing entered yet');
  insert into public.marks (school_id, exam_id, student_id, subject_id, marks, absent) values
    (a, ex, s1, m, 90, false), (a, ex, s1, e, 45, false),
    (a, ex, s2, m, 39, false), (a, ex, s2, e, 40, false),     -- Diya fails Maths (pass mark 40)
    (a, ex, s3, m, null, true);                              -- Kabir absent in Maths, nothing for English
  select * into rw from public.exam_marks_progress(a, ex) where class_id = cls;
  perform pg_temp.check(rw.entered = 5 and rw.absent = 1, 'progress counts entered cells and absentees');

  begin perform public.declare_exam_result(a, ex, cls); perform pg_temp.check(false, 'incomplete');
  exception when others then perform pg_temp.check(sqlerrm like '%missing%', 'a class with missing marks cannot be declared without force'); end;
  perform pg_temp.act_as(te);
  begin perform public.declare_exam_result(a, ex, cls, true); perform pg_temp.check(false, 'teacher');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a subject teacher cannot declare results'); end;
  perform pg_temp.act_as(pr);
  j := public.declare_exam_result(a, ex, cls, true);
  perform pg_temp.check((j ->> 'students')::int = 3 and (j ->> 'passed')::int = 1 and (j ->> 'failed')::int = 2, 'declare: 3 students, 1 pass, 2 fail');
  select * into rw from public.exam_results where exam_id = ex and student_id = s1;
  perform pg_temp.check(rw.total = 135 and rw.max_total = 150 and rw.percent = 90 and rw.rank = 1 and rw.result = 'pass' and rw.grade = 'A2', 'topper: 135/150 = 90% grade A2 rank 1');
  select * into rw from public.exam_results where exam_id = ex and student_id = s2;
  perform pg_temp.check(rw.result = 'fail' and rw.failed_subjects = 1 and rw.rank = 2, 'a student below the pass mark fails and is ranked second');
  select * into rw from public.exam_results where exam_id = ex and student_id = s3;
  perform pg_temp.check(rw.result = 'fail' and rw.total = 0, 'an absent student with missing marks counts as fail with zero');

  -- locked after declaration
  begin update public.marks set marks = 95 where exam_id = ex and student_id = s1 and subject_id = m; perform pg_temp.check(false, 'edit locked');
  exception when others then perform pg_temp.check(sqlerrm like '%locked%', 'marks cannot be changed after declaration'); end;
  perform public.undo_exam_declaration(a, ex, cls);
  perform pg_temp.check((select count(*) from public.exam_results where exam_id = ex) = 0, 'undo removes the declared results');
  update public.marks set marks = 95 where exam_id = ex and student_id = s1 and subject_id = m;
  perform pg_temp.check((select marks = 95 from public.marks where exam_id = ex and student_id = s1 and subject_id = m), 'after undo marks can be corrected');

  -- withhold and remark
  perform public.declare_exam_result(a, ex, cls, true);
  perform public.withhold_result(a, ex, s2, 'Fees pending');
  perform pg_temp.check((select result = 'withheld' from public.exam_results where exam_id = ex and student_id = s2), 'a result can be withheld with a reason');
  perform public.declare_exam_result(a, ex, cls, true);
  perform pg_temp.check((select result = 'withheld' from public.exam_results where exam_id = ex and student_id = s2), 'a withheld result survives a re-declaration');
  perform public.withhold_result(a, ex, s2, null, true);
  perform pg_temp.check((select result = 'fail' from public.exam_results where exam_id = ex and student_id = s2), 'releasing a withheld result restores pass / fail');
  perform public.set_result_remark(a, ex, s1, 'Excellent work');
  perform pg_temp.check((select remark = 'Excellent work' from public.exam_results where exam_id = ex and student_id = s1), 'a remark is kept on the result');

  -- visibility
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.exam_results) = 0, 'another school cannot read results');
  begin perform public.declare_exam_result(a, ex, cls, true); perform pg_temp.check(false, 'cross');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot declare our results'); end;
end $$;

rollback;
