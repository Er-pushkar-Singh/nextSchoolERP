-- ═══════════════════════════════════════════════════════════════════════════
-- Step 21: Timetable (bell schedule, class grid, teacher view, substitutions) and the school calendar (holidays, exams, events).
--   A teacher can never be in two sections in the same period (database-enforced).
--   Holidays reduce the working days used by staff attendance → payroll suggestion.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.periods (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  no         int  not null check (no between 1 and 20),
  name       text not null check (length(btrim(name)) between 1 and 30),
  start_time time not null,
  end_time   time not null,
  is_break   boolean not null default false,
  unique (school_id, no),
  check (end_time > start_time)
);

create table if not exists public.timetable_slots (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  day        int  not null check (day between 1 and 7),          -- 1 = Monday … 7 = Sunday
  period_id  uuid not null references public.periods(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  staff_id   uuid references public.staff(id) on delete set null,
  room       text,
  unique (section_id, day, period_id)
);
create unique index if not exists timetable_teacher_once on public.timetable_slots (staff_id, day, period_id) where staff_id is not null;
create index if not exists timetable_slots_school on public.timetable_slots (school_id, day);

create table if not exists public.substitutions (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  slot_id             uuid not null references public.timetable_slots(id) on delete cascade,
  on_date             date not null,
  substitute_staff_id uuid not null references public.staff(id) on delete cascade,
  reason              text,
  created_by_name     text,
  created_at          timestamptz not null default now(),
  unique (slot_id, on_date)
);
create index if not exists substitutions_day on public.substitutions (school_id, on_date);

create table if not exists public.school_events (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  title           text not null check (length(btrim(title)) between 1 and 120),
  kind            text not null default 'event' check (kind in ('holiday', 'vacation', 'exam', 'ptm', 'event', 'other')),
  start_date      date not null,
  end_date        date not null,
  description     text,
  created_by_name text,
  created_at      timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 120)
);
create index if not exists school_events_range on public.school_events (school_id, start_date, end_date);

alter table public.periods enable row level security;
alter table public.timetable_slots enable row level security;
alter table public.substitutions enable row level security;
alter table public.school_events enable row level security;

drop policy if exists "read" on public.periods;
create policy "read" on public.periods for select to authenticated using (public.is_member(school_id));
drop policy if exists "write" on public.periods;
create policy "write" on public.periods for all to authenticated
  using (public.has_perm_school(school_id, 'academics.timetable.edit')) with check (public.has_perm_school(school_id, 'academics.timetable.edit'));

drop policy if exists "read" on public.timetable_slots;
create policy "read" on public.timetable_slots for select to authenticated
  using (public.can_section(school_id, 'academics.timetable.view', section_id)
         or exists (select 1 from public.staff s where s.id = staff_id and s.user_id = auth.uid()));
-- slots are written by set_slot / clear_slot / copy_slots only

drop policy if exists "read" on public.substitutions;
create policy "read" on public.substitutions for select to authenticated
  using (public.has_perm_school(school_id, 'academics.timetable.view')
         or exists (select 1 from public.staff s where s.id = substitute_staff_id and s.user_id = auth.uid()));

drop policy if exists "read" on public.school_events;
create policy "read" on public.school_events for select to authenticated using (public.has_perm(school_id, 'comms.calendar.view'));
drop policy if exists "create" on public.school_events;
create policy "create" on public.school_events for insert to authenticated with check (public.has_perm_school(school_id, 'comms.calendar.create'));
drop policy if exists "edit" on public.school_events;
create policy "edit" on public.school_events for update to authenticated
  using (public.has_perm_school(school_id, 'comms.calendar.edit')) with check (public.has_perm_school(school_id, 'comms.calendar.edit'));
drop policy if exists "delete" on public.school_events;
create policy "delete" on public.school_events for delete to authenticated using (public.has_perm_school(school_id, 'comms.calendar.delete'));

