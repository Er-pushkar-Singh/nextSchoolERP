-- ═══════════════════════════════════════════════════════════════════════════
-- Step 38: Inventory = the school's property. Fans, benches, computers, lab kits, sports goods … with their stock in the store,
--          where each one is (classroom, lab, office), who holds it (a staff member, a student, a department), return dates,
--          condition, repairs, write-offs and recovery of damaged / lost property from the student's fee account.
--          (The uniform & book shop of step 36 stays as "shop" items.)  Also: TC clearance — no transfer certificate
--          until the student's fees are paid in full.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── item kinds ─────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'kind') then
    alter table public.inventory_items add column kind text not null default 'asset' check (kind in ('asset', 'consumable', 'shop'));
    update public.inventory_items set kind = 'shop' where category in ('Uniform', 'Books', 'Stationery');
  end if;
end $$;
alter table public.inventory_items add column if not exists warranty_until date;
alter table public.inventory_items add column if not exists supplier_id uuid references public.inventory_suppliers(id) on delete set null;

alter table public.inventory_moves drop constraint if exists inventory_moves_kind_check;
alter table public.inventory_moves add constraint inventory_moves_kind_check
  check (kind in ('opening', 'purchase', 'sale', 'sale_return', 'issue', 'issue_return', 'adjust', 'damage', 'stock_take', 'assign', 'return', 'writeoff'));

-- ───────────── places ─────────────
create table if not exists public.inventory_locations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  kind        text not null default 'classroom' check (kind in ('classroom', 'lab', 'office', 'library', 'hostel', 'staffroom', 'ground', 'store', 'other')),
  class_id    uuid references public.classes(id) on delete set null,
  section_id  uuid references public.sections(id) on delete set null,
  building    text,
  in_charge_staff_id uuid references public.staff(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (school_id, name)
);

-- ───────────── who holds what ─────────────
create table if not exists public.inventory_assignments (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  item_id          uuid not null references public.inventory_items(id) on delete restrict,
  qty              int not null check (qty > 0),
  holder_kind      text not null check (holder_kind in ('location', 'staff', 'student', 'department')),
  location_id      uuid references public.inventory_locations(id) on delete restrict,
  staff_id         uuid references public.staff(id) on delete restrict,
  student_id       uuid references public.students(id) on delete restrict,
  department       text,
  tag              text,                              -- serial / asset tag of the unit(s)
  assigned_on      date not null default (now() at time zone 'Asia/Kolkata')::date,
  due_back         date,
  note             text,
  status           text not null default 'active' check (status in ('active', 'returned', 'damaged', 'lost', 'repair')),
  returned_on      date,
  return_condition text check (return_condition in ('good', 'needs_repair', 'damaged', 'lost')),
  return_note      text,
  assigned_by_name text,
  returned_by_name text,
  charge_due_id    uuid references public.fee_dues(id) on delete set null,
  created_at       timestamptz not null default now(),
  check ((holder_kind = 'location' and location_id is not null) or (holder_kind = 'staff' and staff_id is not null) or (holder_kind = 'student' and student_id is not null)
         or (holder_kind = 'department' and coalesce(btrim(department), '') <> ''))
);
create index if not exists inventory_assign_school on public.inventory_assignments (school_id, status, created_at desc);
create index if not exists inventory_assign_item on public.inventory_assignments (item_id, status);
create index if not exists inventory_assign_staff on public.inventory_assignments (staff_id) where staff_id is not null;
create index if not exists inventory_assign_student on public.inventory_assignments (student_id) where student_id is not null;
create index if not exists inventory_assign_location on public.inventory_assignments (location_id) where location_id is not null;

create table if not exists public.inventory_assignment_events (
  id            bigint generated always as identity primary key,
  school_id     uuid not null references public.schools(id) on delete cascade,
  assignment_id uuid not null references public.inventory_assignments(id) on delete cascade,
  at            timestamptz not null default now(),
  by_name       text,
  action        text not null,
  detail        text
);
create index if not exists inventory_assign_events on public.inventory_assignment_events (assignment_id, at);

