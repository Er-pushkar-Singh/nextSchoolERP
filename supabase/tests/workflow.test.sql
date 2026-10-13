-- Admission workflow test (step 13): enquiry → details → documents → test → decision → fee → class & section.
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/workflow.test.sql
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
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
  ('cdcdcdcd-0000-0000-0000-000000000001', 'wf-owner@test.dev'),
  ('cdcdcdcd-0000-0000-0000-000000000002', 'wf-principal@test.dev'),
  ('cdcdcdcd-0000-0000-0000-000000000003', 'wf-front@test.dev'),
  ('cdcdcdcd-0000-0000-0000-000000000004', 'wf-acct@test.dev'),
  ('cdcdcdcd-0000-0000-0000-000000000005', 'wf-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('cdcdcdcd-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'cdcdcdcd-0000-0000-0000-000000000001'; pr uuid := 'cdcdcdcd-0000-0000-0000-000000000002';
  fo uuid := 'cdcdcdcd-0000-0000-0000-000000000003'; ac uuid := 'cdcdcdcd-0000-0000-0000-000000000004'; ot uuid := 'cdcdcdcd-0000-0000-0000-000000000005';
  a uuid; b uuid; c6 uuid; c7 uuid; sec6 uuid; sec7 uuid; sess uuid; head uuid; app uuid; app2 uuid; app3 uuid; stu uuid; stu2 uuid; rid uuid; p jsonb; n int;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Flow A', 'wfa-' || sfx);
  b := public.create_school('Flow B', 'wfb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fo, 'Front'), (a, ac, 'Accountant'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fo, 'front_office'), (ac, 'accountant')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into c6 from public.classes where school_id = a and name = '6';
  select id into c7 from public.classes where school_id = a and name = '7';
  select id into sec6 from public.sections where class_id = c6 limit 1;
  select id into sec7 from public.sections where class_id = c7 limit 1;
  select id into sess from public.sessions where school_id = a and is_current;
  select id into head from public.fee_heads where school_id = a and name = 'Tuition Fee';
  update public.classes set seats = 2 where id = c6;
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (a, sess, c6, head, 'Admission', current_date, 3000);
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (a, sess, c6, head, 'Next quarter', current_date + 120, 5000);
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (a, sess, c7, head, 'Admission', current_date, 3500);

  -- ── Step 1–2: an application always has an enquiry; details are checked ──
  perform pg_temp.act_as(fo);
  app := public.create_application(a, c6, null, jsonb_build_object('first_name', 'Tara', 'dob', '2014-05-01'), false, null, 'Walk-in');
  perform pg_temp.check((select enquiry_id is not null from public.admission_applications where id = app), 'an application started without an enquiry gets one automatically');
  perform pg_temp.check((select e.source = 'Walk-in' and e.class_sought = '6' from public.enquiries e join public.admission_applications x on x.enquiry_id = e.id where x.id = app), 'the enquiry carries the source and class');
  p := public.application_progress(app);
  perform pg_temp.check(p ->> 'stage' = 'details', 'stage is "details" while student / parent details are incomplete');
  perform pg_temp.check((p -> 'details_missing') ? 'gender' and (p -> 'details_missing') ? 'father''s name', 'the missing details are listed');
  perform pg_temp.act_as(pr);
  begin update public.admission_applications set status = 'approved' where id = app; perform pg_temp.check(false, 'approve incomplete');
  exception when others then perform pg_temp.check(sqlerrm like '%cannot be approved yet%' and sqlerrm like '%details%', 'approval is blocked while details are missing'); end;

  -- ── Step 3: documents ──
  perform pg_temp.act_as(fo);
  update public.admission_applications set form = form || jsonb_build_object('gender', 'F', 'father_name', 'Anil Verma', 'mother_name', 'Rekha Verma', 'guardian_phone', '9811122233', 'city', 'Lucknow') where id = app;
  perform pg_temp.check(public.application_progress(app) ->> 'stage' = 'documents', 'stage moves to "documents" once details are complete');
  perform pg_temp.act_as(pr);
  begin update public.admission_applications set status = 'approved' where id = app; perform pg_temp.check(false, 'approve no docs');
  exception when others then perform pg_temp.check(sqlerrm like '%documents%', 'approval is blocked while required documents are missing'); end;
  perform pg_temp.act_as(fo);
  begin perform public.waive_application_docs(app, 'x'); perform pg_temp.check(false, 'front waive'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot waive documents'); end;
  insert into public.application_documents (school_id, application_id, doc_type, status, file_path, file_name, mime_type, size_bytes)
    values (a, app, 'birth_certificate', 'uploaded', a || '/applications/' || app || '/bc.pdf', 'bc.pdf', 'application/pdf', 1000);
  perform pg_temp.check((public.application_progress(app) -> 'docs_missing') ? 'photo' and not (public.application_progress(app) -> 'docs_missing') ? 'birth_certificate', 'one required document is still missing: the photo');
  perform pg_temp.act_as(pr);
  perform public.waive_application_docs(app, 'Photo to be submitted with the TC');
  perform pg_temp.check(public.application_progress(app) ->> 'stage' = 'decision', 'with the documents waived the stage is the principal''s decision');

  -- ── Step 4: test (when the school requires it) ──
  insert into public.admission_settings (school_id, require_test) values (a, true) on conflict (school_id) do update set require_test = true;
  perform pg_temp.check(public.application_progress(app) ->> 'stage' = 'assessment', 'a school that requires the test stops at "assessment"');
  begin update public.admission_applications set status = 'approved' where id = app; perform pg_temp.check(false, 'no test');
  exception when others then perform pg_temp.check(sqlerrm like '%test%', 'approval needs the test marks'); end;
  update public.admission_applications set test_marks = 41, test_max = 50 where id = app;

  -- ── Step 5: decision ──
  update public.admission_applications set status = 'approved' where id = app;
  perform pg_temp.check((select offer_valid_till is not null from public.admission_applications where id = app), 'approved: the offer validity is stamped');
  perform pg_temp.check(public.application_progress(app) ->> 'stage' = 'fee', 'after approval the next stage is the admission fee');
  perform pg_temp.check((public.application_progress(app) ->> 'can_start')::boolean, 'the admission can be started');

  -- ── Class and section cannot be given before the fee ──
  begin perform public.admit_application(app, c6, sec6); perform pg_temp.check(false, 'admit before fee');
  exception when others then perform pg_temp.check(sqlerrm like '%collect the admission fee first%', 'class & section are refused before the admission is started and paid'); end;

  -- ── Step 6: start the admission → student record without a class, fees billed ──
  perform pg_temp.act_as(fo);
  begin perform public.begin_admission(app); perform pg_temp.check(false, 'front begin'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot start the admission'); end;
  perform pg_temp.act_as(pr);
  stu := public.begin_admission(app);
  perform pg_temp.check((select status = 'admission_pending' and class_id is null and section_id is null and admission_class_id = c6 and admission_no is not null from public.students where id = stu),
    'a pending student exists: admission number, NO class or section yet');
  perform pg_temp.check((select count(*) = 2 and sum(amount) = 8000 from public.fee_dues where student_id = stu), 'the fees of the class applied for are billed');
  perform pg_temp.check(public.begin_admission(app) = stu, 'starting twice returns the same student');
  perform pg_temp.check(not exists (select 1 from public.student_enrolments where student_id = stu), 'no class history yet');
  p := public.application_progress(app);
  perform pg_temp.check((p -> 'fee' ->> 'balance')::numeric = 3000 and not (p -> 'fee' ->> 'ready')::boolean, 'the admission fee is the dues falling due within the window (3000), not the whole year');
  begin perform public.admit_application(app, c6, sec6); perform pg_temp.check(false, 'admit unpaid');
  exception when others then perform pg_temp.check(sqlerrm like '%not paid%', 'class & section are refused while the admission fee is unpaid'); end;

  -- ── Fee is collected with the normal fee desk ──
  perform pg_temp.act_as(ac);
  rid := public.collect_fee_v2(a, stu, '[{"mode":"cash","amount":1000}]'::jsonb, null, 0, null, null, 'Accountant', 0);
  perform pg_temp.act_as(pr);
  perform pg_temp.check((public.application_progress(app) -> 'fee' ->> 'balance')::numeric = 2000, 'part payment reduces the balance');
  begin perform public.admit_application(app, c6, sec6); perform pg_temp.check(false, 'admit part paid');
  exception when others then perform pg_temp.check(sqlerrm like '%not paid%', 'part payment is not enough');  end;
  perform pg_temp.act_as(ac);
  rid := public.collect_fee_v2(a, stu, '[{"mode":"upi","amount":2000,"reference":"UPI1"}]'::jsonb, null, 0, null, null, 'Accountant', 0);
  perform pg_temp.act_as(pr);
  perform pg_temp.check(public.application_progress(app) ->> 'stage' = 'allotment', 'fee paid: the stage is class & section allotment');
  perform pg_temp.check(exists (select 1 from public.admission_application_events where application_id = app and event = 'fee received'), 'fee receipts appear on the application timeline');
  perform pg_temp.check(exists (select 1 from public.application_timeline(app) where event like 'enquiry received%'), 'the timeline starts with the enquiry');

  -- ── Step 7: class & section last ──
  begin perform public.admit_application(app, c7, sec7); perform pg_temp.check(false, 'class change after pay');
  exception when others then perform pg_temp.check(sqlerrm like '%already paid%', 'after payment the class cannot be switched to another class'); end;
  stu2 := public.admit_application(app, c6, sec6, null, null, 5);
  perform pg_temp.check(stu2 = stu, 'the same student record is admitted');
  perform pg_temp.check((select status = 'active' and class_id = c6 and section_id = sec6 and roll_no = 5 and admission_date is not null from public.students where id = stu), 'the student is active with class, section and roll');
  perform pg_temp.check(exists (select 1 from public.student_enrolments where student_id = stu and class_id = c6 and ended_on is null), 'class history opens at the allotment');
  perform pg_temp.check((select status = 'admitted' and student_id = stu from public.admission_applications where id = app), 'the application is admitted');
  perform pg_temp.check(public.application_progress(app) ->> 'stage' = 'admitted', 'stage: admitted');

  -- ── Fee waiver path, and a different class chosen at the end (nothing paid yet) ──
  perform pg_temp.act_as(fo);
  app2 := public.create_application(a, c6, null, jsonb_build_object('first_name', 'Esha', 'gender', 'F', 'dob', '2014-06-01', 'father_name', 'B', 'mother_name', 'C', 'guardian_phone', '9811100000', 'city', 'Lucknow', 'allow_duplicate', true), false, null, 'Referral');
  insert into public.application_documents (school_id, application_id, doc_type, status, file_path, file_name, mime_type, size_bytes) values
    (a, app2, 'birth_certificate', 'uploaded', 'p/a', 'a.pdf', 'application/pdf', 1), (a, app2, 'photo', 'uploaded', 'p/b', 'b.jpg', 'image/jpeg', 1);
  update public.admission_applications set test_marks = 30, test_max = 50 where id = app2;
  perform pg_temp.act_as(pr);
  update public.admission_applications set status = 'approved' where id = app2;
  perform public.begin_admission(app2);
  begin perform public.waive_application_fee(app2, ''); perform pg_temp.check(false, 'no reason'); exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'waiving the fee needs a reason'); end;
  update public.classes set seats = 1 where id = c6;
  begin perform public.waive_application_fee(app2, 'RTE candidate'); perform public.admit_application(app2, c6, sec6); perform pg_temp.check(false, 'no seat');
  exception when others then perform pg_temp.check(sqlerrm like '%No free seat%', 'a full class refuses the allotment'); end;
  perform public.waive_application_fee(app2, 'RTE candidate');
  perform pg_temp.check(public.application_progress(app2) ->> 'stage' = 'allotment', 'a waived fee unlocks the allotment');
  perform public.admit_application(app2, c7, sec7);
  perform pg_temp.check((select class_id = c7 and status = 'active' from public.students where application_id = app2), 'class chosen at the last step (different from applied) is honoured');
  perform pg_temp.check((select count(*) = 1 and sum(amount) = 3500 from public.fee_dues d join public.students s on s.id = d.student_id where s.application_id = app2), 'fees are billed again for the class finally given');

  -- ── Cancelling releases an unpaid pending student ──
  perform pg_temp.act_as(fo);
  app3 := public.create_application(a, c6, null, jsonb_build_object('first_name', 'Farhan', 'gender', 'M', 'dob', '2014-07-01', 'father_name', 'D', 'mother_name', 'E', 'guardian_phone', '9811100001', 'city', 'Lucknow'), false, null, 'Online');
  insert into public.application_documents (school_id, application_id, doc_type, status, file_path, file_name, mime_type, size_bytes) values
    (a, app3, 'birth_certificate', 'uploaded', 'p/c', 'a.pdf', 'application/pdf', 1), (a, app3, 'photo', 'uploaded', 'p/d', 'b.jpg', 'image/jpeg', 1);
  update public.admission_applications set test_marks = 20, test_max = 50 where id = app3;
  perform pg_temp.act_as(pr);
  update public.admission_applications set status = 'approved' where id = app3;
  stu := public.begin_admission(app3);
  update public.admission_applications set status = 'cancelled' where id = app3;
  perform pg_temp.check(not exists (select 1 from public.students where id = stu), 'cancelling releases the unpaid pending student');

  -- ── Board ──
  perform pg_temp.check((select count(*) = 3 from public.application_board(a, sess)), 'the board lists all three applications');
  perform pg_temp.check((select count(*) = 2 from public.application_board(a, sess, 'admitted')), 'filter the board by stage');
  perform pg_temp.check((select count(*) = 0 from public.application_board(b, sess)), 'another school''s board is separate');

  -- ── Isolation ──
  perform pg_temp.act_as(ot);
  perform pg_temp.check(public.application_progress(app) is null, 'another school cannot read the progress');
  begin perform public.begin_admission(app2); perform pg_temp.check(false, 'cross'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%' or sqlerrm like '%Only an approved%', 'another school cannot act on our application'); end;
end $$;

rollback;