-- ───────────── Bell schedule defaults ─────────────
create or replace function public.ensure_timetable_defaults(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_perm(sid, 'academics.timetable.view') or public.has_perm(sid, 'comms.calendar.view')) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.periods where school_id = sid) then return; end if;
  insert into public.periods (school_id, no, name, start_time, end_time, is_break) values
    (sid, 1, 'Period 1', '08:00', '08:40', false), (sid, 2, 'Period 2', '08:40', '09:20', false), (sid, 3, 'Period 3', '09:20', '10:00', false),
    (sid, 4, 'Period 4', '10:00', '10:40', false), (sid, 5, 'Lunch', '10:40', '11:10', true), (sid, 6, 'Period 5', '11:10', '11:50', false),
    (sid, 7, 'Period 6', '11:50', '12:30', false), (sid, 8, 'Period 7', '12:30', '13:10', false), (sid, 9, 'Period 8', '13:10', '13:50', false);
end $$;

-- ───────────── Timetable editing ─────────────
create or replace function public.set_slot(sid uuid, p_section uuid, p_day int, p_period uuid, p_subject uuid, p_staff uuid, p_room text) returns uuid
language plpgsql security definer set search_path = public as $$
declare clash record; i uuid; rm text := nullif(left(btrim(coalesce(p_room, '')), 30), '');
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'academics.timetable.edit') then raise exception 'not allowed'; end if;
  if p_day not between 1 and 7 then raise exception 'Unknown day.'; end if;
  if not exists (select 1 from public.sections where id = p_section and school_id = sid) then raise exception 'Section not found.'; end if;
  if not exists (select 1 from public.periods where id = p_period and school_id = sid and not is_break) then raise exception 'Choose a teaching period (not a break).'; end if;
  if p_subject is not null and not exists (select 1 from public.subjects where id = p_subject and school_id = sid) then raise exception 'Subject not found.'; end if;
  if p_staff is not null then
    if not exists (select 1 from public.staff where id = p_staff and school_id = sid and status = 'active') then raise exception 'Teacher not found or no longer working here.'; end if;
    select st.name as tname, c.name as cname, sc.name as sname into clash
      from public.timetable_slots t join public.staff st on st.id = t.staff_id join public.sections sc on sc.id = t.section_id join public.classes c on c.id = sc.class_id
     where t.staff_id = p_staff and t.day = p_day and t.period_id = p_period and t.section_id <> p_section limit 1;
    if clash.tname is not null then raise exception '% already teaches %-% in this period.', clash.tname, clash.cname, clash.sname; end if;
  end if;
  if p_subject is null and p_staff is null and rm is null then
    delete from public.timetable_slots where section_id = p_section and day = p_day and period_id = p_period;
    return null;
  end if;
  insert into public.timetable_slots (school_id, section_id, day, period_id, subject_id, staff_id, room) values (sid, p_section, p_day, p_period, p_subject, p_staff, rm)
  on conflict (section_id, day, period_id) do update set subject_id = excluded.subject_id, staff_id = excluded.staff_id, room = excluded.room
  returning id into i;
  return i;
end $$;

-- copy one day of a section to other days; teacher clashes are skipped (their slot is copied without the teacher)
create or replace function public.copy_day(sid uuid, p_section uuid, p_from int, p_to int[]) returns int
language plpgsql security definer set search_path = public as $$
declare s record; d int; n int := 0;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'academics.timetable.edit') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.sections where id = p_section and school_id = sid) then raise exception 'Section not found.'; end if;
  foreach d in array p_to loop
    continue when d = p_from or d not between 1 and 7;
    for s in select * from public.timetable_slots where section_id = p_section and day = p_from loop
      insert into public.timetable_slots (school_id, section_id, day, period_id, subject_id, staff_id, room)
      values (sid, p_section, d, s.period_id, s.subject_id,
              case when s.staff_id is not null and not exists (select 1 from public.timetable_slots t where t.staff_id = s.staff_id and t.day = d and t.period_id = s.period_id) then s.staff_id end, s.room)
      on conflict (section_id, day, period_id) do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- ───────────── Substitutions ─────────────
