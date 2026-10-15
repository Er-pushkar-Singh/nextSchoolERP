-- Inventory as the school's property (step 38) + one money trail (step 37) + TC clearance.
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
  ('f8f8f8f8-0000-0000-0000-000000000001', 'as-owner@test.dev'), ('f8f8f8f8-0000-0000-0000-000000000002', 'as-principal@test.dev'),
  ('f8f8f8f8-0000-0000-0000-000000000003', 'as-office@test.dev'), ('f8f8f8f8-0000-0000-0000-000000000004', 'as-teacher@test.dev'),
  ('f8f8f8f8-0000-0000-0000-000000000005', 'as-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('f8f8f8f8-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'f8f8f8f8-0000-0000-0000-000000000001'; pr uuid := 'f8f8f8f8-0000-0000-0000-000000000002'; of uuid := 'f8f8f8f8-0000-0000-0000-000000000003';
  te uuid := 'f8f8f8f8-0000-0000-0000-000000000004'; ot uuid := 'f8f8f8f8-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; sess uuid; s1 uuid; s2 uuid; w1 uuid; room1 uuid; room2 uuid; fan uuid; laptop uuid; chalk uuid; shop uuid; j jsonb; asg uuid; asg2 uuid; asg3 uuid; n int; rw record; due uuid;
  tc uuid; head uuid; breg uuid; inc uuid; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('AS A', 'asa-' || sfx);
  b := public.create_school('AS B', 'asb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, of, 'Office'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (of, 'office_admin'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '9';
  select id into sess from public.sessions where school_id = a and is_current;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, guardian_phone) values (a, 'A1', 'Aarav', 'Sharma', cls, '9811100001') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (a, 'A2', 'Diya', 'Verma', cls) returning id into s2;
  insert into public.staff (school_id, emp_code, name, designation, email) values (a, 'E1', 'Meena Rao', 'Teacher', 'meena@school.in') returning id into w1;

  -- places and items
  perform pg_temp.act_as(pr);
  insert into public.inventory_locations (school_id, name, kind, class_id) values (a, 'Room 9-A', 'classroom', cls) returning id into room1;
  insert into public.inventory_locations (school_id, name, kind) values (a, 'Science lab', 'lab') returning id into room2;
  insert into public.inventory_items (school_id, name, category, kind, cost, price) values (a, 'Ceiling fan', 'Furniture & fittings', 'asset', 2200, 0) returning id into fan;
  insert into public.inventory_items (school_id, name, category, kind, cost, price) values (a, 'Laptop', 'Computers', 'asset', 42000, 0) returning id into laptop;
  insert into public.inventory_items (school_id, name, category, kind, cost, reorder_level) values (a, 'Chalk box', 'Stationery', 'consumable', 40, 5) returning id into chalk;
  insert into public.inventory_items (school_id, name, category, kind, cost, price) values (a, 'School shirt', 'Uniform', 'shop', 150, 250) returning id into shop;
  perform public.inventory_adjust(a, fan, 10, 'opening', 'Opening stock');
  perform public.inventory_adjust(a, laptop, 3, 'opening', 'Opening stock');
  perform public.inventory_adjust(a, shop, 5, 'opening', 'x');

  -- office admin assigns; a teacher cannot
  perform pg_temp.act_as(te);
  begin perform public.inventory_assign(a, fan, 1, 'location', room1); perform pg_temp.check(false, 'teacher assign');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot assign inventory'); end;
  perform pg_temp.act_as(of);
  j := public.inventory_assign(a, fan, 4, 'location', room1, null, null, null, 'Installed');
  asg := (j ->> 'id')::uuid;
  perform pg_temp.check((j ->> 'holder') = 'Room 9-A' and (select on_hand = 6 from public.inventory_items where id = fan), 'fans installed in a classroom leave the store stock');
  j := public.inventory_assign(a, laptop, 1, 'staff', w1, null, public.today_ist() + 30, 'LT-0042', 'For the computer lab');
  asg2 := (j ->> 'id')::uuid;
  perform pg_temp.check((j ->> 'holder') = 'Meena Rao' and (j ->> 'due_back')::date = public.today_ist() + 30, 'a laptop assigned to a staff member with a return date');
  j := public.inventory_assign(a, laptop, 1, 'student', s1, null, public.today_ist() + 7, 'LT-0043');
  asg3 := (j ->> 'id')::uuid;
  perform pg_temp.check((j ->> 'holder') = 'Aarav Sharma', 'a device assigned to a student');
  begin perform public.inventory_assign(a, fan, 50, 'location', room2); perform pg_temp.check(false, 'overstock');
  exception when others then perform pg_temp.check(sqlerrm like '%in the store%', 'cannot assign more than the store has'); end;
  begin perform public.inventory_assign(a, shop, 1, 'staff', w1); perform pg_temp.check(false, 'shop');
  exception when others then perform pg_temp.check(sqlerrm like '%shop item%', 'a shop item is sold, not assigned'); end;
  begin perform public.inventory_assign(a, fan, 1, 'department', null, ''); perform pg_temp.check(false, 'dept');
  exception when others then perform pg_temp.check(sqlerrm like '%department%', 'a department needs a name'); end;
  perform public.inventory_assign(a, fan, 1, 'department', null, 'Accounts office');

  -- lists and overview
  select * into rw from public.inventory_item_list(a, 'fan') limit 1;
  perform pg_temp.check(rw.on_hand = 5 and rw.assigned_qty = 5 and rw.owned_qty = 10, 'the item list shows in store, assigned and the total owned');
  perform pg_temp.check((select count(*) from public.inventory_assignment_list(a, 'active')) = 4, 'four active assignments');
  perform pg_temp.check((select count(*) from public.inventory_assignment_list(a, 'active', 'staff', 'meena')) = 1, 'find what a staff member holds');
  perform pg_temp.check((select count(*) from public.inventory_assignment_list(a, 'active', null, null, null, room1)) = 1, 'find what a room holds');
  select * into rw from public.inventory_location_summary(a) where name = 'Room 9-A';
  perform pg_temp.check(rw.units = 4 and rw.value = 8800, 'the room holds 4 fans worth ₹8,800');
  j := public.inventory_overview(a);
  perform pg_temp.check((j ->> 'in_rooms')::int = 4 and (j ->> 'with_people')::int = 2 and (j ->> 'assigned')::int = 7 and (j ->> 'kinds')::int = 3, 'the overview counts rooms, people and kinds (shop items excluded)');

  -- overdue
  perform pg_temp.act_admin();
  update public.inventory_assignments set due_back = public.today_ist() - 3 where id = asg3;
  perform pg_temp.act_as(of);
  perform pg_temp.check((select count(*) from public.inventory_assignment_list(a, 'overdue')) = 1 and (select days_overdue = 3 from public.inventory_assignment_list(a, 'overdue') limit 1), 'an overdue return is flagged with its days');

  -- return: good, partial, damaged with a recovery charge
  j := public.inventory_return(a, asg2, null, 'good', 'Back from the lab');
  perform pg_temp.check((select on_hand = 2 from public.inventory_items where id = laptop) and (select status = 'returned' from public.inventory_assignments where id = asg2), 'a good return goes back to the store');
  j := public.inventory_return(a, asg, 1, 'good');
  perform pg_temp.check((select qty = 3 from public.inventory_assignments where id = asg) and (select on_hand = 6 from public.inventory_items where id = fan), 'a partial return leaves the rest in the room');
  j := public.inventory_return(a, asg3, 1, 'damaged', 'Screen cracked', 5000);
  perform pg_temp.act_admin();
  perform pg_temp.check((j ->> 'charged')::numeric = 5000 and (select count(*) from public.fee_dues where student_id = s1 and source_key like 'asset:%' and amount = 5000) = 1, 'a damaged device charges the student''s fee account');
  perform pg_temp.act_as(of);
  perform pg_temp.check((select on_hand = 2 from public.inventory_items where id = laptop) and (select count(*) = 1 from public.inventory_moves where item_id = laptop and kind = 'writeoff'), 'a written-off device is not put back in stock and the ledger shows the write-off');
  perform pg_temp.check((select sum(qty) from public.inventory_moves where item_id = laptop) = (select on_hand from public.inventory_items where id = laptop), 'stock still equals the ledger after the write-off');
  begin perform public.inventory_return(a, asg3, 1, 'good'); perform pg_temp.check(false, 'twice');
  exception when others then perform pg_temp.check(sqlerrm like '%already returned%', 'the same assignment cannot be returned twice'); end;
  begin perform public.inventory_return(a, asg, 1, 'damaged', null, 100); perform pg_temp.check(false, 'room charge');
  exception when others then perform pg_temp.check(sqlerrm like '%only for a student%', 'only a student can be charged a recovery'); end;

  -- transfer and repair
  j := public.inventory_transfer(a, asg, 'location', room2, null, 'Moved to the lab');
  perform pg_temp.check((select location_id = room2 from public.inventory_assignments where id = asg) and (select count(*) from public.inventory_assignment_events where assignment_id = asg and action = 'transferred') = 1, 'an installed item moves to another room and the history records it');
  j := public.inventory_return(a, asg, 1, 'needs_repair', 'Motor humming');
  perform pg_temp.check((select count(*) from public.inventory_repairs where status = 'open' and removed) = 1 and (select on_hand = 6 from public.inventory_items where id = fan), 'a unit needing repair is not put back in the store');
  select * into rw from public.inventory_item_list(a, 'fan') limit 1;
  perform pg_temp.check(rw.repair_qty = 1, 'the item list shows what is under repair');
  perform public.inventory_repair_close(a, (select id from public.inventory_repairs where status = 'open' limit 1), 'fixed', 450, 'New capacitor', 'Local electrician');
  perform pg_temp.check((select on_hand = 7 from public.inventory_items where id = fan), 'a repaired unit returns to the store');

  -- clearance and the Transfer Certificate rule
  perform pg_temp.act_admin();
  insert into public.fee_dues (school_id, session_id, student_id, label, due_date, amount, concession) values (a, sess, s2, 'Tuition · Oct', public.today_ist() + 20, 3000, 0) returning id into due;
  select id into tc from public.document_templates where school_id = a and on_issue = 'mark_transferred' limit 1;
  perform pg_temp.act_as(pr);
  j := public.student_clearance(a, s2);
  perform pg_temp.check((j ->> 'owed')::numeric = 3000 and not (j ->> 'fees_clear')::boolean, 'clearance reports the pending fee, even an instalment not yet due (mode "all")');
  begin perform public.issue_document(a, tc, s2, null, null, jsonb_build_object('reason', 'Relocation'), true, 'Principal'); perform pg_temp.check(false, 'tc blocked');
  exception when others then perform pg_temp.check(sqlerrm like '%Transfer Certificate cannot be issued%', 'a TC cannot be issued while fees are pending'); end;
  begin perform public.issue_certificate(a, s2, 'transfer', null, '{}'::jsonb, false, 'Principal'); perform pg_temp.check(false, 'old tc blocked');
  exception when others then perform pg_temp.check(sqlerrm like '%Transfer Certificate cannot be issued%', 'the old certificate screen is blocked the same way'); end;
  perform public.issue_certificate(a, s2, 'bonafide', null, '{}'::jsonb, false, 'Principal');
  perform pg_temp.check(true, 'other certificates are not blocked by pending fees');
  perform pg_temp.act_admin();
  update public.fee_settings set tc_clearance = 'due_till_today' where school_id = a;
  insert into public.fee_settings (school_id, tc_clearance) select a, 'due_till_today' where not exists (select 1 from public.fee_settings where school_id = a);
  perform pg_temp.act_as(pr);
  perform public.issue_document(a, tc, s2, null, null, jsonb_build_object('reason', 'Relocation'), true, 'Principal');
  perform pg_temp.check((select status = 'transferred' from public.students where id = s2), 'with "due till today" an instalment that is not due yet does not block the TC');
  perform pg_temp.act_admin();
  update public.fee_dues set due_date = public.today_ist() - 5 where id = due;
  insert into public.fee_dues (school_id, session_id, student_id, label, due_date, amount, concession) values (a, sess, s1, 'Tuition · Sep', public.today_ist() - 10, 1000, 0);
  perform pg_temp.act_as(pr);
  begin perform public.issue_document(a, tc, s1, null, null, jsonb_build_object('reason', 'Relocation'), true, 'Principal'); perform pg_temp.check(false, 'tc blocked 2');
  exception when others then perform pg_temp.check(sqlerrm like '%Transfer Certificate cannot be issued%', 'an overdue instalment blocks the TC in every mode'); end;
  perform pg_temp.act_admin();
  update public.fee_dues set paid = amount where student_id = s1;
  perform pg_temp.act_as(pr);
  perform pg_temp.check((public.student_clearance(a, s1) ->> 'owed')::numeric = 0, 'after payment the student is clear');
  perform public.issue_document(a, tc, s1, null, null, jsonb_build_object('reason', 'Relocation'), false, 'Principal');
  perform pg_temp.check((select tc_no is not null from public.students where id = s1), 'once the fees are paid the TC is issued');

  -- UP Board registration fee lands on the fee account and the payment flows back
  perform pg_temp.act_admin();
  insert into public.board_registrations (school_id, student_id, session_id, kind, class_level, exam_year) values (a, s1, sess, 'advance_registration', 9, 2028) returning id into breg;
  perform pg_temp.check((select count(*) from public.fee_dues where student_id = s1 and source_key = 'board:' || breg and amount = 50) = 1, 'a board registration puts its fee on the student''s fee account');
  update public.fee_dues set paid = amount where student_id = s1 and source_key = 'board:' || breg;
  perform pg_temp.check((select fee_paid_on is not null from public.board_registrations where id = breg), 'paying that due marks the board fee as paid');

  -- discipline fine
  perform pg_temp.act_as(pr);
  inc := public.discipline_report(a, array[s2], 'property_damage', 'moderate', public.today_ist(), 'Lab', 'Broke apparatus', null, false, null, false);
  n := public.discipline_set_fine(a, inc, 200);
  perform pg_temp.check(n = 1 and (select amount = 200 from public.fee_dues where student_id = s2 and source_key = 'disc:' || inc || ':' || s2), 'a discipline fine becomes a due');
  n := public.discipline_set_fine(a, inc, 0);
  perform pg_temp.check(not exists (select 1 from public.fee_dues where student_id = s2 and source_key like 'disc:%'), 'withdrawing the fine removes the unpaid due');

  -- isolation
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.inventory_assignments) = 0 and (select count(*) from public.inventory_locations) = 0 and (select count(*) from public.inventory_repairs) = 0, 'another school sees none of this');
  begin perform public.inventory_assign(a, fan, 1, 'location', room1); perform pg_temp.check(false, 'cross');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot assign from this store'); end;
end $$;

rollback;
