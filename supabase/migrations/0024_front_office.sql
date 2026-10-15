-- ═══════════════════════════════════════════════════════════════════════════
-- Step 22: Front office — visitor log with passes, phone call log with follow-ups, postal register, student gate pass
--          (early leave with a named pick-up person), and one "today at the front desk" summary.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.front_office_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  next_visitor_no int not null default 1,
  next_pass_no int not null default 1
);
alter table public.front_office_settings enable row level security;
drop policy if exists "read" on public.front_office_settings;
create policy "read" on public.front_office_settings for select to authenticated using (public.has_perm(school_id, 'frontdesk.visitors.view'));

-- ───────────── Visitors ─────────────
create table if not exists public.visitors (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  pass_no         text not null,
  name            text not null check (length(btrim(name)) between 1 and 80),
  phone           text,
  purpose         text not null default 'meeting' check (purpose in ('meeting', 'admission', 'parent', 'vendor', 'official', 'interview', 'delivery', 'other')),
  to_meet         text,
  student_id      uuid references public.students(id) on delete set null,
  organisation    text,
  id_proof        text,
  people          int not null default 1 check (people between 1 and 50),
  vehicle_no      text,
  note            text,
  in_at           timestamptz not null default now(),
  out_at          timestamptz,
  created_by_name text,
  unique (school_id, pass_no),
  check (out_at is null or out_at >= in_at)
);
create index if not exists visitors_day on public.visitors (school_id, in_at desc);
create index if not exists visitors_inside on public.visitors (school_id) where out_at is null;

-- ───────────── Calls ─────────────
create table if not exists public.phone_calls (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  direction       text not null default 'incoming' check (direction in ('incoming', 'outgoing')),
  name            text,
  phone           text,
  purpose         text not null default 'enquiry' check (purpose in ('enquiry', 'complaint', 'fees', 'leave', 'transport', 'staff', 'other')),
  summary         text,
  student_id      uuid references public.students(id) on delete set null,
  call_at         timestamptz not null default now(),
  follow_up_on    date,
  followed_up_at  timestamptz,
  handled_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists phone_calls_day on public.phone_calls (school_id, call_at desc);
create index if not exists phone_calls_followup on public.phone_calls (school_id, follow_up_on) where follow_up_on is not null and followed_up_at is null;

-- ───────────── Postal register ─────────────
create table if not exists public.postal_items (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  direction       text not null check (direction in ('received', 'dispatched')),
  on_date         date not null default (now() at time zone 'Asia/Kolkata')::date,
  mode            text not null default 'post' check (mode in ('post', 'speed_post', 'courier', 'hand', 'other')),
  party           text not null check (length(btrim(party)) > 0),
  reference_no    text,
  subject         text,
  to_whom         text,
  note            text,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists postal_day on public.postal_items (school_id, on_date desc);

-- ───────────── Student gate pass (early leave) ─────────────
create table if not exists public.gate_passes (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  pass_no          text not null,
  student_id       uuid not null references public.students(id) on delete cascade,
  reason           text not null check (length(btrim(reason)) > 0),
  leave_on         date not null default (now() at time zone 'Asia/Kolkata')::date,
  pickup_name      text not null,
  pickup_relation  text,
  pickup_phone     text,
  status           text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'completed', 'cancelled')),
  requested_by_name text,
  decided_by_name  text,
  decided_at       timestamptz,
  decision_note    text,
  out_at           timestamptz,
  created_at       timestamptz not null default now(),
  unique (school_id, pass_no)
);
create index if not exists gate_passes_day on public.gate_passes (school_id, leave_on desc, status);

alter table public.visitors enable row level security;
alter table public.phone_calls enable row level security;
alter table public.postal_items enable row level security;
alter table public.gate_passes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['visitors', 'phone_calls', 'postal_items'] loop
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('create policy "read" on public.%I for select to authenticated using (public.has_perm_school(school_id, ''frontdesk.visitors.view''))', t);
    execute format('drop policy if exists "create" on public.%I', t);
    execute format('create policy "create" on public.%I for insert to authenticated with check (public.has_perm_school(school_id, ''frontdesk.visitors.create''))', t);
    execute format('drop policy if exists "edit" on public.%I', t);
    execute format('create policy "edit" on public.%I for update to authenticated using (public.has_perm_school(school_id, ''frontdesk.visitors.edit'')) with check (public.has_perm_school(school_id, ''frontdesk.visitors.edit''))', t);
    execute format('drop policy if exists "delete" on public.%I', t);
    execute format('create policy "delete" on public.%I for delete to authenticated using (public.has_perm_school(school_id, ''frontdesk.visitors.delete''))', t);
  end loop;
end $$;
drop policy if exists "read" on public.gate_passes;
create policy "read" on public.gate_passes for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.visitors.view'));
-- gate passes are written by the functions below

