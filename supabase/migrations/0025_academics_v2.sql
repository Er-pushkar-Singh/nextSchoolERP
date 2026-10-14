-- ═══════════════════════════════════════════════════════════════════════════
-- Step 23: Academic setup — curriculum (which subjects each class studies, periods a week, optional), section capacity and room,
--          class teacher / subject teacher allocation in one place, syllabus & lesson-plan tracking with coverage.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.sections add column if not exists capacity int check (capacity is null or capacity between 1 and 200);
alter table public.sections add column if not exists room text;

create table if not exists public.class_subjects (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  class_id         uuid not null references public.classes(id) on delete cascade,
  subject_id       uuid not null references public.subjects(id) on delete cascade,
  periods_per_week int not null default 5 check (periods_per_week between 0 and 20),
  is_optional      boolean not null default false,
  unique (class_id, subject_id)
);
create index if not exists class_subjects_school on public.class_subjects (school_id);

create table if not exists public.syllabus_units (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  session_id       uuid not null references public.sessions(id) on delete cascade,
  class_id         uuid not null references public.classes(id) on delete cascade,
  subject_id       uuid not null references public.subjects(id) on delete cascade,
  no               int not null default 1,
  title            text not null check (length(btrim(title)) between 1 and 160),
  term             text,
  planned_on       date,
  status           text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  completed_on     date,
  note             text,
  verified_by_name text,
  verified_at      timestamptz,
  updated_by_name  text,
  created_at       timestamptz not null default now()
);
create index if not exists syllabus_units_idx on public.syllabus_units (school_id, session_id, class_id, subject_id, no);

alter table public.class_subjects enable row level security;
alter table public.syllabus_units enable row level security;

drop policy if exists "read" on public.class_subjects;
create policy "read" on public.class_subjects for select to authenticated using (public.is_member(school_id));
drop policy if exists "write" on public.class_subjects;
create policy "write" on public.class_subjects for all to authenticated
  using (public.has_perm_school(school_id, 'academics.setup.edit')) with check (public.has_perm_school(school_id, 'academics.setup.edit'));

