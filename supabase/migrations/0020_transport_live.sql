-- ═══════════════════════════════════════════════════════════════════════════
-- Step 18: transport — live bus tracking (driver phone → map for parents and the office), stop locations,
--          trips, position history, and database-side list functions (search / filter / pages).
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Locations ─────────────
alter table public.transport_stops add column if not exists lat numeric(9,6);
alter table public.transport_stops add column if not exists lng numeric(9,6);
alter table public.transport_stops drop constraint if exists transport_stops_geo_check;
alter table public.transport_stops add constraint transport_stops_geo_check
  check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180));

alter table public.schools add column if not exists lat numeric(9,6);
alter table public.schools add column if not exists lng numeric(9,6);

-- the driver's private link: /drive/<token>
alter table public.transport_vehicles add column if not exists track_token text;
update public.transport_vehicles set track_token = encode(gen_random_bytes(12), 'hex') where track_token is null;
alter table public.transport_vehicles alter column track_token set default encode(gen_random_bytes(12), 'hex');
create unique index if not exists transport_vehicles_token on public.transport_vehicles (track_token);

-- ───────────── Trips and positions ─────────────
create table if not exists public.transport_trips (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  vehicle_id  uuid not null references public.transport_vehicles(id) on delete cascade,
  route_id    uuid references public.transport_routes(id) on delete set null,
  kind        text not null default 'pickup' check (kind in ('pickup', 'drop')),
  status      text not null default 'running' check (status in ('running', 'ended')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists transport_trips_vehicle_idx on public.transport_trips (vehicle_id, started_at desc);
create unique index if not exists transport_trips_one_running on public.transport_trips (vehicle_id) where status = 'running';

create table if not exists public.transport_vehicle_position (
  vehicle_id  uuid primary key references public.transport_vehicles(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  trip_id     uuid references public.transport_trips(id) on delete set null,
  lat         numeric(9,6) not null check (lat between -90 and 90),
  lng         numeric(9,6) not null check (lng between -180 and 180),
  speed_kmh   numeric(6,1) check (speed_kmh is null or speed_kmh between 0 and 250),
  heading     numeric(5,1) check (heading is null or heading between 0 and 360),
  accuracy_m  numeric(8,1),
  updated_at  timestamptz not null default now()
);

create table if not exists public.transport_position_log (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references public.schools(id) on delete cascade,
  trip_id     uuid not null references public.transport_trips(id) on delete cascade,
  lat         numeric(9,6) not null,
  lng         numeric(9,6) not null,
  speed_kmh   numeric(6,1),
  at          timestamptz not null default now()
);
create index if not exists transport_position_log_trip_idx on public.transport_position_log (trip_id, at);

alter table public.transport_trips enable row level security;
alter table public.transport_vehicle_position enable row level security;
alter table public.transport_position_log enable row level security;
drop policy if exists "read" on public.transport_trips;
create policy "read" on public.transport_trips for select to authenticated using (public.has_perm_school(school_id, 'transport.tracking.view'));
drop policy if exists "read" on public.transport_vehicle_position;
create policy "read" on public.transport_vehicle_position for select to authenticated using (public.has_perm_school(school_id, 'transport.tracking.view'));
drop policy if exists "read" on public.transport_position_log;
create policy "read" on public.transport_position_log for select to authenticated using (public.has_perm_school(school_id, 'transport.tracking.view'));
-- written only by the driver functions below

-- ───────────── Geometry ─────────────
create or replace function public.geo_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable as $$
  select (2 * 6371 * asin(least(1, sqrt(
    power(sin(radians((lat2 - lat1) / 2)), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lng2 - lng1) / 2)), 2)))))::numeric;
$$;

