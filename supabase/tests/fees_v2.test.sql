-- Fees 2.0 test (step 10). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/fees_v2.test.sql
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
create or replace function pg_temp.act_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

insert into auth.users (id, email) values
  ('f2f2f2f2-0000-0000-0000-000000000001', 'fv-owner@test.dev'),
  ('f2f2f2f2-0000-0000-0000-000000000002', 'fv-principal@test.dev'),
  ('f2f2f2f2-0000-0000-0000-000000000003', 'fv-acct@test.dev'),
  ('f2f2f2f2-0000-0000-0000-000000000004', 'fv-teacher@test.dev'),
  ('f2f2f2f2-0000-0000-0000-000000000005', 'fv-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('f2f2f2f2-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'f2f2f2f2-0000-0000-0000-000000000001'; pr uuid := 'f2f2f2f2-0000-0000-0000-000000000002';
  ac uuid := 'f2f2f2f2-0000-0000-0000-000000000003'; te uuid := 'f2f2f2f2-0000-0000-0000-000000000004'; ot uuid := 'f2f2f2f2-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; sec uuid; sess uuid; sess2 uuid; head uuid; plan1 uuid; plan2 uuid; s1 uuid; s2 uuid; s3 uuid;
  d1 uuid; d2 uuid; rid uuid; rid2 uuid; con uuid; cq uuid; rf uuid; oid uuid; n int; v numeric; r json;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Fee A', 'feea-' || sfx);
  b := public.create_school('Fee B', 'feeb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, ac, 'Accountant'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (ac, 'accountant'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '8';
  select id into sec from public.sections where class_id = cls limit 1;
  select id into sess from public.sessions where school_id = a and is_current;
  select id into head from public.fee_heads where school_id = a and name = 'Tuition Fee';
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'F1', 'Ravi', 'Singh', cls, sec) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'F2', 'Sana', 'Khan', cls, sec) returning id into s2;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id) values (a, 'F3', 'Amit', 'Rai', cls, sec) returning id into s3;
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (a, sess, cls, head, 'Apr', current_date - 40, 1000) returning id into plan1;
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (a, sess, cls, head, 'May', current_date + 20, 1000) returning id into plan2;

  -- ── Concession approval workflow ──
  perform pg_temp.act_as(pr);
  perform public.generate_dues(a, sess);
  perform pg_temp.check((select count(*) = 6 from public.fee_dues where school_id = a), 'dues are generated for 3 students × 2 instalments');
  insert into public.fee_settings (school_id, concession_approval, fine_enabled, fine_mode, fine_amount, fine_grace_days, fine_cap, bounce_charge, online_enabled)
    values (a, true, true, 'per_day', 5, 5, 100, 50, true);
  perform pg_temp.act_as(ac);
  insert into public.student_concessions (school_id, student_id, fee_head_id, kind, value, reason, category) values (a, s1, head, 'percent', 50, 'Sibling', 'sibling') returning id into con;
  perform pg_temp.check((select status = 'pending' from public.student_concessions where id = con), 'accountant''s concession waits for approval when approval is on');
  perform public.reapply_concessions(a, s1);
  perform pg_temp.check((select sum(concession) = 0 from public.fee_dues where student_id = s1), 'a pending concession is not billed');
  update public.student_concessions set status = 'approved' where id = con;
  perform pg_temp.check((select status = 'pending' from public.student_concessions where id = con), 'accountant cannot approve a concession (still pending)');
  perform pg_temp.act_as(pr);
  update public.student_concessions set status = 'approved' where id = con;
  perform public.reapply_concessions(a, s1);
  perform pg_temp.check((select sum(concession) = 1000 from public.fee_dues where student_id = s1), 'approved concession is billed on both instalments (50%)');
  begin update public.fee_dues set concession = 2000 where student_id = s1; perform pg_temp.check(false, 'direct update');
  exception when others then perform pg_temp.check(sqlerrm like '%fee screens%', 'money columns cannot be edited directly'); end;

  -- ── Late fine ──
  perform pg_temp.act_as(pr);
  n := public.apply_late_fines(a, current_date);
  perform pg_temp.check(n = 3, 'late fine applies to the three overdue April instalments');
  select fine into v from public.fee_dues where student_id = s2 and label like '%Apr';
  perform pg_temp.check(v = 100, 'fine = (40 days − 5 grace) × 5 capped at 100');
  n := public.apply_late_fines(a, current_date);
  perform pg_temp.check((select fine from public.fee_dues where student_id = s2 and label like '%Apr') = 100, 'applying again does not double the fine');
  perform pg_temp.check((select fine = 0 from public.fee_dues where student_id = s2 and label like '%May'), 'a not-yet-due instalment has no fine');
  select id into d1 from public.fee_dues where student_id = s2 and label like '%Apr';
  perform public.waive_fine(d1, 40, 'Parent was in hospital');
  perform pg_temp.check((select fine = 60 and fine_waived = 40 from public.fee_dues where id = d1), 'fine waiver reduces the fine and is remembered');
  perform public.apply_late_fines(a, current_date);
  perform pg_temp.check((select fine = 60 from public.fee_dues where id = d1), 'a waived fine does not come back at the next run');
  begin perform public.waive_fine(d1, 10, ''); perform pg_temp.check(false, 'no reason');
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'waiving needs a reason'); end;
  perform pg_temp.act_as(ac);
  begin perform public.waive_fine(d1, 10, 'friend'); perform pg_temp.check(false, 'acct waive');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'accountant cannot waive a fine'); end;

  -- ── Collection: choose instalments, split payment, wallet ──
  select id into d2 from public.fee_dues where student_id = s2 and label like '%May';
  rid := public.collect_fee_v2(a, s2, '[{"mode":"cash","amount":300},{"mode":"upi","amount":200,"reference":"UPI123"}]'::jsonb, array[d2], 0, null, 'split', 'Accountant', 0);
  perform pg_temp.check((select mode = 'mixed' and amount = 500 from public.fee_receipts where id = rid), 'split payment makes one mixed receipt of 500');
  perform pg_temp.check((select count(*) = 2 from public.fee_receipt_payments where receipt_id = rid), 'both payment lines are stored');
  perform pg_temp.check((select paid = 500 from public.fee_dues where id = d2), 'only the chosen instalment was paid');
  perform pg_temp.check((select paid = 0 from public.fee_dues where id = d1), 'the other instalment was not touched');

  -- advance
  rid2 := public.collect_fee_v2(a, s3, '[{"mode":"cash","amount":2500}]'::jsonb, null, 0, null, null, 'Accountant', 0);
  perform pg_temp.check((select advance_amount = 400 from public.fee_receipts where id = rid2), 'money above the total due is kept as advance (2500 vs 2100 due incl. fine)');
  perform pg_temp.act_as(ac);
  perform pg_temp.check(public.wallet_balance(s3) = 400, 'wallet balance function shows the advance');
  perform pg_temp.act_admin();
  perform pg_temp.check((select coalesce(sum(amount), 0) = 400 from public.fee_wallet_entries where student_id = s3), 'wallet holds the 400 advance');
  perform pg_temp.check((select bool_and(status = 'paid') from public.fee_dues where student_id = s3), 'student 3 is fully paid');

  -- wallet use against a new charge
  perform pg_temp.act_as(pr);
  perform public.add_charge(a, sess, array[s3], null, null, null, 'Picnic', current_date + 5, 300);
  perform pg_temp.check((select count(*) = 1 from public.fee_dues where student_id = s3 and kind = 'charge'), 'ad-hoc charge added to one student');
  perform public.collect_fee_v2(a, s3, '[]'::jsonb, null, 300, null, 'from wallet', 'Principal', 0);
  perform pg_temp.act_admin();
  perform pg_temp.check((select coalesce(sum(amount), 0) = 100 from public.fee_wallet_entries where student_id = s3), 'wallet is reduced by what was used');
  perform pg_temp.check((select status = 'paid' from public.fee_dues where student_id = s3 and kind = 'charge'), 'the charge was cleared from the wallet');
  perform pg_temp.act_as(pr);
  begin perform public.collect_fee_v2(a, s3, '[]'::jsonb, null, 9999, null, null, null, 0); perform pg_temp.check(false, 'overuse');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'cannot use more than the wallet holds'); end;
  begin perform public.collect_fee_v2(a, s1, '[{"mode":"cash","amount":-5}]'::jsonb, null, 0, null, null, null, 0); perform pg_temp.check(false, 'neg');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'a negative payment is refused'); end;
  begin perform public.collect_fee_v2(a, s1, '[{"mode":"bitcoin","amount":5}]'::jsonb, null, 0, null, null, null, 0); perform pg_temp.check(false, 'mode');
  exception when others then perform pg_temp.check(sqlerrm like '%Unknown payment mode%', 'an unknown mode is refused'); end;

  -- teacher cannot collect
  perform pg_temp.act_as(te);
  begin perform public.collect_fee_v2(a, s1, '[{"mode":"cash","amount":10}]'::jsonb, null, 0, null, null, null, 0); perform pg_temp.check(false, 'teacher');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'a teacher cannot collect fees'); end;

  -- ── Cheque bounce ──
  perform pg_temp.act_as(ac);
  select id into d1 from public.fee_dues where student_id = s1 and label like '%May';
  rid := public.collect_fee_v2(a, s1, '[{"mode":"cheque","amount":400,"cheque_no":"334455","bank":"SBI","cheque_date":"2026-10-01"}]'::jsonb, array[d1], 0, null, null, 'Accountant', 0);
  select id into cq from public.fee_cheques where receipt_id = rid;
  perform pg_temp.check(cq is not null, 'a cheque payment is registered in the cheque register');
  perform public.set_cheque_status(cq, 'deposited');
  perform pg_temp.check((select status = 'deposited' from public.fee_cheques where id = cq), 'cheque can be marked deposited');
  begin perform public.set_cheque_status(cq, 'bounced', null, 'Insufficient funds'); perform pg_temp.check(false, 'acct bounce');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'accountant cannot mark a cheque bounced'); end;
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select paid = 400 from public.fee_dues where id = d1), 'the cheque payment counted before the bounce');
  perform public.set_cheque_status(cq, 'bounced', null, 'Insufficient funds');
  perform pg_temp.check((select paid = 0 from public.fee_dues where id = d1), 'a bounced cheque takes the payment back');
  perform pg_temp.check((select cancelled from public.fee_receipts where id = rid), 'the receipt of a bounced cheque is cancelled');
  perform pg_temp.check(exists (select 1 from public.fee_dues where student_id = s1 and kind = 'bounce' and amount = 50), 'the bank charge is billed');
  begin perform public.set_cheque_status(cq, 'cleared'); perform pg_temp.check(false, 'after bounce');
  exception when others then perform pg_temp.check(sqlerrm like '%already%', 'a bounced cheque cannot be cleared'); end;

  -- ── Adjust, extend, waive ──
  select id into d1 from public.fee_dues where student_id = s1 and label like '%May';
  perform public.adjust_due_amount(d1, 800, 'Custom fee agreed');
  perform pg_temp.check((select amount = 800 from public.fee_dues where id = d1) and exists (select 1 from public.fee_adjustments where due_id = d1 and kind = 'amount_change'), 'amount changed and the change is recorded');
  perform public.extend_dues(a, array[d1], current_date + 60, 'Harvest season');
  perform pg_temp.check((select due_date = current_date + 60 and original_due_date = current_date + 20 from public.fee_dues where id = d1), 'due date extended, original kept');
  perform public.waive_due(d1, 100, 'Staff request');
  perform pg_temp.check((select concession >= 100 from public.fee_dues where id = d1), 'waiver raises the concession');
  begin perform public.waive_due(d1, 99999, 'too much'); perform pg_temp.check(false, 'over waive');
  exception when others then perform pg_temp.check(sqlerrm like '%at most%', 'cannot waive more than the balance'); end;

  -- ── Reverse a payment to wallet, then refund ──
  select id into d2 from public.fee_dues where student_id = s2 and label like '%May';
  perform public.reverse_payment(d2, 500, 'Wrong student');
  perform pg_temp.check((select paid = 0 from public.fee_dues where id = d2), 'the payment is moved off the instalment');
  perform pg_temp.check((select coalesce(sum(amount), 0) = 500 from public.fee_wallet_entries where student_id = s2), 'and credited to the wallet');
  perform pg_temp.act_as(ac);
  rf := public.request_refund(a, s2, 300, 'Left the school');
  begin perform public.request_refund(a, s2, 300, 'again'); perform pg_temp.check(false, 'double refund');
  exception when others then perform pg_temp.check(sqlerrm like '%available%', 'pending refunds are held against the wallet'); end;
  begin perform public.pay_refund(rf, 'cash', null); perform pg_temp.check(false, 'unapproved');
  exception when others then perform pg_temp.check(sqlerrm like '%approved%', 'an unapproved refund cannot be paid'); end;
  begin perform public.decide_refund(rf, true); perform pg_temp.check(false, 'acct approve');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'accountant cannot approve a refund'); end;
  perform pg_temp.act_as(pr);
  perform public.decide_refund(rf, true, 'ok');
  perform public.pay_refund(rf, 'cash', null);
  perform pg_temp.check((select status = 'paid' from public.fee_refunds where id = rf), 'refund approved and paid');
  perform pg_temp.act_admin();
  perform pg_temp.check((select coalesce(sum(amount), 0) = 200 from public.fee_wallet_entries where student_id = s2), 'the wallet is reduced by the refund');

  -- ── Day close ──
  perform pg_temp.act_as(ac);
  v := public.cash_expected(a, current_date, 'Accountant');
  perform pg_temp.check(v > 0, 'expected cash for the collector is calculated');
  perform public.close_day(a, current_date, 'Accountant', v - 10, 'short');
  perform pg_temp.check((select difference = -10 from public.fee_day_close where school_id = a and day = current_date), 'day close records the difference');

  -- ── Reports ──
  perform pg_temp.act_as(pr);
  perform pg_temp.check((select sum(amount) > 0 from public.fee_report(a, current_date - 1, current_date, 'day')), 'collection report by day');
  perform pg_temp.check((select count(*) >= 1 from public.fee_report(a, current_date - 1, current_date, 'mode')), 'collection report by mode');
  perform pg_temp.check((select count(*) >= 1 from public.fee_report(a, current_date - 1, current_date, 'head')), 'collection report by head');
  perform pg_temp.check((select count(*) >= 1 from public.fee_aging(a, sess)), 'ageing report');

  -- ── Carry forward ──
  perform pg_temp.act_admin();
  insert into public.sessions (school_id, name, start_date, end_date, is_current) values (a, '2099-00', current_date, current_date + 300, false) returning id into sess2;
  perform pg_temp.act_as(pr);
  n := public.carry_forward_dues(a, sess, sess2, current_date + 30);
  perform pg_temp.check(n >= 1, 'arrears are carried to the new session');
  perform pg_temp.check((select count(*) = 0 from public.fee_dues where student_id = s1 and session_id = sess and status <> 'paid'), 'the old session no longer shows a balance');
  perform pg_temp.check((select amount > 0 from public.fee_dues where student_id = s1 and session_id = sess2 and kind = 'arrears'), 'the arrears are billed in the new session');
  perform public.carry_forward_dues(a, sess, sess2, current_date + 30);
  perform pg_temp.check((select count(*) = 1 from public.fee_dues where student_id = s1 and kind = 'arrears'), 'carrying forward twice does not duplicate');

  -- ── Online orders (service role only) ──
  perform pg_temp.act_as(pr);
  begin perform public.create_online_order(a, s2, 100, null); perform pg_temp.check(false, 'user order');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'a signed-in user cannot create an online order directly'); end;
  perform pg_temp.act_service();
  select id into d1 from public.fee_dues where student_id = s1 and kind = 'arrears';
  oid := public.create_online_order(a, s1, 300, array[d1]);
  update public.fee_online_orders set link_id = 'plink_1' where id = oid;
  r := public.complete_online_order('plink_1', 'pay_1', 29999);
  perform pg_temp.check((r ->> 'ok')::boolean = false, 'a payment of the wrong amount is not accepted');
  update public.fee_online_orders set status = 'created' where id = oid;
  r := public.complete_online_order('plink_1', 'pay_1', 30000);
  perform pg_temp.check((r ->> 'ok')::boolean and r ->> 'receipt_no' is not null, 'a matching payment creates a receipt automatically');
  r := public.complete_online_order('plink_1', 'pay_1', 30000);
  perform pg_temp.check((r ->> 'note') like '%already%', 'the same webhook twice does not double-receipt');
  perform pg_temp.act_admin();
  perform pg_temp.check((select count(*) = 1 from public.fee_receipts where online_order_id = oid), 'exactly one receipt for the online order');
  perform pg_temp.check((select paid = 300 from public.fee_dues where id = d1), 'the online payment reduced the due');

  -- ── Isolation ──
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) = 0 from public.fee_cheques), 'another school sees no cheques');
  perform pg_temp.check((select count(*) = 0 from public.fee_refunds), 'another school sees no refunds');
  perform pg_temp.check((select count(*) = 0 from public.fee_wallet_entries), 'another school sees no wallet entries');
  begin perform public.waive_due(d1, 1, 'x'); perform pg_temp.check(false, 'cross waive');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'another school cannot waive our dues'); end;
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) = 0 from public.fee_cheques), 'a teacher sees no cheques');
  perform pg_temp.check((select count(*) = 0 from public.fee_refunds), 'a teacher sees no refunds');

  -- ── Internal helpers are not public API ──
  begin perform public.collect_fee_core(a, s1, '[]'::jsonb, null, 0, null, null, null, 0, true); perform pg_temp.check(false, 'core');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'collect_fee_core is not callable by a signed-in user'); end;
end $$;

rollback;
