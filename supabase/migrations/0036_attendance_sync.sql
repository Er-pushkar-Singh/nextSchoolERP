-- ═══════════════════════════════════════════════════════════════════════════
-- Step 34: attendance synchronisation — the day summary groups marks by the student's CURRENT class and section (not the section
--          that was stored when the mark was made), so a scan at the gate, a manual mark and a mark made before the student
--          changed section are all counted in the same place as the strength.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.attendance_summary(sid uuid, on_day date)
returns table (class_id uuid, section_id uuid, marked bigint, present bigint, absent bigint)
language sql stable as $$
  select s.class_id, s.section_id, count(*), count(*) filter (where a.status in ('P', 'L', 'H')), count(*) filter (where a.status = 'A')
    from public.attendance a
    join public.students s on s.id = a.student_id
   where a.school_id = sid and a.date = on_day
   group by s.class_id, s.section_id;
$$;

-- a student moved to another section takes the day's mark along, so registers and summaries agree at once
create or replace function public.attendance_follow_section() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.class_id is not null and (new.section_id is distinct from old.section_id or new.class_id is distinct from old.class_id) then
    update public.attendance set class_id = new.class_id, section_id = new.section_id
     where student_id = new.id and date >= public.today_ist();
  end if;
  return new;
end $$;
drop trigger if exists attendance_follow_section on public.students;
create trigger attendance_follow_section after update of class_id, section_id on public.students
  for each row execute function public.attendance_follow_section();

-- pickers list the first 30 names as soon as they are opened (the user then only searches and selects)
create or replace function public.student_lookup(sid uuid, p_q text)
returns table (id uuid, name text, admission_no text, class_name text, father_name text)
language sql stable security definer set search_path = public as $$
  select s.id, btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)), s.admission_no, c.name || coalesce('-' || sec.name, ''), s.father_name
    from public.students s
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
   where s.school_id = sid and s.status = 'active' and auth.uid() is not null
     and concat_ws(' ', s.first_name, s.last_name, s.admission_no, s.father_name) ilike public.like_escape(btrim(coalesce(p_q, '')))
     and (public.can_student(sid, 'students.profile.view', s.id) or public.can_student(sid, 'library.circulation.view', s.id) or public.can_student(sid, 'wellbeing.medical.view', s.id)
          or public.can_student(sid, 'wellbeing.discipline.view', s.id) or public.can_student(sid, 'hostel.allocation.view', s.id) or public.can_student(sid, 'hostel.rollcall.view', s.id)
          or public.can_student(sid, 'frontdesk.visitors.view', s.id) or public.can_student(sid, 'fees.collection.view', s.id) or public.can_student(sid, 'attendance.students.view', s.id)
          or public.can_student(sid, 'documents.issue.view', s.id) or public.can_student(sid, 'students.board_reg.view', s.id))
   order by s.first_name, s.last_name limit 30;
$$;

create or replace function public.staff_lookup(sid uuid, p_q text) returns table (id uuid, name text, designation text, emp_code text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.designation, s.emp_code
    from public.staff s
   where s.school_id = sid and s.status = 'active'
     and (public.has_perm(sid, 'hr.staff.view') or public.has_perm(sid, 'frontdesk.visitors.view') or public.has_perm(sid, 'academics.timetable.view')
          or public.has_perm(sid, 'library.circulation.view') or public.has_perm(sid, 'hostel.allocation.view'))
     and concat_ws(' ', s.name, s.emp_code, s.designation) ilike public.like_escape(btrim(coalesce(p_q, '')))
   order by s.name limit 30;
$$;

notify pgrst, 'reload schema';
