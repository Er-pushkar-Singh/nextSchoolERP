-- ═══════════════════════════════════════════════════════════════════════════
-- Step 32: Hostel — hostels (boys / girls), rooms and beds, bed allocation with gender and capacity checks, hostel fee billed
--          into the normal fee dues, night / morning roll call, outpass (leave out) with approval and return, visitors, mess menu.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.hostels (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  kind        text not null default 'boys' check (kind in ('boys', 'girls', 'mixed')),
  warden_id   uuid references public.staff(id) on delete set null,
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (school_id, name)
);
create table if not exists public.hostel_rooms (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  hostel_id   uuid not null references public.hostels(id) on delete cascade,
  room_no     text not null check (length(btrim(room_no)) between 1 and 20),
  floor       int not null default 0,
  beds        int not null default 4 check (beds between 1 and 40),
  room_type   text not null default 'dormitory' check (room_type in ('dormitory', 'double', 'single')),
  monthly_fee numeric(10,2) not null default 0 check (monthly_fee >= 0),
  active      boolean not null default true,
  unique (hostel_id, room_no)
);
create table if not exists public.hostel_allocations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  session_id  uuid references public.sessions(id) on delete set null,
  student_id  uuid not null references public.students(id) on delete cascade,
  room_id     uuid not null references public.hostel_rooms(id) on delete restrict,
  bed_no      int not null check (bed_no >= 1),
  start_date  date not null default (now() at time zone 'Asia/Kolkata')::date,
  end_date    date,
  monthly_fee numeric(10,2),
  status      text not null default 'active' check (status in ('active', 'ended')),
  created_by_name text,
  created_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create unique index if not exists hostel_alloc_student on public.hostel_allocations (student_id) where status = 'active';
create unique index if not exists hostel_alloc_bed on public.hostel_allocations (room_id, bed_no) where status = 'active';

create table if not exists public.hostel_attendance (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  hostel_id     uuid not null references public.hostels(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  on_date       date not null,
  slot          text not null default 'night' check (slot in ('night', 'morning')),
  status        text not null check (status in ('P', 'A', 'LV')),
  note          text,
  marked_by_name text,
  unique (student_id, on_date, slot)
);
create index if not exists hostel_att_day on public.hostel_attendance (school_id, hostel_id, on_date);

create table if not exists public.hostel_outpasses (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  kind            text not null default 'home' check (kind in ('home', 'local', 'medical', 'event')),
  reason          text not null check (length(btrim(reason)) > 0),
  out_at          timestamptz not null,
  expected_back   timestamptz not null,
  guardian_name   text,
  guardian_phone  text,
  status          text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'out', 'returned', 'cancelled')),
  decided_by_name text,
  decision_note   text,
  left_at         timestamptz,
  returned_at     timestamptz,
  requested_by_name text,
  created_at      timestamptz not null default now(),
  check (expected_back > out_at)
);
create index if not exists hostel_outpass_idx on public.hostel_outpasses (school_id, status, out_at desc);

create table if not exists public.hostel_visitors (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  hostel_id   uuid references public.hostels(id) on delete set null,
  student_id  uuid not null references public.students(id) on delete cascade,
  visitor_name text not null check (length(btrim(visitor_name)) > 0),
  relation    text,
  phone       text,
  in_at       timestamptz not null default now(),
  out_at      timestamptz,
  note        text,
  by_name     text
);
create index if not exists hostel_visitors_idx on public.hostel_visitors (school_id, in_at desc);

create table if not exists public.mess_menu (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  hostel_id  uuid references public.hostels(id) on delete cascade,
  weekday    int not null check (weekday between 1 and 7),
  meal       text not null check (meal in ('breakfast', 'lunch', 'snacks', 'dinner')),
  items      text not null
);
create unique index if not exists mess_menu_uniq on public.mess_menu (school_id, coalesce(hostel_id, '00000000-0000-0000-0000-000000000000'::uuid), weekday, meal);

alter table public.hostels enable row level security;
alter table public.hostel_rooms enable row level security;
alter table public.hostel_allocations enable row level security;
alter table public.hostel_attendance enable row level security;
alter table public.hostel_outpasses enable row level security;
alter table public.hostel_visitors enable row level security;
alter table public.mess_menu enable row level security;

