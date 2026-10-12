-- ═══════════════════════════════════════════════════════════════════════════
-- Step 5: the Standard-plan modules — Homework & study material, Transport,
-- Staff & payroll (HR) and Library. Permissions come from the catalogue
-- (homework.*, transport.*, hr.*, library.*); every table is scope-aware.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- Fix: has_perm_school() returned NULL (not false) when the user had no grant at all, so guards written as
-- `if not has_perm_school(...) then raise` let anyone through (collect_fee, generate_dues, promote_students …).
create or replace function public.has_perm_school(sid uuid, pkey text) returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.perm_scope(sid, pkey) = 'school', false); $$;

-- Fix: deleting a school (or a role) failed with "Role belongs to another school" because this guard ran
-- on member_roles rows removed by the cascade after their role was already gone.
create or replace function public.guard_member_roles() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; missing text;
begin
  select * into r from public.roles where id = coalesce(new.role_id, old.role_id);
  -- role already gone: this row is being removed by a cascade (role or whole school deleted)
  if tg_op = 'DELETE' and r.id is null then return old; end if;
  if r.school_id is distinct from coalesce(new.school_id, old.school_id) then raise exception 'Role belongs to another school.'; end if;
  if tg_op = 'DELETE' and r.code = 'principal' and not exists (
       select 1 from public.member_roles where role_id = r.id and user_id <> old.user_id) then
    if exists (select 1 from public.schools where id = old.school_id) then
      raise exception 'A school must always have at least one Principal / School Admin.';
    end if;
  end if;
  if public.is_platform_admin() or auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.user_id, old.user_id) = auth.uid() then raise exception 'You cannot change your own roles.'; end if;
  if tg_op = 'INSERT' then
    select rp.perm_key into missing from public.role_permissions rp where rp.role_id = r.id and public.perm_scope(r.school_id, rp.perm_key) is null limit 1;
    if missing is not null then raise exception 'You cannot assign this role: it includes % which you do not have.', missing; end if;
  end if;
  return coalesce(new, old);
end $$;