-- may this user write syllabus rows of this class + subject?
create or replace function public.can_syllabus(sid uuid, p_class uuid, p_subject uuid, pkey text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s text := public.perm_scope(sid, pkey);
begin
  if s = 'school' then return true; end if;
  if s = 'assigned' then
    return exists (select 1 from public.staff_assignments a join public.sections sc on sc.id = a.section_id
                    where a.school_id = sid and a.user_id = auth.uid() and sc.class_id = p_class and (a.subject_id is null or a.subject_id = p_subject));
  end if;
  return false;
end $$;

drop policy if exists "read" on public.syllabus_units;
create policy "read" on public.syllabus_units for select to authenticated
  using (public.has_perm_school(school_id, 'academics.syllabus.view') or public.can_syllabus(school_id, class_id, subject_id, 'academics.syllabus.view'));
drop policy if exists "create" on public.syllabus_units;
create policy "create" on public.syllabus_units for insert to authenticated with check (public.can_syllabus(school_id, class_id, subject_id, 'academics.syllabus.create'));
drop policy if exists "edit" on public.syllabus_units;
create policy "edit" on public.syllabus_units for update to authenticated
  using (public.can_syllabus(school_id, class_id, subject_id, 'academics.syllabus.edit')) with check (public.can_syllabus(school_id, class_id, subject_id, 'academics.syllabus.edit'));
drop policy if exists "delete" on public.syllabus_units;
create policy "delete" on public.syllabus_units for delete to authenticated using (public.can_syllabus(school_id, class_id, subject_id, 'academics.syllabus.delete'));

-- stamps who changed a unit; completion date follows status; a changed unit loses its verification
create or replace function public.syllabus_unit_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text;
begin
  select name into me from public.school_members where school_id = new.school_id and user_id = auth.uid();
  new.updated_by_name := coalesce(me, new.updated_by_name);
  if new.status = 'done' and new.completed_on is null then new.completed_on := public.today_ist(); end if;
  if new.status <> 'done' then new.completed_on := null; end if;
  if tg_op = 'UPDATE' and (new.status is distinct from old.status or new.title is distinct from old.title) and new.verified_at is not distinct from old.verified_at then
    new.verified_by_name := null; new.verified_at := null;
  end if;
  return new;
end $$;
drop trigger if exists syllabus_unit_guard on public.syllabus_units;
create trigger syllabus_unit_guard before insert or update on public.syllabus_units for each row execute function public.syllabus_unit_guard();

create or replace function public.verify_syllabus_unit(uid2 uuid, p_ok boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare u public.syllabus_units; me text;
begin
  select * into u from public.syllabus_units where id = uid2;
  if u.id is null or auth.uid() is null or not public.has_perm_school(u.school_id, 'academics.syllabus.approve') then raise exception 'not allowed'; end if;
  if u.status <> 'done' then raise exception 'Only a completed unit can be verified.'; end if;
  select name into me from public.school_members where school_id = u.school_id and user_id = auth.uid();
  update public.syllabus_units set verified_by_name = case when p_ok then coalesce(me, 'User') end, verified_at = case when p_ok then now() end where id = uid2;
end $$;

-- ───────────── Overview, allocation, progress ─────────────
create or replace function public.academic_overview(sid uuid)
returns table (class_id uuid, class_name text, class_sort int, section_id uuid, section_name text, capacity int, room text, students bigint,
               class_teacher_id uuid, class_teacher_name text, subjects_mapped bigint, subjects_staffed bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.sort, s.id, s.name, s.capacity, s.room,
         (select count(*) from public.students st where st.section_id = s.id and st.status = 'active'),
         ct.user_id, (select m.name from public.school_members m where m.school_id = sid and m.user_id = ct.user_id),
         (select count(*) from public.class_subjects cs where cs.class_id = c.id),
         (select count(distinct a.subject_id) from public.staff_assignments a join public.class_subjects cs on cs.subject_id = a.subject_id and cs.class_id = c.id where a.section_id = s.id)
    from public.classes c
    join public.sections s on s.class_id = c.id
    left join lateral (select a.user_id from public.staff_assignments a where a.section_id = s.id and a.is_class_teacher limit 1) ct on true
   where c.school_id = sid and public.is_member(sid)
   order by c.sort, c.name, s.name;
$$;

create or replace function public.set_class_teacher(sid uuid, p_section uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_perm_school(sid, 'academics.allocation.edit') or public.has_perm_school(sid, 'academics.allocation.create')) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.sections where id = p_section and school_id = sid) then raise exception 'Section not found.'; end if;
  if p_user is not null and not exists (select 1 from public.school_members where school_id = sid and user_id = p_user) then raise exception 'That person does not have a login in this school.'; end if;
  delete from public.staff_assignments where section_id = p_section and is_class_teacher;
  update public.sections set class_teacher_id = p_user where id = p_section;
  if p_user is not null then
    delete from public.staff_assignments where section_id = p_section and user_id = p_user and subject_id is null;
    insert into public.staff_assignments (school_id, user_id, section_id, subject_id, is_class_teacher) values (sid, p_user, p_section, null, true);
  end if;
end $$;

create or replace function public.set_subject_teacher(sid uuid, p_section uuid, p_subject uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_perm_school(sid, 'academics.allocation.edit') or public.has_perm_school(sid, 'academics.allocation.create')) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.sections where id = p_section and school_id = sid) then raise exception 'Section not found.'; end if;
  if not exists (select 1 from public.subjects where id = p_subject and school_id = sid) then raise exception 'Subject not found.'; end if;
  if p_user is not null and not exists (select 1 from public.school_members where school_id = sid and user_id = p_user) then raise exception 'That person does not have a login in this school.'; end if;
  delete from public.staff_assignments where section_id = p_section and subject_id = p_subject and not is_class_teacher;
  if p_user is not null then
    insert into public.staff_assignments (school_id, user_id, section_id, subject_id, is_class_teacher) values (sid, p_user, p_section, p_subject, false)
    on conflict do nothing;
  end if;
end $$;

create or replace function public.syllabus_progress(sid uuid, p_session uuid, p_class uuid default null)
returns table (class_id uuid, class_name text, class_sort int, subject_id uuid, subject_name text, units bigint, in_progress bigint, done bigint, verified bigint, pct numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.sort, s.id, s.name, count(u.id), count(u.id) filter (where u.status = 'in_progress'), count(u.id) filter (where u.status = 'done'),
         count(u.id) filter (where u.verified_at is not null), round(100.0 * count(u.id) filter (where u.status = 'done') / nullif(count(u.id), 0), 0)
    from public.class_subjects cs
    join public.classes c on c.id = cs.class_id
    join public.subjects s on s.id = cs.subject_id
    left join public.syllabus_units u on u.class_id = c.id and u.subject_id = s.id and u.session_id = p_session
   where cs.school_id = sid and (p_class is null or c.id = p_class)
     and (public.has_perm(sid, 'academics.syllabus.view') or public.has_perm(sid, 'academics.setup.view'))
   group by c.id, c.name, c.sort, s.id, s.name
   order by c.sort, s.name;
$$;

-- copies the syllabus of one session into the next (titles and order, everything pending)
create or replace function public.copy_syllabus(sid uuid, from_session uuid, to_session uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'academics.syllabus.create') then raise exception 'not allowed'; end if;
  if from_session = to_session then raise exception 'Choose two different sessions.'; end if;
  if not exists (select 1 from public.sessions where id in (from_session, to_session) and school_id = sid having count(*) = 2) then raise exception 'Session not found.'; end if;
  insert into public.syllabus_units (school_id, session_id, class_id, subject_id, no, title, term)
  select sid, to_session, u.class_id, u.subject_id, u.no, u.title, u.term from public.syllabus_units u
   where u.school_id = sid and u.session_id = from_session
     and not exists (select 1 from public.syllabus_units x where x.session_id = to_session and x.class_id = u.class_id and x.subject_id = u.subject_id and x.title = u.title);
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['class_subjects', 'syllabus_units'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
