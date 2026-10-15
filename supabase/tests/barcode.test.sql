-- Barcode attendance and verifiable documents (step 39).
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

insert into auth.users (id, email) values ('a9a9a9a9-0000-0000-0000-000000000001', 'bc-owner@test.dev'), ('a9a9a9a9-0000-0000-0000-000000000002', 'bc-principal@test.dev'),
  ('a9a9a9a9-0000-0000-0000-000000000003', 'bc-teacher@test.dev') on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('a9a9a9a9-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'a9a9a9a9-0000-0000-0000-000000000001'; pr uuid := 'a9a9a9a9-0000-0000-0000-000000000002'; te uuid := 'a9a9a9a9-0000-0000-0000-000000000003';
  a uuid; cls uuid; sec uuid; sec2 uuid; s1 uuid; s2 uuid; s3 uuid; code1 text; j jsonb; html text; doc uuid; tpl uuid; d date := public.today_ist(); sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('BC A', 'bca-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher');
  insert into public.member_roles (school_id, user_id, role_id) select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into cls from public.classes where school_id = a and name = '6';
  select id into sec from public.sections where class_id = cls order by name limit 1;
  insert into public.sections (school_id, class_id, name) values (a, cls, 'Z') returning id into sec2;
  insert into public.staff_assignments (school_id, user_id, section_id, is_class_teacher) values (a, te, sec, true);
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'B1', 'Aarav', 'Sharma', cls, sec) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'B2', 'Diya', 'Verma', cls, sec) returning id into s2;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'B3', 'Kabir', 'Khan', cls, sec2) returning id into s3;
  select att_code into code1 from public.students where id = s1;

  -- the renderer: barcode and verification QR
  html := public.render_document('{{student.barcode}} {{doc.verify_qr}} {{student.name}}', jsonb_build_object('student', jsonb_build_object('att_code', code1, 'name', 'A<b>')));
  perform pg_temp.check(html like '%data-barcode="' || code1 || '"%' and html like '%data-verify="1"%' and html like '%A&lt;b&gt;%', 'documents get a barcode slot, a verification QR slot, and text stays escaped');
  perform pg_temp.check(public.render_document('{{student.barcode}}', jsonb_build_object('student', jsonb_build_object('att_code', '"><script>'))) = '', 'a code that is not a card code renders nothing');

  -- scanning the barcode marks attendance, the feed shows it, the teacher closes the day for the own section
  perform pg_temp.act_as(pr);
  j := public.scan_attendance(a, code1);
  perform pg_temp.check((j ->> 'ok')::boolean and (j ->> 'name') = 'Aarav Sharma', 'a scanned barcode marks the student');
  perform pg_temp.check((select count(*) from public.attendance_scan_feed(a)) = 1, 'the scan appears in the live feed');
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.attendance_scan_feed(a)) = 0, 'a class teacher does not see the whole school''s feed');
  begin perform public.attendance_close_day(a, d, null); perform pg_temp.check(false, 'teacher whole school');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot close the day for the whole school'); end;
  j := public.attendance_close_day(a, d, sec);
  perform pg_temp.check((j ->> 'marked')::int = 1 and (select status = 'A' from public.attendance where student_id = s2 and date = d), 'closing the own section marks only the unscanned student absent');
  perform pg_temp.check((select status <> 'A' from public.attendance where student_id = s1 and date = d), 'a scanned student stays present');
  perform pg_temp.check(not exists (select 1 from public.attendance where student_id = s3 and date = d), 'another section is untouched');
  perform pg_temp.act_as(pr);
  j := public.attendance_close_day(a, d, null);
  perform pg_temp.check((j ->> 'marked')::int = 1, 'the principal closes the rest of the school');
  perform pg_temp.check(public.attendance_clear(a, s2, d), 'a wrong mark can be undone');
  perform pg_temp.check(not exists (select 1 from public.attendance where student_id = s2 and date = d), 'and it is gone');

  -- the public verification of an issued document
  select id into tpl from public.document_templates where school_id = a and audience = 'student' and on_issue = 'none' and not one_per_student limit 1;
  doc := public.issue_document(a, tpl, s1, null, null, '{}'::jsonb, false, 'Principal');
  begin perform public.verify_document(doc); perform pg_temp.check(false, 'verify as user');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%' or sqlerrm like '%permission denied%', 'only the server (public page) reads the verification data'); end;
  perform pg_temp.act_admin();
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  j := public.verify_document(doc);
  perform pg_temp.check(j ->> 'status' = 'issued' and j -> 'person' ->> 'name' = 'Aarav Sharma' and j -> 'current' ->> 'admission_no' = 'B1', 'the verification page gets the document, the student as printed and as now');
  perform pg_temp.check(public.verify_document(gen_random_uuid()) is null, 'an unknown code finds nothing');
end $$;

rollback;