-- Academic setup: curriculum, allocation, syllabus (step 23).
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
  ('e5e5e5e5-0000-0000-0000-000000000001', 'ac2-owner@test.dev'), ('e5e5e5e5-0000-0000-0000-000000000002', 'ac2-principal@test.dev'),
  ('e5e5e5e5-0000-0000-0000-000000000003', 'ac2-teacher@test.dev'), ('e5e5e5e5-0000-0000-0000-000000000004', 'ac2-teacher2@test.dev'),
  ('e5e5e5e5-0000-0000-0000-000000000005', 'ac2-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('e5e5e5e5-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'e5e5e5e5-0000-0000-0000-000000000001'; pr uuid := 'e5e5e5e5-0000-0000-0000-000000000002'; t1 uuid := 'e5e5e5e5-0000-0000-0000-000000000003';
  t2 uuid := 'e5e5e5e5-0000-0000-0000-000000000004'; ot uuid := 'e5e5e5e5-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; cls2 uuid; sec uuid; sec2 uuid; sess uuid; sess2 uuid; maths uuid; eng uuid; n int; u1 uuid; u2 uuid; rw record;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('AC2 A', 'ac2a-' || sfx);
  b := public.create_school('AC2 B', 'ac2b-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, t1, 'Teacher One'), (a, t2, 'Teacher Two'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (t1, 'subject_teacher'), (t2, 'subject_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  select id into cls2 from public.classes where school_id = a and name = '6';
  select id into sec from public.sections where class_id = cls order by name limit 1;
  select id into sec2 from public.sections where class_id = cls2 order by name limit 1;
  select id into sess from public.sessions where school_id = a and is_current;
  insert into public.sessions (school_id, name, start_date, end_date) values (a, 'NEXT-' || sfx, current_date + 200, current_date + 560) returning id into sess2;
  select id into maths from public.subjects where school_id = a order by name limit 1;
  select id into eng from public.subjects where school_id = a and id <> maths order by name limit 1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'AC1', 'Aarav', cls, sec), (a, 'AC2', 'Diya', cls, sec);

  -- curriculum
  perform pg_temp.act_as(pr);
  insert into public.class_subjects (school_id, class_id, subject_id, periods_per_week) values (a, cls, maths, 6), (a, cls, eng, 5);
  perform pg_temp.check((select count(*) from public.class_subjects) = 2, 'the principal maps subjects to a class');
  begin insert into public.class_subjects (school_id, class_id, subject_id) values (a, cls, maths); perform pg_temp.check(false, 'dup');
  exception when unique_violation then perform pg_temp.check(true, 'a subject is mapped to a class once'); end;
  perform pg_temp.act_as(t1);
  begin insert into public.class_subjects (school_id, class_id, subject_id) values (a, cls2, maths); perform pg_temp.check(false, 'teacher map');
  exception when insufficient_privilege then perform pg_temp.check(true, 'a teacher cannot change the curriculum'); end;
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.class_subjects) = 0, 'another school cannot read the curriculum');

  -- allocation
  perform pg_temp.act_as(pr);
  perform public.set_class_teacher(a, sec, t1);
  perform public.set_subject_teacher(a, sec, maths, t2);
  select * into rw from public.academic_overview(a) where section_id = sec;
  perform pg_temp.check(rw.students = 2 and rw.class_teacher_name = 'Teacher One' and rw.subjects_mapped = 2 and rw.subjects_staffed = 1, 'overview: students, class teacher, mapped and staffed subjects');
  perform public.set_class_teacher(a, sec, t2);
  perform pg_temp.check((select count(*) from public.staff_assignments where section_id = sec and is_class_teacher) = 1 and (select class_teacher_id = t2 from public.sections where id = sec), 'changing the class teacher keeps exactly one');
  perform public.set_subject_teacher(a, sec, maths, t1);
  perform pg_temp.check((select count(*) from public.staff_assignments where section_id = sec and subject_id = maths) = 1, 'changing a subject teacher replaces the previous one');
  begin perform public.set_class_teacher(a, sec, ot); perform pg_temp.check(false, 'outsider');
  exception when others then perform pg_temp.check(sqlerrm like '%does not have a login%', 'a person from another school cannot be allocated'); end;
  perform pg_temp.act_as(t1);
  begin perform public.set_class_teacher(a, sec, t1); perform pg_temp.check(false, 'teacher alloc');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a teacher cannot allocate teachers'); end;

  -- syllabus: t1 teaches maths in class 5 (assigned); t2 is class teacher of 5-A (assigned, subject null) so also allowed
  insert into public.syllabus_units (school_id, session_id, class_id, subject_id, no, title) values (a, sess, cls, maths, 1, 'Numbers') returning id into u1;
  perform pg_temp.check(u1 is not null, 'an assigned teacher can add a syllabus unit for their class and subject');
  begin insert into public.syllabus_units (school_id, session_id, class_id, subject_id, no, title) values (a, sess, cls2, maths, 1, 'Fractions'); perform pg_temp.check(false, 'other class');
  exception when insufficient_privilege then perform pg_temp.check(true, 'a teacher cannot write syllabus of a class they are not assigned to'); end;
  update public.syllabus_units set status = 'done' where id = u1;
  perform pg_temp.check((select completed_on = public.today_ist() and updated_by_name = 'Teacher One' from public.syllabus_units where id = u1), 'completing a unit stamps the date and who');
  begin perform public.verify_syllabus_unit(u1); perform pg_temp.check(false, 'teacher verify');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a teacher cannot verify coverage'); end;
  perform pg_temp.act_as(pr);
  insert into public.syllabus_units (school_id, session_id, class_id, subject_id, no, title) values (a, sess, cls, maths, 2, 'Geometry') returning id into u2;
  perform public.verify_syllabus_unit(u1);
  perform pg_temp.check((select verified_by_name = 'Principal' from public.syllabus_units where id = u1), 'the principal verifies a completed unit');
  begin perform public.verify_syllabus_unit(u2); perform pg_temp.check(false, 'pending verify');
  exception when others then perform pg_temp.check(sqlerrm like '%completed unit%', 'a pending unit cannot be verified'); end;
  update public.syllabus_units set title = 'Numbers and place value' where id = u1;
  perform pg_temp.check((select verified_at is null from public.syllabus_units where id = u1), 'editing a verified unit removes the verification');

  select * into rw from public.syllabus_progress(a, sess, cls) where subject_id = maths;
  perform pg_temp.check(rw.units = 2 and rw.done = 1 and rw.pct = 50, 'progress: 1 of 2 units done = 50%');
  n := public.copy_syllabus(a, sess, sess2);
  perform pg_temp.check(n = 2 and (select count(*) from public.syllabus_units where session_id = sess2 and status = 'pending') = 2, 'copying the syllabus to the next session starts everything pending');
  perform pg_temp.check(public.copy_syllabus(a, sess, sess2) = 0, 'copying twice adds nothing');
end $$;

rollback;
