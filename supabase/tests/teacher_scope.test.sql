-- A teacher (scope "assigned") sees exactly the students of the sections assigned to them: none before the assignment, those after it.
-- Run on a THROWAWAY database after all migrations:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/teacher_scope.test.sql
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
  ('f1f1f1f1-0000-0000-0000-000000000001', 'ts-owner@test.dev'),
  ('f1f1f1f1-0000-0000-0000-000000000002', 'ts-teacher@test.dev'),
  ('f1f1f1f1-0000-0000-0000-000000000003', 'ts-principal@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('f1f1f1f1-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'f1f1f1f1-0000-0000-0000-000000000001'; te uuid := 'f1f1f1f1-0000-0000-0000-000000000002'; pr uuid := 'f1f1f1f1-0000-0000-0000-000000000003';
  a uuid; c uuid; s1 uuid; s2 uuid; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Teacher Scope', 'tsc-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name, email) values (a, te, 'Teacher', 'ts-teacher@test.dev'), (a, pr, 'Principal', 'ts-principal@test.dev');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (te, 'class_teacher'), (pr, 'principal')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into c from public.classes where school_id = a order by sort limit 1;
  insert into public.sections (school_id, class_id, name) values (a, c, 'X') returning id into s1;
  insert into public.sections (school_id, class_id, name) values (a, c, 'Y') returning id into s2;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id, status)
    values (a, 'T1', 'Asha', c, s1, 'active'), (a, 'T2', 'Bala', c, s1, 'active'), (a, 'T3', 'Chitra', c, s2, 'active');
  insert into public.staff (school_id, name, user_id, status) values (a, 'Teacher', te, 'active');

  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.students) = 0, 'a teacher with no assigned class sees no students');
  perform pg_temp.check((select count(*) from public.student_list(a)) = 0, 'and the student list is empty');
  perform pg_temp.check(public.my_staff_id(a) is not null, 'but the teacher still reaches their own staff record');
  perform pg_temp.act_admin();

  -- the principal assigns the teacher as class teacher of section X
  perform pg_temp.act_as(pr);
  insert into public.staff_assignments (school_id, user_id, section_id, is_class_teacher) values (a, te, s1, true);
  perform pg_temp.act_admin();

  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.students) = 2, 'after the assignment the teacher sees the two students of the section');
  perform pg_temp.check((select count(*) from public.student_list(a)) = 2 and (select max(total) from public.student_list(a)) = 2, 'the paged list and its total agree');
  perform pg_temp.check(not exists (select 1 from public.students where first_name = 'Chitra'), 'students of other sections stay hidden');
  perform pg_temp.check((select count(*) from public.student_list(a, 'asha')) = 1, 'search works inside the teacher''s own class');
  perform pg_temp.check((select count(*) from public.student_list(a, null, null, s2)) = 0, 'asking for another section returns nothing');
  perform pg_temp.act_admin();

  perform pg_temp.act_as(pr);
  perform pg_temp.check((select count(*) from public.students) = 3, 'the principal sees every section');
  perform pg_temp.act_admin();
end $$;

select 'ALL TEACHER SCOPE TESTS PASSED' as result;
rollback;
