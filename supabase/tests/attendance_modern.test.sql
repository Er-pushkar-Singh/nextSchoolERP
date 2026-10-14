-- Modern attendance: QR / biometric devices, staff check-in, reports (step 19).
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
  ('a1a1a1a1-0000-0000-0000-000000000001', 'am-owner@test.dev'), ('a1a1a1a1-0000-0000-0000-000000000002', 'am-principal@test.dev'),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'am-teacher@test.dev'), ('a1a1a1a1-0000-0000-0000-000000000004', 'am-staff@test.dev'),
  ('a1a1a1a1-0000-0000-0000-000000000005', 'am-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('a1a1a1a1-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'a1a1a1a1-0000-0000-0000-000000000001'; pr uuid := 'a1a1a1a1-0000-0000-0000-000000000002'; te uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  sf uuid := 'a1a1a1a1-0000-0000-0000-000000000004'; ot uuid := 'a1a1a1a1-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; sec uuid; s1 uuid; s2 uuid; s3 uuid; t1 uuid; t2 uuid; dev uuid; dev2 uuid; tok text; tok2 text; j jsonb; n int; c1 text; c2 text; sfx text := substr(md5(random()::text), 1, 6);
  d date := public.today_ist(); rw record;
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Att A', 'atta-' || sfx);
  b := public.create_school('Att B', 'attb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher'), (a, sf, 'Staffer'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  select id into sec from public.sections where class_id = cls order by name limit 1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'Q1', 'Aarav', 'Sharma', cls, sec) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'Q2', 'Diya', 'Verma', cls, sec) returning id into s2;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, status) values (a, 'Q3', 'Kabir', 'Khan', cls, sec, 'left') returning id into s3;
  insert into public.staff (school_id, user_id, emp_code, name, designation) values (a, sf, 'E001', 'Meena Rao', 'Teacher') returning id into t1;
  insert into public.staff (school_id, emp_code, name) values (a, 'E002', 'Ravi Kumar') returning id into t2;
  select att_code into c1 from public.students where id = s1;
  select att_code into c2 from public.staff where id = t1;

  perform pg_temp.check(c1 ~ '^[0-9a-f]{12}$' and c2 ~ '^[0-9a-f]{12}$' and c1 <> c2, 'every student and staff member gets a private scan code');

  -- devices
  perform pg_temp.act_as(pr);
  dev := public.add_device(a, 'Main gate', 'qr_kiosk', 'Gate 1');
  dev2 := public.add_device(a, 'Staff room machine', 'biometric', null);
  select token into tok from public.attendance_devices where id = dev;
  select token into tok2 from public.attendance_devices where id = dev2;
  perform pg_temp.check(tok ~ '^[0-9a-f]{24}$', 'a device gets its own private token');
  begin perform public.add_device(a, 'Hack', 'qr_kiosk', null); perform pg_temp.act_as(te); perform public.add_device(a, 'Hack', 'qr_kiosk', null); perform pg_temp.check(false, 'teacher adds device');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot add devices'); end;
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.attendance_devices) = 0, 'another school cannot see the devices');

  -- kiosk scan
  perform pg_temp.act_as(pr);
  begin perform public.device_scan(tok, c1); perform pg_temp.check(false, 'user scan'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%' or sqlerrm like '%permission denied%', 'a signed-in user cannot use the device endpoint'); end;
  perform pg_temp.act_service();
  begin perform public.device_scan('nothex', c1); perform pg_temp.check(false, 'bad tok'); exception when others then perform pg_temp.check(sqlerrm like '%not valid%', 'a bad device token is refused'); end;
  j := public.device_scan(tok, c1, now() - interval '0 minutes');
  perform pg_temp.check((j ->> 'ok')::boolean and j ->> 'result' = 'in' and j ->> 'name' = 'Aarav Sharma', 'a QR scan marks the student present');
  perform pg_temp.check((select source from public.attendance where student_id = s1 and date = d) = 'qr', 'the record remembers it came from a QR scan');
  j := public.device_scan(tok, c1);
  perform pg_temp.check(j ->> 'result' = 'already', 'a second scan within minutes is not a new punch');
  j := public.device_scan(tok, 'Q2');
  perform pg_temp.check(j ->> 'result' = 'in' and j ->> 'name' = 'Diya Verma', 'the admission number also works as a code');
  j := public.device_scan(tok, 'Q3');
  perform pg_temp.check(not (j ->> 'ok')::boolean and j ->> 'result' = 'inactive', 'a student who has left is not marked');
  j := public.device_scan(tok, 'zzzz-unknown');
  perform pg_temp.check(not (j ->> 'ok')::boolean and j ->> 'result' = 'unknown', 'an unknown code is reported, not marked');
  j := public.device_scan(tok2, c2, null, 'in');
  perform pg_temp.check((j ->> 'ok')::boolean and j ->> 'kind' = 'staff', 'a biometric device marks staff attendance');
  perform pg_temp.check((select source from public.staff_attendance where staff_id = t1 and date = d) = 'biometric', 'staff record keeps the biometric source');
  perform pg_temp.check((select count(*) from public.attendance_punches where school_id = a) >= 5, 'every punch is logged, including unknown ones');

  -- late punch and out punch
  j := public._punch_core(a, 'student', s2, (d::timestamp + time '14:30') at time zone 'Asia/Kolkata', null, 'rfid', null, 'test');
  perform pg_temp.check(j ->> 'result' = 'out' or j ->> 'result' = 'in', 'a later punch is accepted');

  -- manual teacher scan
  perform pg_temp.act_admin();
  update public.attendance set status = 'A', in_time = null, source = 'manual' where student_id = s2 and date = d;
  perform pg_temp.act_as(pr);
  j := public.scan_attendance(a, 'Q2');
  perform pg_temp.check((j ->> 'ok')::boolean and (select status in ('P','L') from public.attendance where student_id = s2 and date = d), 'scanning turns an absent mark into present');
  perform pg_temp.act_as(ot);
  begin j := public.scan_attendance(a, 'Q1'); perform pg_temp.check(false, 'cross school ' || j::text || ' uid ' || coalesce(auth.uid()::text,'null') || ' admin ' || public.is_platform_admin()); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot scan our students: ' || sqlerrm); end;

  -- reports
  perform pg_temp.act_as(pr);
  select * into rw from public.attendance_day(a, d) limit 1;
  perform pg_temp.check(rw.strength = 2 and rw.present = 2 and rw.not_marked = 0, 'the day overview counts only active students');
  perform pg_temp.act_admin();
  insert into public.attendance (school_id, student_id, class_id, section_id, date, status) values (a, s1, cls, sec, d - 1, 'A'), (a, s1, cls, sec, d - 2, 'A');
  perform pg_temp.act_as(pr);
  select count(*) into n from public.attendance_low(a, d - 5, d, 75);
  perform pg_temp.check(n = 1, 'low attendance lists the student under the threshold');
  select count(*) into n from public.attendance_low(a, d - 5, d, 75, null, null, 'zzzz');
  perform pg_temp.check(n = 0, 'low attendance search filters in the database');

  -- staff check-in with location
  perform pg_temp.act_admin();
  update public.schools set lat = 26.8467, lng = 80.9462 where id = a;
  delete from public.staff_attendance where staff_id = t1;
  perform pg_temp.act_as(sf);
  j := public.staff_check_in(a, 26.9500, 80.9462);
  perform pg_temp.check(not (j ->> 'ok')::boolean and j ->> 'result' = 'far', 'a staff member far from the school cannot check in');
  j := public.staff_check_in(a, 26.8468, 80.9463);
  perform pg_temp.check((j ->> 'ok')::boolean and (select source from public.staff_attendance where staff_id = t1 and date = d) = 'geo', 'a staff member at the school checks in');
  perform pg_temp.act_as(ot);
  begin perform public.staff_check_in(a, 26.8468, 80.9463); perform pg_temp.check(false, 'x'); exception when others then perform pg_temp.check(sqlerrm like '%not linked%' or sqlerrm like '%not allowed%', 'someone outside the school cannot check in'); end;

  perform pg_temp.act_as(pr);
  select count(*) into n from public.staff_attendance_day(a, d);
  perform pg_temp.check(n = 2, 'the staff day list shows every active staff member');
  select count(*) into n from public.staff_attendance_month(a, d);
  perform pg_temp.check(n = 2, 'the staff month summary has one row per staff member');
  perform pg_temp.act_as(sf);
  select count(*) into n from public.staff_attendance_day(a, d);
  perform pg_temp.check(n = 0, 'a staff member without attendance permission cannot list everyone');
end $$;

rollback;
