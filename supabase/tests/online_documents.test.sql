-- Online admission + Documents & templates test (step 9). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/online_documents.test.sql
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
  ('cdcdcdcd-0000-0000-0000-000000000001', 'od-owner@test.dev'),
  ('cdcdcdcd-0000-0000-0000-000000000002', 'od-principal@test.dev'),
  ('cdcdcdcd-0000-0000-0000-000000000003', 'od-front@test.dev'),
  ('cdcdcdcd-0000-0000-0000-000000000004', 'od-teacher@test.dev'),
  ('cdcdcdcd-0000-0000-0000-000000000005', 'od-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('cdcdcdcd-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'cdcdcdcd-0000-0000-0000-000000000001'; pr uuid := 'cdcdcdcd-0000-0000-0000-000000000002';
  fo uuid := 'cdcdcdcd-0000-0000-0000-000000000003'; te uuid := 'cdcdcdcd-0000-0000-0000-000000000004'; ot uuid := 'cdcdcdcd-0000-0000-0000-000000000005';
  a uuid; b uuid; c5 uuid; c6 uuid; sec5 uuid; s1 uuid; s2 uuid; w1 uuid; scode text; r json; r2 json; tc uuid; bon uuid; idc uuid; sid_ uuid; d1 uuid; d2 uuid; d3 uuid; n int; h text; v1 int;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Docs A', 'docsa-' || sfx);
  b := public.create_school('Docs B', 'docsb-' || sfx);
  perform pg_temp.act_admin();
  scode := (select s.code from public.schools s where s.id = a);
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fo, 'Front'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fo, 'front_office'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into c5 from public.classes where school_id = a and name = '5';
  select id into c6 from public.classes where school_id = a and name = '6';
  select id into sec5 from public.sections where class_id = c5 limit 1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, father_name, mother_name, dob, gender, guardian_phone, admission_date, roll_no, blood_group)
    values (a, 'D1', 'Meera', 'Gupta', c5, sec5, 'Ramesh Gupta', 'Sita Gupta', date '2015-03-21', 'F', '9876500001', date '2020-04-01', 4, 'B+') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id, father_name) values (a, 'D2', 'Arjun', c5, sec5, 'Vijay') returning id into s2;
  insert into public.staff (school_id, name, designation, department, emp_code, joining_date, leaving_date, status) values (a, 'Neha Rao', 'PGT', 'Science', 'E9', date '2018-04-01', date '2026-03-31', 'active') returning id into w1;

  -- ───────── Online admission ─────────
  begin perform public.public_create_application(scode, c6, '{"first_name":"Zoya","guardian_phone":"9811100000"}', false, 'iphash1'); perform pg_temp.check(false, 'closed form accepted');
  exception when others then perform pg_temp.check(sqlerrm like '%not open%', 'the online form is closed until the school opens it'); end;
  insert into public.online_admission_settings (school_id, enabled, class_ids, intro) values (a, true, array[c6], 'Welcome');
  r := public.public_create_application(scode, c6, '{"first_name":"Zoya","last_name":"Khan","father_name":"Imran Khan","guardian_phone":"9811100000","dob":"2014-02-02"}', false, 'iphash1');
  perform pg_temp.check((r ->> 'application_no') like 'APP/%/0001', 'a parent can submit the form and gets an application number');
  perform pg_temp.check((select source = 'Online' and status = 'submitted' and applicant_name = 'Zoya Khan' from public.admission_applications where id = (r ->> 'id')::uuid), 'the application is marked Online and starts as received');
  begin perform public.public_create_application(scode, c5, '{"first_name":"Late","guardian_phone":"9811100001"}', false, 'iphash2'); perform pg_temp.check(false, 'closed class');
  exception when others then perform pg_temp.check(sqlerrm like '%not open%', 'only the classes the school opened can be applied to'); end;
  begin perform public.public_create_application(scode, c6, '{"first_name":"Zoya","last_name":"Khan","father_name":"Imran Khan","guardian_phone":"9811100000","dob":"2014-02-02"}', false, 'iphash3'); perform pg_temp.check(false, 'dup');
  exception when others then perform pg_temp.check(sqlerrm like '%already exists%', 'the same child cannot be submitted twice'); end;
  begin perform public.public_create_application(scode, c6, '{"first_name":"NoPhone"}', false, 'iphash4'); perform pg_temp.check(false, 'no phone');
  exception when others then perform pg_temp.check(sqlerrm like '%mobile%', 'a parent mobile number is required'); end;
  for n in 1..5 loop
    perform public.public_create_application(scode, c6, jsonb_build_object('first_name', 'Kid' || n, 'dob', '2014-0' || n || '-01', 'guardian_phone', '98111000' || (10 + n)), false, 'floodip');
  end loop;
  begin perform public.public_create_application(scode, c6, '{"first_name":"Kid9","dob":"2014-09-01","guardian_phone":"9811100099"}', false, 'floodip'); perform pg_temp.check(false, 'rate');
  exception when others then perform pg_temp.check(sqlerrm like '%Too many%', 'one network cannot flood the form'); end;
  update public.online_admission_settings set closes_on = current_date - 1 where school_id = a;
  begin perform public.public_create_application(scode, c6, '{"first_name":"Late","guardian_phone":"9811100002"}', false, 'iphash5'); perform pg_temp.check(false, 'after close');
  exception when others then perform pg_temp.check(sqlerrm like '%closed%', 'the form stops at the closing date'); end;
  r2 := public.public_application_status(scode, r ->> 'application_no', '98111 00000', 'iphash1');
  perform pg_temp.check(r2 is not null and (r2 ->> 'status') = 'submitted' and (r2 ->> 'name') = 'Zoya Khan', 'parents can track with the application number and mobile');
  perform pg_temp.check(public.public_application_status(scode, r ->> 'application_no', '9000000000', 'iphash1') is null, 'a wrong mobile number shows nothing');
  perform pg_temp.act_as(fo);
  perform pg_temp.check((select count(*) from public.admission_applications where source = 'Online') >= 5, 'staff see online applications in the normal list');
  begin perform public.public_create_application(scode, c6, '{"first_name":"X","guardian_phone":"9811100077"}', false, 'z'); perform pg_temp.check(false, 'staff public');
  exception when others then perform pg_temp.check(sqlerrm like '%permission denied%', 'the public function is not callable with a user key'); end;
  perform pg_temp.act_admin();

  -- ───────── Templates ─────────
  perform pg_temp.check((select count(*) from public.document_templates where school_id = a) >= 9, 'a new school gets the default templates (TC, bonafide, ID cards, letters …)');
  select id into tc from public.document_templates where school_id = a and code = 'transfer_certificate';
  select id into bon from public.document_templates where school_id = a and code = 'bonafide_certificate';
  select id into idc from public.document_templates where school_id = a and code = 'student_id_card';
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.document_templates where school_id = a) = 0, 'teachers cannot see templates');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(fo);
  begin update public.document_templates set body_html = 'x' where id = bon; get diagnostics n = row_count; perform pg_temp.check(n = 0, 'front edits template');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'front office cannot edit templates'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  select version into v1 from public.document_templates where id = bon;
  update public.document_templates set body_html = '<p>Bonafide: {{student.name}} <script>alert(1)</script><img src=x onerror="alert(1)"> {{doc.no}} {{ extra.remarks }}</p>' where id = bon;
  select body_html into h from public.document_templates where id = bon;
  perform pg_temp.check(h not like '%<script%' and h not like '%onerror%' and h like '%{{student.name}}%', 'scripts and event handlers are stripped from templates');
  perform pg_temp.check((select version = v1 + 1 from public.document_templates where id = bon) and (select count(*) = 2 from public.document_template_versions where template_id = bon), 'every edit creates a new version');
  perform pg_temp.check(public.render_document('{{student.name}}', '{"student":{"name":"A <b>&\"x"}}') = 'A &lt;b&gt;&amp;&quot;x', 'values are HTML-escaped when rendered');
  perform pg_temp.check(position('Meera Gupta' in public.preview_document(bon, s1, null)) > 0, 'preview renders a template with a real student');
  perform pg_temp.act_admin();

  -- ───────── Issue ─────────
  perform pg_temp.act_as(fo);
  d1 := public.issue_document(a, bon, s1, null, null, '{"remarks":"For passport"}', false, 'Front');
  perform pg_temp.check((select doc_no like 'BC/%/0001' and html like '%Meera Gupta%' and html like '%For passport%' and html not like '{{%' from public.issued_documents where id = d1), 'a document is numbered and rendered from the template and the student record');
  perform pg_temp.check((select html like '%Bonafide:%' and template_version = 2 from public.issued_documents where id = d1), 'it records which template version was used');
  begin perform public.issue_document(a, tc, s1, null, null, '{}', true, null); perform pg_temp.check(false, 'tc w/o reason');
  exception when others then perform pg_temp.check(sqlerrm like '%Reason for leaving%', 'required template fields are enforced'); end;
  d2 := public.issue_document(a, tc, s1, null, null, '{"reason":"Transfer of parent","last_exam":"Annual 2026","result":"Passed","evil":"x"}', true, 'Front');
  perform pg_temp.check((select data -> 'extra' ->> 'reason' = 'Transfer of parent' and not (data -> 'extra' ? 'evil') from public.issued_documents where id = d2), 'only declared fields reach the document');
  perform pg_temp.act_admin();
  perform pg_temp.check((select status = 'transferred' and tc_no like 'TC/%/0001' from public.students where id = s1), 'a TC marks the student transferred and stores the TC number');
  perform pg_temp.act_as(fo);
  begin perform public.issue_document(a, tc, s1, null, null, '{"reason":"again"}', false, null); perform pg_temp.check(false, 'second tc');
  exception when others then perform pg_temp.check(sqlerrm like '%Duplicate copy%', 'a second TC needs the duplicate tick'); end;
  d3 := public.issue_document(a, tc, s1, null, null, '{"reason":"Lost original","duplicate":"true"}', false, null);
  perform pg_temp.check((select is_duplicate and doc_no like '%-D' from public.issued_documents where id = d3), 'a duplicate TC is numbered as a duplicate');
  begin perform public.issue_document(a, idc, null, w1, null, '{}', false, null); perform pg_temp.check(false, 'wrong audience');
  exception when others then perform pg_temp.check(sqlerrm like '%for student only%', 'a student template cannot be issued to staff'); end;
  begin perform public.cancel_issued_document(d1, 'x'); perform pg_temp.check(false, 'front cancels');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot cancel documents'); end;
  perform pg_temp.act_admin();

  -- ID cards in bulk, staff documents
  perform pg_temp.act_as(fo);
  n := public.issue_documents_bulk(a, idc, c5, null, 'Front');
  perform pg_temp.check(n = 1, 'bulk ID cards are issued for the active students of the class (the transferred one is skipped)');
  n := public.issue_documents_bulk(a, idc, c5, null, 'Front');
  perform pg_temp.check(n = 0, 'running the bulk issue again adds nothing');
  perform pg_temp.check((select html like '%data-photo="1"%' and html like '%Arjun%' from public.issued_documents where template_code = 'student_id_card' and student_id = s2), 'ID card has the photo slot and the student data');
  begin perform public.issue_documents_bulk(a, tc, c5, null, null); perform pg_temp.check(false, 'bulk tc');
  exception when others then perform pg_temp.check(sqlerrm like '%one by one%', 'a TC cannot be issued in bulk'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  perform public.issue_document(a, (select id from public.document_templates where school_id = a and code = 'experience_certificate'), null, w1, null, '{"remarks":"Excellent"}', false, 'Principal');
  perform pg_temp.check((select html like '%Neha Rao%' and html like '%31/03/2026%' from public.issued_documents where staff_id = w1), 'staff documents render from the staff record');
  perform public.cancel_issued_document(d1, 'Wrong student');
  perform pg_temp.check((select status = 'cancelled' and cancelled_by = pr from public.issued_documents where id = d1), 'principal cancels (the document stays on record)');
  perform pg_temp.act_admin();

  -- isolation
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.issued_documents where school_id = a) + (select count(*) from public.document_templates where school_id = a)
                      + (select count(*) from public.online_admission_settings where school_id = a) = 0, 'another school sees none of it');
  begin perform public.issue_document(a, bon, s2, null, null, '{}', false, null); perform pg_temp.check(false, 'cross');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot issue for this student'); end;
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.audit_log where school_id = a and entity = 'issued_documents' and details::text like '%<html%'), 'the audit log has no document bodies');
  perform pg_temp.act_as(ow);
  delete from public.schools where id = a;
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.issued_documents where school_id = a) and not exists (select 1 from public.document_templates where school_id = a), 'deleting a school removes templates and documents');
end $$;

select 'ALL ONLINE + DOCUMENT TESTS PASSED' as result;
rollback;
