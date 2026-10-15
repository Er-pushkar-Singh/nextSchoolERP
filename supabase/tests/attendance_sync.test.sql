-- Attendance synchronisation (step 34): the day summary follows the student's current section.
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

insert into auth.users (id, email) values ('c5c5c5c5-0000-0000-0000-000000000001', 'as-owner@test.dev'), ('c5c5c5c5-0000-0000-0000-000000000002', 'as-principal@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('c5c5c5c5-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'c5c5c5c5-0000-0000-0000-000000000001'; pr uuid := 'c5c5c5c5-0000-0000-0000-000000000002';
  a uuid; cls uuid; sec1 uuid; sec2 uuid; s1 uuid; s2 uuid; rw record; d date := public.today_ist(); sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('AS A', 'asa-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal');
  insert into public.member_roles (school_id, user_id, role_id) select a, pr, id from public.roles where school_id = a and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  select id into sec1 from public.sections where class_id = cls order by name limit 1;
  insert into public.sections (school_id, class_id, name) values (a, cls, 'Z') returning id into sec2;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'AS1', 'Aarav', cls, sec1) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'AS2', 'Diya', cls, sec1) returning id into s2;
  insert into public.attendance (school_id, student_id, class_id, section_id, date, status, source) values (a, s1, cls, sec1, d, 'P', 'qr'), (a, s2, cls, sec1, d, 'A', 'manual');

  perform pg_temp.act_as(pr);
  select * into rw from public.attendance_summary(a, d) where section_id = sec1;
  perform pg_temp.check(rw.marked = 2 and rw.present = 1 and rw.absent = 1, 'the day summary counts both marks in the section');

  -- the student moves to another section: the day's mark and the summary follow
  perform pg_temp.act_admin();
  update public.students set section_id = sec2 where id = s1;
  perform pg_temp.act_as(pr);
  select * into rw from public.attendance_summary(a, d) where section_id = sec2;
  perform pg_temp.check(rw.marked = 1 and rw.present = 1, 'the scanned student is counted in the new section');
  perform pg_temp.check((select section_id = sec2 from public.attendance where student_id = s1 and date = d), 'today''s mark moved with the student');
  select * into rw from public.attendance_summary(a, d) where section_id = sec1;
  perform pg_temp.check(rw.marked = 1 and rw.absent = 1, 'the old section keeps only its own student');

  -- a past mark keeps the section it was made in
  perform pg_temp.act_admin();
  insert into public.attendance (school_id, student_id, class_id, section_id, date, status) values (a, s2, cls, sec1, d - 3, 'P');
  update public.students set section_id = sec2 where id = s2;
  perform pg_temp.check((select section_id = sec1 from public.attendance where student_id = s2 and date = d - 3), 'a past mark keeps the section of that day');
end $$;

rollback;
