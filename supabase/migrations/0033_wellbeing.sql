-- ═══════════════════════════════════════════════════════════════════════════
-- Step 31: Health & discipline — health record per student (allergies, conditions, emergency contact), medical-room visits with
--          parent-informed tracking, periodic check-ups (height / weight / BMI / vision), discipline incidents with several students
--          per incident, actions and follow-up, confidential counselling notes. Teachers see only their own sections.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.student_health (
  student_id       uuid primary key references public.students(id) on delete cascade,
  school_id        uuid not null references public.schools(id) on delete cascade,
  blood_group      text,
  allergies        text,
  conditions       text,
  medications      text,
  vision           text,
  disability       text,
  emergency_name   text,
  emergency_phone  text,
  doctor_name      text,
  doctor_phone     text,
  insurance        text,
  notes            text,
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);

create table if not exists public.health_visits (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id) on delete cascade,
  student_id         uuid not null references public.students(id) on delete cascade,
  visited_at         timestamptz not null default now(),
  complaint          text not null check (length(btrim(complaint)) > 0),
  temperature_c      numeric(4,1) check (temperature_c is null or temperature_c between 30 and 45),
  treatment          text,
  medicine           text,
  outcome            text not null default 'rested' check (outcome in ('rested', 'returned_class', 'sent_home', 'referred', 'hospital')),
  parent_informed    boolean not null default false,
  parent_informed_at timestamptz,
  follow_up_on       date,
  attended_by_name   text,
  created_at         timestamptz not null default now()
);
create index if not exists health_visits_idx on public.health_visits (school_id, visited_at desc);
create index if not exists health_visits_student on public.health_visits (student_id, visited_at desc);

create table if not exists public.health_checkups (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  on_date      date not null default (now() at time zone 'Asia/Kolkata')::date,
  height_cm    numeric(5,1) check (height_cm is null or height_cm between 40 and 230),
  weight_kg    numeric(5,1) check (weight_kg is null or weight_kg between 5 and 200),
  bmi          numeric(4,1) generated always as (case when height_cm > 0 and weight_kg > 0 then round(weight_kg / ((height_cm / 100) * (height_cm / 100)), 1) end) stored,
  vision_left  text,
  vision_right text,
  dental       text,
  remarks      text,
  camp         text,
  by_name      text,
  created_at   timestamptz not null default now()
);
create index if not exists health_checkups_student on public.health_checkups (student_id, on_date desc);

