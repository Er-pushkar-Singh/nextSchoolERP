-- Removes what supabase/seed/demo_data.sql created for ONE school (students DEMO-*, the demo applications and
-- enquiries and everything attached to them: dues, receipts, cheques, refunds, follow-ups, documents).
-- It keeps the fee structure, settings, classes and sections. Run in the Supabase SQL editor.
do $rm$
declare
  v_code text := 'YOUR-SCHOOL-CODE';
  sid uuid; n int;
begin
  if v_code = 'YOUR-SCHOOL-CODE' then
    select count(*) into n from public.schools;
    if n = 1 then select code into v_code from public.schools; else raise exception 'Put your school code in v_code.'; end if;
  end if;
  select id into sid from public.schools where code = v_code;
  if sid is null then raise exception 'No school with code "%".', v_code; end if;

  -- school property held by demo people or of demo items goes first (assignments keep their people)
  if to_regclass('public.inventory_assignments') is not null then
    delete from public.inventory_repairs where school_id = sid and item_id in (select id from public.inventory_items where school_id = sid and sku like 'DEMO-A%');
    delete from public.inventory_assignments where school_id = sid and (item_id in (select id from public.inventory_items where school_id = sid and sku like 'DEMO-A%')
       or student_id in (select id from public.students where school_id = sid and (admission_no like 'DEMO-%' or admission_no like 'SCALE-%'))
       or staff_id in (select id from public.staff where school_id = sid and emp_code like 'DEMO-E%'));
    delete from public.inventory_items where school_id = sid and sku like 'DEMO-A%';
    delete from public.inventory_locations l where l.school_id = sid and l.building = 'DEMO block'
       and not exists (select 1 from public.inventory_assignments a where a.location_id = l.id);
  end if;
  -- students created by "Admit" from demo applications, then the seeded ones
  -- receipts first: they are not removed automatically with a student
  delete from public.fee_receipts where school_id = sid and student_id in (
    select id from public.students where school_id = sid and ((admission_no like 'DEMO-%' or admission_no like 'SCALE-%') or application_id in (select id from public.admission_applications where school_id = sid and form ? 'demo')));
  delete from public.students where school_id = sid and ((admission_no like 'DEMO-%' or admission_no like 'SCALE-%') or application_id in (select id from public.admission_applications where school_id = sid and form ? 'demo'));
  delete from public.admission_applications where school_id = sid and form ? 'demo';
  delete from public.enquiries where school_id = sid and notes like 'DEMO%';
  -- demo payroll (draft months only), then the demo staff
  delete from public.payslips p using public.payroll_runs r
   where p.run_id = r.id and r.school_id = sid and r.status = 'draft' and p.staff_id in (select id from public.staff where school_id = sid and emp_code like 'DEMO-E%');
  delete from public.payroll_runs r where r.school_id = sid and r.status = 'draft' and not exists (select 1 from public.payslips p where p.run_id = r.id);
  if to_regclass('public.inventory_items') is not null then
    delete from public.vouchers where school_id = sid and id in (select voucher_id from public.inventory_sales where school_id = sid and note = 'DEMO' and voucher_id is not null)
      or id in (select voucher_id from public.inventory_purchases where school_id = sid and note = 'DEMO' and voucher_id is not null);
    delete from public.fee_dues where school_id = sid and source_key in (select 'sale:' || id from public.inventory_sales where school_id = sid and note = 'DEMO');
    delete from public.inventory_sales where school_id = sid and note = 'DEMO';
    delete from public.inventory_purchases where school_id = sid and note = 'DEMO';
    delete from public.inventory_items where school_id = sid and sku like 'DEMO-%';
    delete from public.inventory_suppliers where school_id = sid and name like 'DEMO %';
  end if;
  if to_regclass('public.message_outbox') is not null then
    delete from public.message_outbox where school_id = sid and created_by_name = 'DEMO';
  end if;
  delete from public.discipline_incidents where school_id = sid and reported_by_name = 'DEMO';
  delete from public.counselling_notes where school_id = sid and by_name = 'DEMO';
  delete from public.health_visits where school_id = sid and attended_by_name = 'DEMO';
  delete from public.health_checkups where school_id = sid and by_name = 'DEMO';
  delete from public.hostel_visitors where school_id = sid and by_name = 'DEMO';
  delete from public.hostel_attendance where school_id = sid and marked_by_name = 'DEMO';
  delete from public.hostel_outpasses where school_id = sid and requested_by_name = 'DEMO';
  delete from public.hostel_allocations where school_id = sid and created_by_name = 'DEMO';
  delete from public.student_health where school_id = sid and updated_by_name = 'DEMO';
  delete from public.hostels h where h.school_id = sid and h.name like 'DEMO %'
     and not exists (select 1 from public.hostel_rooms r join public.hostel_allocations a on a.room_id = r.id where r.hostel_id = h.id);
  delete from public.library_issues where school_id = sid and issued_by_name = 'DEMO';
  delete from public.library_books where school_id = sid and accession_no like 'DEMO-B%';
  delete from public.online_exams where school_id = sid and created_by_name = 'DEMO';
  delete from public.question_bank where school_id = sid and created_by_name = 'DEMO';
  delete from public.exams where school_id = sid and name like '%[demo]';
  delete from public.homework where school_id = sid and created_by_name = 'DEMO';
  delete from public.notices where school_id = sid and title like '[Demo]%';
  delete from public.vouchers where school_id = sid and (no like 'PV-S%' or no like '__-D____');
  delete from public.visitors where school_id = sid and pass_no like 'V-S-%';
  delete from public.staff where school_id = sid and emp_code like 'DEMO-E%';
  delete from public.transport_routes where school_id = sid and name like 'DEMO Route%';
  delete from public.attendance_devices where school_id = sid and name like 'DEMO %';
  delete from public.visitors where school_id = sid and pass_no like 'V-D-%';
  delete from public.phone_calls where school_id = sid and handled_by_name = 'DEMO';
  delete from public.postal_items where school_id = sid and created_by_name = 'DEMO';
  delete from public.gate_passes where school_id = sid and pass_no like 'GP-D-%';
  delete from public.staff_advances where school_id = sid and created_by_name = 'DEMO';
  delete from public.payroll_settings where school_id = sid;
  delete from public.school_events where school_id = sid and created_by_name = 'DEMO';
  delete from public.timetable_slots where school_id = sid and room in ('Room 1', 'Room 2') and staff_id in (select id from public.staff where school_id = sid and emp_code like 'DEMO-E%');
  delete from public.vouchers where school_id = sid and no like '__-D____';
  delete from public.account_books b where b.school_id = sid and b.name like 'DEMO %' and not exists (select 1 from public.vouchers v where v.book_id = b.id or v.to_book_id = b.id);
  delete from public.transport_vehicles where school_id = sid and reg_no like 'DEMO %';
  delete from public.fee_day_close where school_id = sid and not exists (select 1 from public.fee_receipts r where r.school_id = sid);
  -- charges and fee dues of removed students are gone with them (cascade); leftover guardians of demo students
  delete from public.guardians g where g.school_id = sid and not exists (select 1 from public.student_guardians sg where sg.guardian_id = g.id);
  raise notice 'Demo data removed for "%".', v_code;
end
$rm$;
