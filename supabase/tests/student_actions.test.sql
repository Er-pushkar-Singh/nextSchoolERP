-- One-student actions from the student table: move and promote (step 26).
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
  ('c9c9c9c9-0000-0000-0000-000000000001', 'sa-owner@test.dev'), ('c9c9c9c9-0000-0000-0000-000000000002', 'sa-principal@test.dev'),
  ('c9c9c9c9-0000-0000-0000-000000000003', 'sa-teacher@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('c9c9c9c9-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'c9c9c9c9-0000-0000-0000-000000000001'; pr uuid := 'c9c9c9c9-0000-0000-0000-000000000002'; te uuid := 'c9c9c9c9-0000-0000-0000-000000000003';
  a uuid; c5 uuid; c6 uuid; s5 uuid; s6 uuid; st uuid; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('SA A', 'saa-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'subject_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into c5 from public.classes where school_id = a and name = '5';
  select id into c6 from public.classes where school_id = a and name = '6';
  select id into s5 from public.sections where class_id = c5 order by name limit 1;
  select id into s6 from public.sections where class_id = c6 order by name limit 1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id, roll_no) values (a, 'M1', 'Aarav', c5, s5, 7) returning id into st;

  perform pg_temp.act_as(te);
  begin perform public.move_student(a, st, c6, s6, 'promote'); perform pg_temp.check(false, 'teacher');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a teacher cannot promote a student'); end;
  perform pg_temp.act_as(pr);
  begin perform public.move_student(a, st, c5, s6, 'move'); perform pg_temp.check(false, 'mismatch');
  exception when others then perform pg_temp.check(sqlerrm like '%section of the selected class%', 'the section must belong to the chosen class'); end;
  begin perform public.move_student(a, st, c5, s5, 'move'); perform pg_temp.check(false, 'same');
  exception when others then perform pg_temp.check(sqlerrm like '%already there%', 'moving to the same place is refused'); end;
  perform public.move_student(a, st, c6, s6, 'promote');
  perform pg_temp.check((select class_id = c6 and section_id = s6 and roll_no is null from public.students where id = st), 'promote moves the class and clears the roll number');
  perform pg_temp.check((select outcome = 'promoted' from public.student_enrolments where student_id = st and class_id = c5 order by started_on desc limit 1), 'the old class is kept in the history as promoted');
  perform pg_temp.act_admin();
  update public.students set status = 'left' where id = st;
  perform pg_temp.act_as(pr);
  begin perform public.move_student(a, st, c5, s5, 'move'); perform pg_temp.check(false, 'left');
  exception when others then perform pg_temp.check(sqlerrm like '%on roll%', 'only a student on roll can be moved'); end;
end $$;

rollback;