-- Can the user use permission pkey on something that belongs to a class (and optionally one section / subject)?
--   school   → yes
--   assigned → teaches that section (sec null: for view any section of the class, for changes every section of it)
--   child    → one of their children is in that class / section
--   self     → the student is in that class / section
create or replace function public.can_class_item(sid uuid, pkey text, cls uuid, sec uuid, subj uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s text := public.perm_scope(sid, pkey); is_view boolean := split_part(pkey, '.', 3) = 'view';
begin
  if s is null or cls is null then return false; end if;
  if s = 'school' then return true; end if;
  if s = 'assigned' then
    if sec is not null then return public.assigned_to_section(sid, sec, subj); end if;
    if is_view then
      return exists (select 1 from public.sections x where x.class_id = cls and public.assigned_to_section(sid, x.id, subj));
    end if;
    return exists (select 1 from public.sections x where x.class_id = cls)
       and not exists (select 1 from public.sections x where x.class_id = cls and not public.assigned_to_section(sid, x.id, subj));
  end if;
  if s in ('child', 'self') then
    return exists (
      select 1 from public.students st
       where st.school_id = sid and st.status = 'active' and st.class_id = cls and (sec is null or st.section_id = sec)
         and case when s = 'self' then st.user_id = auth.uid()
                  else exists (select 1 from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id
                                where sg.student_id = st.id and g.user_id = auth.uid()) end);
  end if;
  return false;
end $$;

create or replace function public.touch_row() returns trigger
language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;

-- ═════════════════════════ Homework & study material ═════════════════════════
-- kind 'homework' uses homework.homework.*, kind 'material' uses homework.material.*
create table if not exists public.homework (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  session_id      uuid references public.sessions(id) on delete cascade,
  kind            text not null default 'homework' check (kind in ('homework','material')),
  class_id        uuid not null references public.classes(id) on delete cascade,
  section_id      uuid references public.sections(id) on delete cascade,   -- null = every section of the class
  subject_id      uuid references public.subjects(id) on delete set null,
  title           text not null check (length(title) between 1 and 200),
  details         text,
  link_url        text check (link_url is null or link_url ~* '^https?://'),
  assigned_on     date not null default (now() at time zone 'Asia/Kolkata')::date,
  due_on          date,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (due_on is null or due_on >= assigned_on)
);
create index if not exists homework_class_idx on public.homework (school_id, class_id, assigned_on desc);
drop trigger if exists homework_touch on public.homework;
create trigger homework_touch before update on public.homework for each row execute function public.touch_row();

-- a section must belong to the class
create or replace function public.guard_class_section() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.section_id is not null and not exists (select 1 from public.sections where id = new.section_id and class_id = new.class_id) then
    raise exception 'The section does not belong to this class.';
  end if;
  return new;
end $$;
drop trigger if exists homework_section_guard on public.homework;
create trigger homework_section_guard before insert or update on public.homework for each row execute function public.guard_class_section();

alter table public.homework enable row level security;
drop policy if exists "read" on public.homework;
create policy "read" on public.homework for select to authenticated using (public.can_class_item(school_id, 'homework.' || kind || '.view', class_id, section_id));
drop policy if exists "create" on public.homework;
create policy "create" on public.homework for insert to authenticated with check (public.can_class_item(school_id, 'homework.' || kind || '.create', class_id, section_id, subject_id));
drop policy if exists "edit" on public.homework;
create policy "edit" on public.homework for update to authenticated
  using (public.can_class_item(school_id, 'homework.' || kind || '.edit', class_id, section_id, subject_id))
  with check (public.can_class_item(school_id, 'homework.' || kind || '.edit', class_id, section_id, subject_id));
drop policy if exists "delete" on public.homework;
create policy "delete" on public.homework for delete to authenticated using (public.can_class_item(school_id, 'homework.' || kind || '.delete', class_id, section_id, subject_id));

-- ═════════════════════════ Transport ═════════════════════════
create table if not exists public.transport_vehicles (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  reg_no          text not null,
  kind            text not null default 'bus' check (kind in ('bus','van','auto','other')),
  capacity        int check (capacity is null or capacity > 0),
  driver_name     text,
  driver_phone    text,
  driver_licence  text,
  attendant_name  text,
  attendant_phone text,
  insurance_upto  date,
  fitness_upto    date,
  permit_upto     date,
  puc_upto        date,
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (school_id, reg_no)
);

create table if not exists public.transport_routes (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null,
  vehicle_id uuid references public.transport_vehicles(id) on delete set null,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.transport_stops (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  route_id    uuid not null references public.transport_routes(id) on delete cascade,
  name        text not null,
  sort        int not null default 0,
  pickup_time time,
  drop_time   time,
  monthly_fee numeric(10,2) not null default 0 check (monthly_fee >= 0),
  unique (route_id, name)
);
create index if not exists transport_stops_route_idx on public.transport_stops (route_id, sort);

-- One allocation per student per session; changing the stop updates the row.
create table if not exists public.transport_allocations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  route_id    uuid not null references public.transport_routes(id),
  stop_id     uuid not null references public.transport_stops(id),
  trip        text not null default 'both' check (trip in ('both','pickup','drop')),
  monthly_fee numeric(10,2) check (monthly_fee is null or monthly_fee >= 0),   -- null = the stop's fee
  start_date  date not null default (now() at time zone 'Asia/Kolkata')::date,
  end_date    date,
  created_at  timestamptz not null default now(),
  unique (session_id, student_id),
  check (end_date is null or end_date >= start_date)
);
create index if not exists transport_allocations_route_idx on public.transport_allocations (route_id, stop_id);

create or replace function public.guard_transport_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; n int;
begin
  if not exists (select 1 from public.transport_stops where id = new.stop_id and route_id = new.route_id) then
    raise exception 'The stop is not on this route.';
  end if;
  if not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then
    raise exception 'Student not found.';
  end if;
  -- the vehicle's seats are a hard limit for students currently on the route
  if new.end_date is null and (tg_op = 'INSERT' or old.route_id is distinct from new.route_id or old.end_date is not null) then
    select v.capacity into cap from public.transport_routes r join public.transport_vehicles v on v.id = r.vehicle_id where r.id = new.route_id;
    select count(*) into n from public.transport_allocations a where a.route_id = new.route_id and a.session_id = new.session_id and a.end_date is null and a.id <> new.id;
    if cap is not null and n >= cap then raise exception 'The vehicle on this route is full (% seats).', cap; end if;
  end if;
  return new;
end $$;
drop trigger if exists transport_allocations_guard on public.transport_allocations;
create trigger transport_allocations_guard before insert or update on public.transport_allocations for each row execute function public.guard_transport_allocation();

alter table public.transport_vehicles enable row level security;
alter table public.transport_routes enable row level security;
alter table public.transport_stops enable row level security;
alter table public.transport_allocations enable row level security;
do $$
declare t text;
begin
  foreach t in array array['transport_vehicles','transport_routes','transport_stops'] loop
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('drop policy if exists "create" on public.%I', t);
    execute format('drop policy if exists "edit" on public.%I', t);
    execute format('drop policy if exists "delete" on public.%I', t);
    -- families with transport.allocation.view see the route / bus their child uses
    execute format('create policy "read" on public.%I for select to authenticated using (public.has_perm(school_id, ''transport.routes.view'') or public.has_perm(school_id, ''transport.allocation.view''))', t);
    execute format('create policy "create" on public.%I for insert to authenticated with check (public.has_perm_school(school_id, ''transport.routes.create''))', t);
    execute format('create policy "edit" on public.%I for update to authenticated using (public.has_perm_school(school_id, ''transport.routes.edit'')) with check (public.has_perm_school(school_id, ''transport.routes.edit''))', t);
    execute format('create policy "delete" on public.%I for delete to authenticated using (public.has_perm_school(school_id, ''transport.routes.delete''))', t);
  end loop;
end $$;
drop policy if exists "read" on public.transport_allocations;
create policy "read" on public.transport_allocations for select to authenticated using (public.can_student(school_id, 'transport.allocation.view', student_id));
drop policy if exists "create" on public.transport_allocations;
create policy "create" on public.transport_allocations for insert to authenticated with check (public.has_perm_school(school_id, 'transport.allocation.create'));
drop policy if exists "edit" on public.transport_allocations;
create policy "edit" on public.transport_allocations for update to authenticated using (public.has_perm_school(school_id, 'transport.allocation.edit')) with check (public.has_perm_school(school_id, 'transport.allocation.edit'));
drop policy if exists "delete" on public.transport_allocations;
create policy "delete" on public.transport_allocations for delete to authenticated using (public.has_perm_school(school_id, 'transport.allocation.delete'));

-- Transport fees become ordinary fee dues (head "Transport Fee"), so collection, receipts,
-- concessions, defaulters and the parent page work unchanged. source_key makes each run idempotent.
alter table public.fee_dues add column if not exists source_key text;
create unique index if not exists fee_dues_source_key on public.fee_dues (student_id, source_key) where source_key is not null;

create or replace function public.generate_transport_dues(sid uuid, sess uuid, p_label text, p_due date, p_months numeric default 1) returns int
language plpgsql security definer set search_path = public as $$
declare head uuid; cnt int; k text;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_label), '') = '' or p_due is null then raise exception 'Label and due date are required.'; end if;
  if p_months is null or p_months <= 0 or p_months > 12 then raise exception 'Months must be between 1 and 12.'; end if;
  if not exists (select 1 from public.sessions where id = sess and school_id = sid) then raise exception 'Session not found.'; end if;
  select id into head from public.fee_heads where school_id = sid and name = 'Transport Fee';
  if head is null then
    insert into public.fee_heads (school_id, name, sort) values (sid, 'Transport Fee', 50) returning id into head;
  end if;
  k := 'transport:' || sess || ':' || lower(trim(p_label));
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, source_key)
  select sid, sess, x.student_id, head, 'Transport Fee · ' || trim(p_label), p_due, x.amt,
         least(x.amt, coalesce((select sum(case when c.kind = 'percent' then x.amt * c.value / 100 else c.value end)
                                  from public.student_concessions c
                                 where c.student_id = x.student_id and (c.fee_head_id is null or c.fee_head_id = head)), 0)),
         k
    from (select a.student_id, round(coalesce(a.monthly_fee, st.monthly_fee) * p_months, 2) as amt
            from public.transport_allocations a
            join public.transport_stops st on st.id = a.stop_id
            join public.students s on s.id = a.student_id and s.status = 'active'
           where a.school_id = sid and a.session_id = sess and a.start_date <= p_due
             and (a.end_date is null or a.end_date >= p_due)) x
   where x.amt > 0
  on conflict (student_id, source_key) where source_key is not null do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ═════════════════════════ Staff & payroll (HR) ═════════════════════════