create table if not exists public.discipline_incidents (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  incident_on      date not null default (now() at time zone 'Asia/Kolkata')::date,
  category         text not null default 'misbehaviour' check (category in ('bullying', 'fighting', 'misbehaviour', 'late_coming', 'uniform', 'mobile_phone', 'property_damage', 'cheating', 'absconding', 'abuse', 'other')),
  severity         text not null default 'minor' check (severity in ('minor', 'moderate', 'serious')),
  location         text,
  description      text not null check (length(btrim(description)) > 0),
  action_taken     text,
  status           text not null default 'open' check (status in ('open', 'under_review', 'action_taken', 'closed', 'escalated')),
  parent_informed  boolean not null default false,
  follow_up_on     date,
  closed_on        date,
  confidential     boolean not null default false,
  reported_by_name text,
  reported_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists discipline_idx on public.discipline_incidents (school_id, incident_on desc, status);

create table if not exists public.discipline_students (
  incident_id uuid not null references public.discipline_incidents(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  role        text not null default 'involved' check (role in ('involved', 'victim', 'witness')),
  primary key (incident_id, student_id)
);
create index if not exists discipline_students_student on public.discipline_students (student_id);

create table if not exists public.counselling_notes (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  on_date    date not null default (now() at time zone 'Asia/Kolkata')::date,
  note       text not null check (length(btrim(note)) > 0),
  by_name    text,
  created_at timestamptz not null default now()
);

alter table public.student_health enable row level security;
alter table public.health_visits enable row level security;
alter table public.health_checkups enable row level security;
alter table public.discipline_incidents enable row level security;
alter table public.discipline_students enable row level security;
alter table public.counselling_notes enable row level security;

-- medical data: scope follows the class assignment
do $$
declare t text;
begin
  foreach t in array array['student_health', 'health_visits', 'health_checkups'] loop
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('create policy "read" on public.%I for select to authenticated using (public.can_student(school_id, ''wellbeing.medical.view'', student_id))', t);
    execute format('drop policy if exists "create" on public.%I', t);
    execute format('create policy "create" on public.%I for insert to authenticated with check (public.can_student(school_id, ''wellbeing.medical.create'', student_id))', t);
    execute format('drop policy if exists "edit" on public.%I', t);
    execute format('create policy "edit" on public.%I for update to authenticated using (public.can_student(school_id, ''wellbeing.medical.edit'', student_id)) with check (public.can_student(school_id, ''wellbeing.medical.edit'', student_id))', t);
    execute format('drop policy if exists "delete" on public.%I', t);
    execute format('create policy "delete" on public.%I for delete to authenticated using (public.has_perm_school(school_id, ''wellbeing.medical.delete''))', t);
  end loop;
end $$;

-- a student's record can be written by a teacher only for own sections (can_student) — and a student_health row needs 'create' or 'edit'
drop policy if exists "create" on public.student_health;
create policy "create" on public.student_health for insert to authenticated
  with check (public.can_student(school_id, 'wellbeing.medical.create', student_id) or public.can_student(school_id, 'wellbeing.medical.edit', student_id));

-- discipline: incidents are visible to those who can see any of the students involved (confidential ones need approve)
create or replace function public.can_incident(sid uuid, inc uuid, pkey text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare scope text := public.perm_scope(sid, pkey); r public.discipline_incidents;
begin
  if scope is null then return false; end if;
  select * into r from public.discipline_incidents where id = inc;
  if r.id is null then return false; end if;
  if r.confidential and not public.has_perm_school(sid, 'wellbeing.discipline.approve') and r.reported_by is distinct from auth.uid() then return false; end if;
  if scope = 'school' then return true; end if;
  if r.reported_by = auth.uid() then return true; end if;
  return exists (select 1 from public.discipline_students ds where ds.incident_id = inc and public.can_student(sid, pkey, ds.student_id));
end $$;

drop policy if exists "read" on public.discipline_incidents;
create policy "read" on public.discipline_incidents for select to authenticated using (public.can_incident(school_id, id, 'wellbeing.discipline.view'));
drop policy if exists "read" on public.discipline_students;
create policy "read" on public.discipline_students for select to authenticated using (public.can_incident(school_id, incident_id, 'wellbeing.discipline.view'));
drop policy if exists "read" on public.counselling_notes;
create policy "read" on public.counselling_notes for select to authenticated using (public.has_perm_school(school_id, 'wellbeing.discipline.approve'));
-- incidents and counselling notes are written by the functions below

-- ───────────── medical room ─────────────
create or replace function public.health_visit_add(sid uuid, p_student uuid, p_complaint text, p_temp numeric, p_treatment text, p_medicine text, p_outcome text,
                                                   p_informed boolean, p_follow date) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid; me text;
begin
  if auth.uid() is null or not public.can_student(sid, 'wellbeing.medical.create', p_student) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = p_student and school_id = sid and status = 'active') then raise exception 'Student not found or not on roll.'; end if;
  if coalesce(btrim(p_complaint), '') = '' then raise exception 'Write the complaint.'; end if;
  if p_outcome not in ('rested', 'returned_class', 'sent_home', 'referred', 'hospital') then raise exception 'Choose what happened.'; end if;
  if p_outcome in ('sent_home', 'hospital') and not coalesce(p_informed, false) then raise exception 'The parent must be informed before the student is sent home or to hospital.'; end if;
  if p_follow is not null and p_follow < public.today_ist() then raise exception 'The follow-up date is in the past.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  insert into public.health_visits (school_id, student_id, complaint, temperature_c, treatment, medicine, outcome, parent_informed, parent_informed_at, follow_up_on, attended_by_name)
  values (sid, p_student, left(btrim(p_complaint), 300), p_temp, nullif(left(btrim(coalesce(p_treatment, '')), 300), ''), nullif(left(btrim(coalesce(p_medicine, '')), 200), ''), p_outcome,
          coalesce(p_informed, false), case when p_informed then now() end, p_follow, coalesce(me, 'User')) returning id into i;
  return i;
end $$;

create or replace function public.health_visit_inform(sid uuid, p_visit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.health_visits;
begin
  select * into v from public.health_visits where id = p_visit and school_id = sid;
  if v.id is null or auth.uid() is null or not public.can_student(sid, 'wellbeing.medical.edit', v.student_id) then raise exception 'not allowed'; end if;
  update public.health_visits set parent_informed = true, parent_informed_at = coalesce(parent_informed_at, now()) where id = p_visit;
end $$;

create or replace function public.health_visit_list(sid uuid, d1 date, d2 date, p_q text default null, p_outcome text default null, p_followup boolean default false,
                                                    p_limit int default 25, p_offset int default 0)
returns table (id uuid, student_id uuid, student_name text, admission_no text, class_name text, visited_at timestamptz, complaint text, temperature_c numeric, treatment text, medicine text,
               outcome text, parent_informed boolean, follow_up_on date, attended_by_name text, allergies text, conditions text, visits_30 bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select v.id, s.id, btrim(concat_ws(' ', s.first_name, s.last_name)), s.admission_no, c.name || coalesce('-' || sec.name, ''), v.visited_at, v.complaint, v.temperature_c, v.treatment, v.medicine,
         v.outcome, v.parent_informed, v.follow_up_on, v.attended_by_name, h.allergies, h.conditions,
         (select count(*) from public.health_visits x where x.student_id = s.id and x.visited_at >= now() - interval '30 days'), count(*) over ()
    from public.health_visits v
    join public.students s on s.id = v.student_id
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
    left join public.student_health h on h.student_id = s.id
   where v.school_id = sid and public.can_student(sid, 'wellbeing.medical.view', s.id)
     and (v.visited_at at time zone 'Asia/Kolkata')::date between d1 and d2
     and (p_outcome is null or v.outcome = p_outcome)
     and (not p_followup or (v.follow_up_on is not null and v.follow_up_on <= public.today_ist()))
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', s.first_name, s.last_name, s.admission_no, v.complaint, v.medicine) ilike public.like_escape(btrim(p_q)))
   order by v.visited_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── discipline ─────────────
create or replace function public.discipline_report(sid uuid, p_students uuid[], p_category text, p_severity text, p_on date, p_location text, p_description text,
                                                    p_action text, p_informed boolean, p_follow date, p_confidential boolean, p_victims uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid; me text; s uuid;
begin
  if auth.uid() is null or not public.has_perm(sid, 'wellbeing.discipline.create') then raise exception 'not allowed'; end if;
  if coalesce(cardinality(p_students), 0) = 0 then raise exception 'Choose at least one student.'; end if;
  if coalesce(btrim(p_description), '') = '' then raise exception 'Describe what happened.'; end if;
  if p_on is null or p_on > public.today_ist() then raise exception 'The incident date cannot be in the future.'; end if;
  foreach s in array p_students loop
    if not exists (select 1 from public.students where id = s and school_id = sid) then raise exception 'Student not found.'; end if;
    if not public.can_student(sid, 'wellbeing.discipline.create', s) then raise exception 'not allowed — % is not in your class.', (select first_name from public.students where id = s); end if;
  end loop;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  insert into public.discipline_incidents (school_id, incident_on, category, severity, location, description, action_taken, parent_informed, follow_up_on, confidential, reported_by_name,
                                           status)
  values (sid, p_on, p_category, p_severity, nullif(left(btrim(coalesce(p_location, '')), 80), ''), left(btrim(p_description), 1500), nullif(left(btrim(coalesce(p_action, '')), 500), ''),
          coalesce(p_informed, false), p_follow, coalesce(p_confidential, false) or p_category in ('abuse', 'bullying'), coalesce(me, 'User'),
          case when p_severity = 'serious' then 'under_review' else 'open' end) returning id into i;
  insert into public.discipline_students (incident_id, student_id, school_id, role)
  select i, x, sid, case when x = any(coalesce(p_victims, '{}')) then 'victim' else 'involved' end from unnest(p_students) x on conflict do nothing;
  return i;
end $$;

create or replace function public.discipline_update(sid uuid, p_incident uuid, p_status text, p_action text, p_informed boolean, p_follow date) returns void
language plpgsql security definer set search_path = public as $$
declare r public.discipline_incidents;
begin
  select * into r from public.discipline_incidents where id = p_incident and school_id = sid;
  if r.id is null or auth.uid() is null then raise exception 'not allowed'; end if;
  if not (public.has_perm_school(sid, 'wellbeing.discipline.edit') or r.reported_by = auth.uid()) then raise exception 'not allowed'; end if;
  if p_status not in ('open', 'under_review', 'action_taken', 'closed', 'escalated') then raise exception 'Unknown status.'; end if;
  if p_status in ('closed', 'escalated') and not public.has_perm_school(sid, 'wellbeing.discipline.approve') then raise exception 'not allowed — only the principal can close or escalate.'; end if;
  if p_status in ('action_taken', 'closed') and coalesce(btrim(coalesce(p_action, r.action_taken)), '') = '' then raise exception 'Write the action taken.'; end if;
  update public.discipline_incidents set status = p_status, action_taken = coalesce(nullif(left(btrim(coalesce(p_action, '')), 500), ''), action_taken),
         parent_informed = coalesce(p_informed, parent_informed), follow_up_on = p_follow, closed_on = case when p_status = 'closed' then public.today_ist() else null end
   where id = p_incident;
end $$;

create or replace function public.discipline_list(sid uuid, d1 date, d2 date, p_q text default null, p_status text default null, p_category text default null, p_severity text default null,
                                                  p_limit int default 25, p_offset int default 0)
returns table (id uuid, incident_on date, category text, severity text, status text, location text, description text, action_taken text, parent_informed boolean, follow_up_on date,
               confidential boolean, reported_by_name text, students text, student_count bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select i.id, i.incident_on, i.category, i.severity, i.status, i.location, i.description, i.action_taken, i.parent_informed, i.follow_up_on, i.confidential, i.reported_by_name,
         (select string_agg(btrim(concat_ws(' ', s.first_name, s.last_name)) || ' (' || coalesce(c.name, '') || ')' || case when ds.role <> 'involved' then ' · ' || ds.role else '' end, '; ' order by s.first_name)
            from public.discipline_students ds join public.students s on s.id = ds.student_id left join public.classes c on c.id = s.class_id where ds.incident_id = i.id),
         (select count(*) from public.discipline_students ds where ds.incident_id = i.id), count(*) over ()
    from public.discipline_incidents i
   where i.school_id = sid and public.can_incident(sid, i.id, 'wellbeing.discipline.view') and i.incident_on between d1 and d2
     and (p_status is null or i.status = p_status) and (p_category is null or i.category = p_category) and (p_severity is null or i.severity = p_severity)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or i.description ilike public.like_escape(btrim(p_q))
          or exists (select 1 from public.discipline_students ds join public.students s on s.id = ds.student_id where ds.incident_id = i.id
                      and concat_ws(' ', s.first_name, s.last_name, s.admission_no) ilike public.like_escape(btrim(p_q))))
   order by i.incident_on desc, i.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.counselling_add(sid uuid, p_student uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid; me text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'wellbeing.discipline.approve') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = p_student and school_id = sid) then raise exception 'Student not found.'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write the note.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  insert into public.counselling_notes (school_id, student_id, note, by_name) values (sid, p_student, left(btrim(p_note), 2000), coalesce(me, 'User')) returning id into i;
  return i;
end $$;

-- the wellbeing numbers of one student (profile card)
create or replace function public.student_wellbeing(sid uuid, p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'visits_90', case when public.can_student(sid, 'wellbeing.medical.view', p_student) then (select count(*) from public.health_visits where student_id = p_student and visited_at >= now() - interval '90 days') end,
    'incidents_180', case when public.perm_scope(sid, 'wellbeing.discipline.view') is not null then
        (select count(*) from public.discipline_students ds join public.discipline_incidents i on i.id = ds.incident_id
          where ds.student_id = p_student and i.incident_on >= public.today_ist() - 180 and public.can_incident(sid, i.id, 'wellbeing.discipline.view')) end);
end $$;

do $$
declare t text;
begin
  foreach t in array array['discipline_incidents', 'counselling_notes', 'health_visits'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
