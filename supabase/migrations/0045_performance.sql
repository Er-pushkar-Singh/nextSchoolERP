-- ═══════════════════════════════════════════════════════════════════════════
-- Step 43: Speed.
--   • Permission checks are remembered for the length of one request (they were re-worked from the tables for every row of every list)
--   • Indexes on the foreign keys that had none (lists, joins and the cascade deletes of a school)
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── 1. A generation counter that changes whenever anything a permission depends on changes ─────────────
create or replace function public._bump_perm_gen() returns trigger language plpgsql as $$
begin
  perform set_config('erp.gen', (coalesce(nullif(current_setting('erp.gen', true), ''), '0')::bigint + 1)::text, true);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['member_roles', 'role_permissions', 'member_overrides', 'school_modules', 'school_members', 'platform_admins', 'support_sessions', 'group_members', 'erp_modules', 'staff_assignments'] loop
    execute format('drop trigger if exists perm_gen on public.%I', t);
    execute format('create trigger perm_gen after insert or update or delete on public.%I for each statement execute function public._bump_perm_gen()', t);
  end loop;
end $$;
-- schools: only a change of status or group matters (a receipt counter bumping must not clear the memory)
drop trigger if exists perm_gen_ins on public.schools;
create trigger perm_gen_ins after insert or delete on public.schools for each statement execute function public._bump_perm_gen();
drop trigger if exists perm_gen_upd on public.schools;
create trigger perm_gen_upd after update on public.schools for each row when (old.status is distinct from new.status or old.group_id is distinct from new.group_id) execute function public._bump_perm_gen();

-- ───────────── 2. perm_scope remembers its answer per (login, school, permission) for the rest of the request ─────────────
-- The real calculation stays in perm_scope_calc (the previous body of perm_scope). Change rules THERE, never in the wrapper.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname = 'perm_scope' and p.pronamespace = 'public'::regnamespace and p.prosrc not like '%perm_scope_calc%';
  if def is not null then
    execute replace(def, 'FUNCTION public.perm_scope(', 'FUNCTION public.perm_scope_calc(');
  end if;
end $$;

create or replace function public.perm_scope(sid uuid, pkey text) returns text
language plpgsql stable security definer set search_path = public as $$
declare k text; v text;
begin
  if sid is null or auth.uid() is null then return null; end if;
  k := 'erp.p' || md5(auth.uid()::text || '|' || sid::text || '|' || pkey || '|' || coalesce(nullif(current_setting('erp.gen', true), ''), '0'));
  v := nullif(current_setting(k, true), '');
  if v is not null then return case v when '~' then null else v end; end if;
  v := public.perm_scope_calc(sid, pkey);
  perform set_config(k, coalesce(v, '~'), true);
  return v;
end $$;

