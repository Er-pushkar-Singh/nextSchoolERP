-- Health & discipline (step 31).
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
  ('f2f2f2f2-0000-0000-0000-000000000001', 'wb-owner@test.dev'), ('f2f2f2f2-0000-0000-0000-000000000002', 'wb-principal@test.dev'),
  ('f2f2f2f2-0000-0000-0000-000000000003', 'wb-teacher@test.dev'), ('f2f2f2f2-0000-0000-0000-000000000004', 'wb-teacher2@test.dev'),
  ('f2f2f2f2-0000-0000-0000-000000000005', 'wb-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('f2f2f2f2-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'f2f2f2f2-0000-0000-0000-000000000001'; pr uuid := 'f2f2f2f2-0000-0000-0000-000000000002'; t1 uuid := 'f2f2f2f2-0000-0000-0000-000000000003';
  t2 uuid := 'f2f2f2f2-0000-0000-0000-000000000004'; ot uuid := 'f2f2f2f2-0000-0000-0000-000000000005';
  a uuid; b uuid; c5 uuid; c6 uuid; sec5 uuid; sec6 uuid; s1 uuid; s2 uuid; s3 uuid; v uuid; inc uuid; inc2 uuid; n int; j jsonb; sfx text := substr(md5(random()::text), 1, 6); d date := public.today_ist();
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('WB A', 'wba-' || sfx);
  b := public.create_school('WB B', 'wbb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, t1, 'Teacher One'), (a, t2, 'Teacher Two'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (t1, 'class_teacher'), (t2, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into c5 from public.classes where school_id = a and name = '5';
  select id into c6 from public.classes where school_id = a and name = '6';
  select id into sec5 from public.sections where class_id = c5 order by name limit 1;
  select id into sec6 from public.sections where class_id = c6 order by name limit 1;
  insert into public.staff_assignments (school_id, user_id, section_id, is_class_teacher) values (a, t1, sec5, true), (a, t2, sec6, true);
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'W1', 'Aarav', 'Sharma', c5, sec5) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'W2', 'Diya', 'Verma', c5, sec5) returning id into s2;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'W3', 'Kabir', 'Khan', c6, sec6) returning id into s3;

  -- the principal records health data; class teachers only see their own students
  perform pg_temp.act_as(pr);
  insert into public.student_health (student_id, school_id, blood_group, allergies, emergency_name, emergency_phone) values (s1, a, 'B+', 'Peanuts', 'Mr Sharma', '9811100001'), (s3, a, 'O+', null, 'Mr Khan', '9811100003');
  perform pg_temp.act_as(t1);
  perform pg_temp.check((select count(*) from public.student_health) = 1, 'a class teacher sees the health record of own section only');
  begin insert into public.student_health (student_id, school_id, blood_group) values (s2, a, 'A+'); perform pg_temp.check(false, 'teacher write');
  exception when insufficient_privilege then perform pg_temp.check(true, 'a class teacher cannot create health records'); end;

  -- medical room: principal logs visits
  perform pg_temp.act_as(pr);
  v := public.health_visit_add(a, s1, 'Stomach ache', 37.8, 'Rest, warm water', 'ORS', 'rested', false, null);
  begin perform public.health_visit_add(a, s2, 'Fever', 39.5, null, null, 'sent_home', false, null); perform pg_temp.check(false, 'informed');
  exception when others then perform pg_temp.check(sqlerrm like '%parent must be informed%', 'sending a child home needs the parent informed'); end;
  perform public.health_visit_add(a, s2, 'Fever', 39.5, null, 'Paracetamol', 'sent_home', true, d + 2);
  perform public.health_visit_inform(a, v);
  perform pg_temp.check((select parent_informed and parent_informed_at is not null from public.health_visits where id = v), 'the parent-informed time is recorded');
  select count(*) into n from public.health_visit_list(a, d, d);
  perform pg_temp.check(n = 2, 'the visit list returns today''s visits');
  select count(*) into n from public.health_visit_list(a, d, d, 'fever');
  perform pg_temp.check(n = 1, 'search the visit list by complaint');
  select count(*) into n from public.health_visit_list(a, d, d, null, null, true);
  perform pg_temp.check(n = 0, 'follow-up filter shows only follow-ups that are due');
  perform pg_temp.act_as(t2);
  perform pg_temp.check((select count(*) from public.health_visit_list(a, d, d)) = 0, 'a teacher of another section sees no visits of these students');
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.health_visits) = 0, 'another school sees nothing');

  -- discipline
  perform pg_temp.act_as(t1);
  inc := public.discipline_report(a, array[s1, s2], 'fighting', 'moderate', d, 'Playground', 'Pushing during the break', null, false, d + 3, false, array[s2]);
  perform pg_temp.check(inc is not null, 'a class teacher reports an incident of own students');
  begin perform public.discipline_report(a, array[s3], 'uniform', 'minor', d, null, 'No tie', null, false, null, false); perform pg_temp.check(false, 'other class');
  exception when others then perform pg_temp.check(sqlerrm like '%not in your class%', 'a teacher cannot report a student of another section'); end;
  begin perform public.discipline_update(a, inc, 'closed', 'Warned', true, null); perform pg_temp.check(false, 'close');
  exception when others then perform pg_temp.check(sqlerrm like '%only the principal%' or sqlerrm like '%not allowed%', 'a teacher cannot close an incident'); end;
  perform public.discipline_update(a, inc, 'action_taken', 'Both students counselled and parents called', true, null);
  perform pg_temp.check((select status = 'action_taken' and parent_informed from public.discipline_incidents where id = inc), 'the reporter records the action taken');

  perform pg_temp.act_as(pr);
  inc2 := public.discipline_report(a, array[s3], 'bullying', 'serious', d, null, 'Repeated teasing', null, false, null, false);
  perform pg_temp.check((select confidential and status = 'under_review' from public.discipline_incidents where id = inc2), 'bullying is confidential and a serious one goes under review at once');
  perform pg_temp.act_as(t2);
  perform pg_temp.check((select count(*) from public.discipline_list(a, d, d)) = 0, 'a teacher cannot see a confidential incident of another teacher''s student');
  perform pg_temp.act_as(t1);
  select count(*) into n from public.discipline_list(a, d, d);
  perform pg_temp.check(n = 1, 'the teacher sees only the incident of own section');
  select count(*) into n from public.discipline_list(a, d, d, 'verma');
  perform pg_temp.check(n = 1, 'search finds an incident by a student''s name');
  perform pg_temp.act_as(pr);
  perform public.discipline_update(a, inc, 'closed', null, null, null);
  perform pg_temp.check((select status = 'closed' and closed_on = d from public.discipline_incidents where id = inc), 'the principal closes it with the date');
  perform public.counselling_add(a, s1, 'Spoke about conflict with peers; will meet weekly.');
  perform pg_temp.act_as(t1);
  perform pg_temp.check((select count(*) from public.counselling_notes) = 0, 'counselling notes are for the principal only');
  begin perform public.counselling_add(a, s1, 'x'); perform pg_temp.check(false, 'teacher note');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a teacher cannot add counselling notes'); end;
  j := public.student_wellbeing(a, s1);
  perform pg_temp.check((j ->> 'incidents_180')::int = 1, 'the student profile counts incidents the viewer may see');
end $$;

rollback;
