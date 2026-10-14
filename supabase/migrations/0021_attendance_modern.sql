-- ═══════════════════════════════════════════════════════════════════════════
-- Step 19: attendance, the modern way — QR scanning (kiosk at the gate / teacher's phone), biometric & RFID devices,
--          staff self check-in by location, manual class-wise as before; staff attendance; low-attendance report;
--          punches log; QR codes for ID cards.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Settings ─────────────
create table if not exists public.attendance_settings (
  school_id      uuid primary key references public.schools(id) on delete cascade,
  school_start   time not null default '08:00',
  late_after     time not null default '08:15',
  geofence_m     int  not null default 150 check (geofence_m between 30 and 2000),
  updated_at     timestamptz not null default now()
);
alter table public.attendance_settings enable row level security;
drop policy if exists "read" on public.attendance_settings;
create policy "read" on public.attendance_settings for select to authenticated using (public.has_module_perm(school_id, 'attendance'));
drop policy if exists "write" on public.attendance_settings;
create policy "write" on public.attendance_settings for all to authenticated
  using (public.has_perm_school(school_id, 'attendance.students.edit')) with check (public.has_perm_school(school_id, 'attendance.students.edit'));

-- ───────────── Columns ─────────────
alter table public.attendance add column if not exists source text not null default 'manual';
alter table public.attendance drop constraint if exists attendance_source_check;
alter table public.attendance add constraint attendance_source_check check (source in ('manual', 'qr', 'biometric', 'rfid', 'import', 'geo'));
alter table public.attendance add column if not exists in_time time;
alter table public.attendance add column if not exists out_time time;
alter table public.attendance add column if not exists note text;

alter table public.students add column if not exists att_code text;
update public.students set att_code = encode(gen_random_bytes(6), 'hex') where att_code is null;
alter table public.students alter column att_code set default encode(gen_random_bytes(6), 'hex');
create unique index if not exists students_att_code on public.students (att_code);

alter table public.staff add column if not exists att_code text;
update public.staff set att_code = encode(gen_random_bytes(6), 'hex') where att_code is null;
alter table public.staff alter column att_code set default encode(gen_random_bytes(6), 'hex');
create unique index if not exists staff_att_code on public.staff (att_code);

-- ───────────── Devices and punches ─────────────
create table if not exists public.attendance_devices (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  kind         text not null default 'qr_kiosk' check (kind in ('qr_kiosk', 'biometric', 'rfid')),
  location     text,
  token        text not null unique default encode(gen_random_bytes(12), 'hex'),
  active       boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);
create table if not exists public.attendance_punches (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references public.schools(id) on delete cascade,
  device_id   uuid references public.attendance_devices(id) on delete set null,
  subject     text not null check (subject in ('student', 'staff')),
  student_id  uuid references public.students(id) on delete cascade,
  staff_id    uuid references public.staff(id) on delete cascade,
  punched_at  timestamptz not null default now(),
  source      text not null,
  direction   text,
  result      text not null,           -- in / out / already / unknown / inactive / error
  raw         text
);
create index if not exists attendance_punches_idx on public.attendance_punches (school_id, punched_at desc);

create table if not exists public.staff_attendance (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  staff_id   uuid not null references public.staff(id) on delete cascade,
  date       date not null,
  status     text not null check (status in ('P', 'A', 'L', 'H', 'LV', 'OD')),     -- present, absent, late, half day, leave, on duty
  in_time    time,
  out_time   time,
  source     text not null default 'manual' check (source in ('manual', 'qr', 'biometric', 'rfid', 'import', 'geo')),
  note       text,
  marked_by  text,
  marked_at  timestamptz not null default now(),
  unique (staff_id, date)
);
create index if not exists staff_attendance_date_idx on public.staff_attendance (school_id, date);

alter table public.attendance_devices enable row level security;
alter table public.attendance_punches enable row level security;
alter table public.staff_attendance enable row level security;
drop policy if exists "read" on public.attendance_devices;
create policy "read" on public.attendance_devices for select to authenticated using (public.has_perm_school(school_id, 'attendance.students.edit'));
drop policy if exists "read" on public.attendance_punches;
create policy "read" on public.attendance_punches for select to authenticated
  using (public.has_perm_school(school_id, 'attendance.students.edit') or public.has_perm_school(school_id, 'attendance.staff.view'));
drop policy if exists "read" on public.staff_attendance;
create policy "read" on public.staff_attendance for select to authenticated
  using (public.has_perm_school(school_id, 'attendance.staff.view') or exists (select 1 from public.staff s where s.id = staff_id and s.user_id = auth.uid()));
-- devices and punches are written by the functions below; staff attendance by the functions and the policies here
drop policy if exists "create" on public.staff_attendance;
create policy "create" on public.staff_attendance for insert to authenticated with check (public.has_perm_school(school_id, 'attendance.staff.create'));
drop policy if exists "edit" on public.staff_attendance;
create policy "edit" on public.staff_attendance for update to authenticated using (public.has_perm_school(school_id, 'attendance.staff.edit') or public.has_perm_school(school_id, 'attendance.staff.create'));

-- ───────────── Punch core ─────────────
create or replace function public._punch_core(sid uuid, p_kind text, p_subject uuid, p_at timestamptz, p_dir text, p_source text, p_device uuid, p_by text, p_raw text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg record; d date := (p_at at time zone 'Asia/Kolkata')::date; tm time := date_trunc('second', (p_at at time zone 'Asia/Kolkata'))::time;
        late time; st text; ex record; res text := 'in'; nm text; cls text; stu record; stf record; sid2 uuid;
begin
  select * into cfg from public.attendance_settings where school_id = sid;
  late := coalesce(cfg.late_after, time '08:15');
  if d > public.today_ist() then raise exception 'That time is in the future.'; end if;
  st := case when tm > late then 'L' else 'P' end;

  if p_kind = 'student' then
    select s.id, s.status, s.class_id, s.section_id, btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)) as nm, c.name as cname, sec.name as sname
      into stu from public.students s left join public.classes c on c.id = s.class_id left join public.sections sec on sec.id = s.section_id where s.id = p_subject and s.school_id = sid;
    if stu.id is null then raise exception 'Student not found.'; end if;
    nm := stu.nm; cls := concat_ws('-', stu.cname, stu.sname);
    if stu.status <> 'active' then
      insert into public.attendance_punches (school_id, device_id, subject, student_id, punched_at, source, direction, result, raw) values (sid, p_device, 'student', stu.id, p_at, p_source, p_dir, 'inactive', p_raw);
      return jsonb_build_object('ok', false, 'result', 'inactive', 'name', nm, 'class', cls, 'message', 'This student is not currently on roll.');
    end if;
    select * into ex from public.attendance where student_id = stu.id and date = d;
    if ex.id is null then
      insert into public.attendance (school_id, student_id, class_id, section_id, date, status, marked_by, source, in_time) values (sid, stu.id, stu.class_id, stu.section_id, d, st, p_by, p_source, tm);
    elsif ex.status in ('A', 'LV') then
      update public.attendance set status = st, source = p_source, in_time = tm, out_time = null, marked_by = p_by, marked_at = now(), note = null where id = ex.id;
    elsif ex.in_time is null then
      update public.attendance set in_time = tm, source = case when ex.source = 'manual' then ex.source else p_source end where id = ex.id;
    elsif tm >= ex.in_time + interval '10 minutes' and (ex.out_time is null or tm > ex.out_time) then
      update public.attendance set out_time = tm where id = ex.id; res := 'out';
    else
      res := 'already';
    end if;
    insert into public.attendance_punches (school_id, device_id, subject, student_id, punched_at, source, direction, result, raw) values (sid, p_device, 'student', stu.id, p_at, p_source, p_dir, res, p_raw);
    return jsonb_build_object('ok', true, 'result', res, 'kind', 'student', 'name', nm, 'class', cls, 'status', case when ex.id is null or ex.status in ('A','LV') then st else ex.status end, 'time', to_char(tm, 'HH24:MI'), 'late', st = 'L' and res = 'in');
  end if;

  select s.id, s.name, s.status, s.designation into stf from public.staff s where s.id = p_subject and s.school_id = sid;
  if stf.id is null then raise exception 'Staff member not found.'; end if;
  if stf.status <> 'active' then
    insert into public.attendance_punches (school_id, device_id, subject, staff_id, punched_at, source, direction, result, raw) values (sid, p_device, 'staff', stf.id, p_at, p_source, p_dir, 'inactive', p_raw);
    return jsonb_build_object('ok', false, 'result', 'inactive', 'name', stf.name, 'message', 'This staff member is not working here.');
  end if;
  select * into ex from public.staff_attendance where staff_id = stf.id and date = d;
  if ex.id is null then
    insert into public.staff_attendance (school_id, staff_id, date, status, in_time, source, marked_by) values (sid, stf.id, d, st, tm, p_source, p_by);
  elsif ex.status in ('A', 'LV') then
    update public.staff_attendance set status = st, in_time = tm, out_time = null, source = p_source, marked_by = p_by, marked_at = now() where id = ex.id;
  elsif ex.in_time is null then
    update public.staff_attendance set in_time = tm where id = ex.id;
  elsif tm >= ex.in_time + interval '10 minutes' and (ex.out_time is null or tm > ex.out_time) then
    update public.staff_attendance set out_time = tm where id = ex.id; res := 'out';
  else
    res := 'already';
  end if;
  insert into public.attendance_punches (school_id, device_id, subject, staff_id, punched_at, source, direction, result, raw) values (sid, p_device, 'staff', stf.id, p_at, p_source, p_dir, res, p_raw);
  return jsonb_build_object('ok', true, 'result', res, 'kind', 'staff', 'name', stf.name, 'class', stf.designation, 'status', case when ex.id is null or ex.status in ('A','LV') then st else ex.status end, 'time', to_char(tm, 'HH24:MI'), 'late', st = 'L' and res = 'in');