create table if not exists public.inventory_repairs (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  item_id       uuid not null references public.inventory_items(id) on delete restrict,
  qty           int not null default 1 check (qty > 0),
  assignment_id uuid references public.inventory_assignments(id) on delete set null,
  location_id   uuid references public.inventory_locations(id) on delete set null,
  issue         text not null check (length(btrim(issue)) > 0),
  removed       boolean not null default false,     -- true: the units came back from their place and are out of the store until fixed
  reported_on   date not null default (now() at time zone 'Asia/Kolkata')::date,
  status        text not null default 'open' check (status in ('open', 'fixed', 'written_off')),
  cost          numeric(12,2) check (cost is null or cost >= 0),
  vendor        text,
  closed_on     date,
  result_note   text,
  by_name       text,
  closed_by_name text,
  created_at    timestamptz not null default now()
);
create index if not exists inventory_repairs_idx on public.inventory_repairs (school_id, status, reported_on desc);

alter table public.inventory_locations enable row level security;
alter table public.inventory_assignments enable row level security;
alter table public.inventory_assignment_events enable row level security;
alter table public.inventory_repairs enable row level security;

drop policy if exists "read" on public.inventory_locations;
create policy "read" on public.inventory_locations for select to authenticated
  using (public.has_perm_school(school_id, 'inventory.items.view') or public.has_perm_school(school_id, 'inventory.assign.view'));
drop policy if exists "write" on public.inventory_locations;
create policy "write" on public.inventory_locations for all to authenticated
  using (public.has_perm_school(school_id, 'inventory.items.edit')) with check (public.has_perm_school(school_id, 'inventory.items.create'));
drop policy if exists "read" on public.inventory_assignments;
create policy "read" on public.inventory_assignments for select to authenticated
  using (public.has_perm_school(school_id, 'inventory.assign.view') or public.has_perm_school(school_id, 'inventory.items.view'));
drop policy if exists "read" on public.inventory_assignment_events;
create policy "read" on public.inventory_assignment_events for select to authenticated
  using (public.has_perm_school(school_id, 'inventory.assign.view') or public.has_perm_school(school_id, 'inventory.items.view'));
drop policy if exists "read" on public.inventory_repairs;
create policy "read" on public.inventory_repairs for select to authenticated
  using (public.has_perm_school(school_id, 'inventory.assign.view') or public.has_perm_school(school_id, 'inventory.items.view'));
-- assignments, repairs and their history are written by the functions below

-- ───────────── helpers ─────────────
create or replace function public._inv_holder(sid uuid, a public.inventory_assignments) returns text
language sql stable security definer set search_path = public as $$
  select case a.holder_kind
    when 'location' then (select name from public.inventory_locations where id = a.location_id)
    when 'staff' then (select name from public.staff where id = a.staff_id)
    when 'student' then (select btrim(concat_ws(' ', first_name, last_name)) from public.students where id = a.student_id)
    else a.department end;
$$;
revoke execute on function public._inv_holder(uuid, public.inventory_assignments) from public, anon, authenticated;

