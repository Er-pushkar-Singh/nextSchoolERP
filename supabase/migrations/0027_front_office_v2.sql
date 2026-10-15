-- ═══════════════════════════════════════════════════════════════════════════
-- Step 25: front office refinements — visitors can check themselves in by scanning the school's QR, call follow-up statuses,
--          gate pass picked up by a staff member chosen from the staff list, staff look-up for pickers.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Visitors: QR self check-in ─────────────
alter table public.visitors add column if not exists source text not null default 'manual';
alter table public.visitors drop constraint if exists visitors_source_check;
alter table public.visitors add constraint visitors_source_check check (source in ('manual', 'qr'));

alter table public.front_office_settings add column if not exists visit_token text;
update public.front_office_settings set visit_token = encode(gen_random_bytes(12), 'hex') where visit_token is null;
create unique index if not exists front_office_visit_token on public.front_office_settings (visit_token);

-- the school's visitor QR token (created on first use); only front-office staff can read it
create or replace function public.visit_token(sid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'frontdesk.visitors.view') then raise exception 'not allowed'; end if;
  insert into public.front_office_settings (school_id, visit_token) values (sid, encode(gen_random_bytes(12), 'hex')) on conflict (school_id) do nothing;
  update public.front_office_settings set visit_token = encode(gen_random_bytes(12), 'hex') where school_id = sid and visit_token is null;
  select visit_token into t from public.front_office_settings where school_id = sid;
  return t;
end $$;

create or replace function public.rotate_visit_token(sid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t text := encode(gen_random_bytes(12), 'hex');
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'frontdesk.visitors.edit') then raise exception 'not allowed'; end if;
  insert into public.front_office_settings (school_id, visit_token) values (sid, t) on conflict (school_id) do update set visit_token = excluded.visit_token;
  return t;
end $$;

