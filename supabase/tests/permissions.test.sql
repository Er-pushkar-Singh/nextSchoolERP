-- Permission engine test. Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/permissions.test.sql
-- It creates its own school + users, checks every cell of the default role matrix and the
-- scope rules, then rolls everything back.
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

-- Fixed ids
create temp table t_ids as select
  'cccccccc-0000-0000-0000-000000000001'::uuid as platform,
  gen_random_uuid() as sid;
grant all on t_ids to authenticated;

insert into auth.users (id, email) values ('cccccccc-0000-0000-0000-000000000001', 'perm-platform@test.dev') on conflict do nothing;
insert into public.platform_admins values ('cccccccc-0000-0000-0000-000000000001') on conflict do nothing;

-- One user per role template: dddddddd-0000-0000-0000-0000000000NN
insert into auth.users (id, email)
select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid, 'perm-' || code || '@test.dev' from public.role_templates
on conflict do nothing;

-- Create the school as the platform admin
select pg_temp.act_as('cccccccc-0000-0000-0000-000000000001');
create temp table t_school as select public.create_school('Perm Test School', 'perm-test-' || substr(md5(random()::text), 1, 6)) as sid;
select pg_temp.act_admin();

insert into public.school_members (school_id, user_id, name)
select (select sid from t_school), ('dddddddd-0000-0000-0000-0000000000' || lpad(t.sort::text, 2, '0'))::uuid, t.name from public.role_templates t where t.kind = 'staff';
insert into public.member_roles (school_id, user_id, role_id)
select (select sid from t_school), ('dddddddd-0000-0000-0000-0000000000' || lpad(t.sort::text, 2, '0'))::uuid, r.id
from public.role_templates t join public.roles r on r.school_id = (select sid from t_school) and r.code = t.code;

-- ═════ 1. Every cell of the default matrix ═════
do $$
declare t record; uid uuid; missing int; extra int; sid uuid := (select sid from t_school);
begin
  for t in select * from public.role_templates order by sort loop
    uid := ('dddddddd-0000-0000-0000-0000000000' || lpad(t.sort::text, 2, '0'))::uuid;
    perform pg_temp.act_as(uid);
    create temp table if not exists t_got (perm_key text, scope text);
    delete from t_got;
    insert into t_got select * from public.my_permissions(sid);
    perform pg_temp.act_admin();
    select count(*) into missing from public.role_template_permissions e where e.template_code = t.code
      and not exists (select 1 from t_got g where g.perm_key = e.perm_key and g.scope = e.scope);
    select count(*) into extra from t_got g where not exists (select 1 from public.role_template_permissions e where e.template_code = t.code and e.perm_key = g.perm_key);
    perform pg_temp.check(missing = 0 and extra = 0, format('matrix: %s holds exactly its %s permissions (missing %s, extra %s)', t.code,
      (select count(*) from public.role_template_permissions where template_code = t.code), missing, extra));
    -- and perm_scope agrees cell by cell
    perform pg_temp.act_as(uid);
    perform pg_temp.check(not exists (select 1 from public.role_template_permissions e where e.template_code = t.code and public.perm_scope(sid, e.perm_key) is distinct from e.scope)
      and not exists (select 1 from public.erp_permissions p where public.perm_scope(sid, p.key) is not null
                      and not exists (select 1 from public.role_template_permissions e where e.template_code = t.code and e.perm_key = p.key)),
      format('matrix: perm_scope matches every cell for %s', t.code));
    perform pg_temp.act_admin();
  end loop;
end $$;

-- ═════ 2. Scope rules with real rows ═════
do $$
declare sid uuid := (select sid from t_school);
  principal uuid; vp uuid; acct uuid; fo uuid; ct uuid; st uuid; parent_u uuid; student_u uuid;
  cls uuid; secA uuid; secB uuid; maths uuid; eng uuid; s1 uuid; s2 uuid; sess uuid; ex uuid; head uuid; rid uuid; n int; g uuid;
