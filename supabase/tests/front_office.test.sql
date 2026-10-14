-- Front office: visitors, calls, postal, gate pass (step 22).
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
  ('d4d4d4d4-0000-0000-0000-000000000001', 'fo-owner@test.dev'), ('d4d4d4d4-0000-0000-0000-000000000002', 'fo-principal@test.dev'),
  ('d4d4d4d4-0000-0000-0000-000000000003', 'fo-desk@test.dev'), ('d4d4d4d4-0000-0000-0000-000000000004', 'fo-teacher@test.dev'),
  ('d4d4d4d4-0000-0000-0000-000000000005', 'fo-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('d4d4d4d4-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'd4d4d4d4-0000-0000-0000-000000000001'; pr uuid := 'd4d4d4d4-0000-0000-0000-000000000002'; fd uuid := 'd4d4d4d4-0000-0000-0000-000000000003';
  te uuid := 'd4d4d4d4-0000-0000-0000-000000000004'; ot uuid := 'd4d4d4d4-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; stu uuid; v1 uuid; v2 uuid; g1 uuid; g2 uuid; n int; j jsonb; c1 uuid; sfx text := substr(md5(random()::text), 1, 6); d date := public.today_ist();
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('FO A', 'foa-' || sfx);
  b := public.create_school('FO B', 'fob-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fd, 'Desk'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fd, 'front_office'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (a, 'F1', 'Aarav', 'Sharma', cls) returning id into stu;
  insert into public.attendance (school_id, student_id, class_id, date, status, in_time) values (a, stu, cls, d, 'P', '08:00');

  -- visitors
  perform pg_temp.act_as(fd);
  v1 := public.visitor_checkin(a, 'Mr Verma', '9811100001', 'parent', 'Class teacher 5-A', stu, null, 'Aadhaar ending 4321', 1, 'UP32 AB 1234', null);
  v2 := public.visitor_checkin(a, 'Courier boy', null, 'delivery', 'Office', null, 'BlueDart', null, 1, null, null);
  perform pg_temp.check((select pass_no like 'V-%' and out_at is null from public.visitors where id = v1), 'a visitor gets a pass number and is inside');
  perform pg_temp.check((select pass_no from public.visitors where id = v1) <> (select pass_no from public.visitors where id = v2), 'pass numbers are unique');
  begin perform public.visitor_checkin(a, ' ', null, 'meeting', null, null, null, null, 1, null, null); perform pg_temp.check(false, 'blank');
  exception when others then perform pg_temp.check(sqlerrm like '%name%', 'a visitor needs a name'); end;
  begin perform public.visitor_checkin(a, 'X', 'abc', 'meeting', null, null, null, null, 1, null, null); perform pg_temp.check(false, 'phone');
  exception when others then perform pg_temp.check(sqlerrm like '%phone%', 'a bad phone number is refused'); end;
  perform public.visitor_checkout(v2);
  begin perform public.visitor_checkout(v2); perform pg_temp.check(false, 'twice');
  exception when others then perform pg_temp.check(sqlerrm like '%already left%', 'a visitor cannot be checked out twice'); end;
  select count(*) into n from public.visitor_list(a, d, d, null, null, true);
  perform pg_temp.check(n = 1, 'the inside filter lists only visitors still inside');
  select count(*) into n from public.visitor_list(a, d, d, 'verma');
  perform pg_temp.check(n = 1, 'search in the database finds a visitor by name');

  -- calls
  insert into public.phone_calls (school_id, direction, name, phone, purpose, summary, follow_up_on, handled_by_name) values (a, 'incoming', 'Mrs Gupta', '9811100002', 'enquiry', 'Asked about class 3 seats', d, 'Desk') returning id into c1;
  j := public.frontdesk_today(a);
  perform pg_temp.check((j ->> 'visitors_today')::int = 2 and (j ->> 'visitors_inside')::int = 1 and (j ->> 'followups_due')::int = 1 and (j ->> 'calls_today')::int = 1, 'the front desk summary counts visitors, calls and follow-ups');
  perform public.call_followup_done(c1);
  perform pg_temp.check((public.frontdesk_today(a) ->> 'followups_due')::int = 0, 'a follow-up marked done leaves the list');

  -- gate pass: the front desk can approve, so its own passes are approved at once
  g1 := public.gate_pass_request(a, stu, 'Doctor appointment', 'Mr Sharma', 'Father', '9811100003');
  perform pg_temp.check((select status = 'approved' from public.gate_passes where id = g1), 'a pass raised by someone who can approve is approved immediately');
  begin perform public.gate_pass_request(a, stu, 'Again', 'Someone', null, null); perform pg_temp.check(false, 'dup');
  exception when others then perform pg_temp.check(sqlerrm like '%already an open%', 'only one open pass per student per day'); end;
  perform public.gate_pass_complete(g1);
  perform pg_temp.check((select out_time is not null and note like '%gate pass%' from public.attendance where student_id = stu and date = d), 'releasing the child records the out-time on attendance');
  begin perform public.gate_pass_complete(g1); perform pg_temp.check(false, 'reuse');
  exception when others then perform pg_temp.check(sqlerrm like '%approved pass%', 'a pass cannot be used twice'); end;

  -- teacher: no front office access
  perform pg_temp.act_as(te);
  begin perform public.visitor_checkin(a, 'X', null, 'meeting', null, null, null, null, 1, null, null); perform pg_temp.check(false, 'teacher');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot use the visitor log'); end;
  perform pg_temp.check((select count(*) from public.visitors) = 0 and (select count(*) from public.gate_passes) = 0, 'a class teacher sees no visitors or passes');

  -- refusal path
  perform pg_temp.act_admin();
  insert into public.gate_passes (school_id, pass_no, student_id, reason, pickup_name, status) values (a, 'GP-T-1', stu, 'Function', 'Uncle', 'requested') returning id into g2;
  perform pg_temp.act_as(pr);
  begin perform public.gate_pass_decide(g2, false, ' '); perform pg_temp.check(false, 'noreason');
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'refusing a pass needs a reason'); end;
  perform public.gate_pass_decide(g2, false, 'No guardian consent');
  perform pg_temp.check((select status = 'rejected' and decided_by_name = 'Principal' from public.gate_passes where id = g2), 'the principal can refuse a pass');

  -- isolation
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.visitors) = 0 and (select count(*) from public.phone_calls) = 0, 'another school sees nothing');
  begin perform public.frontdesk_today(a); perform pg_temp.check(false, 'cross'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot read our desk summary'); end;
end $$;

rollback;
