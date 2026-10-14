-- Timetable, substitutions and calendar (step 21).
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
  ('c3c3c3c3-0000-0000-0000-000000000001', 'tt-owner@test.dev'), ('c3c3c3c3-0000-0000-0000-000000000002', 'tt-principal@test.dev'),
  ('c3c3c3c3-0000-0000-0000-000000000003', 'tt-teacher@test.dev'), ('c3c3c3c3-0000-0000-0000-000000000004', 'tt-parent@test.dev'),
  ('c3c3c3c3-0000-0000-0000-000000000005', 'tt-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('c3c3c3c3-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'c3c3c3c3-0000-0000-0000-000000000001'; pr uuid := 'c3c3c3c3-0000-0000-0000-000000000002'; te uuid := 'c3c3c3c3-0000-0000-0000-000000000003';
  pa uuid := 'c3c3c3c3-0000-0000-0000-000000000004'; ot uuid := 'c3c3c3c3-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; cls2 uuid; sec1 uuid; sec2 uuid; p1 uuid; p2 uuid; brk uuid; maths uuid; eng uuid; t1 uuid; t2 uuid; t3 uuid; n int; i uuid; sub uuid;
  sfx text := substr(md5(random()::text), 1, 6); monday date; rw record;
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('TT A', 'tta-' || sfx);
  b := public.create_school('TT B', 'ttb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher'), (a, pa, 'Parent'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher'), (pa, 'parent')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  select id into cls2 from public.classes where school_id = a and name = '6';
  select id into sec1 from public.sections where class_id = cls order by name limit 1;
  select id into sec2 from public.sections where class_id = cls2 order by name limit 1;
  select id into maths from public.subjects where school_id = a order by name limit 1;
  select id into eng from public.subjects where school_id = a and id <> maths order by name limit 1;
  insert into public.staff (school_id, user_id, name, kind) values (a, te, 'Meena Rao', 'teaching') returning id into t1;
  insert into public.staff (school_id, name, kind) values (a, 'Ravi Kumar', 'teaching') returning id into t2;
  insert into public.staff (school_id, name, kind) values (a, 'Sunita Devi', 'teaching') returning id into t3;
  insert into public.staff_assignments (school_id, user_id, section_id) values (a, te, sec1);
  monday := public.today_ist() + ((8 - extract(isodow from public.today_ist())::int) % 7);

  -- defaults and permissions
  perform pg_temp.act_as(pr);
  perform public.ensure_timetable_defaults(a);
  select count(*) into n from public.periods where school_id = a;
  perform pg_temp.check(n = 9 and (select count(*) from public.periods where school_id = a and is_break) = 1, 'a default bell schedule of 8 periods and a lunch break is created');
  select id into p1 from public.periods where school_id = a and no = 1;
  select id into p2 from public.periods where school_id = a and no = 2;
  select id into brk from public.periods where school_id = a and is_break;

  i := public.set_slot(a, sec1, 1, p1, maths, t1, 'R-12');
  perform pg_temp.check(i is not null, 'the principal puts Maths with Meena in 5-A, Monday, period 1');
  begin perform public.set_slot(a, sec2, 1, p1, eng, t1, null); perform pg_temp.check(false, 'double booking');
  exception when others then perform pg_temp.check(sqlerrm like '%already teaches%', 'the same teacher cannot be in two sections in one period'); end;
  perform public.set_slot(a, sec2, 1, p1, eng, t2, null);
  begin perform public.set_slot(a, sec1, 1, brk, maths, t1, null); perform pg_temp.check(false, 'break');
  exception when others then perform pg_temp.check(sqlerrm like '%not a break%', 'a break period cannot take a class'); end;
  perform public.set_slot(a, sec1, 1, p1, maths, t1, 'R-14');
  perform pg_temp.check((select room = 'R-14' from public.timetable_slots where section_id = sec1 and day = 1 and period_id = p1), 'setting a slot again replaces it');
  perform public.set_slot(a, sec1, 1, p2, eng, t2, null);
  n := public.copy_day(a, sec1, 1, array[2, 3]);
  perform pg_temp.check(n = 4 and (select count(*) from public.timetable_slots where section_id = sec1) = 6, 'copy day copies the periods to the other days');
  perform public.set_slot(a, sec1, 3, p2, null, null, null);
  perform pg_temp.check((select count(*) from public.timetable_slots where section_id = sec1 and day = 3) = 1, 'an emptied cell is removed');

  -- visibility
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.timetable_slots) = 5, 'a class teacher sees the timetable of the assigned section (and own periods)');
  begin perform public.set_slot(a, sec1, 4, p1, maths, t1, null); perform pg_temp.check(false, 'teacher edit');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot edit the timetable'); end;
  perform pg_temp.act_as(pa);
  perform pg_temp.check((select count(*) from public.timetable_slots) = 0, 'a parent login does not read the staff timetable');
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.timetable_slots) = 0 and (select count(*) from public.periods) = 0, 'another school sees nothing');

  -- cover: Meena on approved leave next Monday
  perform pg_temp.act_admin();
  insert into public.staff_leaves (school_id, staff_id, kind, from_date, to_date, status) values (a, t1, 'CL', monday, monday, 'approved');
  perform pg_temp.act_as(pr);
  select count(*) into n from public.cover_needed(a, monday);
  perform pg_temp.check(n = 1, 'a teacher on approved leave needs cover for her period');
  select count(*) into n from public.free_staff(a, monday, p1);
  perform pg_temp.check(n = 1 and (select name from public.free_staff(a, monday, p1)) = 'Sunita Devi', 'only the genuinely free teacher is offered (Ravi teaches in 6-A that period)');
  select slot_id into i from public.cover_needed(a, monday) limit 1;
  begin perform public.save_substitution(a, i, monday, t2, 'x'); perform pg_temp.check(false, 'busy sub');
  exception when others then perform pg_temp.check(sqlerrm like '%not free%', 'a busy teacher cannot be the substitute'); end;
  begin perform public.save_substitution(a, i, monday + 1, t3, 'x'); perform pg_temp.check(false, 'wrong day');
  exception when others then perform pg_temp.check(sqlerrm like '%not a%', 'the date must be the weekday of the period'); end;
  sub := public.save_substitution(a, i, monday, t3, 'Meena on leave');
  select * into rw from public.cover_needed(a, monday) limit 1;
  perform pg_temp.check(rw.substitute_name = 'Sunita Devi', 'the cover board shows the substitute');
  select count(*) into n from public.free_staff(a, monday, p1);
  perform pg_temp.check(n = 0, 'a covering teacher is no longer free that period');
  perform public.remove_substitution(sub);
  select count(*) into n from public.free_staff(a, monday, p1);
  perform pg_temp.check(n = 1, 'removing the cover frees the teacher again');

  -- load
  select * into rw from public.teacher_load(a) where name = 'Meena Rao';
  perform pg_temp.check(rw.periods = 3 and rw.sections = 1, 'teacher load counts periods and sections');

  -- calendar
  insert into public.school_events (school_id, title, kind, start_date, end_date) values (a, 'Diwali', 'holiday', date_trunc('month', public.today_ist())::date + 9, date_trunc('month', public.today_ist())::date + 13);
  begin insert into public.school_events (school_id, title, kind, start_date, end_date) values (a, 'Bad', 'event', public.today_ist(), public.today_ist() - 1);
    perform pg_temp.check(false, 'bad range'); exception when check_violation then perform pg_temp.check(true, 'an event cannot end before it starts'); end;
  perform pg_temp.check(public.holiday_on(a, date_trunc('month', public.today_ist())::date + 9) = 'Diwali', 'holiday_on finds the holiday');
  perform pg_temp.check(public.holiday_on(a, date_trunc('month', public.today_ist())::date + 20) is null, 'holiday_on is null on a normal day');
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.school_events) = 1, 'staff can read the calendar');
  begin insert into public.school_events (school_id, title, kind, start_date, end_date) values (a, 'Teacher event', 'event', public.today_ist(), public.today_ist());
    perform pg_temp.check(false, 'teacher event'); exception when insufficient_privilege then perform pg_temp.check(true, 'a teacher cannot add calendar events'); end;
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.school_events) = 0, 'another school cannot read our calendar');

  -- holidays reduce working days
  perform pg_temp.act_as(pr);
  select working_days into n from public.staff_attendance_month(a, date_trunc('month', public.today_ist())::date) limit 1;
  perform pg_temp.check(n = (select count(*) from generate_series(date_trunc('month', public.today_ist())::date,
      (date_trunc('month', public.today_ist()) + interval '1 month - 1 day')::date, interval '1 day') g
      where extract(isodow from g) <> 7 and not (g::date between date_trunc('month', public.today_ist())::date + 9 and date_trunc('month', public.today_ist())::date + 13)),
    'working days for payroll exclude the holiday');
end $$;

rollback;
