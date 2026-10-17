-- Permission answers are remembered for one request (migration 0045) — but never after something they depend on changed.
-- Run on a THROWAWAY database after all migrations:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/perm_memo.test.sql
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
  ('bebebebe-0000-0000-0000-000000000001', 'pm-owner@test.dev'),
  ('bebebebe-0000-0000-0000-000000000002', 'pm-teacher@test.dev'),
  ('bebebebe-0000-0000-0000-000000000003', 'pm-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('bebebebe-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'bebebebe-0000-0000-0000-000000000001'; te uuid := 'bebebebe-0000-0000-0000-000000000002'; ot uuid := 'bebebebe-0000-0000-0000-000000000003';
  a uuid; b uuid; c uuid; sx uuid; sy uuid; s1 uuid; s2 uuid; rid uuid; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Memo A', 'pma-' || sfx);
  b := public.create_school('Memo B', 'pmb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, te, 'Teacher'), (b, ot, 'Other');
  select id into c from public.classes where school_id = a order by sort limit 1;
  insert into public.sections (school_id, class_id, name) values (a, c, 'M') returning id into sx;
  insert into public.sections (school_id, class_id, name) values (a, c, 'N') returning id into sy;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id, status) values (a, 'M1', 'Asha', c, sx, 'active') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id, status) values (a, 'M2', 'Bala', c, sy, 'active') returning id into s2;

  -- no role yet: nothing, and the answer is asked twice (the second one comes from memory)
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') is null and public.perm_scope(a, 'students.profile.view') is null, 'a login without a role has no permission (asked twice)');
  perform pg_temp.check((select count(*) from public.students) = 0, 'and sees no students');
  perform pg_temp.act_admin();

  -- role given in the same transaction: the remembered "no" must not survive
  insert into public.member_roles (school_id, user_id, role_id) select a, te, id from public.roles where school_id = a and code = 'class_teacher';
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') = 'assigned', 'a new role is seen at once');
  perform pg_temp.check((select count(*) from public.students) = 0, 'assigned scope without an assignment still sees no students');
  perform pg_temp.act_admin();

  -- assignment added: the remembered "not assigned" must not survive
  insert into public.staff_assignments (school_id, user_id, section_id, is_class_teacher) values (a, te, sx, true);
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.students) = 1 and public.assigned_to_section(a, sx) and not public.assigned_to_section(a, sy), 'a new assignment is seen at once');
  perform pg_temp.act_admin();
  delete from public.staff_assignments where user_id = te;
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.students) = 0 and not public.assigned_to_section(a, sx), 'a removed assignment is gone at once');
  perform pg_temp.act_admin();
  insert into public.staff_assignments (school_id, user_id, section_id, is_class_teacher) values (a, te, sx, true);

  -- a permission removed from the role
  select id into rid from public.roles where school_id = a and code = 'class_teacher';
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') = 'assigned', 'before: the role grants it');
  perform pg_temp.act_admin();
  delete from public.role_permissions where role_id = rid and perm_key = 'students.profile.view';
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') is null and (select count(*) from public.students) = 0, 'after: a removed permission is gone at once');
  perform pg_temp.act_admin();

  -- a personal exception
  insert into public.member_overrides (school_id, user_id, perm_key, effect, scope) values (a, te, 'students.profile.view', 'grant', 'school');
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') = 'school' and (select count(*) from public.students) = 2, 'a granted exception is seen at once');
  perform pg_temp.act_admin();
  update public.member_overrides set effect = 'deny' where user_id = te;
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') is null, 'and a denial overrides it at once');
  perform pg_temp.act_admin();
  delete from public.member_overrides where user_id = te;

  -- a module switched off
  insert into public.role_permissions (role_id, perm_key, scope) values (rid, 'students.profile.view', 'school') on conflict do nothing;
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') in ('school', 'assigned'), 'with the permission back it works');
  perform pg_temp.check(public.has_module_perm(a, 'homework'), 'a module permission is true while the module is on');
  perform pg_temp.act_admin();
  update public.school_modules set enabled = false where school_id = a and module_code = 'homework';
  perform pg_temp.act_as(te);
  perform pg_temp.check(not public.has_module_perm(a, 'homework') and public.perm_scope(a, 'homework.homework.view') is null, 'switching a module off is seen at once');
  perform pg_temp.act_admin();

  -- blocked login
  update public.school_members set blocked_at = now() where school_id = a and user_id = te;
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') is null, 'a blocked login loses everything at once');
  perform pg_temp.act_admin();

  -- suspended school: writes stop, reads stay
  update public.school_members set blocked_at = null where school_id = a and user_id = te;
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.edit') is not null, 'a write permission works while the school is active');
  perform pg_temp.act_admin();
  update public.schools set status = 'suspended' where id = a;
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.perm_scope(a, 'students.profile.edit') is null and public.perm_scope(a, 'students.profile.view') is not null, 'suspending the school stops writes at once but not reads');
  perform pg_temp.act_admin();
  update public.schools set status = 'active' where id = a;

  -- another school: never leaks, and the memory is per login
  perform pg_temp.act_as(ot);
  perform pg_temp.check(not public.is_member(a) and public.is_member(b), 'membership is per school');
  perform pg_temp.check(public.perm_scope(a, 'students.profile.view') is null, 'another school''s login has nothing here');
  perform pg_temp.act_as(te);
  perform pg_temp.check(public.is_member(a) and not public.is_member(b), 'and switching login switches the answers');
  perform pg_temp.act_admin();
end $$;

select 'ALL PERMISSION MEMORY TESTS PASSED' as result;
rollback;