create or replace function public._inv_event(sid uuid, a uuid, p_action text, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into public.inventory_assignment_events (school_id, assignment_id, by_name, action, detail) values (sid, a, public._inv_me(sid), p_action, left(p_detail, 300));
$$;
revoke execute on function public._inv_event(uuid, uuid, text, text) from public, anon, authenticated;

-- validates a holder and returns its readable name (raises a friendly message when it is not valid)
create or replace function public._inv_check_holder(sid uuid, p_kind text, p_target uuid, p_label text) returns text
language plpgsql security definer set search_path = public as $$
declare nm text; st text;
begin
  if p_kind = 'location' then
    select name into nm from public.inventory_locations where id = p_target and school_id = sid and active;
    if nm is null then raise exception 'Choose the room / place.'; end if;
  elsif p_kind = 'staff' then
    select name, status into nm, st from public.staff where id = p_target and school_id = sid;
    if nm is null then raise exception 'Choose the staff member.'; end if;
    if st <> 'active' then raise exception '% is no longer working here.', nm; end if;
  elsif p_kind = 'student' then
    select btrim(concat_ws(' ', first_name, last_name)), status into nm, st from public.students where id = p_target and school_id = sid;
    if nm is null then raise exception 'Choose the student.'; end if;
    if st <> 'active' then raise exception '% is no longer on roll.', nm; end if;
  elsif p_kind = 'department' then
    nm := nullif(btrim(coalesce(p_label, '')), '');
    if nm is null then raise exception 'Write the department (for example Science lab, Accounts).'; end if;
  else
    raise exception 'Choose who or where it goes.';
  end if;
  return nm;
end $$;
revoke execute on function public._inv_check_holder(uuid, text, uuid, text) from public, anon, authenticated;

-- ───────────── assign ─────────────
create or replace function public.inventory_assign(sid uuid, p_item uuid, p_qty int, p_kind text, p_target uuid, p_label text default null, p_due date default null,
                                                   p_tag text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; nm text; aid uuid; me text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.assign.create') then raise exception 'not allowed'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many.'; end if;
  select * into it from public.inventory_items where id = p_item and school_id = sid for update;
  if it.id is null or not it.active then raise exception 'Item not found or withdrawn.'; end if;
  if it.kind = 'shop' then raise exception '“%” is a shop item — it is sold, not assigned.', it.name; end if;
  nm := public._inv_check_holder(sid, p_kind, p_target, p_label);
  if p_due is not null and p_due < public.today_ist() then raise exception 'The return date is in the past.'; end if;
  if it.on_hand < p_qty then raise exception 'Only % of “%” in the store.', it.on_hand, it.name; end if;
  me := public._inv_me(sid);
  insert into public.inventory_assignments (school_id, item_id, qty, holder_kind, location_id, staff_id, student_id, department, tag, due_back, note, assigned_by_name)
  values (sid, p_item, p_qty, p_kind, case when p_kind = 'location' then p_target end, case when p_kind = 'staff' then p_target end, case when p_kind = 'student' then p_target end,
          case when p_kind = 'department' then nm end, nullif(left(btrim(coalesce(p_tag, '')), 60), ''), p_due, nullif(left(btrim(coalesce(p_note, '')), 200), ''), me) returning id into aid;
  insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, ref_type, ref_id, party, by_name) values (sid, p_item, 'assign', -p_qty, it.cost, 'assignment', aid, nm, me);
  perform public._inv_event(sid, aid, 'assigned', p_qty || ' × ' || it.name || ' to ' || nm);
  return jsonb_build_object('id', aid, 'holder', nm, 'holder_kind', p_kind, 'item', it.name, 'qty', p_qty, 'due_back', p_due);
end $$;

-- ───────────── return ─────────────
-- p_condition: good (back to the store) | needs_repair (a repair ticket, out of the store) | damaged | lost (written off).
-- p_charge > 0 for a student's damaged / lost item bills the student's fee account.
create or replace function public.inventory_return(sid uuid, p_assignment uuid, p_qty int default null, p_condition text default 'good', p_note text default null, p_charge numeric default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.inventory_assignments; it public.inventory_items; n int; closed uuid; nm text; me text; due uuid; chg numeric := greatest(coalesce(p_charge, 0), 0);
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.assign.edit') then raise exception 'not allowed'; end if;
  if p_condition not in ('good', 'needs_repair', 'damaged', 'lost') then raise exception 'Choose the condition it came back in.'; end if;
  select * into a from public.inventory_assignments where id = p_assignment and school_id = sid for update;
  if a.id is null then raise exception 'Record not found.'; end if;
  if a.status <> 'active' then raise exception 'This was already returned.'; end if;
  n := coalesce(p_qty, a.qty);
  if n <= 0 or n > a.qty then raise exception 'You can return between 1 and %.', a.qty; end if;
  select * into it from public.inventory_items where id = a.item_id for update;
  nm := public._inv_holder(sid, a);
  me := public._inv_me(sid);
  if chg > 0 and a.holder_kind <> 'student' then raise exception 'A recovery charge can be added only for a student.'; end if;
  if chg > 0 and p_condition not in ('damaged', 'lost') then raise exception 'A recovery charge is for damaged or lost property.'; end if;

  if n < a.qty then
    update public.inventory_assignments set qty = qty - n where id = a.id;
    insert into public.inventory_assignments (school_id, item_id, qty, holder_kind, location_id, staff_id, student_id, department, tag, assigned_on, due_back, note, status, returned_on,
                                              return_condition, return_note, assigned_by_name, returned_by_name)
    values (a.school_id, a.item_id, n, a.holder_kind, a.location_id, a.staff_id, a.student_id, a.department, a.tag, a.assigned_on, a.due_back, a.note,
            case p_condition when 'good' then 'returned' when 'needs_repair' then 'repair' when 'damaged' then 'damaged' else 'lost' end, public.today_ist(), p_condition,
            nullif(left(btrim(coalesce(p_note, '')), 200), ''), a.assigned_by_name, me) returning id into closed;
  else
    closed := a.id;
    update public.inventory_assignments set status = case p_condition when 'good' then 'returned' when 'needs_repair' then 'repair' when 'damaged' then 'damaged' else 'lost' end,
           returned_on = public.today_ist(), return_condition = p_condition, return_note = nullif(left(btrim(coalesce(p_note, '')), 200), ''), returned_by_name = me where id = a.id;
  end if;

  if p_condition = 'good' then
    insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, ref_type, ref_id, party, by_name) values (sid, a.item_id, 'return', n, it.cost, 'assignment', closed, nm, me);
  elsif p_condition = 'needs_repair' then
    insert into public.inventory_repairs (school_id, item_id, qty, assignment_id, location_id, issue, removed, by_name)
    values (sid, a.item_id, n, closed, a.location_id, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Came back needing repair'), true, me);
  else
    -- the unit comes back and is written off, so the ledger shows both
    insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, ref_type, ref_id, party, note, by_name) values (sid, a.item_id, 'return', n, it.cost, 'assignment', closed, nm, null, me);
    insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, ref_type, ref_id, party, note, by_name) values (sid, a.item_id, 'writeoff', -n, it.cost, 'assignment', closed, nm, p_condition, me);
  end if;

  if chg > 0 then
    due := public.charge_student(sid, a.student_id, 'Damage / Loss Recovery', 'Recovery · ' || it.name || ' (' || p_condition || ')', chg, public.today_ist(), 'asset:' || closed);
    update public.inventory_assignments set charge_due_id = due where id = closed;
  end if;
  perform public._inv_event(sid, closed, 'returned', n || ' × ' || it.name || ' from ' || nm || ' — ' || p_condition || case when chg > 0 then ' · charged ₹' || chg else '' end);
  return jsonb_build_object('id', closed, 'holder', nm, 'holder_kind', a.holder_kind, 'item', it.name, 'qty', n, 'condition', p_condition, 'charged', chg, 'due_id', due);
