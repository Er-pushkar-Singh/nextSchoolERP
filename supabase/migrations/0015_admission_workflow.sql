-- ═══════════════════════════════════════════════════════════════════════════
-- Step 13: Admission as one guided flow, in a fixed order:
--
--   1 Enquiry → 2 Student & parent details → 3 Documents → 4 Test / interview (if the school asks)
--   → 5 Principal's decision → 6 Admission fee → 7 Class & section (last) → Admitted
--
--   • every application has an enquiry trail (created automatically when it starts without one)
--   • approval is blocked until details, required documents and (if required) test marks are in;
--     the principal can waive documents with a written reason
--   • "Start admission" creates the student record (status admission_pending, NO class yet), bills the
--     fees of the class applied for and the family pays BEFORE a class and section are given
--   • class and section are assigned last, only when the admission fee is paid (or waived in writing)
--   • one timeline per application: enquiry, documents, decision, fee receipts, allotment
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Settings ─────────────
alter table public.admission_settings add column if not exists strict_workflow boolean not null default true;       -- gate approval on details / documents / test
alter table public.admission_settings add column if not exists fee_before_allotment boolean not null default true;  -- class & section only after the fee
alter table public.admission_settings add column if not exists required_docs text[] not null default array['birth_certificate','photo'];
alter table public.admission_settings add column if not exists require_test boolean not null default false;
alter table public.admission_settings add column if not exists fee_window_days int not null default 31 check (fee_window_days between 0 and 365);

alter table public.admission_applications add column if not exists docs_waiver_note text;
alter table public.admission_applications add column if not exists docs_waived_by text;
alter table public.admission_applications add column if not exists fee_waiver_note text;
alter table public.admission_applications add column if not exists fee_waived_by text;
alter table public.admission_applications add column if not exists enrolled_on date;       -- "Start admission" (student record + fees)

alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check
  check (status in ('active','left','passed_out','transferred','withdrawn','admission_pending'));

-- ───────────── Settings access with defaults ─────────────
create or replace function public.admission_cfg(sid uuid)
returns table (strict_workflow boolean, fee_before_allotment boolean, required_docs text[], require_test boolean, fee_window_days int, offer_days int)
language sql stable security definer set search_path = public as $$
  select coalesce(s.strict_workflow, true), coalesce(s.fee_before_allotment, true), coalesce(s.required_docs, array['birth_certificate','photo']),
         coalesce(s.require_test, false), coalesce(s.fee_window_days, 31), coalesce(s.offer_days, 7)
    from (select 1) one left join public.admission_settings s on s.school_id = sid;
$$;
revoke execute on function public.admission_cfg(uuid) from public, anon, authenticated;

-- ───────────── What is still missing, for one application row ─────────────
create or replace function public.application_missing_details(f jsonb) returns text[]
language sql immutable set search_path = public as $$
  select array_remove(array[
    case when coalesce(btrim(f ->> 'first_name'), '') = '' then 'student name' end,
    case when coalesce(btrim(f ->> 'dob'), '') = '' then 'date of birth' end,
    case when coalesce(btrim(f ->> 'gender'), '') = '' then 'gender' end,
    case when coalesce(btrim(f ->> 'father_name'), '') = '' then 'father''s name' end,
    case when coalesce(btrim(f ->> 'mother_name'), '') = '' then 'mother''s name' end,
    case when coalesce(btrim(f ->> 'guardian_phone'), '') = '' then 'parent mobile' end,
    case when coalesce(btrim(f ->> 'address'), btrim(f ->> 'street'), btrim(f ->> 'city'), '') = '' then 'address' end
  ], null);
$$;

create or replace function public.application_missing_docs(app uuid, req text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d order by d), '{}') from unnest(req) d
   where not exists (select 1 from public.application_documents x where x.application_id = app and x.doc_type = d and x.status in ('uploaded', 'verified', 'not_applicable'));
$$;
revoke execute on function public.application_missing_docs(uuid, text[]) from public, anon, authenticated;

-- what stops an approval right now (empty = nothing)
create or replace function public.approval_blockers(a public.admission_applications) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare c record; out text[] := '{}'; d text[]; m text[];
begin
  select * into c from public.admission_cfg(a.school_id);
  if not c.strict_workflow then return out; end if;
  m := public.application_missing_details(a.form);
  if cardinality(m) > 0 then out := out || ('details: ' || array_to_string(m, ', '))::text; end if;
  d := public.application_missing_docs(a.id, c.required_docs);
  if cardinality(d) > 0 and a.docs_waiver_note is null then out := out || ('documents: ' || array_to_string(d, ', '))::text; end if;
  if c.require_test and a.test_marks is null then out := out || 'entrance test marks'::text; end if;
  return out;