-- ───────────── Driver side (called by the app server only, with the vehicle's private token) ─────────────
create or replace function public._vehicle_by_token(p_token text) returns public.transport_vehicles
language plpgsql stable security definer set search_path = public as $$
declare v public.transport_vehicles;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{24}$' then raise exception 'This driver link is not valid.'; end if;
  select * into v from public.transport_vehicles where track_token = p_token and active;
  if v.id is null then raise exception 'This driver link is not valid or the vehicle is switched off.'; end if;
  return v;
end $$;
revoke execute on function public._vehicle_by_token(text) from public, anon, authenticated;

create or replace function public.driver_status(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.transport_vehicles; t record; p record; r record;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  v := public._vehicle_by_token(p_token);
  select * into t from public.transport_trips where vehicle_id = v.id and status = 'running';
  select * into p from public.transport_vehicle_position where vehicle_id = v.id;
  select r2.name, r2.id into r from public.transport_routes r2 where r2.vehicle_id = v.id and r2.active order by r2.name limit 1;
  return jsonb_build_object('vehicle', v.reg_no, 'driver', v.driver_name, 'route', r.name, 'route_id', r.id,
    'trip', case when t.id is null then null else jsonb_build_object('id', t.id, 'kind', t.kind, 'started_at', t.started_at) end,
    'last_ping', p.updated_at, 'school', (select name from public.schools where id = v.school_id));
end $$;
revoke execute on function public.driver_status(text) from public, anon, authenticated;
grant execute on function public.driver_status(text) to service_role;

create or replace function public.driver_start_trip(p_token text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.transport_vehicles; rid uuid; tid uuid;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  if p_kind not in ('pickup', 'drop') then raise exception 'Choose pickup or drop.'; end if;
  v := public._vehicle_by_token(p_token);
  select id into rid from public.transport_routes where vehicle_id = v.id and active order by name limit 1;
  update public.transport_trips set status = 'ended', ended_at = now() where vehicle_id = v.id and status = 'running';
  insert into public.transport_trips (school_id, vehicle_id, route_id, kind) values (v.school_id, v.id, rid, p_kind) returning id into tid;
  -- old position from a previous trip must not look live
  delete from public.transport_vehicle_position where vehicle_id = v.id;
  return jsonb_build_object('trip_id', tid, 'kind', p_kind);
end $$;
revoke execute on function public.driver_start_trip(text, text) from public, anon, authenticated;
grant execute on function public.driver_start_trip(text, text) to service_role;

create or replace function public.driver_ping(p_token text, p_lat numeric, p_lng numeric, p_speed numeric default null, p_heading numeric default null, p_accuracy numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.transport_vehicles; t record; last_at timestamptz; last_log timestamptz;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location.'; end if;
  v := public._vehicle_by_token(p_token);
  select * into t from public.transport_trips where vehicle_id = v.id and status = 'running';
  if t.id is null then raise exception 'Start the trip first.'; end if;
  select updated_at into last_at from public.transport_vehicle_position where vehicle_id = v.id;
  if last_at is not null and last_at > now() - interval '2 seconds' then return jsonb_build_object('ok', true, 'skipped', true); end if;
  insert into public.transport_vehicle_position (vehicle_id, school_id, trip_id, lat, lng, speed_kmh, heading, accuracy_m, updated_at)
  values (v.id, v.school_id, t.id, round(p_lat, 6), round(p_lng, 6), least(greatest(coalesce(p_speed, 0), 0), 250), p_heading, p_accuracy, now())
  on conflict (vehicle_id) do update set trip_id = excluded.trip_id, lat = excluded.lat, lng = excluded.lng, speed_kmh = excluded.speed_kmh,
        heading = excluded.heading, accuracy_m = excluded.accuracy_m, updated_at = excluded.updated_at;
  select max(at) into last_log from public.transport_position_log where trip_id = t.id;
  if last_log is null or last_log < now() - interval '8 seconds' then
    insert into public.transport_position_log (school_id, trip_id, lat, lng, speed_kmh) values (v.school_id, t.id, round(p_lat, 6), round(p_lng, 6), p_speed);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.driver_ping(text, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.driver_ping(text, numeric, numeric, numeric, numeric, numeric) to service_role;

create or replace function public.driver_end_trip(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.transport_vehicles;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  v := public._vehicle_by_token(p_token);
  update public.transport_trips set status = 'ended', ended_at = now() where vehicle_id = v.id and status = 'running';
  delete from public.transport_vehicle_position where vehicle_id = v.id;
  -- history older than 45 days is dropped
  delete from public.transport_position_log where school_id = v.school_id and at < now() - interval '45 days';
end $$;
revoke execute on function public.driver_end_trip(text) from public, anon, authenticated;
grant execute on function public.driver_end_trip(text) to service_role;

create or replace function public.rotate_driver_token(vid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v record; t text;
begin
  select * into v from public.transport_vehicles where id = vid;
  if v.id is null or not public.has_perm_school(v.school_id, 'transport.routes.edit') then raise exception 'not allowed'; end if;
  t := encode(gen_random_bytes(12), 'hex');
  update public.transport_vehicles set track_token = t where id = vid;
  update public.transport_trips set status = 'ended', ended_at = now() where vehicle_id = vid and status = 'running';
  delete from public.transport_vehicle_position where vehicle_id = vid;
  return t;
end $$;

create or replace function public.set_school_location(sid uuid, p_lat numeric, p_lng numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'transport.routes.edit') then raise exception 'not allowed'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location.'; end if;
  update public.schools set lat = round(p_lat, 6), lng = round(p_lng, 6) where id = sid;
end $$;

-- ───────────── Office side ─────────────
-- every vehicle with its route, its trip and its last position (fresh = a ping in the last 60 seconds)
create or replace function public.live_vehicles(sid uuid)
returns table (vehicle_id uuid, reg_no text, kind text, driver_name text, driver_phone text, route_id uuid, route_name text, trip_id uuid, trip_kind text, trip_started timestamptz,
               lat numeric, lng numeric, speed_kmh numeric, heading numeric, updated_at timestamptz, age_s int, state text, riders bigint)
language sql stable security definer set search_path = public as $$
  select v.id, v.reg_no, v.kind, v.driver_name, v.driver_phone, r.id, r.name, t.id, t.kind, t.started_at,
         p.lat, p.lng, p.speed_kmh, p.heading, p.updated_at, extract(epoch from now() - p.updated_at)::int,
         case when t.id is null then 'idle' when p.updated_at is null then 'waiting' when p.updated_at < now() - interval '90 seconds' then 'offline'
              when coalesce(p.speed_kmh, 0) < 2 then 'stopped' else 'moving' end,
         (select count(*) from public.transport_allocations a where a.route_id = r.id and a.end_date is null)
    from public.transport_vehicles v
    left join lateral (select * from public.transport_routes rr where rr.vehicle_id = v.id and rr.active order by rr.name limit 1) r on true
    left join public.transport_trips t on t.vehicle_id = v.id and t.status = 'running'
    left join public.transport_vehicle_position p on p.vehicle_id = v.id and p.trip_id = t.id
   where v.school_id = sid and v.active and public.has_perm_school(sid, 'transport.tracking.view')
   order by (t.id is not null) desc, v.reg_no;
$$;

create or replace function public.trip_trace(p_trip uuid) returns table (lat numeric, lng numeric, at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.lat, l.lng, l.at from public.transport_position_log l join public.transport_trips t on t.id = l.trip_id
   where l.trip_id = p_trip and public.has_perm_school(t.school_id, 'transport.tracking.view') order by l.at limit 3000;
$$;

-- recent trips of the school (history screen)
create or replace function public.trip_history(sid uuid, p_vehicle uuid default null, p_limit int default 25, p_offset int default 0)
returns table (trip_id uuid, vehicle_id uuid, reg_no text, route_name text, kind text, started_at timestamptz, ended_at timestamptz, minutes int, points bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select t.id, v.id, v.reg_no, r.name, t.kind, t.started_at, t.ended_at,
         (extract(epoch from coalesce(t.ended_at, now()) - t.started_at) / 60)::int,
         (select count(*) from public.transport_position_log l where l.trip_id = t.id), count(*) over ()
    from public.transport_trips t join public.transport_vehicles v on v.id = t.vehicle_id left join public.transport_routes r on r.id = t.route_id
   where t.school_id = sid and public.has_perm_school(sid, 'transport.tracking.view') and (p_vehicle is null or t.vehicle_id = p_vehicle)
   order by t.started_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── Parent side (called by the app server for a valid parent link) ─────────────
create or replace function public.child_bus(stu uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v record; t record; p record; st record; sc record; stops jsonb; d numeric; sp numeric; eta int; state text; stop_lat numeric; stop_lng numeric;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select al.*, r.name as route_name, r.vehicle_id, s.name as stop_name, s.lat as slat, s.lng as slng, s.pickup_time, s.drop_time, s.sort as stop_sort
    into a from public.transport_allocations al join public.transport_routes r on r.id = al.route_id join public.transport_stops s on s.id = al.stop_id
   where al.student_id = stu and al.end_date is null order by al.start_date desc limit 1;
  if a.id is null then return jsonb_build_object('allocated', false); end if;
  select * into v from public.transport_vehicles where id = a.vehicle_id;
  select * into sc from public.schools where id = a.school_id;
  select * into t from public.transport_trips where vehicle_id = a.vehicle_id and status = 'running';
  select * into p from public.transport_vehicle_position where vehicle_id = a.vehicle_id and trip_id = t.id;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'seq', s.sort, 'lat', s.lat, 'lng', s.lng, 'pickup', s.pickup_time, 'drop', s.drop_time,
           'mine', s.id = a.stop_id,
           'visited', t.id is not null and s.lat is not null and exists (select 1 from public.transport_position_log l where l.trip_id = t.id and public.geo_km(l.lat, l.lng, s.lat, s.lng) < 0.15))
           order by s.sort), '[]'::jsonb)
    into stops from public.transport_stops s where s.route_id = a.route_id;

  state := 'not_started';
  if t.id is not null then
    state := case when p.updated_at is null then 'starting' when p.updated_at < now() - interval '90 seconds' then 'offline' else 'on_the_way' end;
  end if;
  if p.lat is not null and a.slat is not null then
    d := public.geo_km(p.lat, p.lng, a.slat, a.slng);
    sp := greatest(coalesce(p.speed_kmh, 0), 18);                          -- a moving school bus; slower readings are treated as 18 km/h
    eta := ceil(d / sp * 60);
    if d < 0.15 then state := 'reached'; elsif d < 1 and state = 'on_the_way' then state := 'near'; end if;
  end if;
  return jsonb_build_object(
    'allocated', true, 'state', state, 'student_trip', a.trip,
    'vehicle', jsonb_build_object('reg_no', v.reg_no, 'driver', v.driver_name, 'phone', v.driver_phone, 'attendant', v.attendant_name, 'attendant_phone', v.attendant_phone),
    'route', a.route_name,
    'my_stop', jsonb_build_object('name', a.stop_name, 'lat', a.slat, 'lng', a.slng, 'pickup', a.pickup_time, 'drop', a.drop_time),
    'school', jsonb_build_object('name', sc.name, 'lat', sc.lat, 'lng', sc.lng),
    'trip', case when t.id is null then null else jsonb_build_object('kind', t.kind, 'started_at', t.started_at) end,
    'position', case when p.lat is null then null else jsonb_build_object('lat', p.lat, 'lng', p.lng, 'speed', p.speed_kmh, 'heading', p.heading, 'age_s', extract(epoch from now() - p.updated_at)::int) end,
    'distance_km', case when d is null then null else round(d, 2) end, 'eta_min', eta, 'stops', stops);
end $$;
revoke execute on function public.child_bus(uuid) from public, anon, authenticated;
grant execute on function public.child_bus(uuid) to service_role;

-- ───────────── Riders: search + filter + sort + count + page in the database ─────────────
create or replace function public.transport_riders(sid uuid, sess uuid, p_q text default null, p_route uuid default null, p_stop uuid default null, p_class uuid default null,
    p_trip text default null, p_ended boolean default false, p_sort text default 'route', p_limit int default 25, p_offset int default 0)
returns table (alloc_id uuid, student_id uuid, admission_no text, student_name text, class_name text, section_name text, guardian_phone text, father_name text,
               route_id uuid, route_name text, stop_id uuid, stop_name text, pickup_time time, trip text, fee numeric, start_date date, end_date date, total bigint, monthly_total numeric)
language sql stable set search_path = public as $$
  with base as (
    select al.id as aid, s.id as sid2, s.admission_no, btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)) as nm, c.name as cname, c.sort as csort, sec.name as secname,
           s.guardian_phone, s.father_name, r.id as rid, r.name as rname, st.id as stid, st.name as stname, st.pickup_time, al.trip,
           coalesce(al.monthly_fee, st.monthly_fee, 0) as fee, al.start_date, al.end_date, st.sort as stsort
      from public.transport_allocations al
      join public.students s on s.id = al.student_id
      join public.transport_routes r on r.id = al.route_id
      join public.transport_stops st on st.id = al.stop_id
      left join public.classes c on c.id = s.class_id
      left join public.sections sec on sec.id = s.section_id
     where al.school_id = sid and al.session_id = sess
       and (p_ended or al.end_date is null)
       and (p_route is null or al.route_id = p_route) and (p_stop is null or al.stop_id = p_stop) and (p_class is null or s.class_id = p_class)
       and (p_trip is null or p_trip = '' or al.trip = p_trip)
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or concat_ws(' ', s.first_name, s.middle_name, s.last_name) ilike public.like_escape(btrim(p_q)) or s.admission_no ilike public.like_escape(btrim(p_q))
            or s.guardian_phone ilike public.like_escape(btrim(p_q)) or s.father_name ilike public.like_escape(btrim(p_q)) or st.name ilike public.like_escape(btrim(p_q)))
  )
  select b.aid, b.sid2, b.admission_no, b.nm, b.cname, b.secname, b.guardian_phone, b.father_name, b.rid, b.rname, b.stid, b.stname, b.pickup_time, b.trip, b.fee, b.start_date, b.end_date,
         count(*) over (), sum(case when b.end_date is null then b.fee else 0 end) over ()
    from base b
   order by
     case when p_sort = 'name' then b.nm end asc,
     case when p_sort = 'class' then b.csort end asc nulls last,
     case when p_sort = 'fee' then b.fee end desc,
     b.rname asc, b.stsort asc, b.nm asc, b.aid
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- vehicles: papers due is computed here so it can be filtered and paged
create or replace function public.vehicle_list(sid uuid, p_q text default null, p_kind text default null, p_active text default 'yes', p_papers text default null,
    p_limit int default 25, p_offset int default 0)
returns table (id uuid, reg_no text, kind text, capacity int, driver_name text, driver_phone text, attendant_name text, active boolean, route_names text,
               insurance_upto date, fitness_upto date, permit_upto date, puc_upto date, papers_due int, track_token text, seen_at timestamptz, trip_state text, total bigint)
language sql stable security definer set search_path = public as $$
  with base as (
    select v.*, (select string_agg(r.name, ', ' order by r.name) from public.transport_routes r where r.vehicle_id = v.id) as rn,
           (select count(*) from unnest(array[v.insurance_upto, v.fitness_upto, v.permit_upto, v.puc_upto]) d where d is not null and d <= public.today_ist() + 30)::int as due,
           p.updated_at as seen, t.status as ts
      from public.transport_vehicles v
      left join public.transport_vehicle_position p on p.vehicle_id = v.id
      left join public.transport_trips t on t.vehicle_id = v.id and t.status = 'running'
     where v.school_id = sid and (public.has_perm_school(sid, 'transport.routes.view') or public.has_perm_school(sid, 'transport.allocation.view'))
       and (p_kind is null or p_kind = '' or v.kind = p_kind)
       and (p_active is null or p_active = '' or p_active = 'all' or (p_active = 'yes' and v.active) or (p_active = 'no' and not v.active))
       and (nullif(btrim(coalesce(p_q, '')), '') is null or v.reg_no ilike public.like_escape(btrim(p_q)) or v.driver_name ilike public.like_escape(btrim(p_q))
            or v.driver_phone ilike public.like_escape(btrim(p_q)) or v.attendant_name ilike public.like_escape(btrim(p_q)))
  )
  select b.id, b.reg_no, b.kind, b.capacity, b.driver_name, b.driver_phone, b.attendant_name, b.active, b.rn, b.insurance_upto, b.fitness_upto, b.permit_upto, b.puc_upto, b.due,
         case when public.has_perm_school(sid, 'transport.routes.edit') then b.track_token end, b.seen, b.ts, count(*) over ()
    from base b
   where (p_papers is null or p_papers = '' or (p_papers = 'due' and b.due > 0) or (p_papers = 'ok' and b.due = 0))
   order by b.reg_no
   limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- audit for the vehicle token rotation is covered by the audit trigger on transport_vehicles when present