end $$;

-- ───────────── move an installed item to another place / person ─────────────
create or replace function public.inventory_transfer(sid uuid, p_assignment uuid, p_kind text, p_target uuid, p_label text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.inventory_assignments; before text; nm text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.assign.edit') then raise exception 'not allowed'; end if;
  select * into a from public.inventory_assignments where id = p_assignment and school_id = sid for update;
  if a.id is null or a.status <> 'active' then raise exception 'This is not currently assigned.'; end if;
  before := public._inv_holder(sid, a);
  nm := public._inv_check_holder(sid, p_kind, p_target, p_label);
  update public.inventory_assignments set holder_kind = p_kind, location_id = case when p_kind = 'location' then p_target end, staff_id = case when p_kind = 'staff' then p_target end,
         student_id = case when p_kind = 'student' then p_target end, department = case when p_kind = 'department' then nm end where id = p_assignment;
  perform public._inv_event(sid, p_assignment, 'transferred', 'from ' || before || ' to ' || nm || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''));
  return jsonb_build_object('id', p_assignment, 'from', before, 'to', nm, 'holder_kind', p_kind, 'qty', a.qty, 'item_id', a.item_id);
end $$;

-- ───────────── repairs ─────────────
create or replace function public.inventory_report_fault(sid uuid, p_item uuid, p_qty int, p_issue text, p_location uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid;
begin
  if auth.uid() is null or not (public.has_perm_school(sid, 'inventory.assign.create') or public.has_perm_school(sid, 'inventory.assign.edit')) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.inventory_items where id = p_item and school_id = sid) then raise exception 'Item not found.'; end if;
  if coalesce(btrim(p_issue), '') = '' then raise exception 'Describe the fault.'; end if;
  insert into public.inventory_repairs (school_id, item_id, qty, location_id, issue, by_name)
  values (sid, p_item, greatest(coalesce(p_qty, 1), 1), p_location, left(btrim(p_issue), 300), public._inv_me(sid)) returning id into i;
  return i;
