-- ═══════════════════════════════════════════════════════════════════════════
-- Step 39: barcode attendance and verifiable documents.
--   • {{student.barcode}} / {{staff.barcode}} — a Code 128 barcode of the card code on ID cards (any barcode scanner reads it).
--   • {{doc.verify_qr}} — a QR on marksheets, report cards, TCs … that opens the public verification page of THAT document.
--   • the barcode scan station: live feed, "finish the day" (mark everyone not scanned absent), undo a wrong scan.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.render_document(body text, data jsonb) returns text
language plpgsql immutable as $$
declare out text := regexp_replace(coalesce(body, ''), '\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}', '{{\1}}', 'g'); k text; v text;
begin
  for k in select distinct t.m[1] from regexp_matches(out, '\{\{([a-zA-Z0-9_.]+)\}\}', 'g') as t(m) loop
    v := data #>> string_to_array(k, '.');
    if k = 'student.photo' then
      out := replace(out, '{{' || k || '}}', '<img class="doc-photo" data-photo="1" src="" alt="Photograph" style="width:100%;height:100%;object-fit:cover">');
    elsif k = 'school.logo' then
      out := replace(out, '{{' || k || '}}', case when v ~* '^https://' then '<img class="doc-logo" src="' || public.html_escape(v) || '" alt="Logo" style="width:100%;height:100%;object-fit:contain">' else '' end);
    elsif k in ('school.signature', 'school.seal') then
      out := replace(out, '{{' || k || '}}', '<img class="doc-brand" data-brand="' || split_part(k, '.', 2) || '" src="" alt="' || case when k = 'school.seal' then 'School seal' else 'Principal signature' end
                                             || '" style="width:100%;height:100%;object-fit:contain">');
    elsif k in ('student.qr', 'staff.qr') then
      v := data #>> string_to_array(case when k = 'student.qr' then 'student.att_code' else 'staff.att_code' end, '.');
      out := replace(out, '{{' || k || '}}', case when v ~ '^[0-9a-f]{12}$' then '<img class="doc-qr" data-qr="' || v || '" src="" alt="QR" style="width:100%;height:100%;object-fit:contain">' else '' end);
    elsif k in ('student.barcode', 'staff.barcode') then
      v := data #>> string_to_array(case when k = 'student.barcode' then 'student.att_code' else 'staff.att_code' end, '.');
      out := replace(out, '{{' || k || '}}', case when v ~ '^[0-9a-f]{12}$' then '<img class="doc-barcode" data-barcode="' || v || '" src="" alt="Barcode" style="width:100%;height:100%;object-fit:fill">' else '' end);
    elsif k = 'doc.verify_qr' then
      out := replace(out, '{{' || k || '}}', '<img class="doc-qr" data-verify="1" src="" alt="Scan to verify" style="width:100%;height:100%;object-fit:contain">');
    elsif k ~ '^(fee|exam)\.[a-z_]+_html$' then
      out := replace(out, '{{' || k || '}}', coalesce(v, ''));
    else
      out := replace(out, '{{' || k || '}}', public.html_escape(v));
    end if;
  end loop;
  return out;
end $$;

