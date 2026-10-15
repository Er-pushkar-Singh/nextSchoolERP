-- ═══════════════════════════════════════════════════════════════════════════
-- Step 26: one-student actions from the students table — move to another section / class, promote to another class.
-- The class history (student_enrolments) is written by the existing trigger; the outcome says why it changed.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.move_student(sid uuid, p_student uuid, p_class uuid, p_section uuid, p_kind text default 'move') returns void
language plpgsql security definer set search_path = public as $$
declare st public.students; sec record;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_kind not in ('move', 'promote') then raise exception 'Unknown action.'; end if;
  if not public.has_perm_school(sid, case when p_kind = 'promote' then 'students.promotion.create' else 'students.profile.edit' end) then raise exception 'not allowed'; end if;
  select * into st from public.students where id = p_student and school_id = sid;
  if st.id is null then raise exception 'Student not found.'; end if;
  if st.status <> 'active' then raise exception 'Only a student on roll can be moved.'; end if;
  select s.id, s.class_id into sec from public.sections s where s.id = p_section and s.school_id = sid and s.class_id = p_class;
  if sec.id is null then raise exception 'Choose a section of the selected class.'; end if;
  if st.class_id = p_class and st.section_id = p_section then raise exception 'The student is already there.'; end if;
  perform set_config('app.enrol_outcome', case when p_kind = 'promote' then 'promoted' else 'changed' end, true);
  update public.students set class_id = p_class, section_id = p_section, roll_no = case when p_class is distinct from st.class_id then null else roll_no end where id = p_student;
  perform set_config('app.enrol_outcome', '', true);
end $$;