-- the same for "is this login assigned to that section" (a teacher's list asks it once per student)
create or replace function public.assigned_to_section(sid uuid, sec uuid, subj uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare k text; v text;
begin
  if auth.uid() is null or sec is null then return false; end if;
  k := 'erp.a' || md5(auth.uid()::text || '|' || sid::text || '|' || sec::text || '|' || coalesce(subj::text, '') || '|' || coalesce(nullif(current_setting('erp.gen', true), ''), '0'));
  v := nullif(current_setting(k, true), '');
  if v is not null then return v = 't'; end if;
  v := case when exists (select 1 from public.staff_assignments a where a.school_id = sid and a.user_id = auth.uid() and a.section_id = sec and (subj is null or a.subject_id is null or a.subject_id = subj)) then 't' else 'f' end;
  perform set_config(k, v, true);
  return v = 't';
end $$;

-- the other helpers that row-level policies call for every row
do $$
declare f text; def text;
begin
  foreach f in array array['is_member', 'has_module_perm', 'is_platform_admin'] loop
    select pg_get_functiondef(p.oid) into def from pg_proc p
     where p.proname = f and p.pronamespace = 'public'::regnamespace and p.prosrc not like '%' || f || '_calc%';
    if def is not null then
      execute replace(def, 'FUNCTION public.' || f || '(', 'FUNCTION public.' || f || '_calc(');
    end if;
  end loop;
end $$;

create or replace function public.is_platform_admin() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare k text; v text;
begin
  if auth.uid() is null then return false; end if;
  k := 'erp.q' || md5(auth.uid()::text || '|' || coalesce(nullif(current_setting('erp.gen', true), ''), '0'));
  v := nullif(current_setting(k, true), '');
  if v is not null then return v = 't'; end if;
  v := case when public.is_platform_admin_calc() then 't' else 'f' end;
  perform set_config(k, v, true);
  return v = 't';
end $$;

create or replace function public.is_member(sid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare k text; v text;
begin
  if auth.uid() is null or sid is null then return false; end if;
  k := 'erp.m' || md5(auth.uid()::text || '|' || sid::text || '|' || coalesce(nullif(current_setting('erp.gen', true), ''), '0'));
  v := nullif(current_setting(k, true), '');
  if v is not null then return v = 't'; end if;
  v := case when public.is_member_calc(sid) then 't' else 'f' end;
  perform set_config(k, v, true);
  return v = 't';
end $$;

create or replace function public.has_module_perm(sid uuid, m text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare k text; v text;
begin
  if auth.uid() is null or sid is null then return false; end if;
  k := 'erp.d' || md5(auth.uid()::text || '|' || sid::text || '|' || m || '|' || coalesce(nullif(current_setting('erp.gen', true), ''), '0'));
  v := nullif(current_setting(k, true), '');
  if v is not null then return v = 't'; end if;
  v := case when public.has_module_perm_calc(sid, m) then 't' else 'f' end;
  perform set_config(k, v, true);
  return v = 't';
end $$;

-- ───────────── 4. The student list only adds up fee dues for the rows on the page ─────────────
-- (it used to add up every due of the whole school on every page view; only "sort by dues" and the dues filter need that)
do $$
begin
  if exists (select 1 from pg_proc p where p.proname = 'student_list' and p.pronamespace = 'public'::regnamespace and p.prosrc not like '%student_list_dues%')
     and not exists (select 1 from pg_proc p where p.proname = 'student_list_dues' and p.pronamespace = 'public'::regnamespace) then
    alter function public.student_list(uuid, text, uuid, uuid, text, text, text, text, text, text, int, int) rename to student_list_dues;
  end if;
end $$;

create or replace function public.student_list(sid uuid, p_q text default null, p_class uuid default null, p_section uuid default null,
    p_status text default 'active', p_gender text default null, p_category text default null, p_blocked text default null,
    p_dues text default null, p_sort text default 'name', p_limit int default 25, p_offset int default 0)
returns table (id uuid, admission_no text, first_name text, middle_name text, last_name text, roll_no int, father_name text, guardian_phone text,
               status text, class_name text, section_name text, gender text, category text, blocked boolean, block_reason text, balance numeric, total bigint)
language plpgsql stable set search_path = public as $$
begin
  if p_sort = 'dues' or coalesce(p_dues, '') in ('yes', 'no') then
    return query select * from public.student_list_dues(sid, p_q, p_class, p_section, p_status, p_gender, p_category, p_blocked, p_dues, p_sort, p_limit, p_offset);
    return;
  end if;
  return query
  with base as (
    select s.*, c.name as cname, c.sort as csort, sec.name as secname
      from public.students s
      left join public.classes c on c.id = s.class_id
      left join public.sections sec on sec.id = s.section_id
     where s.school_id = sid
       and (p_status is null or p_status = 'all' or s.status = p_status)
       and (p_class is null or s.class_id = p_class)
       and (p_section is null or s.section_id = p_section)
       and (p_gender is null or p_gender = '' or s.gender = p_gender)
       and (p_category is null or p_category = '' or s.category = p_category)
       and (p_blocked is null or p_blocked = '' or (p_blocked = 'yes' and public.block_active(s.blocked_at, s.blocked_till)) or (p_blocked = 'no' and not public.block_active(s.blocked_at, s.blocked_till)))
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or concat_ws(' ', s.first_name, s.middle_name, s.last_name) ilike public.like_escape(btrim(p_q))
            or s.admission_no ilike public.like_escape(btrim(p_q))
            or s.father_name ilike public.like_escape(btrim(p_q))
            or s.mother_name ilike public.like_escape(btrim(p_q))
            or s.guardian_phone ilike public.like_escape(btrim(p_q))
            or s.mobile ilike public.like_escape(btrim(p_q)))
  ), paged as (
    select b.*, count(*) over () as n
      from base b
     order by
       case when p_sort = 'newest' then b.created_at end desc nulls last,
       case when p_sort = 'class' then b.csort end asc nulls last,
       case when p_sort = 'class' then b.secname end asc nulls last,
       case when p_sort = 'class' then b.roll_no end asc nulls last,
       case when p_sort = 'adm' then b.admission_no end asc,
       b.first_name asc, b.last_name asc nulls last, b.id
     limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.id, p.admission_no, p.first_name, p.middle_name, p.last_name, p.roll_no, p.father_name, p.guardian_phone, p.status,
         p.cname, p.secname, p.gender, p.category, public.block_active(p.blocked_at, p.blocked_till), p.block_reason,
         coalesce((select sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) from public.fee_dues d where d.student_id = p.id), 0), p.n
    from paged p
   order by
     case when p_sort = 'newest' then p.created_at end desc nulls last,
     case when p_sort = 'class' then p.csort end asc nulls last,
     case when p_sort = 'class' then p.secname end asc nulls last,
     case when p_sort = 'class' then p.roll_no end asc nulls last,
     case when p_sort = 'adm' then p.admission_no end asc,
     p.first_name asc, p.last_name asc nulls last, p.id;
end $$;

-- ───────────── 5. Indexes on foreign keys ─────────────
create index if not exists ix_admission_application_events_school_id on public.admission_application_events (school_id);
create index if not exists ix_admission_applications_class_id on public.admission_applications (class_id);
create index if not exists ix_admission_applications_enquiry_id on public.admission_applications (enquiry_id);
create index if not exists ix_admission_applications_session_id on public.admission_applications (session_id);
create index if not exists ix_admission_applications_student_id on public.admission_applications (student_id);
create index if not exists ix_advance_recoveries_payslip_id on public.advance_recoveries (payslip_id);
create index if not exists ix_application_documents_school_id on public.application_documents (school_id);
create index if not exists ix_application_followups_application_id on public.application_followups (application_id);
create index if not exists ix_application_followups_enquiry_id on public.application_followups (enquiry_id);
create index if not exists ix_attendance_class_id on public.attendance (class_id);
create index if not exists ix_attendance_section_id on public.attendance (section_id);
create index if not exists ix_attendance_devices_school_id on public.attendance_devices (school_id);
create index if not exists ix_attendance_punches_device_id on public.attendance_punches (device_id);
create index if not exists ix_attendance_punches_staff_id on public.attendance_punches (staff_id);
create index if not exists ix_attendance_punches_student_id on public.attendance_punches (student_id);
create index if not exists ix_board_registration_events_school_id on public.board_registration_events (school_id);
create index if not exists ix_board_registrations_session_id on public.board_registrations (session_id);
create index if not exists ix_class_subjects_subject_id on public.class_subjects (subject_id);
create index if not exists ix_counselling_notes_school_id on public.counselling_notes (school_id);
create index if not exists ix_counselling_notes_student_id on public.counselling_notes (student_id);
create index if not exists ix_discipline_students_school_id on public.discipline_students (school_id);
create index if not exists ix_document_template_versions_school_id on public.document_template_versions (school_id);
create index if not exists ix_enquiries_student_id on public.enquiries (student_id);
create index if not exists ix_exam_class_status_class_id on public.exam_class_status (class_id);
create index if not exists ix_exam_class_status_school_id on public.exam_class_status (school_id);
create index if not exists ix_exam_results_class_id on public.exam_results (class_id);
create index if not exists ix_exam_results_school_id on public.exam_results (school_id);
create index if not exists ix_exam_results_student_id on public.exam_results (student_id);
create index if not exists ix_exam_sessions_school_id on public.exam_sessions (school_id);
create index if not exists ix_exam_subjects_class_id on public.exam_subjects (class_id);
create index if not exists ix_exam_subjects_school_id on public.exam_subjects (school_id);
create index if not exists ix_exam_subjects_subject_id on public.exam_subjects (subject_id);
create index if not exists ix_exams_session_id on public.exams (session_id);
create index if not exists ix_fee_adjustments_school_id on public.fee_adjustments (school_id);
create index if not exists ix_fee_adjustments_student_id on public.fee_adjustments (student_id);
create index if not exists ix_fee_cheques_receipt_id on public.fee_cheques (receipt_id);
create index if not exists ix_fee_cheques_student_id on public.fee_cheques (student_id);
create index if not exists ix_fee_dues_fee_head_id on public.fee_dues (fee_head_id);
create index if not exists ix_fee_dues_fee_plan_id on public.fee_dues (fee_plan_id);
create index if not exists ix_fee_dues_session_id on public.fee_dues (session_id);
create index if not exists ix_fee_followups_student_id on public.fee_followups (student_id);
create index if not exists ix_fee_online_orders_receipt_id on public.fee_online_orders (receipt_id);
create index if not exists ix_fee_online_orders_student_id on public.fee_online_orders (student_id);
create index if not exists ix_fee_plans_class_id on public.fee_plans (class_id);
create index if not exists ix_fee_plans_fee_head_id on public.fee_plans (fee_head_id);
create index if not exists ix_fee_plans_session_id on public.fee_plans (session_id);
create index if not exists ix_fee_receipt_lines_receipt_id on public.fee_receipt_lines (receipt_id);
create index if not exists ix_fee_receipt_lines_school_id on public.fee_receipt_lines (school_id);
create index if not exists ix_fee_receipt_payments_school_id on public.fee_receipt_payments (school_id);
create index if not exists ix_fee_receipts_student_id on public.fee_receipts (student_id);
create index if not exists ix_fee_refunds_student_id on public.fee_refunds (student_id);
create index if not exists ix_fee_settings_sibling_head_id on public.fee_settings (sibling_head_id);
create index if not exists ix_fee_wallet_entries_receipt_id on public.fee_wallet_entries (receipt_id);
create index if not exists ix_fee_wallet_entries_school_id on public.fee_wallet_entries (school_id);
create index if not exists ix_gate_passes_pickup_staff_id on public.gate_passes (pickup_staff_id);
create index if not exists ix_gate_passes_student_id on public.gate_passes (student_id);
create index if not exists ix_guardians_school_id on public.guardians (school_id);
create index if not exists ix_health_checkups_school_id on public.health_checkups (school_id);
create index if not exists ix_homework_class_id on public.homework (class_id);
create index if not exists ix_homework_section_id on public.homework (section_id);
create index if not exists ix_homework_session_id on public.homework (session_id);
create index if not exists ix_homework_subject_id on public.homework (subject_id);
create index if not exists ix_hostel_allocations_school_id on public.hostel_allocations (school_id);
create index if not exists ix_hostel_allocations_session_id on public.hostel_allocations (session_id);
create index if not exists ix_hostel_attendance_hostel_id on public.hostel_attendance (hostel_id);
create index if not exists ix_hostel_outpasses_student_id on public.hostel_outpasses (student_id);
create index if not exists ix_hostel_rooms_school_id on public.hostel_rooms (school_id);
create index if not exists ix_hostel_visitors_hostel_id on public.hostel_visitors (hostel_id);
create index if not exists ix_hostel_visitors_student_id on public.hostel_visitors (student_id);
create index if not exists ix_hostels_warden_id on public.hostels (warden_id);
create index if not exists ix_inventory_assignment_events_school_id on public.inventory_assignment_events (school_id);
create index if not exists ix_inventory_assignments_charge_due_id on public.inventory_assignments (charge_due_id);
create index if not exists ix_inventory_items_for_class_id on public.inventory_items (for_class_id);
create index if not exists ix_inventory_items_supplier_id on public.inventory_items (supplier_id);
create index if not exists ix_inventory_locations_class_id on public.inventory_locations (class_id);
create index if not exists ix_inventory_locations_in_charge_staff_id on public.inventory_locations (in_charge_staff_id);
create index if not exists ix_inventory_locations_section_id on public.inventory_locations (section_id);
create index if not exists ix_inventory_purchase_lines_item_id on public.inventory_purchase_lines (item_id);
create index if not exists ix_inventory_purchase_lines_purchase_id on public.inventory_purchase_lines (purchase_id);
create index if not exists ix_inventory_purchase_lines_school_id on public.inventory_purchase_lines (school_id);
create index if not exists ix_inventory_purchases_supplier_id on public.inventory_purchases (supplier_id);
create index if not exists ix_inventory_purchases_voucher_id on public.inventory_purchases (voucher_id);
create index if not exists ix_inventory_repairs_assignment_id on public.inventory_repairs (assignment_id);
create index if not exists ix_inventory_repairs_item_id on public.inventory_repairs (item_id);
create index if not exists ix_inventory_repairs_location_id on public.inventory_repairs (location_id);
create index if not exists ix_inventory_sale_lines_item_id on public.inventory_sale_lines (item_id);
create index if not exists ix_inventory_sale_lines_sale_id on public.inventory_sale_lines (sale_id);
create index if not exists ix_inventory_sale_lines_school_id on public.inventory_sale_lines (school_id);
create index if not exists ix_inventory_sales_fee_due_id on public.inventory_sales (fee_due_id);
create index if not exists ix_inventory_sales_staff_id on public.inventory_sales (staff_id);
create index if not exists ix_inventory_sales_voucher_id on public.inventory_sales (voucher_id);
create index if not exists ix_issued_documents_staff_id on public.issued_documents (staff_id);
create index if not exists ix_issued_documents_student_id on public.issued_documents (student_id);
create index if not exists ix_issued_documents_template_id on public.issued_documents (template_id);
create index if not exists ix_library_issues_book_id on public.library_issues (book_id);
create index if not exists ix_library_issues_fine_due_id on public.library_issues (fine_due_id);
create index if not exists ix_library_issues_staff_id on public.library_issues (staff_id);
create index if not exists ix_library_reservations_book_id on public.library_reservations (book_id);
create index if not exists ix_library_reservations_staff_id on public.library_reservations (staff_id);
create index if not exists ix_library_reservations_student_id on public.library_reservations (student_id);
create index if not exists ix_marks_school_id on public.marks (school_id);
create index if not exists ix_marks_student_id on public.marks (student_id);
create index if not exists ix_marks_subject_id on public.marks (subject_id);
create index if not exists ix_member_roles_role_id on public.member_roles (role_id);
create index if not exists ix_mess_menu_hostel_id on public.mess_menu (hostel_id);
create index if not exists ix_message_outbox_student_id on public.message_outbox (student_id);
create index if not exists ix_notices_class_id on public.notices (class_id);
create index if not exists ix_notices_school_id on public.notices (school_id);
create index if not exists ix_online_attempts_school_id on public.online_attempts (school_id);
create index if not exists ix_online_attempts_student_id on public.online_attempts (student_id);
create index if not exists ix_online_exam_questions_question_id on public.online_exam_questions (question_id);
create index if not exists ix_online_exams_class_id on public.online_exams (class_id);
create index if not exists ix_online_exams_exam_id on public.online_exams (exam_id);
create index if not exists ix_online_exams_session_id on public.online_exams (session_id);
create index if not exists ix_online_exams_subject_id on public.online_exams (subject_id);
create index if not exists ix_online_submissions_application_id on public.online_submissions (application_id);
create index if not exists ix_payslips_school_id on public.payslips (school_id);
create index if not exists ix_phone_calls_student_id on public.phone_calls (student_id);
create index if not exists ix_question_bank_class_id on public.question_bank (class_id);
create index if not exists ix_question_bank_subject_id on public.question_bank (subject_id);
create index if not exists ix_roles_template_code on public.roles (template_code);
create index if not exists ix_school_subscriptions_plan_id on public.school_subscriptions (plan_id);
create index if not exists ix_schools_group_id on public.schools (group_id);
create index if not exists ix_sections_school_id on public.sections (school_id);
create index if not exists ix_staff_advances_staff_id on public.staff_advances (staff_id);
create index if not exists ix_staff_assignments_section_id on public.staff_assignments (section_id);
create index if not exists ix_staff_assignments_subject_id on public.staff_assignments (subject_id);
create index if not exists ix_staff_salary_history_school_id on public.staff_salary_history (school_id);
create index if not exists ix_student_board_subjects_level_code on public.student_board_subjects (level,code);
create index if not exists ix_student_board_subjects_school_id on public.student_board_subjects (school_id);
create index if not exists ix_student_board_subjects_session_id on public.student_board_subjects (session_id);
create index if not exists ix_student_certificates_student_id on public.student_certificates (student_id);
create index if not exists ix_student_concessions_fee_head_id on public.student_concessions (fee_head_id);
create index if not exists ix_student_concessions_school_id on public.student_concessions (school_id);
create index if not exists ix_student_concessions_student_id on public.student_concessions (student_id);
create index if not exists ix_student_enrolments_class_id on public.student_enrolments (class_id);
create index if not exists ix_student_enrolments_section_id on public.student_enrolments (section_id);
create index if not exists ix_student_enrolments_session_id on public.student_enrolments (session_id);
create index if not exists ix_student_guardians_guardian_id on public.student_guardians (guardian_id);
create index if not exists ix_student_guardians_school_id on public.student_guardians (school_id);
create index if not exists ix_student_health_school_id on public.student_health (school_id);
create index if not exists ix_student_prior_exams_school_id on public.student_prior_exams (school_id);
create index if not exists ix_student_subjects_session_id on public.student_subjects (session_id);
create index if not exists ix_student_subjects_subject_id on public.student_subjects (subject_id);
create index if not exists ix_students_application_id on public.students (application_id);
create index if not exists ix_students_class_id on public.students (class_id);
create index if not exists ix_students_section_id on public.students (section_id);
create index if not exists ix_students_sibling_student_id on public.students (sibling_student_id);
create index if not exists ix_substitutions_substitute_staff_id on public.substitutions (substitute_staff_id);
create index if not exists ix_support_sessions_school_id on public.support_sessions (school_id);
create index if not exists ix_syllabus_units_class_id on public.syllabus_units (class_id);
create index if not exists ix_syllabus_units_session_id on public.syllabus_units (session_id);
create index if not exists ix_syllabus_units_subject_id on public.syllabus_units (subject_id);
create index if not exists ix_ticket_messages_ticket_id on public.ticket_messages (ticket_id);
create index if not exists ix_timetable_slots_period_id on public.timetable_slots (period_id);
create index if not exists ix_timetable_slots_subject_id on public.timetable_slots (subject_id);
create index if not exists ix_transport_allocations_school_id on public.transport_allocations (school_id);
create index if not exists ix_transport_allocations_stop_id on public.transport_allocations (stop_id);
create index if not exists ix_transport_allocations_student_id on public.transport_allocations (student_id);
create index if not exists ix_transport_position_log_school_id on public.transport_position_log (school_id);
create index if not exists ix_transport_routes_vehicle_id on public.transport_routes (vehicle_id);
create index if not exists ix_transport_stops_school_id on public.transport_stops (school_id);
create index if not exists ix_transport_trips_route_id on public.transport_trips (route_id);
create index if not exists ix_transport_trips_school_id on public.transport_trips (school_id);
create index if not exists ix_transport_vehicle_position_school_id on public.transport_vehicle_position (school_id);
create index if not exists ix_transport_vehicle_position_trip_id on public.transport_vehicle_position (trip_id);
create index if not exists ix_visitors_student_id on public.visitors (student_id);
create index if not exists ix_vouchers_book_id on public.vouchers (book_id);
create index if not exists ix_vouchers_head_id on public.vouchers (head_id);
create index if not exists ix_vouchers_to_book_id on public.vouchers (to_book_id);

notify pgrst, 'reload schema';