-- Every employee, with or without a login (drivers, helpers, guards …).
create table if not exists public.staff (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,       -- their ERP login, if any
  emp_code      text,
  name          text not null,
  designation   text,
  department    text,
  kind          text not null default 'teaching' check (kind in ('teaching','non_teaching','support')),
  gender        text check (gender in ('M','F','O')),
  dob           date,
  phone         text,
  email         text,
  address       text,
  qualification text,
  joining_date  date,
  leaving_date  date,
  status        text not null default 'active' check (status in ('active','left')),
  pan           text,
  uan           text,
  bank_name     text,
  bank_account  text,
  ifsc          text,
  -- monthly salary structure: [{ "name": "Basic", "amount": 25000 }, …]
  earnings      jsonb not null default '[]' check (jsonb_typeof(earnings) = 'array'),
  deductions    jsonb not null default '[]' check (jsonb_typeof(deductions) = 'array'),
  leave_quota   jsonb not null default '{"CL": 12, "SL": 7, "EL": 0}' check (jsonb_typeof(leave_quota) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (school_id, emp_code),
  unique (school_id, user_id)
);
drop trigger if exists staff_touch on public.staff;
create trigger staff_touch before update on public.staff for each row execute function public.touch_row();

-- The staff record of the signed-in user in a school
create or replace function public.my_staff_id(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where school_id = sid and user_id = auth.uid() limit 1;
$$;

create table if not exists public.staff_leaves (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  kind            text not null default 'CL' check (kind in ('CL','SL','EL','LWP','OD','other')),
  from_date       date not null,
  to_date         date not null,
  half_day        boolean not null default false,
  days            numeric(5,1) generated always as (case when half_day then 0.5 else (to_date - from_date + 1) end) stored,
  reason          text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  check (to_date >= from_date),
  check (not half_day or to_date = from_date)
);
create index if not exists staff_leaves_staff_idx on public.staff_leaves (staff_id, from_date desc);
create index if not exists staff_leaves_school_idx on public.staff_leaves (school_id, status, from_date);

create or replace function public.guard_staff_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare deciding boolean;
begin
  if not exists (select 1 from public.staff where id = new.staff_id and school_id = new.school_id) then raise exception 'Staff member not found.'; end if;
  if tg_op = 'UPDATE' and old.status in ('rejected','cancelled') and new.status <> old.status then
    raise exception 'This request is closed. Apply again instead.';
  end if;
  deciding := new.status in ('approved','rejected') and (tg_op = 'INSERT' or old.status is distinct from new.status);
  if deciding then
    if auth.uid() is not null and not public.is_service() then
      if not public.has_perm_school(new.school_id, 'hr.leave.approve') then raise exception 'You cannot approve or reject leave.'; end if;
      if not public.is_platform_admin() and exists (select 1 from public.staff where id = new.staff_id and user_id = auth.uid()) then
        raise exception 'You cannot approve your own leave.';
      end if;
    end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  end if;
  -- overlapping requests for the same person
  if new.status in ('pending','approved') and exists (
       select 1 from public.staff_leaves l where l.staff_id = new.staff_id and l.id <> new.id and l.status in ('pending','approved')
          and daterange(l.from_date, l.to_date, '[]') && daterange(new.from_date, new.to_date, '[]')) then
    raise exception 'There is already a leave request for these dates.';
  end if;
  return new;
end $$;
drop trigger if exists staff_leaves_guard on public.staff_leaves;
create trigger staff_leaves_guard before insert or update on public.staff_leaves for each row execute function public.guard_staff_leave();

-- Payroll: one run per month; payslips keep the unprorated structure and are recomputed by a trigger.
create table if not exists public.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  status       text not null default 'draft' check (status in ('draft','approved')),
  approved_by  uuid references auth.users(id) on delete set null,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (school_id, month)
);

create table if not exists public.payslips (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  run_id           uuid not null references public.payroll_runs(id) on delete cascade,
  staff_id         uuid not null references public.staff(id),
  working_days     int not null check (working_days between 1 and 31),
  lop_days         numeric(5,1) not null default 0 check (lop_days >= 0),
  base_earnings    jsonb not null default '[]',
  earnings         jsonb not null default '[]',      -- prorated (computed)
  deductions       jsonb not null default '[]',
  gross            numeric(12,2) not null default 0,  -- computed
  total_deductions numeric(12,2) not null default 0,  -- computed
  adjustment       numeric(12,2) not null default 0,  -- bonus (+) / recovery (−)
  adjustment_note  text,
  net              numeric(12,2) generated always as (gross - total_deductions + adjustment) stored,
  paid_on          date,
  pay_mode         text check (pay_mode in ('bank_transfer','cash','cheque','upi')),
  pay_ref          text,
  unique (run_id, staff_id),
  check (lop_days <= working_days)
);
create index if not exists payslips_staff_idx on public.payslips (staff_id);

create or replace function public.payslip_compute() returns trigger
language plpgsql security definer set search_path = public as $$
declare f numeric; st text;
begin
  select status into st from public.payroll_runs where id = new.run_id;
  if tg_op = 'UPDATE' and st = 'approved' and (
       new.lop_days is distinct from old.lop_days or new.base_earnings is distinct from old.base_earnings
    or new.deductions is distinct from old.deductions or new.adjustment is distinct from old.adjustment
    or new.working_days is distinct from old.working_days) then
    raise exception 'Payroll for this month is approved and locked. Reopen it to make changes.';
  end if;
  if tg_op = 'UPDATE' and st = 'draft' and new.paid_on is not null and old.paid_on is null then
    raise exception 'Approve the payroll before marking salaries paid.';
  end if;
  f := greatest(new.working_days - new.lop_days, 0) / new.working_days;
  select coalesce(jsonb_agg(jsonb_build_object('name', e ->> 'name', 'amount', round(coalesce((e ->> 'amount')::numeric, 0) * f))), '[]'::jsonb)
    into new.earnings from jsonb_array_elements(new.base_earnings) e;
  select coalesce(sum((e ->> 'amount')::numeric), 0) into new.gross from jsonb_array_elements(new.earnings) e;
  select coalesce(sum(coalesce((e ->> 'amount')::numeric, 0)), 0) into new.total_deductions from jsonb_array_elements(new.deductions) e;
  return new;
end $$;
drop trigger if exists payslips_compute on public.payslips;
create trigger payslips_compute before insert or update on public.payslips for each row execute function public.payslip_compute();

create or replace function public.guard_payroll_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and exists (select 1 from public.schools where id = old.school_id) then  -- (whole school being deleted: allow)
      raise exception 'An approved payroll cannot be deleted. Reopen it first.';
    end if;
    return old;
  end if;
  if new.status = 'approved' and old.status = 'draft' then
    if not exists (select 1 from public.payslips where run_id = new.id) then raise exception 'There are no payslips to approve.'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif new.status = 'draft' and old.status = 'approved' then
    if exists (select 1 from public.payslips where run_id = new.id and paid_on is not null) then
      raise exception 'Some salaries are already marked paid; this month cannot be reopened.';
    end if;
    new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;
drop trigger if exists payroll_runs_guard on public.payroll_runs;
create trigger payroll_runs_guard before update or delete on public.payroll_runs for each row execute function public.guard_payroll_run();

-- Days of approved leave without pay (LWP) a staff member has inside [d1, d2]
create or replace function public.lwp_days(stf uuid, d1 date, d2 date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when l.half_day then 0.5 else (least(l.to_date, d2) - greatest(l.from_date, d1) + 1) end), 0)
    from public.staff_leaves l
   where l.staff_id = stf and l.status = 'approved' and l.kind = 'LWP' and l.from_date <= d2 and l.to_date >= d1;
