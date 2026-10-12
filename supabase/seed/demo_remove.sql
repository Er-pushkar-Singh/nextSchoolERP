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

  -- students created by "Admit" from demo applications, then the seeded ones
  -- receipts first: they are not removed automatically with a student
  delete from public.fee_receipts where school_id = sid and student_id in (
    select id from public.students where school_id = sid and (admission_no like 'DEMO-%' or application_id in (select id from public.admission_applications where school_id = sid and form ? 'demo')));
  delete from public.students where school_id = sid and (admission_no like 'DEMO-%' or application_id in (select id from public.admission_applications where school_id = sid and form ? 'demo'));
  delete from public.admission_applications where school_id = sid and form ? 'demo';
  delete from public.enquiries where school_id = sid and notes like 'DEMO%';
  delete from public.staff where school_id = sid and emp_code like 'DEMO-E%';
  delete from public.fee_day_close where school_id = sid and not exists (select 1 from public.fee_receipts r where r.school_id = sid);
  -- charges and fee dues of removed students are gone with them (cascade); leftover guardians of demo students
  delete from public.guardians g where g.school_id = sid and not exists (select 1 from public.student_guardians sg where sg.guardian_id = g.id);
  raise notice 'Demo data removed for "%".', v_code;
end
$rm$;