end $$;
revoke execute on function public.approval_blockers(public.admission_applications) from public, anon, authenticated;

-- ───────────── Fee status of an application ─────────────
-- "Admission fee" = every fee of the class that falls due within fee_window_days of today (admission, annual, first instalments).
create or replace function public.admission_fee_status(app uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a record; c record; req numeric := 0; paid numeric := 0; bal numeric := 0; n int := 0; r record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null or not (public.has_perm_school(a.school_id, 'frontdesk.admissions.view') or public.is_service()) then return null; end if;
  select * into c from public.admission_cfg(a.school_id);
  if a.student_id is not null then
    select count(*), coalesce(sum(greatest(d.amount - d.concession, 0) + d.fine), 0), coalesce(sum(d.paid), 0), coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), 0)
      into n, req, paid, bal
      from public.fee_dues d
     where d.student_id = a.student_id and d.kind = 'plan' and d.due_date <= public.today_ist() + c.fee_window_days;
  end if;
  return jsonb_build_object(
    'student_id', a.student_id, 'lines', n, 'required', req, 'paid', paid, 'balance', bal,
    'waived', a.fee_waiver_note is not null,
    'ready', a.student_id is not null and (bal = 0 or a.fee_waiver_note is not null));
end $$;

-- ───────────── Progress: the step-by-step state of one application ─────────────
create or replace function public.application_progress(app uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.admission_applications; c record; det text[]; dmiss text[]; blockers text[]; fee jsonb; steps jsonb := '[]'::jsonb; st text; cur boolean := false;
        enq record; f_ready boolean; done_ boolean; seat_free int; have int; need int;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null or not (public.has_perm_school(a.school_id, 'frontdesk.admissions.view') or public.is_service()) then return null; end if;
  select * into c from public.admission_cfg(a.school_id);
  det := public.application_missing_details(a.form);
  dmiss := public.application_missing_docs(a.id, c.required_docs);
  blockers := public.approval_blockers(a);
  fee := public.admission_fee_status(app);
  f_ready := coalesce((fee ->> 'ready')::boolean, false);
  need := cardinality(c.required_docs); have := need - cardinality(dmiss);
  select s.seats - s.active_students into seat_free from public.admission_seats(a.school_id, a.session_id) s where s.class_id = a.class_id and s.seats is not null;

  -- stage
  st := case
    when a.status = 'admitted' then 'admitted'
    when a.status in ('cancelled', 'rejected') then 'closed'
    when a.status = 'waitlisted' then 'waitlist'
    when cardinality(det) > 0 then 'details'
    when cardinality(dmiss) > 0 and a.docs_waiver_note is null then 'documents'
    when c.require_test and a.test_marks is null then 'assessment'
    when a.status <> 'approved' then 'decision'
    when not f_ready then 'fee'
    else 'allotment' end;

  -- steps in fixed order; the first one that is not done is "current"
  select array_to_json(array_agg(row_to_json(x) order by x.n))::jsonb into steps from (values
    (1, 'enquiry', 'Enquiry', a.enquiry_id is not null, 'enquiry' || case when a.source is not null then ' · ' || a.source else '' end, false),
    (2, 'details', 'Student & parent details', cardinality(det) = 0, case when cardinality(det) = 0 then 'complete' else 'missing: ' || array_to_string(det, ', ') end, false),
    (3, 'documents', 'Documents', cardinality(dmiss) = 0 or a.docs_waiver_note is not null,
        case when a.docs_waiver_note is not null and cardinality(dmiss) > 0 then 'waived: ' || a.docs_waiver_note
             when cardinality(dmiss) = 0 then have || ' of ' || need || ' required received' else 'missing: ' || array_to_string(dmiss, ', ') end, false),
    (4, 'assessment', 'Test / interview', (not c.require_test) or a.test_marks is not null,
        case when not c.require_test then 'not required' when a.test_marks is not null then a.test_marks || ' / ' || coalesce(a.test_max::text, '?') else 'marks pending' end, not c.require_test),
    (5, 'decision', 'Principal''s decision', a.status in ('approved', 'admitted'), a.status || coalesce(' #' || a.waitlist_no, ''), false),
    (6, 'fee', 'Admission fee', f_ready,
        case when a.student_id is null then 'not started'
             when f_ready and a.fee_waiver_note is not null then 'waived: ' || a.fee_waiver_note
             when f_ready then 'paid'
             else 'balance ' || (fee ->> 'balance') end, false),
    (7, 'allotment', 'Class & section', a.status = 'admitted', case when a.status = 'admitted' then 'allotted' else 'after the fee' end, false)
  ) as x(n, key, label, done, detail, skipped);

  -- mark states
  select jsonb_agg(
           e || jsonb_build_object('state',
             case when (e ->> 'done')::boolean then (case when (e ->> 'skipped')::boolean then 'skipped' else 'done' end)
                  when a.status in ('cancelled', 'rejected') then 'closed'
                  when (e ->> 'key') = st or ((e ->> 'key') = 'assessment' and st = 'assessment') then 'current'
                  else 'todo' end)
           order by (e ->> 'n')::int)
    into steps from jsonb_array_elements(steps) e;

  return jsonb_build_object(
    'stage', st, 'steps', steps, 'details_missing', to_jsonb(det), 'docs_missing', to_jsonb(dmiss), 'blockers', to_jsonb(blockers),
    'can_approve', cardinality(blockers) = 0, 'student_id', a.student_id, 'fee', fee,
    'can_start', a.status = 'approved' and a.student_id is null, 'can_allot', a.status = 'approved' and f_ready, 'seat_free', seat_free,
    'fee_before_allotment', c.fee_before_allotment, 'strict', c.strict_workflow);
end $$;

-- ───────────── Approval gate (extends the workflow trigger of 0010) ─────────────
create or replace function public.guard_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_checked boolean := auth.uid() is not null and not public.is_service(); ok boolean; need_approve boolean; b text[];
begin
  if tg_op = 'INSERT' then new.status := 'submitted'; return new; end if;
  if new.school_id is distinct from old.school_id or new.application_no is distinct from old.application_no then raise exception 'Application numbers cannot be changed.'; end if;
  if old.status in ('admitted','cancelled') and (new.status is distinct from old.status or new.form is distinct from old.form or new.class_id is distinct from old.class_id) then
    raise exception 'This application is closed (%).', old.status;
  end if;
  -- once the student record exists the class applied for is fixed (its fees are already billed)
  if old.student_id is not null and new.class_id is distinct from old.class_id and coalesce(current_setting('app.admitting', true), '') <> '1' then
    raise exception 'The admission has started, so the class can no longer be changed here. Allot the class at the last step.';
  end if;
  -- waivers are the principal's
  if (new.docs_waiver_note is distinct from old.docs_waiver_note or new.fee_waiver_note is distinct from old.fee_waiver_note)
     and actor_checked and not public.has_perm_school(new.school_id, 'frontdesk.admissions.approve') then
    raise exception 'Only the principal can waive documents or the admission fee.';
  end if;
  if new.status is distinct from old.status then
    ok := case old.status
      when 'submitted'      then new.status in ('under_review','test_scheduled','approved','waitlisted','rejected','cancelled')
      when 'under_review'   then new.status in ('test_scheduled','approved','waitlisted','rejected','cancelled')
      when 'test_scheduled' then new.status in ('under_review','approved','waitlisted','rejected','cancelled')
      when 'approved'       then new.status in ('waitlisted','cancelled','admitted','under_review')
      when 'waitlisted'     then new.status in ('approved','rejected','cancelled','under_review')
      when 'rejected'       then new.status in ('under_review')
      else false end;
    if not ok then raise exception 'An application cannot go from % to %.', old.status, new.status; end if;
    if new.status = 'admitted' and coalesce(current_setting('app.admitting', true), '') <> '1' then
      raise exception 'An application becomes admitted only through "Admit".';
    end if;
    need_approve := new.status in ('approved','waitlisted','rejected') or (old.status = 'rejected');
    if actor_checked and need_approve and not public.has_perm_school(new.school_id, 'frontdesk.admissions.approve') then
      raise exception 'Only the principal (admission approver) can approve, waitlist or reject.';
    end if;
    if new.status = 'approved' then
      b := public.approval_blockers(new);
      if cardinality(b) > 0 then raise exception 'This application cannot be approved yet — %. Complete these steps, or (principal) waive the documents with a reason.', array_to_string(b, '; '); end if;
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.decision_note), '') = '' then raise exception 'Write the reason for rejecting.'; end if;
    if new.status in ('approved','waitlisted','rejected') then new.decided_by := auth.uid(); new.decided_at := now(); end if;
    if new.status = 'waitlisted' then
      select coalesce(max(waitlist_no), 0) + 1 into new.waitlist_no from public.admission_applications
       where school_id = new.school_id and class_id is not distinct from new.class_id and session_id is not distinct from new.session_id and status = 'waitlisted';
    elsif old.status = 'waitlisted' then new.waitlist_no := null;
    end if;
    if new.status = 'test_scheduled' and new.test_on is null and new.interview_on is null then raise exception 'Set the test or interview date first.'; end if;
  end if;
  return new;