-- public page: which school is this?
create or replace function public.visit_school(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select sc.name, sc.logo_url into s from public.front_office_settings f join public.schools sc on sc.id = f.school_id where f.visit_token = p_token and sc.status = 'active';
  if s.name is null then raise exception 'This visitor link is not valid.'; end if;
  return jsonb_build_object('school', s.name, 'logo', s.logo_url);
end $$;
revoke execute on function public.visit_school(text) from public, anon, authenticated;
grant execute on function public.visit_school(text) to service_role;

-- a visitor checks in from their own phone (service role only; the app server adds nothing but the token)
create or replace function public.visitor_self_checkin(p_token text, p_name text, p_phone text, p_purpose text, p_to_meet text, p_org text, p_people int, p_vehicle text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; i uuid; no text; recent int;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select school_id into f from public.front_office_settings where visit_token = p_token;
  if f.school_id is null or not exists (select 1 from public.schools where id = f.school_id and status = 'active') then raise exception 'This visitor link is not valid.'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Please enter your name.'; end if;
  if length(btrim(p_name)) > 80 then raise exception 'That name is too long.'; end if;
  if coalesce(btrim(p_phone), '') !~ '^[0-9+() -]{8,20}$' then raise exception 'Please enter a valid mobile number.'; end if;
  select count(*) into recent from public.visitors where school_id = f.school_id and source = 'qr' and in_at > now() - interval '1 hour';
  if recent >= 60 then raise exception 'Too many check-ins right now. Please ask at the front desk.'; end if;
  if exists (select 1 from public.visitors where school_id = f.school_id and source = 'qr' and phone = btrim(p_phone) and out_at is null and in_at > now() - interval '30 minutes') then
    raise exception 'You are already checked in. Please show your pass at the front desk.'; end if;
  no := public._fo_number(f.school_id, 'visitor');
  insert into public.visitors (school_id, pass_no, name, phone, purpose, to_meet, organisation, people, vehicle_no, note, source, created_by_name)
  values (f.school_id, no, left(btrim(p_name), 80), btrim(p_phone), coalesce(nullif(p_purpose, ''), 'meeting'), nullif(left(btrim(coalesce(p_to_meet, '')), 80), ''),
          nullif(left(btrim(coalesce(p_org, '')), 80), ''), least(greatest(coalesce(p_people, 1), 1), 20), nullif(left(btrim(coalesce(p_vehicle, '')), 20), ''),
          nullif(left(btrim(coalesce(p_note, '')), 300), ''), 'qr', 'Self check-in')
  returning id into i;
  return jsonb_build_object('pass_no', no, 'id', i);
end $$;
revoke execute on function public.visitor_self_checkin(text, text, text, text, text, text, int, text, text) from public, anon, authenticated;
grant execute on function public.visitor_self_checkin(text, text, text, text, text, text, int, text, text) to service_role;

-- edit a visit (front desk): everything but the pass number and the in-time
create or replace function public.visitor_update(vid uuid, p_name text, p_phone text, p_purpose text, p_to_meet text, p_org text, p_people int, p_vehicle text, p_id_proof text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.visitors;
begin
  select * into v from public.visitors where id = vid;
  if v.id is null or auth.uid() is null or not public.has_perm_school(v.school_id, 'frontdesk.visitors.edit') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the visitor''s name.'; end if;
  if p_purpose not in ('meeting', 'admission', 'parent', 'vendor', 'official', 'interview', 'delivery', 'other') then raise exception 'Unknown purpose.'; end if;
  update public.visitors set name = left(btrim(p_name), 80), phone = nullif(btrim(coalesce(p_phone, '')), ''), purpose = p_purpose, to_meet = nullif(left(btrim(coalesce(p_to_meet, '')), 80), ''),
         organisation = nullif(left(btrim(coalesce(p_org, '')), 80), ''), people = least(greatest(coalesce(p_people, 1), 1), 50), vehicle_no = nullif(left(btrim(coalesce(p_vehicle, '')), 20), ''),
         id_proof = nullif(left(btrim(coalesce(p_id_proof, '')), 60), ''), note = nullif(left(btrim(coalesce(p_note, '')), 300), '')
   where id = vid;
end $$;

-- the list now also reports where the visit came from and the id (for edit / delete)
drop function if exists public.visitor_list(uuid, date, date, text, text, boolean, int, int);
create or replace function public.visitor_list(sid uuid, d1 date, d2 date, p_q text default null, p_purpose text default null, p_inside boolean default null,
                                               p_limit int default 25, p_offset int default 0, p_source text default null)
returns table (id uuid, pass_no text, name text, phone text, purpose text, to_meet text, student_name text, organisation text, id_proof text, people int, vehicle_no text, note text,
               in_at timestamptz, out_at timestamptz, created_by_name text, source text, total bigint)
language sql stable security definer set search_path = public as $$
  select v.id, v.pass_no, v.name, v.phone, v.purpose, v.to_meet, btrim(concat_ws(' ', s.first_name, s.last_name)), v.organisation, v.id_proof, v.people, v.vehicle_no, v.note,
         v.in_at, v.out_at, v.created_by_name, v.source, count(*) over ()
    from public.visitors v left join public.students s on s.id = v.student_id
   where v.school_id = sid and public.has_perm_school(sid, 'frontdesk.visitors.view')
     and (v.in_at at time zone 'Asia/Kolkata')::date between d1 and d2
     and (p_purpose is null or v.purpose = p_purpose) and (p_source is null or v.source = p_source)
     and (p_inside is null or (p_inside and v.out_at is null) or (not p_inside and v.out_at is not null))
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', v.name, v.phone, v.pass_no, v.to_meet, v.organisation, v.vehicle_no) ilike public.like_escape(btrim(p_q)))
   order by v.in_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── Calls: follow-up status ─────────────
alter table public.phone_calls add column if not exists follow_status text not null default 'pending';
alter table public.phone_calls drop constraint if exists phone_calls_follow_status_check;
alter table public.phone_calls add constraint phone_calls_follow_status_check check (follow_status in ('pending', 'done', 'no_answer', 'rescheduled', 'dropped'));
alter table public.phone_calls add column if not exists follow_note text;
update public.phone_calls set follow_status = 'done' where followed_up_at is not null and follow_status = 'pending';

create or replace function public.call_set_followup(cid uuid, p_status text, p_next date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c public.phone_calls;
begin
  select * into c from public.phone_calls where id = cid;
  if c.id is null or auth.uid() is null or not public.has_perm_school(c.school_id, 'frontdesk.visitors.edit') then raise exception 'not allowed'; end if;
  if p_status not in ('pending', 'done', 'no_answer', 'rescheduled', 'dropped') then raise exception 'Unknown status.'; end if;
  if p_status in ('rescheduled', 'no_answer') and p_next is null then raise exception 'Choose the next follow-up date.'; end if;
  if p_next is not null and p_next < public.today_ist() - 1 then raise exception 'The next follow-up date cannot be in the past.'; end if;
  update public.phone_calls set follow_status = case when p_status in ('rescheduled', 'no_answer') then 'pending' else p_status end,
         follow_up_on = case when p_status in ('done', 'dropped') then follow_up_on else p_next end,
         followed_up_at = case when p_status in ('done', 'dropped') then now() else null end,
         follow_note = nullif(left(btrim(coalesce(p_note, '')), 200), '')
   where id = cid;
end $$;

-- the old "mark done" keeps working
create or replace function public.call_followup_done(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.call_set_followup(cid, 'done', null, null);
end $$;

-- ───────────── Gate pass: pick-up by staff ─────────────
alter table public.gate_passes add column if not exists pickup_staff_id uuid references public.staff(id) on delete set null;

drop function if exists public.gate_pass_request(uuid, uuid, text, text, text, text);
create or replace function public.gate_pass_request(sid uuid, p_student uuid, p_reason text, p_pickup text, p_relation text, p_phone text, p_pickup_staff uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare st record; i uuid; me text; auto boolean; stf record; pname text; prel text; pphone text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'frontdesk.visitors.create') then raise exception 'not allowed'; end if;
  select id, status into st from public.students where id = p_student and school_id = sid;
  if st.id is null then raise exception 'Student not found.'; end if;
  if st.status <> 'active' then raise exception 'This student is not on roll.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give the reason for leaving early.'; end if;
  if p_pickup_staff is not null then
    select id, name, phone, designation into stf from public.staff where id = p_pickup_staff and school_id = sid and status = 'active';
    if stf.id is null then raise exception 'Choose a working staff member.'; end if;
    pname := stf.name; prel := coalesce(stf.designation, 'Staff'); pphone := stf.phone;
  else
    if coalesce(btrim(p_pickup), '') = '' then raise exception 'Name the person who will take the child.'; end if;
    pname := left(btrim(p_pickup), 80); prel := nullif(left(btrim(coalesce(p_relation, '')), 40), ''); pphone := nullif(left(btrim(coalesce(p_phone, '')), 20), '');
  end if;
  if exists (select 1 from public.gate_passes where student_id = p_student and leave_on = public.today_ist() and status in ('requested', 'approved')) then
    raise exception 'There is already an open gate pass for this student today.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  auto := public.has_perm_school(sid, 'frontdesk.visitors.edit');
  insert into public.gate_passes (school_id, pass_no, student_id, reason, pickup_name, pickup_relation, pickup_phone, pickup_staff_id, status, requested_by_name, decided_by_name, decided_at)
  values (sid, public._fo_number(sid, 'pass'), p_student, left(btrim(p_reason), 200), pname, prel, pphone, p_pickup_staff, case when auto then 'approved' else 'requested' end,
          coalesce(me, 'User'), case when auto then coalesce(me, 'User') end, case when auto then now() end)
  returning id into i;
  return i;
end $$;

-- ───────────── Staff look-up for pickers ─────────────
create or replace function public.staff_lookup(sid uuid, p_q text) returns table (id uuid, name text, designation text, emp_code text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.designation, s.emp_code
    from public.staff s
   where s.school_id = sid and s.status = 'active'
     and (public.has_perm(sid, 'hr.staff.view') or public.has_perm(sid, 'frontdesk.visitors.view') or public.has_perm(sid, 'academics.timetable.view'))
     and concat_ws(' ', s.name, s.emp_code, s.designation) ilike public.like_escape(btrim(coalesce(p_q, '')))
   order by s.name limit 10;
$$;