end $$;
revoke execute on function public._punch_core(uuid, text, uuid, timestamptz, text, text, uuid, text, text) from public, anon, authenticated;

-- the code printed on an ID card (QR) or typed in by a biometric device: att_code, else admission no., else employee code
create or replace function public._find_subject(sid uuid, p_code text) returns table (kind text, id uuid)
language sql stable security definer set search_path = public as $$
  select x.kind, x.id from (
    select 'student'::text, s.id, 1 as pri from public.students s where s.school_id = sid and s.att_code = lower(btrim(p_code))
    union all select 'staff', t.id, 2 from public.staff t where t.school_id = sid and t.att_code = lower(btrim(p_code))
    union all select 'student', s.id, 3 from public.students s where s.school_id = sid and lower(s.admission_no) = lower(btrim(p_code))
    union all select 'staff', t.id, 4 from public.staff t where t.school_id = sid and t.emp_code is not null and lower(t.emp_code) = lower(btrim(p_code))
  ) x(kind, id, pri) order by pri limit 1;
$$;
revoke execute on function public._find_subject(uuid, text) from public, anon, authenticated;

-- ───────────── Device side (the app server, with the device's private token) ─────────────
create or replace function public.device_scan(p_token text, p_code text, p_at timestamptz default null, p_dir text default null, p_raw text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare dv public.attendance_devices; f record; r jsonb; src text;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{24}$' then raise exception 'This device link is not valid.'; end if;
  select * into dv from public.attendance_devices where token = p_token and active;
  if dv.id is null then raise exception 'This device link is not valid or the device is switched off.'; end if;
  if p_code is null or length(btrim(p_code)) < 1 or length(p_code) > 60 then raise exception 'Nothing was scanned.'; end if;
  update public.attendance_devices set last_seen_at = now() where id = dv.id;
  select * into f from public._find_subject(dv.school_id, p_code);
  if f.id is null then
    insert into public.attendance_punches (school_id, device_id, subject, punched_at, source, direction, result, raw)
    values (dv.school_id, dv.id, 'student', coalesce(p_at, now()), case dv.kind when 'qr_kiosk' then 'qr' else dv.kind end, p_dir, 'unknown', left(p_code, 60));
    return jsonb_build_object('ok', false, 'result', 'unknown', 'message', 'This code is not on any student or staff card.');
  end if;
  src := case dv.kind when 'qr_kiosk' then 'qr' when 'biometric' then 'biometric' else 'rfid' end;
  r := public._punch_core(dv.school_id, f.kind, f.id, coalesce(p_at, now()), p_dir, src, dv.id, dv.name, left(p_code, 60));
  return r;
end $$;
revoke execute on function public.device_scan(text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.device_scan(text, text, timestamptz, text, text) to service_role;

-- "who am I" for a kiosk page
create or replace function public.device_info(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare dv public.attendance_devices;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into dv from public.attendance_devices where token = p_token and active;
  if dv.id is null then raise exception 'This device link is not valid or the device is switched off.'; end if;
  update public.attendance_devices set last_seen_at = now() where id = dv.id;
  return jsonb_build_object('name', dv.name, 'kind', dv.kind, 'school', (select name from public.schools where id = dv.school_id),
    'today', (select count(*) from public.attendance_punches p where p.device_id = dv.id and p.punched_at >= (public.today_ist())::timestamp at time zone 'Asia/Kolkata' and p.result in ('in', 'out')));
end $$;
revoke execute on function public.device_info(text) from public, anon, authenticated;
grant execute on function public.device_info(text) to service_role;

-- ───────────── Staff side ─────────────
-- A teacher scans a student's QR with the ERP (permission follows the class assignment).
create or replace function public.scan_attendance(sid uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f record; sec uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  select * into f from public._find_subject(sid, p_code);
  if f.id is null then return jsonb_build_object('ok', false, 'result', 'unknown', 'message', 'This code is not on any student or staff card.'); end if;
  if f.kind = 'student' then
    select section_id into sec from public.students where id = f.id;
    if not coalesce(public.can_section(sid, 'attendance.students.create', sec), false) then raise exception 'not allowed — this student is not in your class.'; end if;
  elsif not public.has_perm_school(sid, 'attendance.staff.create') then
    raise exception 'not allowed';
  end if;
  return public._punch_core(sid, f.kind, f.id, now(), null, 'qr', null, coalesce(auth.jwt() ->> 'email', ''), left(p_code, 60));
end $$;

-- A staff member checks in from their own phone, only near the school.
create or replace function public.staff_check_in(sid uuid, p_lat numeric, p_lng numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare stf record; sc record; cfg record; dist numeric;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  select s.id, s.name into stf from public.staff s where s.school_id = sid and s.user_id = auth.uid() and s.status = 'active';
  if stf.id is null then raise exception 'Your login is not linked to a staff record.'; end if;
  select lat, lng into sc from public.schools where id = sid;
  if sc.lat is null or sc.lng is null then raise exception 'The school location is not set yet (Transport → Live bus map → School location).'; end if;
  select * into cfg from public.attendance_settings where school_id = sid;
  dist := public.geo_km(sc.lat, sc.lng, p_lat, p_lng) * 1000;
  if dist > coalesce(cfg.geofence_m, 150) then
    return jsonb_build_object('ok', false, 'result', 'far', 'message', 'You are about ' || round(dist) || ' m from the school. Check in when you reach.', 'distance_m', round(dist));
  end if;
  return public._punch_core(sid, 'staff', stf.id, now(), null, 'geo', null, stf.name, null) || jsonb_build_object('distance_m', round(dist));
end $$;

-- CSV import of punches (a biometric machine's export): code, date-time
create or replace function public.import_punch(sid uuid, p_code text, p_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if not (public.has_perm_school(sid, 'attendance.students.edit') or public.has_perm_school(sid, 'attendance.staff.create')) then raise exception 'not allowed'; end if;
  select * into f from public._find_subject(sid, p_code);
  if f.id is null then return jsonb_build_object('ok', false, 'result', 'unknown'); end if;
  return public._punch_core(sid, f.kind, f.id, p_at, null, 'import', null, coalesce(auth.jwt() ->> 'email', ''), left(p_code, 60));
end $$;

-- device management
create or replace function public.rotate_device_token(did uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d record; t text;
begin
  select * into d from public.attendance_devices where id = did;
  if d.id is null or not public.has_perm_school(d.school_id, 'attendance.students.edit') then raise exception 'not allowed'; end if;
  t := encode(gen_random_bytes(12), 'hex');
  update public.attendance_devices set token = t where id = did;
  return t;
end $$;

create or replace function public.add_device(sid uuid, p_name text, p_kind text, p_location text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid;
begin
  if not public.has_perm_school(sid, 'attendance.students.edit') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Give the device a name.'; end if;
  if p_kind not in ('qr_kiosk', 'biometric', 'rfid') then raise exception 'Unknown device type.'; end if;
  insert into public.attendance_devices (school_id, name, kind, location) values (sid, btrim(p_name), p_kind, nullif(btrim(coalesce(p_location, '')), '')) returning id into i;
  return i;
end $$;

-- ───────────── Reports ─────────────
create or replace function public.attendance_day(sid uuid, on_day date)
returns table (class_id uuid, section_id uuid, class_name text, section_name text, strength bigint, present bigint, late bigint, half bigint, absent bigint, leave bigint, not_marked bigint, scanned bigint)
language sql stable set search_path = public as $$
  select c.id, sec.id, c.name, sec.name, count(s.id),
         count(a.id) filter (where a.status in ('P', 'L', 'H')), count(a.id) filter (where a.status = 'L'), count(a.id) filter (where a.status = 'H'),
         count(a.id) filter (where a.status = 'A'), count(a.id) filter (where a.status = 'LV'),
         count(s.id) filter (where a.id is null), count(a.id) filter (where a.source <> 'manual')
    from public.students s
    join public.classes c on c.id = s.class_id
    join public.sections sec on sec.id = s.section_id
    left join public.attendance a on a.student_id = s.id and a.date = on_day
   where s.school_id = sid and s.status = 'active'
   group by c.id, c.name, c.sort, sec.id, sec.name
   order by c.sort, sec.name;
$$;

create or replace function public.attendance_low(sid uuid, d1 date, d2 date, thr numeric default 75, cls uuid default null, sec uuid default null, p_q text default null,
                                                 p_limit int default 25, p_offset int default 0)
returns table (student_id uuid, admission_no text, student_name text, class_name text, section_name text, guardian_phone text, father_name text,
               marked bigint, present bigint, absent bigint, pct numeric, total bigint)
language sql stable set search_path = public as $$
  with agg as (
    select s.id, s.admission_no, btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)) as nm, c.name as cname, c.sort as csort, sec2.name as secname, s.guardian_phone, s.father_name,
           count(a.id) as marked, count(a.id) filter (where a.status in ('P', 'L', 'H')) as pres, count(a.id) filter (where a.status = 'A') as abs
      from public.students s
      left join public.classes c on c.id = s.class_id left join public.sections sec2 on sec2.id = s.section_id
      left join public.attendance a on a.student_id = s.id and a.date between d1 and d2
     where s.school_id = sid and s.status = 'active' and (cls is null or s.class_id = cls) and (sec is null or s.section_id = sec)
       and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', s.first_name, s.middle_name, s.last_name) ilike public.like_escape(btrim(p_q)) or s.admission_no ilike public.like_escape(btrim(p_q)))
     group by s.id, c.name, c.sort, sec2.name
  )
  select g.id, g.admission_no, g.nm, g.cname, g.secname, g.guardian_phone, g.father_name, g.marked, g.pres, g.abs,
         round(100.0 * g.pres / nullif(g.marked, 0), 1), count(*) over ()
    from agg g
   where g.marked > 0 and 100.0 * g.pres / g.marked < thr
   order by 100.0 * g.pres / g.marked asc, g.csort nulls last, g.nm
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.staff_attendance_day(sid uuid, on_day date)
returns table (staff_id uuid, name text, emp_code text, designation text, department text, status text, in_time time, out_time time, source text, note text, leave_kind text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.emp_code, s.designation, s.department, a.status, a.in_time, a.out_time, a.source, a.note,
         (select l.kind from public.staff_leaves l where l.staff_id = s.id and l.status = 'approved' and on_day between l.from_date and l.to_date limit 1)
    from public.staff s left join public.staff_attendance a on a.staff_id = s.id and a.date = on_day
   where s.school_id = sid and s.status = 'active' and public.has_perm_school(sid, 'attendance.staff.view')
   order by s.name;
$$;

-- one month per staff member; suggested unpaid days for payroll
create or replace function public.staff_attendance_month(sid uuid, p_month date)
returns table (staff_id uuid, name text, emp_code text, present numeric, late bigint, half bigint, absent bigint, leave_days numeric, on_duty bigint, marked bigint, working_days int, suggested_lop numeric)
language plpgsql stable security definer set search_path = public as $$
declare m1 date := date_trunc('month', p_month)::date; m2 date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date; wd int; days int[];
begin
  if not public.has_perm_school(sid, 'attendance.staff.view') then return; end if;
  select coalesce(array(select jsonb_array_elements_text(prefs -> 'working_days')::int), array[1,2,3,4,5,6]) into days from public.schools where id = sid;
  if days is null or cardinality(days) = 0 then days := array[1,2,3,4,5,6]; end if;
  select count(*) into wd from generate_series(m1, m2, interval '1 day') g where extract(isodow from g)::int = any(days);
  return query
    select s.id, s.name, s.emp_code,
           coalesce(sum(case when a.status in ('P', 'L', 'OD') then 1 when a.status = 'H' then 0.5 else 0 end), 0),
           count(*) filter (where a.status = 'L'), count(*) filter (where a.status = 'H'), count(*) filter (where a.status = 'A'),
           coalesce((select sum(l.days) from public.staff_leaves l where l.staff_id = s.id and l.status = 'approved' and l.kind <> 'LWP' and l.from_date <= m2 and l.to_date >= m1), 0)::numeric,
           count(*) filter (where a.status = 'OD'), count(a.id), wd,
           greatest(wd - coalesce(sum(case when a.status in ('P', 'L', 'OD') then 1 when a.status = 'H' then 0.5 else 0 end), 0)
                       - coalesce((select sum(l.days) from public.staff_leaves l where l.staff_id = s.id and l.status = 'approved' and l.kind <> 'LWP' and l.from_date <= m2 and l.to_date >= m1), 0), 0)::numeric
      from public.staff s left join public.staff_attendance a on a.staff_id = s.id and a.date between m1 and m2
     where s.school_id = sid and s.status = 'active'
     group by s.id, s.name, s.emp_code
     order by s.name;
end $$;

-- ───────────── QR on ID cards and documents ─────────────
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'document_data')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'document_data_base') then
    alter function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) rename to document_data_base;
  end if;
end $$;
create or replace function public.document_data(sid uuid, stu uuid, stf uuid, doc_no text, on_day date, valid_until date, p_extra jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb;
begin
  d := public.document_data_base(sid, stu, stf, doc_no, on_day, valid_until, p_extra);
  if stu is not null then d := jsonb_set(d, '{student,att_code}', to_jsonb((select att_code from public.students where id = stu)), true); end if;
  if stf is not null then d := jsonb_set(d, '{staff,att_code}', to_jsonb((select att_code from public.staff where id = stf)), true); end if;
  return d;
end $$;
revoke execute on function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;
revoke execute on function public.document_data_base(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;

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
    elsif k in ('student.qr', 'staff.qr') then
      v := data #>> string_to_array(case when k = 'student.qr' then 'student.att_code' else 'staff.att_code' end, '.');
      out := replace(out, '{{' || k || '}}', case when v ~ '^[0-9a-f]{12}$' then '<img class="doc-qr" data-qr="' || v || '" src="" alt="QR" style="width:100%;height:100%;object-fit:contain">' else '' end);
    elsif k ~ '^fee\.[a-z_]+_html$' then
      out := replace(out, '{{' || k || '}}', coalesce(v, ''));
    else
      out := replace(out, '{{' || k || '}}', public.html_escape(v));
    end if;
  end loop;
  return out;
end $$;

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['attendance_settings', 'attendance_devices'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