begin
  select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid into principal from public.role_templates where code = 'principal';
  select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid into vp from public.role_templates where code = 'vice_principal';
  select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid into acct from public.role_templates where code = 'accountant';
  select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid into fo from public.role_templates where code = 'front_office';
  select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid into ct from public.role_templates where code = 'class_teacher';
  select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid into st from public.role_templates where code = 'subject_teacher';
  select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid into parent_u from public.role_templates where code = 'parent';
  select ('dddddddd-0000-0000-0000-0000000000' || lpad(sort::text, 2, '0'))::uuid into student_u from public.role_templates where code = 'student';

  select id into cls from public.classes where school_id = sid and name = '5';
  select id into secA from public.sections where class_id = cls and name = 'A';
  insert into public.sections (school_id, class_id, name) values (sid, cls, 'B') returning id into secB;
  select id into maths from public.subjects where school_id = sid and name = 'Mathematics';
  select id into eng from public.subjects where school_id = sid and name = 'English';
  select id into sess from public.sessions where school_id = sid and is_current;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id, user_id) values (sid, 'T1', 'Asha', cls, secA, student_u) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (sid, 'T2', 'Bilal', cls, secB) returning id into s2;
  insert into public.staff_assignments (school_id, user_id, section_id, subject_id, is_class_teacher) values (sid, ct, secA, null, true), (sid, st, secA, maths, false);
  insert into public.guardians (school_id, user_id, name, relation) values (sid, parent_u, 'Asha''s mother', 'Mother') returning id into g;
  insert into public.student_guardians (school_id, student_id, guardian_id) values (sid, s1, g);
  select id into head from public.fee_heads where school_id = sid and name = 'Tuition Fee';
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (sid, sess, cls, head, 'Apr', '2026-04-10', 1000);
  insert into public.exams (school_id, session_id, name) values (sid, sess, 'UT1') returning id into ex;
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, max_marks) values (sid, ex, cls, maths, 50), (sid, ex, cls, eng, 50);

  -- Accountant generates dues and collects; cannot cancel (maker-checker)
  perform pg_temp.act_as(acct);
  select public.generate_dues(sid, sess) into n;
  perform pg_temp.check(n = 2, 'accountant generates dues for 2 students');
  select public.collect_fee(sid, s1, 400, 'cash', null, null, null, 0, 'acct') into rid;
  update public.fee_receipts set cancelled = true, cancelled_reason = 'x' where id = rid;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'accountant cannot cancel a receipt (needs fees.receipts.approve)');
  begin
    insert into public.role_permissions (role_id, perm_key, scope) select id, 'fees.receipts.approve', 'school' from public.roles where school_id = sid and code = 'accountant';
    perform pg_temp.check(false, 'accountant must not be able to grant permissions');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'accountant cannot edit roles: ' || left(sqlerrm, 60)); end;
  perform pg_temp.act_admin();

  -- Principal cancels it
  perform pg_temp.act_as(principal);
  update public.fee_receipts set cancelled = true, cancelled_reason = 'test' where id = rid;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'principal can cancel a receipt');
  begin
    delete from public.member_roles where user_id = principal and school_id = sid;
    perform pg_temp.check(false, 'principal must not remove own role');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'principal cannot change own roles'); end;
  begin
    update public.role_permissions set scope = 'own' where role_id = (select id from public.roles where school_id = sid and code = 'principal') and perm_key = 'fees.collection.view';
    perform pg_temp.check(false, 'locked role edited');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'principal role is locked'); end;
  -- principal gives the vice principal one more permission it holds itself
  insert into public.role_permissions (role_id, perm_key, scope) select id, 'fees.collection.view', 'school' from public.roles where school_id = sid and code = 'vice_principal';
  perform pg_temp.act_admin();
  perform pg_temp.act_as(vp);
  perform pg_temp.check(public.has_perm(sid, 'fees.collection.view'), 'role edit takes effect: vice principal now sees fee collection');
  perform pg_temp.act_admin();

  -- Class teacher (section A, all subjects)
  perform pg_temp.act_as(ct);
  perform pg_temp.check((select count(*) from public.students where school_id = sid) = 1, 'class teacher sees only own section''s student');
  insert into public.attendance (school_id, student_id, class_id, section_id, date, status) values (sid, s1, cls, secA, '2026-10-01', 'P');
  begin
    insert into public.attendance (school_id, student_id, class_id, section_id, date, status) values (sid, s2, cls, secB, '2026-10-01', 'P');
    perform pg_temp.check(false, 'class teacher marked another section');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'class teacher cannot mark another section'); end;
  perform pg_temp.check((select count(*) from public.fee_dues where school_id = sid) = 0, 'class teacher sees no fees');
  perform pg_temp.act_admin();

  -- Subject teacher (section A, Maths only)
  perform pg_temp.act_as(st);
  insert into public.marks (school_id, exam_id, student_id, subject_id, marks) values (sid, ex, s1, maths, 40);
  begin
    insert into public.marks (school_id, exam_id, student_id, subject_id, marks) values (sid, ex, s1, eng, 40);
    perform pg_temp.check(false, 'subject teacher entered another subject');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'subject teacher cannot enter marks for another subject'); end;
  begin
    insert into public.marks (school_id, exam_id, student_id, subject_id, marks) values (sid, ex, s2, maths, 40);
    perform pg_temp.check(false, 'subject teacher entered another section');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'subject teacher cannot enter marks for another section'); end;
  perform pg_temp.act_admin();

  -- Parent: own child only; results only once published
  perform pg_temp.act_as(parent_u);
  perform pg_temp.check((select count(*) from public.students where school_id = sid) = 1 and (select id from public.students where school_id = sid) = s1, 'parent sees only own child');
  perform pg_temp.check((select count(*) from public.fee_dues where school_id = sid) = 1, 'parent sees only own child''s dues');
  perform pg_temp.check((select count(*) from public.marks where school_id = sid) = 0, 'parent sees no marks before publish');
  perform pg_temp.check((select count(*) from public.enquiries where school_id = sid) = 0 and not public.has_perm(sid, 'settings.users.view'), 'parent has no staff access');
  perform pg_temp.act_admin();
  update public.exams set published = true where id = ex;
  perform pg_temp.act_as(parent_u);
  perform pg_temp.check((select count(*) from public.marks where school_id = sid) = 1, 'parent sees marks after publish');
  perform pg_temp.act_admin();

  -- After publish the subject teacher can't change marks
  perform pg_temp.act_as(st);
  update public.marks set marks = 45 where exam_id = ex and student_id = s1 and subject_id = maths;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'marks locked after publish for subject teacher');
  perform pg_temp.act_admin();

  -- Student: self only
  perform pg_temp.act_as(student_u);
  perform pg_temp.check((select count(*) from public.students where school_id = sid) = 1, 'student sees only self');
  perform pg_temp.check(not public.has_perm(sid, 'fees.collection.view'), 'student has no fee access');
  perform pg_temp.act_admin();

  -- Module licence: platform switches Fees off
  update public.school_modules set licensed = false where school_id = sid and module_code = 'fees';
  perform pg_temp.act_as(acct);
  perform pg_temp.check(not public.has_perm(sid, 'fees.collection.view') and (select count(*) from public.fee_dues where school_id = sid) = 0, 'fees off: accountant loses fees and sees no dues');
  perform pg_temp.act_admin();
  update public.school_modules set licensed = true where school_id = sid and module_code = 'fees';

  -- Suspended school: read-only
  update public.schools set status = 'suspended' where id = sid;
  perform pg_temp.act_as(fo);
  perform pg_temp.check(public.has_perm(sid, 'students.profile.view') and not public.has_perm(sid, 'students.profile.create'), 'suspended school is read-only');
  perform pg_temp.act_admin();
  update public.schools set status = 'active' where id = sid;

  -- Per-user deny beats the role
  insert into public.member_overrides (school_id, user_id, perm_key, effect) values (sid, fo, 'fees.collection.create', 'deny');
  perform pg_temp.act_as(fo);
  perform pg_temp.check(not public.has_perm(sid, 'fees.collection.create') and public.has_perm(sid, 'fees.collection.view'), 'per-user deny removes one permission only');
  perform pg_temp.act_admin();

  -- Other school's staff see nothing here
  perform pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000005');
  perform pg_temp.check((select count(*) from public.students where school_id = sid) = 0 and not public.is_member(sid), 'outsider sees nothing');
  perform pg_temp.act_admin();
end $$;

select 'ALL PERMISSION TESTS PASSED' as result;
rollback;