-- reads: anyone with a hostel permission; the student's own parent sees the child's allocation / outpass
do $$
declare r record;
begin
  for r in select * from (values
      ('hostels', 'hostel.rooms'), ('hostel_rooms', 'hostel.rooms'), ('hostel_allocations', 'hostel.allocation'), ('hostel_attendance', 'hostel.rollcall'),
      ('hostel_outpasses', 'hostel.rollcall'), ('hostel_visitors', 'hostel.mess'), ('mess_menu', 'hostel.mess')) v(t, p) loop
    execute format('drop policy if exists "read" on public.%I', r.t);
    execute format('create policy "read" on public.%I for select to authenticated using (public.has_perm_school(school_id, %L))', r.t, r.p || '.view');
  end loop;
end $$;
drop policy if exists "write" on public.hostels;
create policy "write" on public.hostels for all to authenticated
  using (public.has_perm_school(school_id, 'hostel.rooms.edit')) with check (public.has_perm_school(school_id, 'hostel.rooms.create'));
drop policy if exists "write" on public.hostel_rooms;
create policy "write" on public.hostel_rooms for all to authenticated
  using (public.has_perm_school(school_id, 'hostel.rooms.edit')) with check (public.has_perm_school(school_id, 'hostel.rooms.create'));
drop policy if exists "write" on public.mess_menu;
create policy "write" on public.mess_menu for all to authenticated
  using (public.has_perm_school(school_id, 'hostel.mess.edit')) with check (public.has_perm_school(school_id, 'hostel.mess.create'));
drop policy if exists "create" on public.hostel_visitors;
create policy "create" on public.hostel_visitors for insert to authenticated with check (public.has_perm_school(school_id, 'hostel.mess.create'));
drop policy if exists "edit" on public.hostel_visitors;
create policy "edit" on public.hostel_visitors for update to authenticated using (public.has_perm_school(school_id, 'hostel.mess.edit')) with check (public.has_perm_school(school_id, 'hostel.mess.edit'));
-- allocations, roll call and outpasses are written by the functions below

-- ───────────── allocation ─────────────
create or replace function public.hostel_allocate(sid uuid, p_student uuid, p_room uuid, p_bed int, p_start date default null, p_fee numeric default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare st record; rm record; h record; i uuid; me text; occupied int; sess uuid;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'hostel.allocation.create') then raise exception 'not allowed'; end if;
  select id, status, gender, first_name into st from public.students where id = p_student and school_id = sid;
  if st.id is null then raise exception 'Student not found.'; end if;
  if st.status <> 'active' then raise exception 'Only a student on roll can get a bed.'; end if;
  select * into rm from public.hostel_rooms where id = p_room and school_id = sid;
  if rm.id is null or not rm.active then raise exception 'Room not found or closed.'; end if;
  select * into h from public.hostels where id = rm.hostel_id;
  if not h.active then raise exception 'This hostel is closed.'; end if;
  if (h.kind = 'boys' and coalesce(st.gender, '') = 'F') or (h.kind = 'girls' and coalesce(st.gender, '') = 'M') then raise exception '% is a % hostel.', h.name, h.kind; end if;
  if p_bed is null or p_bed < 1 or p_bed > rm.beds then raise exception 'Choose a bed between 1 and %.', rm.beds; end if;
  if exists (select 1 from public.hostel_allocations where student_id = p_student and status = 'active') then raise exception '% already has a bed. Vacate it first.', st.first_name; end if;
  select count(*) into occupied from public.hostel_allocations where room_id = p_room and status = 'active';
  if occupied >= rm.beds then raise exception 'Room % is full.', rm.room_no; end if;
  if exists (select 1 from public.hostel_allocations where room_id = p_room and bed_no = p_bed and status = 'active') then raise exception 'Bed % of room % is taken.', p_bed, rm.room_no; end if;
  select id into sess from public.sessions where school_id = sid and is_current;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  insert into public.hostel_allocations (school_id, session_id, student_id, room_id, bed_no, start_date, monthly_fee, created_by_name)
  values (sid, sess, p_student, p_room, p_bed, coalesce(p_start, public.today_ist()), p_fee, coalesce(me, 'User')) returning id into i;
  return i;
end $$;