-- ───────────── Numbers ─────────────
create or replace function public._fo_number(sid uuid, what text) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.front_office_settings (school_id) values (sid) on conflict do nothing;
  if what = 'visitor' then
    update public.front_office_settings set next_visitor_no = next_visitor_no + 1 where school_id = sid returning next_visitor_no - 1 into n;
    return 'V-' || to_char((now() at time zone 'Asia/Kolkata'), 'YYMM') || '-' || lpad(n::text, 4, '0');
  end if;
  update public.front_office_settings set next_pass_no = next_pass_no + 1 where school_id = sid returning next_pass_no - 1 into n;
  return 'GP-' || to_char((now() at time zone 'Asia/Kolkata'), 'YYMM') || '-' || lpad(n::text, 4, '0');
end $$;
revoke execute on function public._fo_number(uuid, text) from public, anon, authenticated;

-- ───────────── Visitors ─────────────
create or replace function public.visitor_checkin(sid uuid, p_name text, p_phone text, p_purpose text, p_to_meet text, p_student uuid, p_org text,
                                                  p_id_proof text, p_people int, p_vehicle text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid; me text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'frontdesk.visitors.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the visitor''s name.'; end if;
  if p_phone is not null and btrim(p_phone) <> '' and btrim(p_phone) !~ '^[0-9+() -]{6,20}$' then raise exception 'That phone number does not look right.'; end if;
  if p_student is not null and not exists (select 1 from public.students where id = p_student and school_id = sid) then raise exception 'Student not found.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  insert into public.visitors (school_id, pass_no, name, phone, purpose, to_meet, student_id, organisation, id_proof, people, vehicle_no, note, created_by_name)
  values (sid, public._fo_number(sid, 'visitor'), left(btrim(p_name), 80), nullif(btrim(coalesce(p_phone, '')), ''), coalesce(nullif(p_purpose, ''), 'meeting'),
          nullif(left(btrim(coalesce(p_to_meet, '')), 80), ''), p_student, nullif(left(btrim(coalesce(p_org, '')), 80), ''), nullif(left(btrim(coalesce(p_id_proof, '')), 60), ''),
          greatest(coalesce(p_people, 1), 1), nullif(left(btrim(coalesce(p_vehicle, '')), 20), ''), nullif(left(btrim(coalesce(p_note, '')), 300), ''), coalesce(me, 'User'))
  returning id into i;
  return i;
end $$;

create or replace function public.visitor_checkout(vid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.visitors;
begin
  select * into v from public.visitors where id = vid;
  if v.id is null or auth.uid() is null or not public.has_perm_school(v.school_id, 'frontdesk.visitors.create') then raise exception 'not allowed'; end if;
  if v.out_at is not null then raise exception 'This visitor has already left.'; end if;
  update public.visitors set out_at = now() where id = vid;
end $$;

create or replace function public.visitor_list(sid uuid, d1 date, d2 date, p_q text default null, p_purpose text default null, p_inside boolean default null,
                                               p_limit int default 25, p_offset int default 0)
returns table (id uuid, pass_no text, name text, phone text, purpose text, to_meet text, student_name text, organisation text, id_proof text, people int, vehicle_no text, note text,
               in_at timestamptz, out_at timestamptz, created_by_name text, total bigint)
language sql stable security definer set search_path = public as $$
  select v.id, v.pass_no, v.name, v.phone, v.purpose, v.to_meet, btrim(concat_ws(' ', s.first_name, s.last_name)), v.organisation, v.id_proof, v.people, v.vehicle_no, v.note,
         v.in_at, v.out_at, v.created_by_name, count(*) over ()
    from public.visitors v left join public.students s on s.id = v.student_id
   where v.school_id = sid and public.has_perm_school(sid, 'frontdesk.visitors.view')
     and (v.in_at at time zone 'Asia/Kolkata')::date between d1 and d2
     and (p_purpose is null or v.purpose = p_purpose)
     and (p_inside is null or (p_inside and v.out_at is null) or (not p_inside and v.out_at is not null))
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', v.name, v.phone, v.pass_no, v.to_meet, v.organisation, v.vehicle_no) ilike public.like_escape(btrim(p_q)))
   order by v.in_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── Gate pass ─────────────
create or replace function public.gate_pass_request(sid uuid, p_student uuid, p_reason text, p_pickup text, p_relation text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare st record; i uuid; me text; auto boolean;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'frontdesk.visitors.create') then raise exception 'not allowed'; end if;
  select id, status into st from public.students where id = p_student and school_id = sid;
  if st.id is null then raise exception 'Student not found.'; end if;
  if st.status <> 'active' then raise exception 'This student is not on roll.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give the reason for leaving early.'; end if;
  if coalesce(btrim(p_pickup), '') = '' then raise exception 'Name the person who will take the child.'; end if;
  if exists (select 1 from public.gate_passes where student_id = p_student and leave_on = public.today_ist() and status in ('requested', 'approved')) then
    raise exception 'There is already an open gate pass for this student today.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  auto := public.has_perm_school(sid, 'frontdesk.visitors.edit');
  insert into public.gate_passes (school_id, pass_no, student_id, reason, pickup_name, pickup_relation, pickup_phone, status, requested_by_name, decided_by_name, decided_at)
  values (sid, public._fo_number(sid, 'pass'), p_student, left(btrim(p_reason), 200), left(btrim(p_pickup), 80), nullif(left(btrim(coalesce(p_relation, '')), 40), ''),
          nullif(left(btrim(coalesce(p_phone, '')), 20), ''), case when auto then 'approved' else 'requested' end, coalesce(me, 'User'),
          case when auto then coalesce(me, 'User') end, case when auto then now() end)
  returning id into i;
  return i;
end $$;

create or replace function public.gate_pass_decide(gid uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare g public.gate_passes; me text;
begin
  select * into g from public.gate_passes where id = gid;
  if g.id is null or auth.uid() is null or not public.has_perm_school(g.school_id, 'frontdesk.visitors.edit') then raise exception 'not allowed'; end if;
  if g.status <> 'requested' then raise exception 'This pass is already %.', g.status; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Give a reason for refusing.'; end if;
  select name into me from public.school_members where school_id = g.school_id and user_id = auth.uid();
  update public.gate_passes set status = case when p_approve then 'approved' else 'rejected' end, decided_by_name = coalesce(me, 'User'), decided_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 200), '') where id = gid;
end $$;

-- the child actually leaves: records the out-time on today's attendance
create or replace function public.gate_pass_complete(gid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.gate_passes; tm time := date_trunc('second', (now() at time zone 'Asia/Kolkata'))::time;
begin
  select * into g from public.gate_passes where id = gid;
  if g.id is null or auth.uid() is null or not public.has_perm_school(g.school_id, 'frontdesk.visitors.create') then raise exception 'not allowed'; end if;
  if g.status <> 'approved' then raise exception 'Only an approved pass can be used.'; end if;
  if g.leave_on <> public.today_ist() then raise exception 'This pass was for %.', to_char(g.leave_on, 'DD Mon'); end if;
  update public.gate_passes set status = 'completed', out_at = now() where id = gid;
  update public.attendance set out_time = tm, note = coalesce(note || ' · ', '') || 'Left early (gate pass ' || g.pass_no || ')'
   where student_id = g.student_id and date = g.leave_on;
end $$;

create or replace function public.gate_pass_cancel(gid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.gate_passes;
begin
  select * into g from public.gate_passes where id = gid;
  if g.id is null or auth.uid() is null or not public.has_perm_school(g.school_id, 'frontdesk.visitors.create') then raise exception 'not allowed'; end if;
  if g.status not in ('requested', 'approved') then raise exception 'This pass is already %.', g.status; end if;
  update public.gate_passes set status = 'cancelled' where id = gid;
end $$;

-- ───────────── Calls ─────────────
create or replace function public.call_followup_done(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.phone_calls;
begin
  select * into c from public.phone_calls where id = cid;
  if c.id is null or auth.uid() is null or not public.has_perm_school(c.school_id, 'frontdesk.visitors.edit') then raise exception 'not allowed'; end if;
  update public.phone_calls set followed_up_at = now() where id = cid and followed_up_at is null;
end $$;

-- ───────────── Today at the front desk ─────────────
create or replace function public.frontdesk_today(sid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := public.today_ist();
begin
  if not (public.has_perm_school(sid, 'frontdesk.visitors.view') or public.has_perm_school(sid, 'frontdesk.enquiries.view') or public.has_perm_school(sid, 'frontdesk.admissions.view')) then
    raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'visitors_today', (select count(*) from public.visitors where school_id = sid and (in_at at time zone 'Asia/Kolkata')::date = d),
    'visitors_inside', (select count(*) from public.visitors where school_id = sid and out_at is null and (in_at at time zone 'Asia/Kolkata')::date >= d - 1),
    'calls_today', (select count(*) from public.phone_calls where school_id = sid and (call_at at time zone 'Asia/Kolkata')::date = d),
    'followups_due', (select count(*) from public.phone_calls where school_id = sid and follow_up_on <= d and followed_up_at is null),
    'passes_waiting', (select count(*) from public.gate_passes where school_id = sid and status = 'requested'),
    'passes_to_release', (select count(*) from public.gate_passes where school_id = sid and status = 'approved' and leave_on = d),
    'postal_today', (select count(*) from public.postal_items where school_id = sid and on_date = d),
    'enquiries_new', (select count(*) from public.enquiries where school_id = sid and status = 'new'),
    'applications_open', (select count(*) from public.admission_applications where school_id = sid and status not in ('admitted', 'rejected', 'cancelled'))
  );
end $$;

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['visitors', 'phone_calls', 'postal_items', 'gate_passes'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
