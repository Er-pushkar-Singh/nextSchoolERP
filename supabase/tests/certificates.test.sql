-- Certificates test (step 7). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/certificates.test.sql
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
  ('ffffffff-0000-0000-0000-000000000001', 'ce-owner@test.dev'),
  ('ffffffff-0000-0000-0000-000000000002', 'ce-principal@test.dev'),
  ('ffffffff-0000-0000-0000-000000000003', 'ce-front@test.dev'),
  ('ffffffff-0000-0000-0000-000000000004', 'ce-teacher@test.dev'),
  ('ffffffff-0000-0000-0000-000000000005', 'ce-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('ffffffff-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'ffffffff-0000-0000-0000-000000000001'; pr uuid := 'ffffffff-0000-0000-0000-000000000002';
  fo uuid := 'ffffffff-0000-0000-0000-000000000003'; te uuid := 'ffffffff-0000-0000-0000-000000000004'; ot uuid := 'ffffffff-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; sec uuid; s1 uuid; s2 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; n int;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Cert A', 'certa-' || sfx);
  b := public.create_school('Cert B', 'certb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fo, 'Front'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fo, 'front_office'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '8';
  select id into sec from public.sections where class_id = cls limit 1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, father_name, dob, admission_date)
    values (a, 'T1', 'Ravi', 'Singh', cls, sec, 'Mohan Singh', date '2013-06-15', date '2019-04-01') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'T2', 'Sana', cls, sec) returning id into s2;
  insert into public.staff_assignments (school_id, user_id, section_id) values (a, te, sec);

  perform pg_temp.act_as(fo);
  c1 := public.issue_certificate(a, s1, 'bonafide', null, '{"remarks":"For passport"}', false, 'Front');
  perform pg_temp.check(c1 is not null, 'front office issues a bonafide certificate');
  perform pg_temp.check((select cert_no like 'BC/%/0001' and details ->> 'name' = 'Ravi Singh' and details ->> 'father_name' = 'Mohan Singh' and details ->> 'class' = '8' from public.student_certificates where id = c1),
    'certificate is numbered and snapshots the student''s data');
  c2 := public.issue_certificate(a, s2, 'bonafide', null, '{}', false, 'Front');
  perform pg_temp.check((select cert_no like 'BC/%/0002' from public.student_certificates where id = c2), 'numbers run on per kind and session');
  begin perform public.issue_certificate(a, s1, 'bonafide', date '2999-01-01', '{}', false, null); perform pg_temp.check(false, 'future date');
  exception when others then perform pg_temp.check(sqlerrm like '%future%', 'a future issue date is refused'); end;

  c3 := public.issue_certificate(a, s1, 'transfer', null, '{"reason":"Parent transferred","last_exam":"Half-yearly 2026","result":"Passed","conduct":"Very good"}', true, 'Front');
  perform pg_temp.act_admin();
  perform pg_temp.check((select status = 'transferred' and tc_no like 'TC/%/0001' and tc_issued_on is not null and left_on is not null and left_reason = 'Parent transferred' from public.students where id = s1),
    'issuing a TC marks the student transferred and stamps the TC number and date');
  perform pg_temp.check(exists (select 1 from public.student_enrolments where student_id = s1 and outcome = 'transferred' and ended_on is not null), 'the class history is closed as transferred');
  perform pg_temp.act_as(fo);
  begin perform public.issue_certificate(a, s1, 'transfer', null, '{}', false, null); perform pg_temp.check(false, 'second TC');
  exception when others then perform pg_temp.check(sqlerrm like '%already issued%', 'a second TC needs the duplicate flag'); end;
  c4 := public.issue_certificate(a, s1, 'transfer', null, '{"duplicate":"true"}', false, 'Front');
  perform pg_temp.check((select is_duplicate and cert_no like '%-D' from public.student_certificates where id = c4), 'a duplicate TC is marked and numbered as a duplicate');
  begin perform public.cancel_certificate(c3, 'x'); perform pg_temp.check(false, 'front cancelled');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot cancel a certificate'); end;
  perform pg_temp.act_admin();

  perform pg_temp.act_as(te);
  begin perform public.issue_certificate(a, s2, 'bonafide', null, '{}', false, null); perform pg_temp.check(false, 'teacher issued');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot issue certificates'); end;
  perform pg_temp.check((select count(*) from public.student_certificates) = 0, 'a class teacher cannot read certificates');
  perform pg_temp.act_admin();

  perform pg_temp.act_as(pr);
  begin perform public.cancel_certificate(c3, '   '); perform pg_temp.check(false, 'no reason');
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'cancelling needs a reason'); end;
  perform public.cancel_certificate(c2, 'Issued to the wrong student');
  perform pg_temp.check((select status = 'cancelled' and cancelled_by = pr from public.student_certificates where id = c2), 'principal cancels a certificate (kept on record)');
  begin
    update public.student_certificates set cert_no = 'HACK' where id = c1;
    get diagnostics n = row_count;
    perform pg_temp.check(n = 0, 'certificates cannot be edited directly');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'certificates cannot be edited directly'); end;
  perform pg_temp.act_admin();

  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.student_certificates where school_id = a) = 0, 'another school sees no certificates');
  begin perform public.issue_certificate(a, s2, 'bonafide', null, '{}', false, null); perform pg_temp.check(false, 'cross-school');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot issue for this student'); end;
  perform pg_temp.act_admin();

  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and entity = 'student_certificates'), 'certificates are audited');
  perform pg_temp.act_as(ow);
  delete from public.schools where id = a;
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.student_certificates where school_id = a), 'deleting a school removes its certificates');
end $$;

select 'ALL CERTIFICATE TESTS PASSED' as result;
rollback;
