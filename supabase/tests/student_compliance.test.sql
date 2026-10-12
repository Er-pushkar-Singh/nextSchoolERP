-- Student-data compliance test (step 6). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/student_compliance.test.sql
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
  ('dddddddd-0000-0000-0000-000000000001', 'sc-owner@test.dev'),
  ('dddddddd-0000-0000-0000-000000000002', 'sc-principal@test.dev'),
  ('dddddddd-0000-0000-0000-000000000003', 'sc-front@test.dev'),
  ('dddddddd-0000-0000-0000-000000000004', 'sc-teacherA@test.dev'),
  ('dddddddd-0000-0000-0000-000000000005', 'sc-office@test.dev'),
  ('dddddddd-0000-0000-0000-000000000006', 'sc-vp@test.dev'),
  ('dddddddd-0000-0000-0000-000000000007', 'sc-parent@test.dev'),
  ('dddddddd-0000-0000-0000-000000000008', 'sc-teacherB@test.dev'),
  ('dddddddd-0000-0000-0000-000000000009', 'sc-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('dddddddd-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'dddddddd-0000-0000-0000-000000000001'; pr uuid := 'dddddddd-0000-0000-0000-000000000002';
  fo uuid := 'dddddddd-0000-0000-0000-000000000003'; ta uuid := 'dddddddd-0000-0000-0000-000000000004';
  of_ uuid := 'dddddddd-0000-0000-0000-000000000005'; vp uuid := 'dddddddd-0000-0000-0000-000000000006';
  pa uuid := 'dddddddd-0000-0000-0000-000000000007'; tb uuid := 'dddddddd-0000-0000-0000-000000000008';
  ot uuid := 'dddddddd-0000-0000-0000-000000000009';
  a uuid; b uuid; c9 uuid; c10 uuid; c12 uuid; empty_cls uuid; secA uuid; secB uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  sess1 uuid; sess2 uuid; g uuid; reg uuid; tok text; tok2 text; n int; r json; doc uuid; maths uuid;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Compl A', 'compa-' || sfx);
  b := public.create_school('Compl B', 'complb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fo, 'Front'), (a, ta, 'Teacher A'), (a, tb, 'Teacher B'),
    (a, of_, 'Office'), (a, vp, 'VP'), (b, ot, 'Other principal');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fo, 'front_office'), (ta, 'class_teacher'), (tb, 'class_teacher'), (of_, 'office_admin'), (vp, 'vice_principal')) x(u, c)
    join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select a, pa, id from public.roles where school_id = a and code = 'parent';
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  -- office admin: profile view only, but holds the unrelated permissions that used to allow editing every student column
  insert into public.member_overrides (school_id, user_id, perm_key, effect, scope) values
    (a, of_, 'students.promotion.create', 'grant', 'school'), (a, of_, 'students.parent_link.edit', 'grant', 'school');

  select id into c9 from public.classes where school_id = a and name = '9';
  select id into c10 from public.classes where school_id = a and name = '10';
  select id into c12 from public.classes where school_id = a and name = '12';
  select id into maths from public.subjects where school_id = a and name = 'Mathematics';
  insert into public.classes (school_id, name, sort) values (a, 'Spare', 99) returning id into empty_cls;
  select id into secA from public.sections where class_id = c9 and name = 'A';
  insert into public.sections (school_id, class_id, name) values (a, c9, 'B') returning id into secB;
  select id into sess1 from public.sessions where school_id = a and is_current;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, father_name, dob, guardian_phone, notes)
    values (a, 'C1', 'Asha', 'K', c9, secA, 'F One', date '2012-05-01', '9876543210', 'secret note') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'C2', 'Bilal', c9, secB) returning id into s2;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'C3', 'Chitra', c12, (select id from public.sections where class_id = c12 limit 1)) returning id into s3;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id) values (a, 'C4', 'Dev', c10, (select id from public.sections where class_id = c10 limit 1)) returning id into s4;
  insert into public.staff_assignments (school_id, user_id, section_id) values (a, ta, secA), (a, tb, secB);
  insert into public.guardians (school_id, user_id, name, relation) values (a, pa, 'Parent of Asha', 'Mother') returning id into g;
  insert into public.student_guardians (school_id, student_id, guardian_id) values (a, s1, g);

  -- ───────── Student edit rights ─────────
  perform pg_temp.act_as(of_);
  update public.students set first_name = 'Hacked' where id = s1;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'promotion / parent-link permissions no longer allow editing student columns');
  begin
    update public.students set portal_token = 'abc' where id = s1;
    get diagnostics n = row_count;
    perform pg_temp.check(n = 0, 'cannot overwrite the parent link');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'cannot overwrite the parent link'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(fo);
  update public.students set first_name = 'Asha' where id = s1;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'front office (profile edit) can still edit students');
  begin
    update public.students set portal_token = 'abc' where id = s1;
    perform pg_temp.check(false, 'token overwritten directly');
  exception when others then perform pg_temp.check(sqlerrm like '%Reset link%', 'the token can only change through reset_portal_token()'); end;
  begin
    perform public.reset_portal_token(a, s1);
    perform pg_temp.check(false, 'front office reset the link');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office (parent link view only) cannot reset the link'); end;
  perform pg_temp.act_admin();
  select portal_token into tok from public.students where id = s1;
  perform pg_temp.act_as(pr);
  perform public.reset_portal_token(a, s1);
  perform pg_temp.act_admin();
  select portal_token into tok2 from public.students where id = s1;
  perform pg_temp.check(tok2 <> tok and length(tok2) = 32, 'principal resets the parent link through the function');

  -- ───────── DOB sanity ─────────
  perform pg_temp.act_as(pr);
  begin update public.students set dob = current_date + 5 where id = s2; perform pg_temp.check(false, 'future dob');
  exception when others then perform pg_temp.check(sqlerrm like '%future%', 'future date of birth is refused'); end;
  begin update public.students set dob = current_date - 200 where id = s2; perform pg_temp.check(false, 'toddler dob');
  exception when others then perform pg_temp.check(sqlerrm like '%age%', 'an impossible age is refused'); end;
  update public.students set dob = date '2013-03-02' where id = s2;
  perform pg_temp.check(true, 'a realistic date of birth is accepted');
  begin update public.students set pincode = '12345' where id = s2; perform pg_temp.check(false, 'bad pin');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'a PIN code must be 6 digits'); end;
  perform pg_temp.act_admin();

  -- ───────── Class / section delete guard ─────────
  perform pg_temp.act_as(pr);
  begin delete from public.classes where id = c9; perform pg_temp.check(false, 'deleted class with students');
  exception when others then perform pg_temp.check(sqlerrm like '%still has students%', 'a class with students cannot be deleted'); end;
  begin delete from public.sections where id = secB; perform pg_temp.check(false, 'deleted section with students');
  exception when others then perform pg_temp.check(sqlerrm like '%still has students%', 'a section with students cannot be deleted'); end;
  delete from public.classes where id = empty_cls;
  perform pg_temp.check(not exists (select 1 from public.classes where id = empty_cls), 'an empty class can be deleted');
  perform pg_temp.act_admin();

  -- ───────── Enrolment history ─────────
  perform pg_temp.check((select count(*) from public.student_enrolments where student_id = s1 and ended_on is null) = 1, 'every student has one open enrolment');
  perform pg_temp.act_as(pr);
  begin
    perform public.promote_students(a);
    perform pg_temp.check(false, 'promoted inside the same session');
  exception when others then perform pg_temp.check(sqlerrm like '%new session first%', 'promotion inside the same session is refused'); end;
  perform pg_temp.act_admin();
  insert into public.sessions (school_id, name, start_date, end_date, is_current) values (a, '2099-00', current_date, current_date + 300, false) returning id into sess2;
  perform pg_temp.act_as(pr);
  perform public.set_current_session(a, sess2);
  perform pg_temp.act_admin();
  perform pg_temp.act_as(ta);
  begin perform public.promote_students(a); perform pg_temp.check(false, 'teacher promoted');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a teacher cannot promote the school'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  r := public.promote_students(a, array[s2]);
  perform pg_temp.act_admin();
  perform pg_temp.check((r ->> 'promoted')::int >= 2 and (r ->> 'passed_out')::int = 1 and (r ->> 'detained')::int = 1, 'promotion reports promoted, passed out and detained');
  perform pg_temp.check((select class_id = c10 from public.students where id = s1) and (select class_id = c9 from public.students where id = s2)
                    and (select status = 'passed_out' from public.students where id = s3), 'students moved up, detained one stayed, top class passed out');
  perform pg_temp.check((select count(*) from public.student_enrolments where student_id = s1) = 2
                    and exists (select 1 from public.student_enrolments where student_id = s1 and class_id = c9 and session_id = sess1 and outcome = 'promoted' and ended_on is not null)
                    and exists (select 1 from public.student_enrolments where student_id = s1 and class_id = c10 and session_id = sess2 and ended_on is null),
    'last year''s class record is kept, with this year''s opened');
  perform pg_temp.check(exists (select 1 from public.student_enrolments where student_id = s2 and outcome = 'detained')
                    and exists (select 1 from public.student_enrolments where student_id = s2 and class_id = c9 and session_id = sess2 and ended_on is null), 'detention is recorded');
  perform pg_temp.check(exists (select 1 from public.student_enrolments where student_id = s3 and outcome = 'passed_out'), 'passing out closes the enrolment');
  perform pg_temp.act_as(pr);
  begin perform public.promote_students(a); perform pg_temp.check(false, 'promoted twice');
  exception when others then perform pg_temp.check(sqlerrm like '%new session first%', 'promoting twice is refused'); end;
  update public.students set status = 'transferred', left_on = current_date, tc_no = 'TC-1' where id = s4;
  perform pg_temp.act_admin();
  perform pg_temp.check(exists (select 1 from public.student_enrolments where student_id = s4 and outcome = 'transferred'), 'transfer closes the enrolment');

  -- teacher A now teaches the section Asha was promoted into
  insert into public.staff_assignments (school_id, user_id, section_id) values (a, ta, (select section_id from public.students where id = s1));

  -- ───────── Identity, health & notes tier ─────────
  perform pg_temp.check(not exists (select 1 from public.students where id = s1 and notes is not null)
                    and exists (select 1 from public.student_sensitive where student_id = s1 and internal_notes = 'secret note'), 'internal notes moved into the protected tier');
  perform pg_temp.act_as(of_);
  perform pg_temp.check((select count(*) from public.student_sensitive) = 0, 'office admin (profile view only) cannot read identity / health data');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(ta);
  perform pg_temp.check((select count(*) from public.student_sensitive where student_id = s1) = 1, 'class teacher sees alerts of own section');
  perform pg_temp.check((select count(*) from public.student_sensitive where student_id = s2) = 0, 'class teacher does not see another section');
  update public.student_sensitive set allergies = 'peanuts' where student_id = s1;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'class teacher cannot edit identity / health data');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(fo);
  update public.student_sensitive set pen = 'UP12345678', apaar_id = '123456789012', apaar_status = 'requested', apaar_consent = true,
         apaar_consent_by = 'Mother', apaar_consent_on = current_date, allergies = 'peanuts' where student_id = s1;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'front office records PEN, APAAR and consent');
  insert into public.student_sensitive (student_id, school_id) values (s2, a);
  begin update public.student_sensitive set apaar_id = '12345' where student_id = s2; perform pg_temp.check(false, 'short apaar');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'APAAR must be 12 digits'); end;
  begin update public.student_sensitive set apaar_id = '123456789012' where student_id = s2; perform pg_temp.check(false, 'dup apaar');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'the same APAAR cannot be given to two students'); end;
  begin update public.student_sensitive set apaar_status = 'requested' where student_id = s2; perform pg_temp.check(false, 'no consent');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'an APAAR request needs parent consent'); end;
  perform pg_temp.act_admin();

  -- ───────── Documents ─────────
  perform pg_temp.act_as(fo);
  insert into public.student_documents (school_id, student_id, doc_type, status, due_by) values (a, s1, 'transfer_certificate', 'pending', current_date + 30);
  perform pg_temp.check(true, 'a missing document can be recorded as pending (admission is not blocked)');
  begin insert into public.student_documents (school_id, student_id, doc_type, status) values (a, s1, 'birth_certificate', 'uploaded'); perform pg_temp.check(false, 'uploaded without file');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'an uploaded document needs a file'); end;
  insert into public.student_documents (school_id, student_id, doc_type, status, file_path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at)
    values (a, s1, 'photo', 'uploaded', a || '/' || s1 || '/photo.jpg', 'photo.jpg', 'image/jpeg', 1000, fo, now()) returning id into doc;
  begin update public.student_documents set status = 'verified' where id = doc; perform pg_temp.check(false, 'front office verified');
  exception when others then perform pg_temp.check(sqlerrm like '%cannot verify%', 'front office cannot verify documents'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(vp);
  begin update public.student_documents set status = 'rejected' where id = doc; perform pg_temp.check(false, 'rejected without reason');
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'rejecting a document needs a reason'); end;
  update public.student_documents set status = 'verified' where id = doc;
  perform pg_temp.check((select status = 'verified' and verified_by = vp and verified_at is not null from public.student_documents where id = doc), 'vice principal verifies (verifier and time stamped)');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(ta);
  perform pg_temp.check((select count(*) from public.student_documents where school_id = a) = 0, 'teachers cannot see student documents');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.student_documents where school_id = a) + (select count(*) from public.student_sensitive where school_id = a)
                      + (select count(*) from public.student_enrolments where school_id = a) = 0, 'another school sees none of it');
  perform pg_temp.act_admin();

  -- ───────── Guardians, emergency & pickup ─────────
  perform pg_temp.act_as(ta);
  g := public.add_student_contact(a, s1, 'Ramesh Kumar', 'Uncle', '+91 98765 11111', 'Driver', false, true, true);
  perform pg_temp.check(g is not null, 'class teacher adds an emergency / pickup contact for own section');
  begin perform public.add_student_contact(a, s2, 'X', 'Y', '9876511111', null, false, false, false); perform pg_temp.check(false, 'other section');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'cannot add contacts to another section''s student'); end;
  begin perform public.add_student_contact(a, s1, 'Bad', 'Y', '12345', null, false, false, false); perform pg_temp.check(false, 'bad phone');
  exception when others then perform pg_temp.check(sqlerrm like '%10-digit%', 'a contact phone must be a 10-digit mobile'); end;
  begin perform public.add_student_contact(a, s1, 'Nophone', 'Y', null, null, false, true, false); perform pg_temp.check(false, 'emergency without phone');
  exception when others then perform pg_temp.check(sqlerrm like '%phone number%', 'an emergency contact needs a phone'); end;
  perform public.add_student_contact(a, s1, 'Sita Devi', 'Mother', '9811122233', 'Teacher', true, true, false);
  perform pg_temp.act_admin();
  perform pg_temp.check((select guardian_phone = '9811122233' from public.students where id = s1), 'the primary contact''s number becomes the WhatsApp number');
  begin
    insert into public.student_guardians (school_id, student_id, guardian_id, is_primary) select a, s1, id, true from public.guardians where name = 'Ramesh Kumar';
    perform pg_temp.check(false, 'two primaries');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'only one primary contact per student'); end;
  perform pg_temp.act_as(pa);
  perform pg_temp.check((select count(*) from public.guardians where school_id = a) = 3, 'a parent sees the guardians of their own child');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(tb);
  perform pg_temp.check((select count(*) from public.guardians where school_id = a) = 0, 'a teacher cannot read guardians of other sections');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(ta);
  perform public.remove_student_contact(a, s1, (select id from public.guardians where name = 'Ramesh Kumar'));
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.guardians where name = 'Ramesh Kumar'), 'removing a contact deletes it');

  -- ───────── UP Board registration ─────────
  perform pg_temp.act_as(fo);
  insert into public.board_registrations (school_id, student_id, session_id, kind, class_level, exam_year) values (a, s1, sess2, 'advance_registration', 9, 2028) returning id into reg;
  perform pg_temp.check((select status = 'draft' from public.board_registrations where id = reg), 'front office starts a registration in draft');
  begin update public.board_registrations set status = 'checked' where id = reg; perform pg_temp.check(false, 'front office checked');
  exception when others then perform pg_temp.check(sqlerrm like '%Only the principal%', 'only the principal can check a registration'); end;
  insert into public.student_subjects (school_id, student_id, session_id, subject_id) values (a, s1, sess2, maths);
  perform pg_temp.act_admin();
  update public.student_documents set status = 'rejected', reject_reason = 'blurry' where id = doc;
  perform pg_temp.act_as(pr);
  begin update public.board_registrations set status = 'checked' where id = reg; perform pg_temp.check(false, 'checked without photo');
  exception when others then perform pg_temp.check(sqlerrm like '%photograph%' and sqlerrm like '%gender%', 'a registration without an acceptable photo (or gender) cannot be checked'); end;
  perform pg_temp.act_admin();
  update public.students set gender = 'F', name_hi = 'आशा के', father_name_hi = 'एफ वन', category = 'General', medium = 'hindi',
         district = 'Lucknow', state = 'Uttar Pradesh', pincode = '226001', mobile = '9876501234' where id = s1;
  insert into public.student_board_subjects (school_id, student_id, session_id, level, slot, code)
    select a, s1, sess2, 'hs', x.slot, x.code from (values ('1','901'),('2','917'),('3','928'),('4','931'),('5','932'),('6','941')) x(slot, code);
  update public.student_documents set status = 'uploaded', file_path = a || '/' || s1 || '/photo2.jpg' where id = doc;
  perform pg_temp.act_as(pr);
  update public.board_registrations set status = 'checked' where id = reg;
  perform pg_temp.check((select snapshot ->> 'name' = 'Asha K' and jsonb_array_length(snapshot -> 'subjects') = 6 and checked_by = pr from public.board_registrations where id = reg), 'checking freezes a snapshot of name, parents, DOB and subjects');
  begin update public.board_registrations set snapshot = '{"name":"X"}' where id = reg; perform pg_temp.check(false, 'edited snapshot');
  exception when others then perform pg_temp.check(sqlerrm like '%automatically%', 'the snapshot cannot be edited by hand'); end;
  update public.board_registrations set status = 'submitted', board_ref = 'UPMSP-123', challan_no = 'CH-9', fee_paid_on = current_date where id = reg;
  begin update public.board_registrations set status = 'correction' where id = reg; perform pg_temp.check(false, 'correction without note');
  exception when others then perform pg_temp.check(sqlerrm like '%correct%', 'a correction request needs the board''s remark'); end;
  update public.board_registrations set status = 'correction', correction_note = 'Father name spelling' where id = reg;
  begin update public.board_registrations set status = 'accepted' where id = reg; perform pg_temp.check(false, 'illegal jump');
  exception when others then perform pg_temp.check(sqlerrm like '%cannot go from%', 'illegal status jumps are refused'); end;
  perform pg_temp.act_admin();
  perform pg_temp.check((select count(*) from public.board_registration_events where registration_id = reg) >= 4, 'every step is in the registration history');
  perform pg_temp.act_as(ta);
  perform pg_temp.check((select count(*) from public.board_registrations) = 0, 'teachers cannot see board registrations');
  perform pg_temp.act_admin();

  -- ───────── Audit coverage & masking ─────────
  perform pg_temp.act_as(pr);
  update public.students set guardian_phone = '9000000001', father_name = 'F Changed' where id = s2;
  perform pg_temp.act_admin();
  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and entity = 'students' and entity_id = s2::text
                                 and details::text like '%guardian_phone%' and details::text not like '%9000000001%'), 'phone changes are logged without the number');
  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and entity = 'students' and details::text like '%F Changed%'), 'name changes keep their values for correction history');
  perform pg_temp.check(not exists (select 1 from public.audit_log where school_id = a and (details::text like '%' || tok2 || '%' or details::text like '%peanuts%')), 'tokens and health values never reach the audit log');
  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and entity = 'student_sensitive'), 'identity changes are audited');
  perform pg_temp.act_as(pr);
  insert into public.exams (school_id, session_id, name) values (a, sess2, 'T1');
  perform pg_temp.act_admin();
  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and entity = 'guardians'), 'guardian changes are audited');

  -- ───────── Whole school can still be deleted ─────────
  perform pg_temp.act_as(ow);
  delete from public.schools where id = a;
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.student_enrolments where school_id = a) and not exists (select 1 from public.board_registrations where school_id = a),
    'deleting a school removes enrolments and registrations');
end $$;

select 'ALL STUDENT COMPLIANCE TESTS PASSED' as result;
rollback;
