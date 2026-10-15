-- Hostel (step 32).
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email) values
  ('a3a3a3a3-0000-0000-0000-000000000001', 'ho-owner@test.dev'), ('a3a3a3a3-0000-0000-0000-000000000002', 'ho-principal@test.dev'),
  ('a3a3a3a3-0000-0000-0000-000000000003', 'ho-warden@test.dev'), ('a3a3a3a3-0000-0000-0000-000000000004', 'ho-teacher@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('a3a3a3a3-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'a3a3a3a3-0000-0000-0000-000000000001'; pr uuid := 'a3a3a3a3-0000-0000-0000-000000000002'; wd uuid := 'a3a3a3a3-0000-0000-0000-000000000003'; te uuid := 'a3a3a3a3-0000-0000-0000-000000000004';
  a uuid; cls uuid; sess uuid; hb uuid; hg uuid; r1 uuid; r2 uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; al uuid; op uuid; n int; j jsonb; rw record; d date := public.today_ist(); sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('HO A', 'hoa-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, wd, 'Warden'), (a, te, 'Teacher');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (wd, 'hostel_warden'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into cls from public.classes where school_id = a and name = '9';
  select id into sess from public.sessions where school_id = a and is_current;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, gender) values (a, 'H1', 'Aarav', 'Sharma', cls, 'M') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, gender) values (a, 'H2', 'Kabir', 'Khan', cls, 'M') returning id into s2;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, gender) values (a, 'H3', 'Diya', 'Verma', cls, 'F') returning id into s3;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, gender) values (a, 'H4', 'Rohan', 'Das', cls, 'M') returning id into s4;

  perform pg_temp.act_as(te);
  begin insert into public.hostels (school_id, name, kind) values (a, 'X', 'boys'); perform pg_temp.check(false, 'teacher hostel');
  exception when insufficient_privilege then perform pg_temp.check(true, 'a class teacher cannot create hostels'); end;

  perform pg_temp.act_as(wd);
  insert into public.hostels (school_id, name, kind) values (a, 'Gandhi House', 'boys') returning id into hb;
  insert into public.hostels (school_id, name, kind) values (a, 'Sarojini House', 'girls') returning id into hg;
  insert into public.hostel_rooms (school_id, hostel_id, room_no, floor, beds, monthly_fee) values (a, hb, '101', 1, 2, 3000) returning id into r1;
  insert into public.hostel_rooms (school_id, hostel_id, room_no, floor, beds, monthly_fee) values (a, hg, 'G1', 0, 2, 3200) returning id into r2;

  al := public.hostel_allocate(a, s1, r1, 1);
  perform public.hostel_allocate(a, s2, r1, 2, null, 2500);
  begin perform public.hostel_allocate(a, s4, r1, 1); perform pg_temp.check(false, 'full');
  exception when others then perform pg_temp.check(sqlerrm like '%full%', 'a full room takes no more students'); end;
  begin perform public.hostel_allocate(a, s3, r1, 1); perform pg_temp.check(false, 'gender');
  exception when others then perform pg_temp.check(sqlerrm like '%boys hostel%', 'a girl cannot be put in a boys hostel'); end;
  begin perform public.hostel_allocate(a, s1, r2, 1); perform pg_temp.check(false, 'dup');
  exception when others then perform pg_temp.check(sqlerrm like '%already has a bed%' or sqlerrm like '%girls hostel%', 'a student cannot hold two beds'); end;
  perform public.hostel_allocate(a, s3, r2, 2);

  select * into rw from public.hostel_overview(a) where name = 'Gandhi House';
  perform pg_temp.check(rw.beds = 2 and rw.occupied = 2 and rw.free = 0, 'overview: 2 beds, 2 occupied, none free');
  select count(*) into n from public.hostel_allocation_list(a, null, 'khan');
  perform pg_temp.check(n = 1, 'search the allocation list in the database');

  -- hostel fee goes into the fee dues
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pr);
  n := public.generate_hostel_dues(a, sess, 'October', d + 5, 1);
  perform pg_temp.check(n = 3, 'hostel fee dues are created for the 3 boarders');
  perform pg_temp.check(public.generate_hostel_dues(a, sess, 'October', d + 5, 1) = 0, 'running it again adds nothing');
  perform pg_temp.check((select amount = 2500 from public.fee_dues where student_id = s2 and source_key like 'hostel:%'), 'a per-student fee overrides the room fee');

  -- roll call
  perform pg_temp.act_as(wd);
  n := public.hostel_save_rollcall(a, hb, d, 'night', jsonb_build_array(jsonb_build_object('student', s1, 'status', 'P'), jsonb_build_object('student', s2, 'status', 'A', 'note', 'Not in room'),
        jsonb_build_object('student', s3, 'status', 'P')));
  perform pg_temp.check(n = 2, 'roll call saves only students who live in this hostel');
  begin perform public.hostel_save_rollcall(a, hb, d + 1, 'night', '[]'); perform pg_temp.check(false, 'future');
  exception when others then perform pg_temp.check(sqlerrm like '%future%', 'the roll call cannot be for a future date'); end;

  -- outpass: warden can approve, so a pass raised by the warden is approved at once
  op := public.hostel_outpass_request(a, s1, 'home', 'Festival at home', now() + interval '1 hour', now() + interval '2 days', 'Mr Sharma', '9811100001');
  perform pg_temp.check((select status = 'approved' from public.hostel_outpasses where id = op), 'an outpass raised by an approver is approved at once');
  begin perform public.hostel_vacate(a, al); perform pg_temp.check(true, 'vacate ok before leaving'); end;
  perform public.hostel_allocate(a, s1, r1, 1);
  op := (select id from public.hostel_outpasses where student_id = s1);
  perform public.hostel_outpass_step(a, op, 'out');
  begin perform public.hostel_vacate(a, (select id from public.hostel_allocations where student_id = s1 and status = 'active')); perform pg_temp.check(false, 'vacate out');
  exception when others then perform pg_temp.check(sqlerrm like '%out on an outpass%', 'a student who is out cannot be vacated'); end;
  perform pg_temp.check((select count(*) from public.hostel_outpass_list(a, 'out')) = 1, 'the outpass list shows who is out');
  perform public.hostel_outpass_step(a, op, 'return');
  perform pg_temp.check((select status = 'returned' and returned_at is not null from public.hostel_outpasses where id = op), 'the return is recorded');
  begin perform public.hostel_outpass_step(a, op, 'out'); perform pg_temp.check(false, 'reuse');
  exception when others then perform pg_temp.check(sqlerrm like '%approved outpass%', 'a used outpass cannot be used again'); end;
end $$;

rollback;