end $$;

create or replace function public.inventory_repair_close(sid uuid, p_repair uuid, p_result text, p_cost numeric default null, p_note text default null, p_vendor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.inventory_repairs; it public.inventory_items;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.assign.edit') then raise exception 'not allowed'; end if;
  if p_result not in ('fixed', 'written_off') then raise exception 'Choose fixed or written off.'; end if;
  select * into r from public.inventory_repairs where id = p_repair and school_id = sid for update;
  if r.id is null or r.status <> 'open' then raise exception 'This repair is not open.'; end if;
  if coalesce(p_cost, 0) < 0 then raise exception 'The cost cannot be negative.'; end if;
  update public.inventory_repairs set status = p_result, cost = p_cost, vendor = nullif(left(btrim(coalesce(p_vendor, '')), 80), ''), result_note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
         closed_on = public.today_ist(), closed_by_name = public._inv_me(sid) where id = p_repair;
  if r.removed then
    select * into it from public.inventory_items where id = r.item_id for update;
    if p_result = 'fixed' then
      insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, ref_type, ref_id, note, by_name) values (sid, r.item_id, 'return', r.qty, it.cost, 'repair', r.id, 'Repaired', public._inv_me(sid));
    end if;
  end if;
end $$;

-- ───────────── lists ─────────────
create or replace function public.inventory_assignment_list(sid uuid, p_state text default 'active', p_holder text default null, p_q text default null, p_item uuid default null,
                                                           p_location uuid default null, p_staff uuid default null, p_student uuid default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, item_id uuid, item_name text, category text, qty int, tag text, holder_kind text, holder_id uuid, holder_name text, holder_sub text, assigned_on date, due_back date,
               days_overdue int, status text, returned_on date, return_condition text, note text, return_note text, assigned_by_name text, returned_by_name text, charge numeric, total bigint)
language sql stable security definer set search_path = public as $$
  select a.id, i.id, i.name || coalesce(' (' || i.variant || ')', ''), i.category, a.qty, a.tag, a.holder_kind, coalesce(a.location_id, a.staff_id, a.student_id),
         case a.holder_kind when 'location' then l.name when 'staff' then w.name when 'student' then btrim(concat_ws(' ', s.first_name, s.last_name)) else a.department end,
         case a.holder_kind when 'location' then concat_ws(' · ', initcap(l.kind), c.name || coalesce('-' || sec.name, ''), l.building)
                            when 'staff' then concat_ws(' · ', w.designation, w.emp_code)
                            when 'student' then concat_ws(' · ', s.admission_no, sc.name || coalesce('-' || ss.name, '')) else 'Department' end,
         a.assigned_on, a.due_back, case when a.status = 'active' and a.due_back is not null and a.due_back < public.today_ist() then public.today_ist() - a.due_back else 0 end,
         a.status, a.returned_on, a.return_condition, a.note, a.return_note, a.assigned_by_name, a.returned_by_name,
         (select d.amount from public.fee_dues d where d.id = a.charge_due_id), count(*) over ()
    from public.inventory_assignments a
    join public.inventory_items i on i.id = a.item_id
    left join public.inventory_locations l on l.id = a.location_id
    left join public.classes c on c.id = l.class_id
    left join public.sections sec on sec.id = l.section_id
    left join public.staff w on w.id = a.staff_id
    left join public.students s on s.id = a.student_id
    left join public.classes sc on sc.id = s.class_id
    left join public.sections ss on ss.id = s.section_id
   where a.school_id = sid and (public.has_perm_school(sid, 'inventory.assign.view') or public.has_perm_school(sid, 'inventory.items.view'))
     and (p_state = 'all' or (p_state = 'active' and a.status = 'active') or (p_state = 'overdue' and a.status = 'active' and a.due_back < public.today_ist())
          or (p_state = 'closed' and a.status <> 'active') or (p_state = 'problem' and a.status in ('damaged', 'lost', 'repair')))
     and (p_holder is null or a.holder_kind = p_holder) and (p_item is null or a.item_id = p_item) and (p_location is null or a.location_id = p_location)
     and (p_staff is null or a.staff_id = p_staff) and (p_student is null or a.student_id = p_student)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', i.name, i.variant, i.sku, a.tag, l.name, w.name, s.first_name, s.last_name, s.admission_no, a.department) ilike public.like_escape(btrim(p_q)))
   order by case when a.status = 'active' then 0 else 1 end, a.due_back nulls last, a.assigned_on desc, a.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- one row per place with how much property it holds
