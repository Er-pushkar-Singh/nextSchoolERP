-- Transport live tracking + list functions (step 18).
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create or replace function pg_temp.act_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email) values
  ('f0f0f0f0-0000-0000-0000-000000000001', 'tl-owner@test.dev'), ('f0f0f0f0-0000-0000-0000-000000000002', 'tl-principal@test.dev'),
  ('f0f0f0f0-0000-0000-0000-000000000003', 'tl-transport@test.dev'), ('f0f0f0f0-0000-0000-0000-000000000004', 'tl-teacher@test.dev'),
  ('f0f0f0f0-0000-0000-0000-000000000005', 'tl-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('f0f0f0f0-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'f0f0f0f0-0000-0000-0000-000000000001'; pr uuid := 'f0f0f0f0-0000-0000-0000-000000000002'; tm uuid := 'f0f0f0f0-0000-0000-0000-000000000003';
  te uuid := 'f0f0f0f0-0000-0000-0000-000000000004'; ot uuid := 'f0f0f0f0-0000-0000-0000-000000000005';
  a uuid; b uuid; sess uuid; cls uuid; v1 uuid; v2 uuid; r1 uuid; st1 uuid; st2 uuid; s1 uuid; s2 uuid; s3 uuid; tok text; tok2 text; j jsonb; n int; trip uuid;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Bus A', 'busa-' || sfx);
  b := public.create_school('Bus B', 'busb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, tm, 'Transport'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (tm, 'transport_manager'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into sess from public.sessions where school_id = a and is_current;
  select id into cls from public.classes where school_id = a and name = '5';
  insert into public.transport_vehicles (school_id, reg_no, kind, capacity, driver_name, driver_phone, insurance_upto) values (a, 'UP32 AB 1234', 'bus', 40, 'Ramesh', '9811100001', current_date + 5) returning id, track_token into v1, tok;
  insert into public.transport_vehicles (school_id, reg_no, kind, capacity, driver_name, active) values (a, 'UP32 CD 5678', 'van', 12, 'Suresh', true) returning id, track_token into v2, tok2;
  insert into public.transport_routes (school_id, name, vehicle_id) values (a, 'Route 1 — Aliganj', v1) returning id into r1;
  insert into public.transport_stops (school_id, route_id, name, sort, pickup_time, monthly_fee, lat, lng) values (a, r1, 'Kapoorthala', 1, '07:10', 900, 26.8800, 80.9400) returning id into st1;
  insert into public.transport_stops (school_id, route_id, name, sort, pickup_time, monthly_fee, lat, lng) values (a, r1, 'Aliganj', 2, '07:25', 900, 26.8900, 80.9500) returning id into st2;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, guardian_phone) values (a, 'B1', 'Aarav', 'Sharma', cls, '9811100011') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, guardian_phone) values (a, 'B2', 'Diya', 'Verma', cls, '9811100012') returning id into s2;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (a, 'B3', 'Kabir', 'Khan', cls) returning id into s3;
  insert into public.transport_allocations (school_id, session_id, student_id, route_id, stop_id, trip) values (a, sess, s1, r1, st1, 'both'), (a, sess, s2, r1, st2, 'pickup');

  -- tokens
  perform pg_temp.check(tok ~ '^[0-9a-f]{24}$' and tok2 ~ '^[0-9a-f]{24}$' and tok <> tok2, 'every vehicle has its own private driver token');

  -- driver side: service role only
  perform pg_temp.act_as(tm);
  begin perform public.driver_start_trip(tok, 'pickup'); perform pg_temp.check(false, 'user start'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%' or sqlerrm like '%permission denied%', 'a signed-in user cannot drive a trip through the driver functions'); end;
  perform pg_temp.act_service();
  begin perform public.driver_ping('deadbeef', 26.88, 80.94); perform pg_temp.check(false, 'bad token'); exception when others then perform pg_temp.check(sqlerrm like '%not valid%', 'a wrong token is refused'); end;
  begin perform public.driver_ping(tok, 26.88, 80.94); perform pg_temp.check(false, 'no trip'); exception when others then perform pg_temp.check(sqlerrm like '%Start the trip%', 'a ping before the trip starts is refused'); end;
  j := public.driver_start_trip(tok, 'pickup');
  trip := (j ->> 'trip_id')::uuid;
  perform pg_temp.check(trip is not null, 'the driver starts a pickup trip');
  begin perform public.driver_ping(tok, 123, 80.94); perform pg_temp.check(false, 'bad lat'); exception when others then perform pg_temp.check(sqlerrm like '%Invalid location%', 'an impossible location is refused'); end;

  -- parent: bus has not moved yet
  j := public.child_bus(s1);
  perform pg_temp.check(j ->> 'state' = 'starting' and (j ->> 'allocated')::boolean, 'a parent sees "starting" before the first position');
  perform pg_temp.check(j -> 'vehicle' ->> 'reg_no' = 'UP32 AB 1234' and j -> 'vehicle' ->> 'phone' = '9811100001', 'the parent gets the vehicle and the driver''s phone');

  -- first positions: far from the stop
  perform public.driver_ping(tok, 26.9200, 80.9800, 30, 90, 8);
  j := public.child_bus(s1);
  perform pg_temp.check(j ->> 'state' = 'on_the_way' and (j ->> 'eta_min')::int > 0 and (j ->> 'distance_km')::numeric > 1, 'bus on the way: distance and ETA are given');
  perform pg_temp.check(public.child_bus(s3) ->> 'allocated' = 'false', 'a student without transport has no bus');

  -- near and reached
  perform pg_temp.act_admin();
  update public.transport_vehicle_position set updated_at = now() - interval '3 seconds' where vehicle_id = v1;
  perform pg_temp.act_service();
  perform public.driver_ping(tok, 26.8860, 80.9400, 12, 180, 5);
  j := public.child_bus(s1);
  perform pg_temp.check(j ->> 'state' = 'near', 'within a kilometre the state is "near"');
  perform pg_temp.act_admin();
  update public.transport_vehicle_position set updated_at = now() - interval '3 seconds' where vehicle_id = v1;
  update public.transport_position_log set at = at - interval '30 seconds' where trip_id = trip;
  perform pg_temp.act_service();
  perform public.driver_ping(tok, 26.8801, 80.9401, 3, 180, 5);
  j := public.child_bus(s1);
  perform pg_temp.check(j ->> 'state' = 'reached', 'at the stop the state is "reached"');
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(j -> 'stops') x where (x ->> 'mine')::boolean and (x ->> 'visited')::boolean), 'the stop the bus has visited is ticked');
  perform pg_temp.act_admin();
  update public.transport_vehicle_position set updated_at = now() where vehicle_id = v1;
  perform pg_temp.act_service();
  -- throttling
  perform pg_temp.check((public.driver_ping(tok, 26.8802, 80.9402) ->> 'skipped')::boolean, 'pings faster than every 2 seconds are skipped');

  -- office
  perform pg_temp.act_as(tm);
  perform pg_temp.check((select count(*) = 2 from public.live_vehicles(a)), 'the transport manager sees both vehicles');
  perform pg_temp.check((select state = 'moving' or state = 'stopped' from public.live_vehicles(a) where vehicle_id = v1), 'the running vehicle has a live state');
  perform pg_temp.check((select state = 'idle' and riders = 0 from public.live_vehicles(a) where vehicle_id = v2), 'a vehicle without a trip is idle');
  perform pg_temp.check((select riders = 2 from public.live_vehicles(a) where vehicle_id = v1), 'riders on the route are counted');
  perform pg_temp.check((select count(*) >= 1 from public.trip_trace(trip)), 'the trace of the trip is available');
  perform pg_temp.check((select count(*) = 1 and min(total) = 1 from public.trip_history(a)), 'trip history lists the trip');
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) = 0 from public.live_vehicles(a)), 'a teacher cannot see the live map');
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) = 0 from public.live_vehicles(a)), 'another school cannot see our vehicles');
  perform pg_temp.check((select count(*) = 0 from public.trip_trace(trip)), 'another school cannot read our trace');

  -- end of trip
  perform pg_temp.act_service();
  perform public.driver_end_trip(tok);
  j := public.child_bus(s1);
  perform pg_temp.check(j ->> 'state' = 'not_started' and j -> 'position' = 'null'::jsonb, 'after the trip ends the parent sees no live position');

  -- token rotation
  perform pg_temp.act_as(te);
  begin perform public.rotate_driver_token(v1); perform pg_temp.check(false, 'teacher rotate'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a teacher cannot rotate a driver link'); end;
  perform pg_temp.act_as(tm);
  perform pg_temp.check(public.rotate_driver_token(v1) <> tok, 'the transport manager rotates the driver link');
  perform pg_temp.act_service();
  begin perform public.driver_start_trip(tok, 'pickup'); perform pg_temp.check(false, 'old token'); exception when others then perform pg_temp.check(sqlerrm like '%not valid%', 'the old link stops working'); end;

  -- riders: filters, search, pages, totals
  perform pg_temp.act_as(tm);
  perform pg_temp.check((select count(*) = 2 and min(total) = 2 and min(monthly_total) = 1800 from public.transport_riders(a, sess)), 'two riders; monthly total 1800');
  perform pg_temp.check((select count(*) = 1 and min(student_name) = 'Aarav Sharma' from public.transport_riders(a, sess, 'aarav')), 'search by name');
  perform pg_temp.check((select count(*) = 1 from public.transport_riders(a, sess, null, null, st2)), 'filter by stop');
  perform pg_temp.check((select count(*) = 1 from public.transport_riders(a, sess, null, null, null, null, 'pickup')), 'filter by trip type');
  perform pg_temp.check((select count(*) = 1 and min(total) = 2 from public.transport_riders(a, sess, null, null, null, null, null, false, 'route', 1, 0)), 'pages: one row, total two');
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) = 0 from public.transport_riders(a, sess)), 'a teacher sees no riders');

  -- vehicles list
  perform pg_temp.act_as(tm);
  perform pg_temp.check((select count(*) = 2 from public.vehicle_list(a)), 'vehicle list');
  perform pg_temp.check((select count(*) = 1 and min(reg_no) = 'UP32 AB 1234' from public.vehicle_list(a, null, null, 'yes', 'due')), 'filter vehicles with papers due in 30 days');
  perform pg_temp.check((select count(*) = 1 from public.vehicle_list(a, 'suresh')), 'search by driver');
  perform pg_temp.check((select track_token is not null from public.vehicle_list(a) limit 1), 'the transport manager sees the driver link');
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) = 0 from public.vehicle_list(a)), 'a teacher sees no vehicles');
end $$;

rollback;