create or replace function public.hostel_vacate(sid uuid, p_alloc uuid, p_end date default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.hostel_allocations;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'hostel.allocation.edit') then raise exception 'not allowed'; end if;
  select * into a from public.hostel_allocations where id = p_alloc and school_id = sid and status = 'active';
  if a.id is null then raise exception 'This bed is not allocated.'; end if;
  if exists (select 1 from public.hostel_outpasses where student_id = a.student_id and status = 'out') then raise exception 'The student is out on an outpass. Mark the return first.'; end if;
  update public.hostel_allocations set status = 'ended', end_date = greatest(coalesce(p_end, public.today_ist()), a.start_date) where id = p_alloc;
end $$;

-- hostel fee into the normal dues (Fees → Collect, defaulters, receipts all work); one run per label
create or replace function public.generate_hostel_dues(sid uuid, sess uuid, p_label text, p_due date, p_months numeric default 1) returns int
language plpgsql security definer set search_path = public as $$
declare head uuid; cnt int; k text;
begin
  if not (public.has_perm_school(sid, 'fees.dues.create') or public.has_perm_school(sid, 'hostel.allocation.edit')) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_label), '') = '' or p_due is null then raise exception 'Label and due date are required.'; end if;
  if p_months is null or p_months <= 0 or p_months > 12 then raise exception 'Months must be between 1 and 12.'; end if;
  if not exists (select 1 from public.sessions where id = sess and school_id = sid) then raise exception 'Session not found.'; end if;
  select id into head from public.fee_heads where school_id = sid and name = 'Hostel Fee';
  if head is null then insert into public.fee_heads (school_id, name, sort) values (sid, 'Hostel Fee', 60) returning id into head; end if;
  k := 'hostel:' || sess || ':' || lower(trim(p_label));
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, source_key)
  select sid, sess, x.student_id, head, 'Hostel Fee · ' || trim(p_label), p_due, x.amt, public.concession_for(x.student_id, head, x.amt, p_due), k
    from (select a.student_id, round(coalesce(a.monthly_fee, r.monthly_fee) * p_months, 2) as amt
            from public.hostel_allocations a join public.hostel_rooms r on r.id = a.room_id join public.students s on s.id = a.student_id and s.status = 'active'
           where a.school_id = sid and a.status = 'active' and a.start_date <= p_due) x
   where x.amt > 0
  on conflict (student_id, source_key) where source_key is not null do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ───────────── overview and lists ─────────────
create or replace function public.hostel_overview(sid uuid)
returns table (hostel_id uuid, name text, kind text, warden text, active boolean, rooms bigint, beds bigint, occupied bigint, free bigint, out_now bigint, absent_last_night bigint, pending_outpass bigint)
language sql stable security definer set search_path = public as $$
  select h.id, h.name, h.kind, w.name, h.active,
         (select count(*) from public.hostel_rooms r where r.hostel_id = h.id and r.active),
         (select coalesce(sum(r.beds), 0) from public.hostel_rooms r where r.hostel_id = h.id and r.active),
         (select count(*) from public.hostel_allocations a join public.hostel_rooms r on r.id = a.room_id where r.hostel_id = h.id and a.status = 'active'),
         (select coalesce(sum(r.beds), 0) from public.hostel_rooms r where r.hostel_id = h.id and r.active)
           - (select count(*) from public.hostel_allocations a join public.hostel_rooms r on r.id = a.room_id where r.hostel_id = h.id and a.status = 'active'),
         (select count(*) from public.hostel_outpasses o join public.hostel_allocations a on a.student_id = o.student_id and a.status = 'active' join public.hostel_rooms r on r.id = a.room_id
           where r.hostel_id = h.id and o.status = 'out'),
         (select count(*) from public.hostel_attendance x where x.hostel_id = h.id and x.on_date = public.today_ist() - 1 and x.slot = 'night' and x.status = 'A'),
         (select count(*) from public.hostel_outpasses o join public.hostel_allocations a on a.student_id = o.student_id and a.status = 'active' join public.hostel_rooms r on r.id = a.room_id
           where r.hostel_id = h.id and o.status = 'requested')
    from public.hostels h left join public.staff w on w.id = h.warden_id
   where h.school_id = sid and public.has_perm_school(sid, 'hostel.rooms.view')
   order by h.name;
$$;