create or replace function public.inventory_location_summary(sid uuid)
returns table (id uuid, name text, kind text, class_name text, section_name text, building text, in_charge text, active boolean, kinds bigint, units bigint, value numeric)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.kind, c.name, sec.name, l.building, w.name, l.active,
         count(distinct a.item_id) filter (where a.status = 'active'), coalesce(sum(a.qty) filter (where a.status = 'active'), 0)::bigint,
         coalesce(sum(a.qty * i.cost) filter (where a.status = 'active'), 0)
    from public.inventory_locations l
    left join public.classes c on c.id = l.class_id left join public.sections sec on sec.id = l.section_id left join public.staff w on w.id = l.in_charge_staff_id
    left join public.inventory_assignments a on a.location_id = l.id
    left join public.inventory_items i on i.id = a.item_id
   where l.school_id = sid and (public.has_perm_school(sid, 'inventory.assign.view') or public.has_perm_school(sid, 'inventory.items.view'))
   group by l.id, l.name, l.kind, c.name, sec.name, l.building, w.name, l.active, c.sort
   order by c.sort nulls last, l.name;
$$;

-- items with what is in the store, out, and under repair (replaces the shop-only list)
drop function if exists public.inventory_item_list(uuid, text, text, text, text, int, int);
create or replace function public.inventory_item_list(sid uuid, p_q text default null, p_category text default null, p_state text default null, p_active text default 'yes',
                                                      p_limit int default 25, p_offset int default 0, p_kind text default null)
returns table (id uuid, sku text, name text, category text, variant text, unit text, cost numeric, price numeric, reorder_level int, track_stock boolean, on_hand int,
               stock_value numeric, active boolean, class_name text, location text, sold_30 bigint, state text, total bigint, kind text, assigned_qty bigint, repair_qty bigint, owned_qty bigint)
language sql stable security definer set search_path = public as $$
  select i.id, i.sku, i.name, i.category, i.variant, i.unit, i.cost, i.price, i.reorder_level, i.track_stock, i.on_hand, round(i.on_hand * i.cost, 2), i.active, c.name, i.location,
         coalesce((select sum(-m.qty) from public.inventory_moves m where m.item_id = i.id and m.kind = 'sale' and m.created_at >= now() - interval '30 days'), 0)::bigint,
         case when not i.track_stock then 'na' when i.on_hand <= 0 then 'out' when i.on_hand <= i.reorder_level then 'low' else 'ok' end, count(*) over (), i.kind,
         coalesce((select sum(a.qty) from public.inventory_assignments a where a.item_id = i.id and a.status = 'active'), 0)::bigint,
         coalesce((select sum(r.qty) from public.inventory_repairs r where r.item_id = i.id and r.status = 'open' and r.removed), 0)::bigint,
         (i.on_hand + coalesce((select sum(a.qty) from public.inventory_assignments a where a.item_id = i.id and a.status = 'active'), 0)
                    + coalesce((select sum(r.qty) from public.inventory_repairs r where r.item_id = i.id and r.status = 'open' and r.removed), 0))::bigint
    from public.inventory_items i left join public.classes c on c.id = i.for_class_id
   where i.school_id = sid and (public.has_perm_school(sid, 'inventory.items.view') or public.has_perm_school(sid, 'inventory.sales.create') or public.has_perm_school(sid, 'inventory.purchase.create')
                                or public.has_perm_school(sid, 'inventory.assign.view') or public.has_perm_school(sid, 'inventory.assign.create'))
     and (p_active is null or p_active = 'all' or (p_active = 'yes' and i.active) or (p_active = 'no' and not i.active))
     and (p_category is null or i.category = p_category) and (p_kind is null or i.kind = p_kind)
     and (p_state is null or (p_state = 'out' and i.track_stock and i.on_hand <= 0) or (p_state = 'low' and i.track_stock and i.on_hand > 0 and i.on_hand <= i.reorder_level)
          or (p_state = 'attention' and i.track_stock and i.on_hand <= i.reorder_level) or (p_state = 'ok' and (not i.track_stock or i.on_hand > i.reorder_level)))
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', i.name, i.sku, i.category, i.variant, i.barcode) ilike public.like_escape(btrim(p_q)))
   order by i.category, i.name, i.variant
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.inventory_repair_list(sid uuid, p_state text default 'open', p_limit int default 25, p_offset int default 0)
returns table (id uuid, item_name text, qty int, issue text, location_name text, holder_name text, reported_on date, status text, cost numeric, vendor text, closed_on date, result_note text,
               by_name text, removed boolean, days_open int, total bigint)