-- who is free in a period on a date: teaching staff with no slot that weekday/period, no cover already, not on approved leave, not marked absent
create or replace function public.free_staff(sid uuid, on_day date, p_period uuid)
returns table (staff_id uuid, name text, designation text, periods_that_day bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.designation,
         (select count(*) from public.timetable_slots t where t.staff_id = s.id and t.day = extract(isodow from on_day)::int)
    from public.staff s
   where s.school_id = sid and s.status = 'active' and s.kind = 'teaching'
     and public.has_perm_school(sid, 'academics.timetable.view')
     and not exists (select 1 from public.timetable_slots t where t.staff_id = s.id and t.day = extract(isodow from on_day)::int and t.period_id = p_period)
     and not exists (select 1 from public.substitutions u join public.timetable_slots t on t.id = u.slot_id
                      where u.substitute_staff_id = s.id and u.on_date = on_day and t.period_id = p_period)
     and not exists (select 1 from public.staff_leaves l where l.staff_id = s.id and l.status = 'approved' and on_day between l.from_date and l.to_date)
     and not exists (select 1 from public.staff_attendance a where a.staff_id = s.id and a.date = on_day and a.status in ('A', 'LV'))
   order by 4, s.name;
$$;

-- periods that need cover on a date (the teacher is on leave or marked absent)
create or replace function public.cover_needed(sid uuid, on_day date)
returns table (slot_id uuid, class_name text, section_name text, period_id uuid, period_name text, start_time time, end_time time, subject_name text,
               teacher_id uuid, teacher_name text, why text, substitution_id uuid, substitute_id uuid, substitute_name text)
language sql stable security definer set search_path = public as $$
  select t.id, c.name, sc.name, p.id, p.name, p.start_time, p.end_time, sj.name, st.id, st.name,
         coalesce((select 'On ' || l.kind || ' leave' from public.staff_leaves l where l.staff_id = st.id and l.status = 'approved' and on_day between l.from_date and l.to_date limit 1), 'Marked absent'),
         u.id, u.substitute_staff_id, ss.name
    from public.timetable_slots t
    join public.periods p on p.id = t.period_id
    join public.sections sc on sc.id = t.section_id
    join public.classes c on c.id = sc.class_id
    join public.staff st on st.id = t.staff_id
    left join public.subjects sj on sj.id = t.subject_id
    left join public.substitutions u on u.slot_id = t.id and u.on_date = on_day
    left join public.staff ss on ss.id = u.substitute_staff_id
   where t.school_id = sid and t.day = extract(isodow from on_day)::int
     and public.has_perm_school(sid, 'academics.timetable.view')
     and (exists (select 1 from public.staff_leaves l where l.staff_id = st.id and l.status = 'approved' and on_day between l.from_date and l.to_date and not l.half_day)
          or exists (select 1 from public.staff_attendance a where a.staff_id = st.id and a.date = on_day and a.status in ('A', 'LV')))
   order by p.no, c.sort, sc.name;
$$;

create or replace function public.save_substitution(sid uuid, p_slot uuid, p_date date, p_staff uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.timetable_slots; me text; i uuid;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'academics.timetable.edit') then raise exception 'not allowed'; end if;
  select * into t from public.timetable_slots where id = p_slot and school_id = sid;
  if t.id is null then raise exception 'That period was not found.'; end if;
  if p_date is null or p_date < public.today_ist() - 7 or p_date > public.today_ist() + 60 then raise exception 'Choose a date within the next 60 days.'; end if;
  if extract(isodow from p_date)::int <> t.day then raise exception 'That date is not a %.', trim(to_char(date '2024-01-01' + (t.day - 1), 'Day')); end if;
  if p_staff = t.staff_id then raise exception 'The substitute is the same teacher.'; end if;
  if not exists (select 1 from public.free_staff(sid, p_date, t.period_id) f where f.staff_id = p_staff) then raise exception 'That teacher is not free in this period.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  insert into public.substitutions (school_id, slot_id, on_date, substitute_staff_id, reason, created_by_name)
  values (sid, p_slot, p_date, p_staff, nullif(left(btrim(coalesce(p_reason, '')), 200), ''), coalesce(me, 'User'))
  on conflict (slot_id, on_date) do update set substitute_staff_id = excluded.substitute_staff_id, reason = excluded.reason, created_by_name = excluded.created_by_name
  returning id into i;
  return i;
end $$;

create or replace function public.remove_substitution(sub uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.substitutions;
begin
  select * into s from public.substitutions where id = sub;
  if s.id is null or not public.has_perm_school(s.school_id, 'academics.timetable.edit') then raise exception 'not allowed'; end if;
  delete from public.substitutions where id = sub;
end $$;

-- weekly load per teacher
create or replace function public.teacher_load(sid uuid)
returns table (staff_id uuid, name text, designation text, periods bigint, sections bigint, subjects bigint, busiest_day int, busiest_count bigint)
language sql stable security definer set search_path = public as $$
  with per as (select t.staff_id, t.day, count(*) c from public.timetable_slots t where t.school_id = sid and t.staff_id is not null group by 1, 2),
       top as (select distinct on (staff_id) staff_id, day, c from per order by staff_id, c desc, day)
  select s.id, s.name, s.designation,
         coalesce((select count(*) from public.timetable_slots t where t.staff_id = s.id), 0),
         coalesce((select count(distinct t.section_id) from public.timetable_slots t where t.staff_id = s.id), 0),
         coalesce((select count(distinct t.subject_id) from public.timetable_slots t where t.staff_id = s.id), 0),
         top.day, top.c
    from public.staff s left join top on top.staff_id = s.id
   where s.school_id = sid and s.status = 'active' and s.kind = 'teaching' and public.has_perm_school(sid, 'academics.timetable.view')
   order by 4 desc, s.name;
$$;

-- ───────────── Calendar helpers ─────────────
-- the holiday or vacation covering a date, if any
create or replace function public.holiday_on(sid uuid, on_day date) returns text
language sql stable security definer set search_path = public as $$
  select e.title from public.school_events e
   where e.school_id = sid and e.kind in ('holiday', 'vacation') and on_day between e.start_date and e.end_date
     and (public.has_perm(sid, 'comms.calendar.view') or public.has_perm(sid, 'attendance.students.view') or public.has_perm(sid, 'attendance.staff.view'))
   order by e.start_date limit 1;
$$;

-- staff attendance month summary: working days now exclude holidays and vacations
create or replace function public.staff_attendance_month(sid uuid, p_month date)
returns table (staff_id uuid, name text, emp_code text, present numeric, late bigint, half bigint, absent bigint, leave_days numeric, on_duty bigint, marked bigint, working_days int, suggested_lop numeric)
language plpgsql stable security definer set search_path = public as $$
declare m1 date := date_trunc('month', p_month)::date; m2 date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date; wd int; days int[];
begin
  if not public.has_perm_school(sid, 'attendance.staff.view') then return; end if;
  select coalesce(array(select jsonb_array_elements_text(prefs -> 'working_days')::int), array[1,2,3,4,5,6]) into days from public.schools where id = sid;
  if days is null or cardinality(days) = 0 then days := array[1,2,3,4,5,6]; end if;
  select count(*) into wd from generate_series(m1, m2, interval '1 day') g
   where extract(isodow from g)::int = any(days)
     and not exists (select 1 from public.school_events e where e.school_id = sid and e.kind in ('holiday', 'vacation') and g::date between e.start_date and e.end_date);
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

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['periods', 'timetable_slots', 'substitutions', 'school_events'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
