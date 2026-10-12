-- Admissions test (step 8). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/admissions.test.sql
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
  ('abababab-0000-0000-0000-000000000001', 'ad-owner@test.dev'),
  ('abababab-0000-0000-0000-000000000002', 'ad-principal@test.dev'),
  ('abababab-0000-0000-0000-000000000003', 'ad-front@test.dev'),
  ('abababab-0000-0000-0000-000000000004', 'ad-teacher@test.dev'),
  ('abababab-0000-0000-0000-000000000005', 'ad-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('abababab-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'abababab-0000-0000-0000-000000000001'; pr uuid := 'abababab-0000-0000-0000-000000000002';
  fo uuid := 'abababab-0000-0000-0000-000000000003'; te uuid := 'abababab-0000-0000-0000-000000000004'; ot uuid := 'abababab-0000-0000-0000-000000000005';
  a uuid; b uuid; c6 uuid; c10 uuid; sec6 uuid; sess uuid; enq uuid; app1 uuid; app2 uuid; app3 uuid; stu uuid; head uuid; plan uuid; n int; sfx text := substr(md5(random()::text), 1, 6);
  form jsonb;
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Adm A', 'adma-' || sfx);
  b := public.create_school('Adm B', 'admb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fo, 'Front'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fo, 'front_office'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into c6 from public.classes where school_id = a and name = '6';
  select id into c10 from public.classes where school_id = a and name = '10';
  select id into sec6 from public.sections where class_id = c6 limit 1;
  select id into sess from public.sessions where school_id = a and is_current;
  select id into head from public.fee_heads where school_id = a and name = 'Tuition Fee';
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (a, sess, c6, head, 'Apr', current_date + 10, 1000) returning id into plan;

  -- reference data
  perform pg_temp.check((select count(*) from public.board_subject_codes where level = 'hs') >= 60 and (select count(*) from public.board_subject_codes where level = 'inter') >= 90, 'official UPMSP subject codes (HS and Intermediate) are loaded');
  perform pg_temp.check(exists (select 1 from public.board_subject_codes where level = 'hs' and code = '944') and exists (select 1 from public.board_subject_codes where level = 'inter' and code = '173'), 'moral / yoga / sports codes exist');

  -- enquiry → application
  insert into public.enquiries (school_id, student_name, class_sought, status) values (a, 'Kiran Verma', '6', 'contacted') returning id into enq;
  form := jsonb_build_object('first_name', 'Kiran', 'last_name', 'Verma', 'gender', 'F', 'dob', '2014-07-09', 'father_name', 'Anil Verma', 'mother_name', 'Rekha Verma',
    'guardian_phone', '9811122233', 'name_hi', 'किरण वर्मा', 'father_name_hi', 'अनिल वर्मा', 'mobile', '9811122233', 'district', 'Lucknow', 'state', 'Uttar Pradesh',
    'pincode', '226001', 'category', 'OBC', 'medium', 'hindi', 'allergies', 'dust',
    'contacts', jsonb_build_array(jsonb_build_object('name', 'Anil Verma', 'relation', 'Father', 'phone', '9811122233', 'is_primary', true, 'is_emergency', true),
                                  jsonb_build_object('name', 'Mahesh Verma', 'relation', 'Uncle', 'phone', '9811199999', 'can_pickup', true)),
    'prior', jsonb_build_array(jsonb_build_object('level', 'class8', 'board_name', 'CBSE', 'exam_year', 2025, 'school_name', 'Old School')));
  perform pg_temp.act_as(te);
  begin perform public.create_application(a, c6, null, form); perform pg_temp.check(false, 'teacher created application');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a teacher cannot create an application'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(fo);
  app1 := public.create_application(a, c6, enq, form, false, null, 'Walk-in');
  perform pg_temp.check((select application_no like 'APP/%/0001' and applicant_name = 'Kiran Verma' and status = 'submitted' and father_name = 'Anil Verma' from public.admission_applications where id = app1), 'front office creates a numbered application');
  begin perform public.create_application(a, c6, null, form); perform pg_temp.check(false, 'duplicate');
  exception when others then perform pg_temp.check(sqlerrm like '%already exists%', 'the same student cannot be applied twice by accident'); end;
  app2 := public.create_application(a, c6, null, jsonb_build_object('first_name', 'Sameer', 'dob', '2014-01-01', 'father_name', 'Z'), true, 'RTE/2026/55');
  perform pg_temp.check((select application_no like '%/0002' and rte_applicant and rte_reference = 'RTE/2026/55' from public.admission_applications where id = app2), 'numbers run on; RTE reference stored');
  perform pg_temp.check((select status from public.enquiries where id = enq) = 'test', 'the enquiry moves forward when an application is made');

  -- workflow
  begin update public.admission_applications set status = 'approved' where id = app1; perform pg_temp.check(false, 'front approved');
  exception when others then perform pg_temp.check(sqlerrm like '%principal%', 'front office cannot approve'); end;
  begin update public.admission_applications set status = 'test_scheduled' where id = app1; perform pg_temp.check(false, 'no date');
  exception when others then perform pg_temp.check(sqlerrm like '%date%', 'a test needs a date'); end;
  update public.admission_applications set test_on = current_date + 3, status = 'test_scheduled' where id = app1;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  begin update public.admission_applications set status = 'rejected' where id = app2; perform pg_temp.check(false, 'reject w/o reason');
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'rejecting needs a reason'); end;
  update public.admission_applications set status = 'waitlisted' where id = app2;
  perform pg_temp.check((select waitlist_no = 1 from public.admission_applications where id = app2), 'a waitlisted application gets a waitlist number');
  begin update public.admission_applications set status = 'admitted' where id = app1; perform pg_temp.check(false, 'direct admit');
  exception when others then perform pg_temp.check(sqlerrm like '%through%' or sqlerrm like '%cannot go from%', 'admitted can only be reached through Admit'); end;
  begin perform public.admit_application(app1, c6, sec6); perform pg_temp.check(false, 'admit before approval');
  exception when others then perform pg_temp.check(sqlerrm like '%approved%', 'only an approved application can be admitted'); end;
  update public.admission_applications set status = 'approved', decision_note = 'Good test result', test_marks = 38, test_max = 50 where id = app1;
  perform pg_temp.act_admin();

  -- documents on the application
  perform pg_temp.act_as(fo);
  insert into public.application_documents (school_id, application_id, doc_type, status, due_by) values (a, app1, 'transfer_certificate', 'pending', current_date + 30);
  insert into public.application_documents (school_id, application_id, doc_type, status, file_path, file_name, mime_type, size_bytes)
    values (a, app1, 'birth_certificate', 'uploaded', a || '/applications/' || app1 || '/bc.pdf', 'bc.pdf', 'application/pdf', 1000);
  perform pg_temp.check(true, 'documents (pending and uploaded) attach to an application');
  begin perform public.admit_application(app1, c6, sec6); perform pg_temp.check(false, 'front admitted');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot admit'); end;
  perform pg_temp.act_admin();

  -- admit
  perform pg_temp.act_as(pr);
  stu := public.admit_application(app1, c6, sec6, null, null, 7);
  perform pg_temp.act_admin();
  perform pg_temp.check((select first_name = 'Kiran' and class_id = c6 and section_id = sec6 and roll_no = 7 and name_hi = 'किरण वर्मा' and mobile = '9811122233' and application_id = app1
                                and category = 'OBC' and medium = 'hindi' and status = 'active' from public.students where id = stu), 'admit creates the student with every field of the application');
  perform pg_temp.check((select status = 'admitted' and student_id = stu and admitted_on is not null from public.admission_applications where id = app1), 'the application is closed as admitted');
  perform pg_temp.check((select count(*) = 2 from public.student_guardians where student_id = stu) and exists (select 1 from public.guardians g join public.student_guardians sg on sg.guardian_id = g.id
                                where sg.student_id = stu and g.name = 'Mahesh Verma' and g.can_pickup), 'guardian, emergency and pickup contacts are created');
  perform pg_temp.check(exists (select 1 from public.student_prior_exams where student_id = stu and level = 'class8' and school_name = 'Old School'), 'earlier school details are kept');
  perform pg_temp.check(exists (select 1 from public.student_documents where student_id = stu and doc_type = 'transfer_certificate' and status = 'pending')
                    and exists (select 1 from public.student_documents where student_id = stu and doc_type = 'birth_certificate' and file_path is not null), 'documents (incl. pending ones) move to the student');
  perform pg_temp.check((select allergies = 'dust' from public.student_sensitive where student_id = stu), 'health details go to the restricted tier');
  perform pg_temp.check((select count(*) = 1 and sum(amount) = 1000 from public.fee_dues where student_id = stu), 'fee dues are billed from the class fee plan at admission');
  perform pg_temp.check((select status = 'admitted' and student_id = stu from public.enquiries where id = enq), 'the enquiry is linked to the new student');
  perform pg_temp.check(exists (select 1 from public.student_enrolments where student_id = stu and class_id = c6 and ended_on is null), 'the class history starts with the admission');
  perform pg_temp.check((select count(*) >= 4 from public.admission_application_events where application_id = app1), 'every step is in the application history');
  perform pg_temp.act_as(pr);
  begin perform public.admit_application(app1, c6, sec6); perform pg_temp.check(false, 'admitted twice');
  exception when others then perform pg_temp.check(sqlerrm like '%approved%', 'an application cannot be admitted twice'); end;
  begin update public.admission_applications set status = 'cancelled' where id = app1; perform pg_temp.check(false, 'cancel admitted');
  exception when others then perform pg_temp.check(sqlerrm like '%closed%', 'an admitted application is closed'); end;
  perform pg_temp.act_admin();

  -- Aadhaar needs consent; ciphertext only
  perform pg_temp.act_as(pr);
  begin update public.student_sensitive set aadhaar_enc = 'v1.x.y.z', aadhaar_last4 = '1234' where student_id = stu; perform pg_temp.check(false, 'aadhaar w/o consent');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'Aadhaar cannot be stored without consent'); end;
  update public.student_sensitive set aadhaar_enc = 'v1.x.y.z', aadhaar_last4 = '1234', aadhaar_consent = true where student_id = stu;
  perform pg_temp.check(true, 'Aadhaar ciphertext is stored with consent');
  perform pg_temp.act_admin();

  -- board subjects and snapshot
  perform pg_temp.act_as(pr);
  update public.students set class_id = c10, section_id = (select id from public.sections where class_id = c10 limit 1), father_name_hi = 'अनिल वर्मा', mother_name = 'Rekha Verma', mother_name_hi = 'रेखा वर्मा' where id = stu;
  insert into public.board_registrations (school_id, student_id, session_id, kind, class_level, exam_year) values (a, stu, sess, 'exam_application', 10, 2027) returning id into app3;
  insert into public.student_documents (school_id, student_id, doc_type, status, file_path) values (a, stu, 'photo', 'uploaded', a || '/' || stu || '/p.jpg') on conflict do nothing;
  insert into public.student_board_subjects (school_id, student_id, session_id, level, slot, code)
    select a, stu, sess, 'hs', x.slot, x.code from (values ('1','901'),('2','917'),('3','928'),('4','931'),('5','932')) x(slot, code);
  begin update public.board_registrations set status = 'checked' where id = app3; perform pg_temp.check(false, 'checked w/o sixth');
  exception when others then perform pg_temp.check(sqlerrm like '%6th subject%', 'a HS form without the 6th subject cannot be checked'); end;
  insert into public.student_board_subjects (school_id, student_id, session_id, level, slot, code) values (a, stu, sess, 'hs', '6', '941');
  begin insert into public.student_board_subjects (school_id, student_id, session_id, level, slot, code) values (a, stu, sess, 'hs', '7', '9999'); perform pg_temp.check(false, 'unknown code');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'only official subject codes are accepted'); end;
  update public.board_registrations set status = 'checked' where id = app3;
  perform pg_temp.check((select snapshot ->> 'name_hi' = 'किरण वर्मा' and jsonb_array_length(snapshot -> 'subjects') = 6 and snapshot ->> 'aadhaar_last4' = '1234'
                                and (snapshot -> 'subjects' -> 0 ->> 'name_hi') = 'हिन्दी' from public.board_registrations where id = app3), 'the checked snapshot carries Hindi names, subjects with codes, and only the Aadhaar last 4');
  perform pg_temp.act_admin();

  -- internal helpers are not callable through the API
  perform pg_temp.act_as(pr);
  begin perform public.build_board_snapshot(stu, sess); perform pg_temp.check(false, 'snapshot callable');
  exception when others then perform pg_temp.check(sqlerrm like '%permission denied%', 'the snapshot builder is not exposed to API users'); end;
  begin perform public.lwp_days(gen_random_uuid(), current_date, current_date); perform pg_temp.check(false, 'lwp callable');
  exception when others then perform pg_temp.check(sqlerrm like '%permission denied%', 'internal payroll helper is not exposed'); end;
  perform pg_temp.act_admin();

  -- isolation
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.admission_applications where school_id = a) + (select count(*) from public.application_documents where school_id = a)
                      + (select count(*) from public.student_prior_exams where school_id = a) = 0, 'another school sees no applications, documents or prior exams');
  begin perform public.admit_application(app2, c6, sec6); perform pg_temp.check(false, 'cross school');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot admit this applicant'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.admission_applications) = 0, 'teachers cannot see applications');
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.audit_log where school_id = a and details::text like '%9811122233%' and entity = 'admission_applications'), 'applicant phone numbers are not written to the audit log');
  perform pg_temp.check((select count(*) from public.admission_seats(a, sess)) > 10, 'seat summary lists every class');

  perform pg_temp.act_as(ow);
  delete from public.schools where id = a;
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.admission_applications where school_id = a), 'deleting a school removes its applications');
end $$;

select 'ALL ADMISSION TESTS PASSED' as result;
rollback;