language sql stable security definer set search_path = public as $$
  select r.id, i.name || coalesce(' (' || i.variant || ')', ''), r.qty, r.issue, l.name, public._inv_holder(sid, a), r.reported_on, r.status, r.cost, r.vendor, r.closed_on, r.result_note, r.by_name, r.removed,
         case when r.status = 'open' then public.today_ist() - r.reported_on else 0 end, count(*) over ()
    from public.inventory_repairs r join public.inventory_items i on i.id = r.item_id
    left join public.inventory_locations l on l.id = r.location_id left join public.inventory_assignments a on a.id = r.assignment_id
   where r.school_id = sid and (public.has_perm_school(sid, 'inventory.assign.view') or public.has_perm_school(sid, 'inventory.items.view'))
     and (p_state = 'all' or r.status = p_state)
   order by case when r.status = 'open' then 0 else 1 end, r.reported_on desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.inventory_overview(sid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := public.today_ist();
begin
  if not (public.has_perm_school(sid, 'inventory.assign.view') or public.has_perm_school(sid, 'inventory.items.view')) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'kinds', (select count(*) from public.inventory_items where school_id = sid and active and kind <> 'shop'),
    'in_store', (select coalesce(sum(on_hand), 0) from public.inventory_items where school_id = sid and active and kind <> 'shop' and track_stock),
    'assigned', (select coalesce(sum(a.qty), 0) from public.inventory_assignments a join public.inventory_items i on i.id = a.item_id where a.school_id = sid and a.status = 'active' and i.kind <> 'shop'),
    'with_people', (select coalesce(sum(qty), 0) from public.inventory_assignments where school_id = sid and status = 'active' and holder_kind in ('staff', 'student')),
    'in_rooms', (select coalesce(sum(qty), 0) from public.inventory_assignments where school_id = sid and status = 'active' and holder_kind = 'location'),
    'overdue', (select count(*) from public.inventory_assignments where school_id = sid and status = 'active' and due_back < d),
    'repairs', (select count(*) from public.inventory_repairs where school_id = sid and status = 'open'),
    'low', (select count(*) from public.inventory_items where school_id = sid and active and kind <> 'shop' and track_stock and on_hand <= reorder_level and reorder_level > 0),
    'value', (select coalesce(sum((i.on_hand + coalesce(x.q, 0)) * i.cost), 0) from public.inventory_items i
              left join (select item_id, sum(qty) q from public.inventory_assignments where status = 'active' group by item_id) x on x.item_id = i.id
              where i.school_id = sid and i.active and i.kind <> 'shop'),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('name', category, 'units', u) order by u desc) from (
        select i.category, i.on_hand + coalesce(x.q, 0) u from public.inventory_items i
          left join (select item_id, sum(qty) q from public.inventory_assignments where status = 'active' group by item_id) x on x.item_id = i.id
         where i.school_id = sid and i.active and i.kind <> 'shop') q where u > 0 limit 8), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'by', by_name, 'action', action, 'detail', detail)) from (
        select at, by_name, action, detail from public.inventory_assignment_events where school_id = sid order by at desc limit 8) e), '[]'::jsonb));
end $$;

-- ───────────── clearance: what stands between a student and the Transfer Certificate ─────────────
alter table public.fee_settings add column if not exists tc_clearance text not null default 'all' check (tc_clearance in ('all', 'due_till_today'));