create or replace function public.hostel_room_grid(sid uuid, p_hostel uuid)
returns table (room_id uuid, room_no text, floor int, beds int, room_type text, monthly_fee numeric, active boolean, occupants jsonb)
language sql stable security definer set search_path = public as $$
  select r.id, r.room_no, r.floor, r.beds, r.room_type, r.monthly_fee, r.active,
         coalesce((select jsonb_agg(jsonb_build_object('alloc', a.id, 'bed', a.bed_no, 'student', s.id, 'name', btrim(concat_ws(' ', s.first_name, s.last_name)), 'class', c.name) order by a.bed_no)
                     from public.hostel_allocations a join public.students s on s.id = a.student_id left join public.classes c on c.id = s.class_id
                    where a.room_id = r.id and a.status = 'active'), '[]'::jsonb)
    from public.hostel_rooms r
   where r.hostel_id = p_hostel and r.school_id = sid and public.has_perm_school(sid, 'hostel.rooms.view')
   order by r.floor, r.room_no;
$$;

create or replace function public.hostel_allocation_list(sid uuid, p_hostel uuid default null, p_q text default null, p_status text default 'active', p_limit int default 25, p_offset int default 0)
returns table (id uuid, student_id uuid, student_name text, admission_no text, class_name text, gender text, guardian_phone text, hostel_name text, room_no text, bed_no int, start_date date, end_date date,
               status text, monthly_fee numeric, dues numeric, total bigint)
language sql stable security definer set search_path = public as $$
  select a.id, s.id, btrim(concat_ws(' ', s.first_name, s.last_name)), s.admission_no, c.name || coalesce('-' || sec.name, ''), s.gender, s.guardian_phone, h.name, r.room_no, a.bed_no,
         a.start_date, a.end_date, a.status, coalesce(a.monthly_fee, r.monthly_fee),
         (select coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), 0) from public.fee_dues d where d.student_id = s.id and d.source_key like 'hostel:%' and d.status <> 'paid'),
         count(*) over ()
    from public.hostel_allocations a
    join public.students s on s.id = a.student_id
    join public.hostel_rooms r on r.id = a.room_id
    join public.hostels h on h.id = r.hostel_id
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
   where a.school_id = sid and public.has_perm_school(sid, 'hostel.allocation.view')
     and (p_hostel is null or h.id = p_hostel) and (p_status = 'all' or a.status = p_status)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', s.first_name, s.last_name, s.admission_no, r.room_no) ilike public.like_escape(btrim(p_q)))
   order by h.name, r.room_no, a.bed_no
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── roll call ─────────────
create or replace function public.hostel_save_rollcall(sid uuid, p_hostel uuid, p_date date, p_slot text, p_marks jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare m jsonb; n int := 0; me text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'hostel.rollcall.create') then raise exception 'not allowed'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'The roll call date cannot be in the future.'; end if;
  if p_slot not in ('night', 'morning') then raise exception 'Choose night or morning.'; end if;
  if not exists (select 1 from public.hostels where id = p_hostel and school_id = sid) then raise exception 'Hostel not found.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  for m in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    continue when (m ->> 'status') not in ('P', 'A', 'LV');
    continue when not exists (select 1 from public.hostel_allocations a join public.hostel_rooms r on r.id = a.room_id
                               where a.student_id = (m ->> 'student')::uuid and r.hostel_id = p_hostel and a.status = 'active');
    insert into public.hostel_attendance (school_id, hostel_id, student_id, on_date, slot, status, note, marked_by_name)
    values (sid, p_hostel, (m ->> 'student')::uuid, p_date, p_slot, m ->> 'status', nullif(left(m ->> 'note', 120), ''), coalesce(me, 'User'))
    on conflict (student_id, on_date, slot) do update set status = excluded.status, note = excluded.note, marked_by_name = excluded.marked_by_name;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────── outpass ─────────────