-- the public verification page reads one issued document by its id (the QR carries the id; the page runs with the server key)
create or replace function public.verify_document(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d public.issued_documents; s record; sc record;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into d from public.issued_documents where id = p_id;
  if d.id is null then return null; end if;
  select name, city, logo_url, phone into sc from public.schools where id = d.school_id;
  if d.student_id is not null then
    select st.first_name, st.last_name, st.admission_no, st.status, c.name as cname, sec.name as sname into s
      from public.students st left join public.classes c on c.id = st.class_id left join public.sections sec on sec.id = st.section_id where st.id = d.student_id;
  end if;
  return jsonb_build_object(
    'doc_no', d.doc_no, 'template_name', d.template_name, 'category', d.category, 'issued_on', d.issued_on, 'valid_until', d.valid_until, 'status', d.status,
    'is_duplicate', d.is_duplicate, 'issued_by', d.issued_by_name, 'student_id', d.student_id, 'staff_id', d.staff_id, 'school_id', d.school_id,
    'school', jsonb_build_object('name', sc.name, 'city', sc.city, 'logo', sc.logo_url, 'phone', sc.phone),
    'person', coalesce(d.data -> 'student', d.data -> 'staff'),
    'current', case when s.admission_no is not null then jsonb_build_object('name', btrim(concat_ws(' ', s.first_name, s.last_name)), 'admission_no', s.admission_no, 'status', s.status,
                                                                        'class', s.cname || coalesce('-' || s.sname, '')) end,
    'exam', d.data -> 'exam');
end $$;
revoke execute on function public.verify_document(uuid) from public, anon, authenticated;
grant execute on function public.verify_document(uuid) to service_role;

-- ───────────── barcode scan station ─────────────
-- "Finish the day": every active student (of a section, or the whole school) with no mark yet is marked absent. Returns who.
create or replace function public.attendance_close_day(sid uuid, p_date date default null, p_section uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_date, public.today_ist()); ids uuid[]; me text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_section is null and not public.has_perm_school(sid, 'attendance.students.create') then raise exception 'not allowed — choose your own section.'; end if;
  if p_section is not null and not coalesce(public.can_section(sid, 'attendance.students.create', p_section), false) then raise exception 'not allowed'; end if;
  if d > public.today_ist() then raise exception 'That day has not come yet.'; end if;
  if public.holiday_on(sid, d) is not null then raise exception '% is a holiday (%) in the school calendar.', to_char(d, 'DD Mon'), public.holiday_on(sid, d); end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  with ins as (
    insert into public.attendance (school_id, student_id, class_id, section_id, date, status, marked_by, source, note)
    select sid, s.id, s.class_id, s.section_id, d, 'A', coalesce(me, 'User'), 'manual', 'Not scanned by closing time'
      from public.students s
     where s.school_id = sid and s.status = 'active' and s.class_id is not null and (p_section is null or s.section_id = p_section)
       and not exists (select 1 from public.attendance a where a.student_id = s.id and a.date = d)
    on conflict (student_id, date) do nothing
    returning student_id)
  select coalesce(array_agg(student_id), '{}') into ids from ins;
  return jsonb_build_object('marked', cardinality(ids), 'student_ids', to_jsonb(ids), 'date', d);
end $$;

-- undo a wrong scan / mark of one student for one day
create or replace function public.attendance_clear(sid uuid, p_student uuid, p_date date default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_date, public.today_ist());
begin
  if auth.uid() is null or not coalesce(public.can_student(sid, 'attendance.students.edit', p_student), false) then raise exception 'not allowed'; end if;
  delete from public.attendance where student_id = p_student and date = d and school_id = sid;
  return found;
end $$;

-- the last scans of the day for the station's live feed
create or replace function public.attendance_scan_feed(sid uuid, p_limit int default 20)
returns table (at timestamptz, result text, kind text, person_id uuid, name text, class_name text, status text, in_time time, out_time time)
language sql stable security definer set search_path = public as $$
  select p.punched_at, p.result, p.subject, coalesce(p.student_id, p.staff_id),
         coalesce(btrim(concat_ws(' ', s.first_name, s.last_name)), w.name), coalesce(c.name || coalesce('-' || sec.name, ''), w.designation),
         coalesce(a.status, sa.status), coalesce(a.in_time, sa.in_time), coalesce(a.out_time, sa.out_time)
    from public.attendance_punches p
    left join public.students s on s.id = p.student_id left join public.classes c on c.id = s.class_id left join public.sections sec on sec.id = s.section_id
    left join public.staff w on w.id = p.staff_id
    left join public.attendance a on a.student_id = p.student_id and a.date = (p.punched_at at time zone 'Asia/Kolkata')::date
    left join public.staff_attendance sa on sa.staff_id = p.staff_id and sa.date = (p.punched_at at time zone 'Asia/Kolkata')::date
   where p.school_id = sid and p.punched_at >= (public.today_ist()::timestamp at time zone 'Asia/Kolkata')
     and (public.has_perm_school(sid, 'attendance.students.create') or public.has_perm_school(sid, 'attendance.staff.create'))
   order by p.punched_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

notify pgrst, 'reload schema';
