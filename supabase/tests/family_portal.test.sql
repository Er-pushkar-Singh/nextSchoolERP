-- Parent & student logins (step 41, migration 0043): own children only, leave requests, class-team messages.
-- Run on a THROWAWAY database after all migrations:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/family_portal.test.sql
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

insert into auth.users (id, email) values
  ('fafafafa-0000-0000-0000-000000000001', 'fp-owner@test.dev'),
  ('fafafafa-0000-0000-0000-000000000002', 'fp-teacher@test.dev'),
  ('fafafafa-0000-0000-0000-000000000003', 'fp-teacher2@test.dev'),
  ('fafafafa-0000-0000-0000-000000000004', 'fp-parent1@test.dev'),
  ('fafafafa-0000-0000-0000-000000000005', 'fp-parent2@test.dev'),
  ('fafafafa-0000-0000-0000-000000000006', 'fp-student1@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('fafafafa-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'fafafafa-0000-0000-0000-000000000001'; t1 uuid := 'fafafafa-0000-0000-0000-000000000002'; t2 uuid := 'fafafafa-0000-0000-0000-000000000003';
  p1 uuid := 'fafafafa-0000-0000-0000-000000000004'; p2 uuid := 'fafafafa-0000-0000-0000-000000000005'; st uuid := 'fafafafa-0000-0000-0000-000000000006';
  a uuid; c uuid; sx uuid; sy uuid; s1 uuid; s2 uuid; g1 uuid; g2 uuid; lid uuid; lid2 uuid; n int; d date; mon date;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Family Portal', 'fpo-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name, email) values (a, t1, 'Teacher One', 'fp-teacher@test.dev'), (a, t2, 'Teacher Two', 'fp-teacher2@test.dev'),
    (a, p1, 'Parent One', 'fp-parent1@test.dev'), (a, p2, 'Parent Two', 'fp-parent2@test.dev'), (a, st, 'Student One', 'fp-student1@test.dev');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (t1, 'class_teacher'), (t2, 'class_teacher'), (p1, 'parent'), (p2, 'parent'), (st, 'student')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into c from public.classes where school_id = a order by sort limit 1;
  insert into public.sections (school_id, class_id, name) values (a, c, 'P') returning id into sx;
  insert into public.sections (school_id, class_id, name) values (a, c, 'Q') returning id into sy;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id, status, user_id) values (a, 'F1', 'Asha', c, sx, 'active', st) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, section_id, status) values (a, 'F2', 'Bala', c, sy, 'active') returning id into s2;
  insert into public.guardians (school_id, user_id, name, relation) values (a, p1, 'Parent One', 'Mother') returning id into g1;
  insert into public.guardians (school_id, user_id, name, relation) values (a, p2, 'Parent Two', 'Father') returning id into g2;
  insert into public.student_guardians (school_id, student_id, guardian_id) values (a, s1, g1), (a, s2, g2);
  insert into public.staff_assignments (school_id, user_id, section_id, is_class_teacher) values (a, t1, sx, true), (a, t2, sy, true);

  -- children
  perform pg_temp.act_as(p1);
  perform pg_temp.check((select count(*) from public.family_children()) = 1 and (select student_id from public.family_children()) = s1, 'a parent sees only their own child');
  perform pg_temp.check(public.is_my_child(s1) and not public.is_my_child(s2), 'is_my_child is true for the own child only');
  perform pg_temp.check((select count(*) from public.students) = 1, 'and the student list shows only that child');
  perform pg_temp.act_as(st);
  perform pg_temp.check((select is_self from public.family_children()) and (select count(*) from public.family_children()) = 1, 'a student login sees only itself');
  perform pg_temp.act_admin();

  -- leave
  mon := date_trunc('week', public.today_ist() + 7)::date;       -- next Monday
  perform pg_temp.act_as(p1);
  lid := public.apply_student_leave(s1, mon, mon + 6, 'Wedding in the family');
  perform pg_temp.check((select status = 'pending' and applied_via = 'family' and applied_by_name = 'Parent One' from public.student_leaves where id = lid), 'a parent applies for leave for their child');
  begin perform public.apply_student_leave(s1, mon + 2, mon + 3, 'x'); perform pg_temp.check(false, 'overlap');
  exception when others then perform pg_temp.check(sqlerrm like '%already a leave%', 'overlapping requests are refused'); end;
  begin perform public.apply_student_leave(s2, mon, mon, 'x'); perform pg_temp.check(false, 'other child');
  exception when others then perform pg_temp.check(sqlerrm = 'not allowed', 'a parent cannot apply for someone else''s child'); end;
  begin perform public.apply_student_leave(s1, mon + 20, mon + 90, 'x'); perform pg_temp.check(false, 'too long');
  exception when others then perform pg_temp.check(sqlerrm like '%at most 45%', 'a request is limited to 45 days'); end;
  begin perform public.decide_student_leave(lid, true, null); perform pg_temp.check(false, 'self approve');
  exception when others then perform pg_temp.check(sqlerrm = 'not allowed', 'a parent cannot approve a leave'); end;
  perform pg_temp.check((select count(*) from public.student_leaves) = 1, 'a parent sees only their child''s requests');
  perform pg_temp.act_as(p2);
  perform pg_temp.check((select count(*) from public.student_leaves) = 0, 'another family sees none of them');
  begin perform public.cancel_student_leave(lid); perform pg_temp.check(false, 'other cancel');
  exception when others then perform pg_temp.check(sqlerrm = 'not allowed', 'another family cannot cancel it'); end;
  perform pg_temp.act_admin();

  perform pg_temp.act_as(t2);
  perform pg_temp.check((select count(*) from public.student_leave_list(a)) = 0, 'a teacher of another section does not see the request');
  begin perform public.decide_student_leave(lid, true, null); perform pg_temp.check(false, 'wrong teacher');
  exception when others then perform pg_temp.check(sqlerrm = 'not allowed', 'and cannot decide it'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(t1);
  perform pg_temp.check((select count(*) from public.student_leave_list(a, 'pending')) = 1 and (select max(total) from public.student_leave_list(a, 'pending')) = 1, 'the class teacher sees the pending request');
  perform pg_temp.check((select days from public.student_leave_list(a)) = 7, 'with its number of days');
  perform pg_temp.check(public.decide_student_leave(lid, true, 'Take care') = 'approved', 'the class teacher approves it');
  begin perform public.decide_student_leave(lid, false, null); perform pg_temp.check(false, 'twice');
  exception when others then perform pg_temp.check(sqlerrm like '%already been approved%', 'a decided request cannot be decided again'); end;
  perform pg_temp.act_admin();
  select count(*) into n from public.attendance where student_id = s1 and status = 'LV' and marked_by = 'leave:' || lid;
  perform pg_temp.check(n between 5 and 6, 'the approved leave writes LV into the register for the school days (no Sundays)');
  perform pg_temp.check(not exists (select 1 from public.attendance where student_id = s1 and extract(dow from date) = 0), 'Sundays are not marked');
  -- a day already marked present is not overwritten
  perform pg_temp.act_as(p1);
  lid2 := public.apply_student_leave(s1, mon + 14, mon + 15, 'Cousin''s function');
  perform pg_temp.act_admin();
  insert into public.attendance (school_id, student_id, class_id, section_id, date, status, marked_by) values (a, s1, c, sx, mon + 14, 'P', 'teacher');
  perform pg_temp.act_as(t1);
  perform public.decide_student_leave(lid2, true, null);
  perform pg_temp.act_admin();
  perform pg_temp.check((select status from public.attendance where student_id = s1 and date = mon + 14) = 'P', 'a day the teacher already marked present stays present');
  perform pg_temp.check((select status from public.attendance where student_id = s1 and date = mon + 15) = 'LV', 'the other day becomes leave');
  -- cancel removes the leave marks it wrote
  perform pg_temp.act_as(t1);
  perform public.cancel_student_leave(lid);
  perform pg_temp.act_admin();
  perform pg_temp.check(not exists (select 1 from public.attendance where marked_by = 'leave:' || lid), 'cancelling a leave removes the marks it wrote');
  perform pg_temp.check((select status from public.student_leaves where id = lid) = 'cancelled', 'and the request is cancelled');
  -- a pending request can be cancelled by its parent
  perform pg_temp.act_as(p1);
  lid := public.apply_student_leave(s1, mon + 30, mon + 30, 'Dentist');
  perform public.cancel_student_leave(lid);
  perform pg_temp.check((select status from public.student_leaves where id = lid) = 'cancelled', 'a parent cancels their own pending request');
  perform pg_temp.act_admin();

  -- messages
  perform pg_temp.act_as(p1);
  perform public.send_family_message(s1, 'Asha has a fever, please excuse her.');
  begin perform public.send_family_message(s2, 'hello'); perform pg_temp.check(false, 'other child msg');
  exception when others then perform pg_temp.check(sqlerrm = 'not allowed', 'a parent cannot message about someone else''s child'); end;
  begin perform public.send_family_message(s1, '   '); perform pg_temp.check(false, 'blank');
  exception when others then perform pg_temp.check(sqlerrm like '%Write a message%', 'a blank message is refused'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(t1);
  perform pg_temp.check((select unread from public.family_inbox(a)) = 1 and (select count(*) from public.family_inbox(a)) = 1, 'the class teacher sees one unread conversation');
  perform pg_temp.check(public.family_unread(a) = 1, 'and one unread message in the badge');
  perform public.send_family_message(s1, 'Get well soon. Noted.');
  perform public.read_family_messages(s1);
  perform pg_temp.check(public.family_unread(a) = 0 and (select unread from public.family_inbox(a)) = 0, 'reading marks it as read');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(t2);
  perform pg_temp.check((select count(*) from public.family_inbox(a)) = 0, 'a teacher of another section does not see the conversation');
  begin perform public.send_family_message(s1, 'hi'); perform pg_temp.check(false, 'wrong teacher msg');
  exception when others then perform pg_temp.check(sqlerrm = 'not allowed', 'and cannot write into it'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(p1);
  perform pg_temp.check((select count(*) from public.family_messages) = 2 and (select count(*) from public.family_messages where not from_family and read_at is null) = 1, 'the parent sees both messages, the reply still unread');
  perform public.read_family_messages(s1);
  perform pg_temp.check((select count(*) from public.family_messages where not from_family and read_at is null) = 0, 'the parent reading marks the reply as read');
  perform pg_temp.act_as(p2);
  perform pg_temp.check((select count(*) from public.family_messages) = 0, 'another family reads none of it');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(st);
  perform pg_temp.check((select count(*) from public.family_messages) = 2, 'the student login can read its own conversation');
  perform pg_temp.act_admin();
end $$;

select 'ALL FAMILY PORTAL TESTS PASSED' as result;
rollback;