create or replace function public.hostel_outpass_request(sid uuid, p_student uuid, p_kind text, p_reason text, p_out timestamptz, p_back timestamptz, p_guardian text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid; me text; auto boolean;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'hostel.rollcall.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.hostel_allocations where student_id = p_student and school_id = sid and status = 'active') then raise exception 'This student has no hostel bed.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_out is null or p_back is null or p_back <= p_out then raise exception 'The return time must be after the going-out time.'; end if;
  if exists (select 1 from public.hostel_outpasses where student_id = p_student and status in ('requested', 'approved', 'out')) then raise exception 'This student already has an open outpass.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  auto := public.has_perm_school(sid, 'hostel.rollcall.approve');
  insert into public.hostel_outpasses (school_id, student_id, kind, reason, out_at, expected_back, guardian_name, guardian_phone, status, requested_by_name, decided_by_name)
  values (sid, p_student, p_kind, left(btrim(p_reason), 200), p_out, p_back, nullif(left(btrim(coalesce(p_guardian, '')), 80), ''), nullif(left(btrim(coalesce(p_phone, '')), 20), ''),
          case when auto then 'approved' else 'requested' end, coalesce(me, 'User'), case when auto then coalesce(me, 'User') end) returning id into i;
  return i;
end $$;

create or replace function public.hostel_outpass_step(sid uuid, p_pass uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.hostel_outpasses; me text;
begin
  select * into o from public.hostel_outpasses where id = p_pass and school_id = sid;
  if o.id is null or auth.uid() is null then raise exception 'not allowed'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  if p_action in ('approve', 'reject') then
    if not public.has_perm_school(sid, 'hostel.rollcall.approve') then raise exception 'not allowed'; end if;
    if o.status <> 'requested' then raise exception 'This outpass is already %.', o.status; end if;
    if p_action = 'reject' and coalesce(btrim(p_note), '') = '' then raise exception 'Give a reason for refusing.'; end if;
    update public.hostel_outpasses set status = case when p_action = 'approve' then 'approved' else 'rejected' end, decided_by_name = coalesce(me, 'User'), decision_note = nullif(left(btrim(coalesce(p_note, '')), 200), '') where id = p_pass;
  elsif p_action = 'out' then
    if not public.has_perm_school(sid, 'hostel.rollcall.create') then raise exception 'not allowed'; end if;
    if o.status <> 'approved' then raise exception 'Only an approved outpass can be used.'; end if;
    update public.hostel_outpasses set status = 'out', left_at = now() where id = p_pass;
  elsif p_action = 'return' then
    if not public.has_perm_school(sid, 'hostel.rollcall.create') then raise exception 'not allowed'; end if;
    if o.status <> 'out' then raise exception 'The student is not out.'; end if;
    update public.hostel_outpasses set status = 'returned', returned_at = now() where id = p_pass;
  elsif p_action = 'cancel' then
    if not public.has_perm_school(sid, 'hostel.rollcall.create') then raise exception 'not allowed'; end if;
    if o.status not in ('requested', 'approved') then raise exception 'This outpass is already %.', o.status; end if;
    update public.hostel_outpasses set status = 'cancelled' where id = p_pass;
  else
    raise exception 'Unknown action.';
  end if;
end $$;

create or replace function public.hostel_outpass_list(sid uuid, p_status text default null, p_q text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, student_id uuid, student_name text, admission_no text, hostel_name text, room_no text, kind text, reason text, out_at timestamptz, expected_back timestamptz,
               status text, late boolean, guardian_name text, guardian_phone text, decided_by_name text, decision_note text, left_at timestamptz, returned_at timestamptz, total bigint)
language sql stable security definer set search_path = public as $$
  select o.id, s.id, btrim(concat_ws(' ', s.first_name, s.last_name)), s.admission_no, h.name, r.room_no, o.kind, o.reason, o.out_at, o.expected_back, o.status,
         (o.status = 'out' and o.expected_back < now()), o.guardian_name, o.guardian_phone, o.decided_by_name, o.decision_note, o.left_at, o.returned_at, count(*) over ()
    from public.hostel_outpasses o
    join public.students s on s.id = o.student_id
    left join public.hostel_allocations a on a.student_id = s.id and a.status = 'active'
    left join public.hostel_rooms r on r.id = a.room_id
    left join public.hostels h on h.id = r.hostel_id
   where o.school_id = sid and public.has_perm_school(sid, 'hostel.rollcall.view')
     and (p_status is null or (p_status = 'late' and o.status = 'out' and o.expected_back < now()) or o.status = p_status)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', s.first_name, s.last_name, s.admission_no, o.reason) ilike public.like_escape(btrim(p_q)))
   order by case o.status when 'requested' then 0 when 'out' then 1 when 'approved' then 2 else 3 end, o.out_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

do $$
declare t text;
begin
  foreach t in array array['hostels', 'hostel_rooms', 'hostel_allocations', 'hostel_outpasses'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