end $$;

-- a cancelled / rejected application releases a student record that was started but never paid
create or replace function public.application_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('cancelled', 'rejected') and old.status not in ('cancelled', 'rejected') and new.student_id is not null then
    if exists (select 1 from public.students s where s.id = new.student_id and s.status = 'admission_pending')
       and not exists (select 1 from public.fee_receipts r where r.student_id = new.student_id) then
      delete from public.students where id = new.student_id and status = 'admission_pending';
    end if;
  end if;
  return null;
end $$;
drop trigger if exists admission_applications_release on public.admission_applications;
create trigger admission_applications_release after update on public.admission_applications for each row execute function public.application_release();

-- ───────────── Every application has an enquiry (so there is one trail from the first contact) ─────────────
create or replace function public.create_application_core(sid uuid, p_class uuid, p_enquiry uuid, p_form jsonb, p_rte boolean, p_rte_ref text, p_source text, p_session uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare sess uuid := coalesce(p_session, (select id from public.sessions where school_id = sid and is_current limit 1));
        sname text; n int; num text; nm text; dup text; aid uuid; f jsonb := coalesce(p_form, '{}'::jsonb); enq uuid := p_enquiry; cname text;
begin
  if coalesce(btrim(f ->> 'first_name'), '') = '' then raise exception 'The student''s first name is required.'; end if;
  if p_class is not null and not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Class not found.'; end if;
  if p_enquiry is not null and not exists (select 1 from public.enquiries where id = p_enquiry and school_id = sid) then raise exception 'Enquiry not found.'; end if;
  nm := btrim(concat_ws(' ', f ->> 'first_name', f ->> 'middle_name', f ->> 'last_name'));
  select application_no into dup from public.admission_applications
   where school_id = sid and session_id is not distinct from sess and status not in ('cancelled','rejected')
     and lower(applicant_name) = lower(nm) and coalesce(form ->> 'dob', '') = coalesce(f ->> 'dob', '') and coalesce(lower(father_name), '') = coalesce(lower(f ->> 'father_name'), '')
   limit 1;
  if dup is not null and coalesce((f ->> 'allow_duplicate')::boolean, false) is not true then
    raise exception 'An application for the same student already exists (no. %).', dup;
  end if;
  if enq is null then
    select name into cname from public.classes where id = p_class;
    insert into public.enquiries (school_id, student_name, class_sought, parent_name, phone, source, status, notes)
    values (sid, nm, cname, nullif(btrim(f ->> 'father_name'), ''), nullif(btrim(f ->> 'guardian_phone'), ''), nullif(btrim(coalesce(p_source, '')), ''), 'test',
            'Created with the application')
    returning id into enq;
  end if;
  select coalesce((select name from public.sessions where id = sess), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, 'application', sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1 returning next_no - 1 into n;
  num := 'APP/' || sname || '/' || lpad(n::text, 4, '0');
  insert into public.admission_applications (school_id, application_no, session_id, class_id, enquiry_id, applicant_name, father_name, phone, form, rte_applicant, rte_reference, source)
  values (sid, num, sess, p_class, enq, nm, nullif(btrim(f ->> 'father_name'), ''), nullif(btrim(f ->> 'guardian_phone'), ''), f - 'allow_duplicate', coalesce(p_rte, false),
          nullif(btrim(coalesce(p_rte_ref, '')), ''), nullif(btrim(coalesce(p_source, '')), ''))
  returning id into aid;
  if p_enquiry is not null then update public.enquiries set status = case when status in ('new','contacted','visited') then 'test' else status end where id = p_enquiry and school_id = sid; end if;
  return aid;
end $$;
revoke execute on function public.create_application_core(uuid, uuid, uuid, jsonb, boolean, text, text, uuid) from public, anon, authenticated;

-- ───────────── Student record from an application (shared by "Start admission" and the one-step admit) ─────────────
create or replace function public.enrol_from_application(a public.admission_applications, p_adm text, p_date date, p_status text, p_class uuid, p_section uuid, p_roll int)
returns uuid language plpgsql security definer set search_path = public as $$
declare f jsonb := a.form; sid uuid := a.school_id; stu uuid; adm text; c jsonb; pr jsonb; d record; today date := public.today_ist();
begin
  adm := nullif(btrim(coalesce(p_adm, '')), '');
  if adm is null then adm := public.next_school_number_internal(sid, 'admission'); end if;
  insert into public.students (school_id, admission_no, first_name, middle_name, last_name, gender, dob, class_id, section_id, roll_no, status,
      father_name, mother_name, guardian_phone, alt_phone, email, address, city, district, block_tehsil, pincode, state, locality_type, mother_tongue, nationality,
      category, blood_group, permanent_address, previous_school, previous_board, previous_class, name_hi, father_name_hi, mother_name_hi, mobile, street, post_office,
      religion, caste, medium, bpl, admission_date, admission_class_id, application_no, application_id,
      admission_category, previous_year_percent, previous_year_days, distance_km)
  values (sid, adm, btrim(f ->> 'first_name'), nullif(f ->> 'middle_name', ''), nullif(f ->> 'last_name', ''), nullif(f ->> 'gender', ''), nullif(f ->> 'dob', '')::date,
      p_class, p_section, p_roll, p_status,
      nullif(f ->> 'father_name', ''), nullif(f ->> 'mother_name', ''), nullif(f ->> 'guardian_phone', ''), nullif(f ->> 'alt_phone', ''), nullif(f ->> 'email', ''),
      nullif(f ->> 'address', ''), nullif(f ->> 'city', ''), nullif(f ->> 'district', ''), nullif(f ->> 'block_tehsil', ''), nullif(f ->> 'pincode', ''), nullif(f ->> 'state', ''),
      nullif(f ->> 'locality_type', ''), nullif(f ->> 'mother_tongue', ''), coalesce(nullif(f ->> 'nationality', ''), 'Indian'),
      nullif(f ->> 'category', ''), nullif(f ->> 'blood_group', ''), nullif(f ->> 'permanent_address', ''), nullif(f ->> 'previous_school', ''), nullif(f ->> 'previous_board', ''),
      nullif(f ->> 'previous_class', ''), nullif(f ->> 'name_hi', ''), nullif(f ->> 'father_name_hi', ''), nullif(f ->> 'mother_name_hi', ''), nullif(f ->> 'mobile', ''),
      nullif(f ->> 'street', ''), nullif(f ->> 'post_office', ''), nullif(f ->> 'religion', ''), nullif(f ->> 'caste', ''), nullif(f ->> 'medium', ''),
      nullif(f ->> 'bpl', '')::boolean, coalesce(p_date, today), a.class_id, a.application_no, a.id,
      case when a.rte_applicant then 'rte' else nullif(f ->> 'admission_category', '') end,
      nullif(f ->> 'previous_year_percent', '')::numeric, nullif(f ->> 'previous_year_days', '')::int, nullif(f ->> 'distance_km', '')::numeric)
  returning id into stu;

  if f ?| array['pen','apaar_id','aadhaar_enc','allergies','medical_conditions','medication','disability','disability_type','accommodations'] then
    insert into public.student_sensitive (student_id, school_id, pen, apaar_id, apaar_status, apaar_consent, aadhaar_enc, aadhaar_last4, aadhaar_consent,
        allergies, medical_conditions, medication, disability, disability_type, disability_percent, accommodations)
    values (stu, sid, nullif(f ->> 'pen', ''), nullif(f ->> 'apaar_id', ''), coalesce(nullif(f ->> 'apaar_status', ''), 'not_created'),
        coalesce((f ->> 'apaar_consent')::boolean, false), nullif(f ->> 'aadhaar_enc', ''), nullif(f ->> 'aadhaar_last4', ''),
        coalesce((f ->> 'aadhaar_consent')::boolean, false), nullif(f ->> 'allergies', ''), nullif(f ->> 'medical_conditions', ''), nullif(f ->> 'medication', ''),
        nullif(f ->> 'disability', ''), nullif(f ->> 'disability_type', ''), nullif(f ->> 'disability_percent', '')::numeric, nullif(f ->> 'accommodations', ''))
    on conflict (student_id) do nothing;
  end if;

  for c in select * from jsonb_array_elements(coalesce(f -> 'contacts', '[]'::jsonb)) loop
    declare gid uuid; ph text := nullif(regexp_replace(coalesce(c ->> 'phone', ''), '\D', '', 'g'), '');
    begin
      if coalesce(btrim(c ->> 'name'), '') = '' then continue; end if;
      if ph is not null and length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
      if ph is not null and ph !~ '^[6-9][0-9]{9}$' then ph := null; end if;
      insert into public.guardians (school_id, name, relation, phone, occupation, is_emergency, can_pickup)
      values (sid, btrim(c ->> 'name'), nullif(c ->> 'relation', ''), ph, nullif(c ->> 'occupation', ''),
              coalesce((c ->> 'is_emergency')::boolean, false) and ph is not null, coalesce((c ->> 'can_pickup')::boolean, false) and ph is not null)
      returning id into gid;
      insert into public.student_guardians (school_id, student_id, guardian_id, is_primary)
      values (sid, stu, gid, coalesce((c ->> 'is_primary')::boolean, false) and not exists (select 1 from public.student_guardians where student_id = stu and is_primary));
    end;
  end loop;

  for pr in select * from jsonb_array_elements(coalesce(f -> 'prior', '[]'::jsonb)) loop
    if (pr ->> 'level') in ('class8','class9_registration','class9','high_school','class11_registration','intermediate','iti','other') then
      insert into public.student_prior_exams (school_id, student_id, level, board_name, exam_year, roll_no, registration_no, school_name, district_code, school_code, result, percentage)
      values (sid, stu, pr ->> 'level', nullif(pr ->> 'board_name', ''), nullif(pr ->> 'exam_year', '')::int, nullif(pr ->> 'roll_no', ''), nullif(pr ->> 'registration_no', ''),
              nullif(pr ->> 'school_name', ''), nullif(pr ->> 'district_code', ''), nullif(pr ->> 'school_code', ''), nullif(pr ->> 'result', ''), nullif(pr ->> 'percentage', '')::numeric)
      on conflict (student_id, level) do nothing;
    end if;
  end loop;

  for d in select * from public.application_documents where application_id = a.id loop
    insert into public.student_documents (school_id, student_id, doc_type, title, status, file_path, file_name, mime_type, size_bytes, due_by, uploaded_by, uploaded_by_name,
                                          uploaded_at, verified_by, verified_by_name, verified_at, reject_reason, remark)
    values (sid, stu, d.doc_type, d.title, d.status, d.file_path, d.file_name, d.mime_type, d.size_bytes, d.due_by, d.uploaded_by, d.uploaded_by_name,
            d.uploaded_at, d.verified_by, d.verified_by_name, d.verified_at, d.reject_reason, d.remark)
    on conflict (student_id, doc_type) where doc_type <> 'other' do nothing;
  end loop;
  return stu;
end $$;
revoke execute on function public.enrol_from_application(public.admission_applications, text, date, text, uuid, uuid, int) from public, anon, authenticated;

-- the original allocator checks the caller's permission; this one is for functions that have already checked
create or replace function public.next_school_number_internal(sid uuid, kind text) returns text
language plpgsql security definer set search_path = public as $$
declare n int; p text;
begin
  if kind = 'admission' then
    update public.schools set next_admission_no = next_admission_no + 1 where id = sid returning next_admission_no - 1, admission_prefix into n, p;
    return p || n::text;
  end if;
  raise exception 'unknown kind %', kind;
end $$;
revoke execute on function public.next_school_number_internal(uuid, text) from public, anon, authenticated;

-- fees of the class applied for, billed to the (pending) student
create or replace function public.bill_application_dues(sid uuid, stu uuid, cls uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int; sess uuid; auto boolean;
begin
  select id into sess from public.sessions where school_id = sid and is_current limit 1;
  if sess is null or cls is null then return 0; end if;
  select coalesce(auto_sibling_discount, true) into auto from public.admission_settings where school_id = sid;
  if coalesce(auto, true) then perform public.sibling_discount_core(sid, stu); end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, stu, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount, public.concession_for(stu, p.fee_head_id, p.amount, p.due_date)
    from public.fee_plans p join public.fee_heads h on h.id = p.fee_head_id
   where p.school_id = sid and p.session_id = sess and p.class_id = cls
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.bill_application_dues(uuid, uuid, uuid) from public, anon, authenticated;

-- ───────────── Step 6: start the admission → student record (no class yet) + fees ─────────────
create or replace function public.begin_admission(app uuid, p_admission_no text default null, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.admission_applications; stu uuid;
begin
  select * into a from public.admission_applications where id = app for update;
  if a.id is null then raise exception 'Application not found.'; end if;
  if not public.has_perm_school(a.school_id, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if a.status <> 'approved' then raise exception 'Only an approved application can start the admission (this one is %).', a.status; end if;
  if a.student_id is not null then return a.student_id; end if;
  if a.class_id is null then raise exception 'Set the class applied for first.'; end if;
  stu := public.enrol_from_application(a, p_admission_no, p_date, 'admission_pending', null, null, null);
  perform public.bill_application_dues(a.school_id, stu, a.class_id);
  if a.enquiry_id is not null then update public.enquiries set student_id = stu where id = a.enquiry_id and school_id = a.school_id; end if;
  update public.admission_applications set student_id = stu, enrolled_on = public.today_ist() where id = app;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (a.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'admission started — fees billed', jsonb_build_object('student_id', stu));
  return stu;
end $$;

create or replace function public.waive_application_docs(app uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null then raise exception 'Application not found.'; end if;
  if not public.has_perm_school(a.school_id, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write the reason for waiving the documents.'; end if;
  update public.admission_applications set docs_waiver_note = btrim(p_note), docs_waived_by = coalesce(auth.jwt() ->> 'email', '') where id = app;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (a.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'documents waived', jsonb_build_object('note', btrim(p_note)));
end $$;

create or replace function public.waive_application_fee(app uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null then raise exception 'Application not found.'; end if;
  if not public.has_perm_school(a.school_id, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if a.student_id is null then raise exception 'Start the admission first.'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write the reason for waiving the admission fee.'; end if;
  update public.admission_applications set fee_waiver_note = btrim(p_note), fee_waived_by = coalesce(auth.jwt() ->> 'email', '') where id = app;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (a.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'admission fee waived', jsonb_build_object('note', btrim(p_note)));
end $$;

-- ───────────── Step 7: class & section, last ─────────────
create or replace function public.admit_application(app uuid, p_class uuid, p_section uuid, p_admission_no text default null,
                                                    p_admission_date date default null, p_roll int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.admission_applications; c record; stu uuid; fee jsonb; free int; sid uuid; today date := public.today_ist(); cls_changed boolean;
begin
  select * into a from public.admission_applications where id = app for update;
  if a.id is null then raise exception 'Application not found.'; end if;
  sid := a.school_id;
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if a.status <> 'approved' then raise exception 'Only an approved application can be admitted (this one is %).', a.status; end if;
  if p_class is null or not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Choose the class.'; end if;
  if p_section is not null and not exists (select 1 from public.sections where id = p_section and class_id = p_class) then raise exception 'The section does not belong to that class.'; end if;
  select * into c from public.admission_cfg(sid);

  if a.student_id is null then
    if c.fee_before_allotment then raise exception 'Start the admission and collect the admission fee first — the class and section are given at the last step.'; end if;
    -- school has switched the fee gate off: one-step admission as before
    stu := public.enrol_from_application(a, p_admission_no, coalesce(p_admission_date, today), 'admission_pending', null, null, null);
    perform public.bill_application_dues(sid, stu, p_class);
  else
    stu := a.student_id;
    fee := public.admission_fee_status(app);
    if c.fee_before_allotment and not coalesce((fee ->> 'ready')::boolean, false) then
      raise exception 'The admission fee is not paid (balance %). Collect it, or ask the principal to waive it with a reason.', fee ->> 'balance';
    end if;
  end if;

  -- a different class from the one applied for: only while nothing has been paid; the fees are billed again for the new class
  cls_changed := p_class is distinct from a.class_id;
  if cls_changed then
    if exists (select 1 from public.fee_dues where student_id = stu and paid > 0) then
      raise exception 'Fees of the applied class are already paid, so the class cannot be changed. Admit into that class.';
    end if;
    delete from public.fee_dues where student_id = stu and fee_plan_id is not null and paid = 0;
    perform public.bill_application_dues(sid, stu, p_class);
  end if;

  -- a free seat
  select s.seats - s.active_students into free from public.admission_seats(sid, a.session_id) s where s.class_id = p_class and s.seats is not null;
  if free is not null and free <= 0 then raise exception 'No free seat in this class. Raise the seats in Settings, or waitlist this application.'; end if;

  -- admission number (if it was not given at the start), then the class goes in last
  if nullif(btrim(coalesce(p_admission_no, '')), '') is not null then
    update public.students set admission_no = btrim(p_admission_no) where id = stu and admission_no is distinct from btrim(p_admission_no);
  end if;
  update public.students set class_id = p_class, section_id = p_section, roll_no = p_roll, status = 'active', admission_date = coalesce(p_admission_date, admission_date, today)
   where id = stu;
  if a.enquiry_id is not null then update public.enquiries set status = 'admitted', student_id = stu where id = a.enquiry_id and school_id = sid; end if;
  perform set_config('app.admitting', '1', true);
  update public.admission_applications set status = 'admitted', student_id = stu, admitted_on = coalesce(p_admission_date, today), class_id = p_class where id = app;
  perform set_config('app.admitting', '', true);
  return stu;
end $$;

-- ───────────── Timeline: documents and fee receipts write into the same trail ─────────────
create or replace function public.log_application_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text;
begin
  if tg_op = 'INSERT' then
    ev := case new.status when 'uploaded' then 'document uploaded' when 'pending' then 'document marked pending' when 'not_applicable' then 'document not applicable' else 'document ' || new.status end;
  elsif new.status is distinct from old.status then ev := 'document ' || new.status;
  else return null; end if;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (new.school_id, new.application_id, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), ev, jsonb_build_object('type', new.doc_type, 'note', new.reject_reason));
  return null;
end $$;
drop trigger if exists application_documents_log on public.application_documents;
create trigger application_documents_log after insert or update on public.application_documents for each row execute function public.log_application_document();

create or replace function public.log_application_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
declare app uuid;
begin
  select application_id into app from public.students where id = new.student_id;
  if app is null then return null; end if;
  if tg_op = 'INSERT' and not new.cancelled then
    insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
    values (new.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', new.collected_by, ''), 'fee received', jsonb_build_object('receipt', new.receipt_no, 'amount', new.amount, 'mode', new.mode));
  elsif tg_op = 'UPDATE' and new.cancelled and not old.cancelled then
    insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
    values (new.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'receipt cancelled', jsonb_build_object('receipt', new.receipt_no, 'amount', new.amount));
  end if;
  return null;
end $$;
drop trigger if exists fee_receipts_application_log on public.fee_receipts;
create trigger fee_receipts_application_log after insert or update on public.fee_receipts for each row execute function public.log_application_receipt();

-- followups and enquiries join the application's timeline
create or replace function public.application_timeline(app uuid) returns table (at timestamptz, actor text, event text, details jsonb, source text)
language plpgsql stable security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null or not public.has_perm_school(a.school_id, 'frontdesk.admissions.view') then return; end if;
  return query
    select e.at, e.actor_name, e.event, e.details, 'application'::text from public.admission_application_events e where e.application_id = app
    union all
    select q.created_at, null::text, 'enquiry received' || coalesce(' via ' || q.source, ''), jsonb_build_object('note', q.notes), 'enquiry'::text from public.enquiries q where q.id = a.enquiry_id
    union all
    select f.created_at, f.created_by_name, 'follow-up planned for ' || to_char(f.due_on, 'DD Mon') || ' (' || f.channel || ')', jsonb_build_object('note', f.note), 'followup'::text
      from public.application_followups f where f.application_id = app
    union all
    select f.done_at, f.done_by_name, 'follow-up done', jsonb_build_object('note', f.outcome), 'followup'::text from public.application_followups f where f.application_id = app and f.done
    order by 1 desc;
end $$;

-- ───────────── Board: one row per application with its stage ─────────────
create or replace function public.application_board(sid uuid, sess uuid, p_stage text default null, p_q text default null, p_class uuid default null,
                                                    p_limit int default 25, p_offset int default 0)
returns table (id uuid, application_no text, applicant_name text, father_name text, phone text, class_id uuid, status text, stage text, applied_on date,
               rte_applicant boolean, source text, waitlist_no int, offer_valid_till date, student_id uuid, total bigint)
language sql stable security definer set search_path = public as $$
  with base as (
    select a.*, case
      when a.status = 'admitted' then 'admitted'
      when a.status in ('cancelled', 'rejected') then 'closed'
      when a.status = 'waitlisted' then 'waitlist'
      when cardinality(public.application_missing_details(a.form)) > 0 then 'details'
      when cardinality(public.application_missing_docs(a.id, (select required_docs from public.admission_cfg(sid)))) > 0 and a.docs_waiver_note is null then 'documents'
      when (select require_test from public.admission_cfg(sid)) and a.test_marks is null then 'assessment'
      when a.status <> 'approved' then 'decision'
      when a.student_id is null then 'fee'
      when exists (select 1 from public.fee_dues d where d.student_id = a.student_id and d.kind = 'plan' and d.due_date <= public.today_ist() + (select fee_window_days from public.admission_cfg(sid))
                      and d.amount - d.concession + d.fine - d.paid > 0) and a.fee_waiver_note is null then 'fee'
      else 'allotment' end as stg
    from public.admission_applications a
   where a.school_id = sid and a.session_id = sess and public.has_perm_school(sid, 'frontdesk.admissions.view')
  )
  select b.id, b.application_no, b.applicant_name, b.father_name, b.phone, b.class_id, b.status, b.stg, b.applied_on, b.rte_applicant, b.source, b.waitlist_no, b.offer_valid_till, b.student_id,
         count(*) over ()
    from base b
   where (p_stage is null or p_stage = '' or b.stg = p_stage)
     and (p_class is null or b.class_id = p_class)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or b.applicant_name ilike public.like_escape(btrim(p_q)) or b.application_no ilike public.like_escape(btrim(p_q))
          or b.father_name ilike public.like_escape(btrim(p_q)) or b.phone ilike public.like_escape(btrim(p_q)))
   order by b.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.application_stage_counts(sid uuid, sess uuid) returns table (stage text, n bigint)
language sql stable security definer set search_path = public as $$
  select x.stage, count(*) from public.application_board(sid, sess, null, null, null, 200, 0) x group by x.stage
  union all select 'total', max(total) from public.application_board(sid, sess, null, null, null, 1, 0);
$$;

-- ───────────── Settings save (principal) ─────────────
create or replace function public.save_admission_flow(sid uuid, p_required_docs text[], p_require_test boolean, p_fee_before boolean, p_strict boolean, p_window int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  insert into public.admission_settings (school_id, required_docs, require_test, fee_before_allotment, strict_workflow, fee_window_days)
  values (sid, coalesce(p_required_docs, '{}'), coalesce(p_require_test, false), coalesce(p_fee_before, true), coalesce(p_strict, true), least(greatest(coalesce(p_window, 31), 0), 365))
  on conflict (school_id) do update set required_docs = excluded.required_docs, require_test = excluded.require_test, fee_before_allotment = excluded.fee_before_allotment,
        strict_workflow = excluded.strict_workflow, fee_window_days = excluded.fee_window_days;
end $$;