$$;

-- Create (or refresh) the month's payroll: one payslip per active employee; unpaid draft payslips are recalculated.
create or replace function public.generate_payroll(sid uuid, p_month date, p_days int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m1 date := date_trunc('month', p_month)::date; m2 date; d int; rid uuid; st text;
begin
  if not public.has_perm_school(sid, 'hr.payroll.create') then raise exception 'not allowed'; end if;
  m2 := (m1 + interval '1 month - 1 day')::date;
  d := coalesce(p_days, extract(day from m2)::int);
  if d < 1 or d > 31 then raise exception 'Working days must be between 1 and 31.'; end if;
  insert into public.payroll_runs (school_id, month) values (sid, m1) on conflict (school_id, month) do nothing;
  select id, status into rid, st from public.payroll_runs where school_id = sid and month = m1;
  if st <> 'draft' then raise exception 'Payroll for this month is already approved.'; end if;
  delete from public.payslips where run_id = rid and paid_on is null;
  insert into public.payslips (school_id, run_id, staff_id, working_days, lop_days, base_earnings, deductions)
  select sid, rid, s.id, d,
         least(d, public.lwp_days(s.id, m1, m2)
                  + case when s.joining_date > m1 then least(d, s.joining_date - m1) else 0 end
                  + case when s.leaving_date < m2 then least(d, m2 - s.leaving_date) else 0 end),
         s.earnings, s.deductions
    from public.staff s
   where s.school_id = sid and jsonb_array_length(s.earnings) > 0
     and (s.joining_date is null or s.joining_date <= m2)
     and (s.status = 'active' or s.leaving_date >= m1)
  on conflict (run_id, staff_id) do nothing;
  return rid;
end $$;

alter table public.staff enable row level security;
alter table public.staff_leaves enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;

drop policy if exists "read" on public.staff;
create policy "read" on public.staff for select to authenticated using (
  user_id = auth.uid() or public.has_perm_school(school_id, 'hr.staff.view') or public.has_perm_school(school_id, 'hr.payroll.view')
  or public.has_perm_school(school_id, 'hr.leave.view') or public.has_perm_school(school_id, 'hr.leave.approve')
  or public.has_perm_school(school_id, 'library.circulation.view'));
drop policy if exists "create" on public.staff;
create policy "create" on public.staff for insert to authenticated with check (public.has_perm_school(school_id, 'hr.staff.create'));
drop policy if exists "edit" on public.staff;
create policy "edit" on public.staff for update to authenticated using (public.has_perm_school(school_id, 'hr.staff.edit')) with check (public.has_perm_school(school_id, 'hr.staff.edit'));
drop policy if exists "delete" on public.staff;
create policy "delete" on public.staff for delete to authenticated using (public.has_perm_school(school_id, 'hr.staff.delete'));

drop policy if exists "read" on public.staff_leaves;
create policy "read" on public.staff_leaves for select to authenticated using (
  public.has_perm_school(school_id, 'hr.leave.view') or public.has_perm_school(school_id, 'hr.leave.approve')
  or (staff_id = public.my_staff_id(school_id) and public.has_perm(school_id, 'hr.leave.view')));
drop policy if exists "create" on public.staff_leaves;
create policy "create" on public.staff_leaves for insert to authenticated with check (
  public.has_perm_school(school_id, 'hr.leave.create')
  or (staff_id = public.my_staff_id(school_id) and public.has_perm(school_id, 'hr.leave.create')));
drop policy if exists "edit" on public.staff_leaves;
create policy "edit" on public.staff_leaves for update to authenticated
  using (public.has_perm_school(school_id, 'hr.leave.approve') or public.has_perm_school(school_id, 'hr.leave.create')
         or (staff_id = public.my_staff_id(school_id) and status = 'pending' and public.has_perm(school_id, 'hr.leave.create')))
  with check (public.has_perm_school(school_id, 'hr.leave.approve') or public.has_perm_school(school_id, 'hr.leave.create')
         or (staff_id = public.my_staff_id(school_id) and status in ('pending','cancelled') and public.has_perm(school_id, 'hr.leave.create')));

-- (security definer helpers: the two tables' policies would otherwise query each other forever)
create or replace function public.payroll_run_approved(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.payroll_runs where id = rid and status = 'approved'); $$;
create or replace function public.has_my_payslip(rid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.payslips where run_id = rid and staff_id = public.my_staff_id(sid)); $$;

drop policy if exists "read" on public.payroll_runs;
create policy "read" on public.payroll_runs for select to authenticated using (
  public.has_perm_school(school_id, 'hr.payroll.view')
  or (status = 'approved' and public.has_my_payslip(id, school_id)));
drop policy if exists "approve" on public.payroll_runs;
create policy "approve" on public.payroll_runs for update to authenticated using (public.has_perm_school(school_id, 'hr.payroll.approve')) with check (public.has_perm_school(school_id, 'hr.payroll.approve'));
drop policy if exists "delete" on public.payroll_runs;
create policy "delete" on public.payroll_runs for delete to authenticated using (public.has_perm_school(school_id, 'hr.payroll.edit'));
-- runs are created only through generate_payroll()

drop policy if exists "read" on public.payslips;
create policy "read" on public.payslips for select to authenticated using (
  public.has_perm_school(school_id, 'hr.payroll.view')
  or (staff_id = public.my_staff_id(school_id) and public.payroll_run_approved(run_id)));
drop policy if exists "edit" on public.payslips;
create policy "edit" on public.payslips for update to authenticated using (public.has_perm_school(school_id, 'hr.payroll.edit')) with check (public.has_perm_school(school_id, 'hr.payroll.edit'));
-- payslips are created / removed only through generate_payroll()

-- Leave taken this session per kind (approved), for balances
create or replace function public.leave_summary(sid uuid, d1 date, d2 date) returns table (staff_id uuid, kind text, days numeric)
language sql stable set search_path = public as $$
  select l.staff_id, l.kind, sum(case when l.half_day then 0.5 else (least(l.to_date, d2) - greatest(l.from_date, d1) + 1) end)
    from public.staff_leaves l
   where l.school_id = sid and l.status = 'approved' and l.from_date <= d2 and l.to_date >= d1
   group by l.staff_id, l.kind;
$$;

-- ═════════════════════════ Library ═════════════════════════
create table if not exists public.library_books (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  accession_no text,
  title        text not null,
  author       text,
  publisher    text,
  isbn         text,
  category     text,
  language     text,
  shelf        text,
  copies       int not null default 1 check (copies >= 0),
  price        numeric(10,2) check (price is null or price >= 0),
  created_at   timestamptz not null default now(),
  unique (school_id, accession_no)
);
create index if not exists library_books_title_idx on public.library_books (school_id, title);

create table if not exists public.library_issues (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  book_id        uuid not null references public.library_books(id),
  student_id     uuid references public.students(id) on delete cascade,
  staff_id       uuid references public.staff(id) on delete cascade,
  issued_on      date not null default (now() at time zone 'Asia/Kolkata')::date,
  due_on         date not null,
  returned_on    date,
  fine           numeric(10,2) not null default 0 check (fine >= 0),
  issued_by_name text,
  note           text,
  created_at     timestamptz not null default now(),
  check (num_nonnulls(student_id, staff_id) = 1),
  check (due_on >= issued_on),
  check (returned_on is null or returned_on >= issued_on)
);
create index if not exists library_issues_open_idx on public.library_issues (school_id, book_id) where returned_on is null;
create index if not exists library_issues_student_idx on public.library_issues (student_id);

create or replace function public.guard_library_issue() returns trigger
language plpgsql security definer set search_path = public as $$
declare c int; n int;
begin
  if tg_op = 'INSERT' or (old.returned_on is not null and new.returned_on is null) then
    select copies into c from public.library_books where id = new.book_id and school_id = new.school_id for update;
    if c is null then raise exception 'Book not found.'; end if;
    select count(*) into n from public.library_issues where book_id = new.book_id and returned_on is null and id <> new.id;
    if n >= c then raise exception 'All % copies of this book are issued.', c; end if;
  end if;
  if new.student_id is not null and not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then
    raise exception 'Student not found.';
  end if;
  if new.staff_id is not null and not exists (select 1 from public.staff where id = new.staff_id and school_id = new.school_id) then
    raise exception 'Staff member not found.';
  end if;
  return new;
end $$;
drop trigger if exists library_issues_guard on public.library_issues;
create trigger library_issues_guard before insert or update on public.library_issues for each row execute function public.guard_library_issue();

alter table public.library_books enable row level security;
alter table public.library_issues enable row level security;
drop policy if exists "read" on public.library_books;
create policy "read" on public.library_books for select to authenticated using (public.has_perm(school_id, 'library.catalogue.view') or public.has_perm(school_id, 'library.circulation.view'));
drop policy if exists "create" on public.library_books;
create policy "create" on public.library_books for insert to authenticated with check (public.has_perm_school(school_id, 'library.catalogue.create'));
drop policy if exists "edit" on public.library_books;
create policy "edit" on public.library_books for update to authenticated using (public.has_perm_school(school_id, 'library.catalogue.edit')) with check (public.has_perm_school(school_id, 'library.catalogue.edit'));
drop policy if exists "delete" on public.library_books;
create policy "delete" on public.library_books for delete to authenticated using (public.has_perm_school(school_id, 'library.catalogue.delete'));

drop policy if exists "read" on public.library_issues;
create policy "read" on public.library_issues for select to authenticated using (
  public.has_perm_school(school_id, 'library.circulation.view')
  or (student_id is not null and public.can_student(school_id, 'library.circulation.view', student_id))
  or (staff_id is not null and staff_id = public.my_staff_id(school_id)));
drop policy if exists "create" on public.library_issues;
create policy "create" on public.library_issues for insert to authenticated with check (public.has_perm_school(school_id, 'library.circulation.create'));
drop policy if exists "edit" on public.library_issues;
create policy "edit" on public.library_issues for update to authenticated using (public.has_perm_school(school_id, 'library.circulation.edit')) with check (public.has_perm_school(school_id, 'library.circulation.edit'));

-- ═════════════════════════ Audit ═════════════════════════
do $$
declare t text;
begin
  foreach t in array array['homework','transport_vehicles','transport_routes','transport_stops','transport_allocations',
                           'staff','staff_leaves','payroll_runs','payslips','library_books','library_issues'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