create or replace function public.student_clearance(sid uuid, stu uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mode text; owed numeric; lst jsonb; books int; assets int; bed boolean;
begin
  if not (public.can_student(sid, 'students.profile.view', stu) or public.can_student(sid, 'documents.issue.view', stu) or public.can_student(sid, 'fees.collection.view', stu)
          or public.has_perm_school(sid, 'documents.issue.create')) then raise exception 'not allowed'; end if;
  select coalesce((select tc_clearance from public.fee_settings where school_id = sid), 'all') into mode;
  select coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), 0),
         coalesce(jsonb_agg(jsonb_build_object('label', d.label, 'balance', greatest(d.amount - d.concession + d.fine - d.paid, 0), 'due_date', d.due_date) order by d.due_date)
                  filter (where d.amount - d.concession + d.fine - d.paid > 0), '[]'::jsonb)
    into owed, lst from public.fee_dues d
   where d.student_id = stu and d.school_id = sid and (mode = 'all' or d.due_date <= public.today_ist());
  select count(*) into books from public.library_issues where student_id = stu and returned_on is null;
  select coalesce(sum(qty), 0) into assets from public.inventory_assignments where student_id = stu and status = 'active';
  select exists (select 1 from public.hostel_allocations where student_id = stu and status = 'active') into bed;
  return jsonb_build_object('owed', owed, 'dues', lst, 'mode', mode, 'books_out', books, 'assets_out', assets, 'hostel_bed', bed, 'fees_clear', owed <= 0);
end $$;

-- the Transfer Certificate rule, applied to every way a TC can be made (template studio and the old certificate screen)
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'issue_document_core') then
    alter function public.issue_document(uuid, uuid, uuid, uuid, date, jsonb, boolean, text) rename to issue_document_core;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'issue_certificate_core') then
    alter function public.issue_certificate(uuid, uuid, text, date, jsonb, boolean, text) rename to issue_certificate_core;
  end if;
end $$;
revoke execute on function public.issue_document_core(uuid, uuid, uuid, uuid, date, jsonb, boolean, text) from public, anon, authenticated;
revoke execute on function public.issue_certificate_core(uuid, uuid, text, date, jsonb, boolean, text) from public, anon, authenticated;

create or replace function public._tc_fee_gate(sid uuid, stu uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mode text; owed numeric;
begin
  select coalesce((select tc_clearance from public.fee_settings where school_id = sid), 'all') into mode;
  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into owed from public.fee_dues
   where student_id = stu and school_id = sid and (mode = 'all' or due_date <= public.today_ist());
  if owed > 0 then
    raise exception 'The Transfer Certificate cannot be issued: ₹% of fees is still pending for this student. Collect it at the fee counter (or have the principal waive it) first.', owed;
  end if;
end $$;
revoke execute on function public._tc_fee_gate(uuid, uuid) from public, anon, authenticated;

create or replace function public.issue_document(sid uuid, tpl uuid, stu uuid, stf uuid, p_issued_on date, p_extra jsonb default '{}', p_mark_left boolean default false, p_by text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if stu is not null then
    select on_issue, numbering_prefix, code into t from public.document_templates where id = tpl and school_id = sid;
    if t.on_issue = 'mark_transferred' or upper(coalesce(t.numbering_prefix, '')) = 'TC' or lower(coalesce(t.code, '')) in ('tc', 'transfer_certificate', 'transfer') then
      perform public._tc_fee_gate(sid, stu);
    end if;
  end if;
  return public.issue_document_core(sid, tpl, stu, stf, p_issued_on, p_extra, p_mark_left, p_by);
end $$;

create or replace function public.issue_certificate(sid uuid, stu uuid, p_kind text, p_issued_on date, p_extra jsonb default '{}', p_mark_left boolean default false, p_by text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'transfer' then perform public._tc_fee_gate(sid, stu); end if;
  return public.issue_certificate_core(sid, stu, p_kind, p_issued_on, p_extra, p_mark_left, p_by);
end $$;

do $$
declare t text;
begin
  foreach t in array array['inventory_locations', 'inventory_assignments', 'inventory_repairs'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
