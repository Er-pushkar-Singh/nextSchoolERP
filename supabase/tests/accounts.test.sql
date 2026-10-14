-- Accounts: vouchers, books, day book (step 20).
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
  ('b2b2b2b2-0000-0000-0000-000000000001', 'ac-owner@test.dev'), ('b2b2b2b2-0000-0000-0000-000000000002', 'ac-principal@test.dev'),
  ('b2b2b2b2-0000-0000-0000-000000000003', 'ac-accountant@test.dev'), ('b2b2b2b2-0000-0000-0000-000000000004', 'ac-teacher@test.dev'),
  ('b2b2b2b2-0000-0000-0000-000000000005', 'ac-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('b2b2b2b2-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'b2b2b2b2-0000-0000-0000-000000000001'; pr uuid := 'b2b2b2b2-0000-0000-0000-000000000002'; ac uuid := 'b2b2b2b2-0000-0000-0000-000000000003';
  te uuid := 'b2b2b2b2-0000-0000-0000-000000000004'; ot uuid := 'b2b2b2b2-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; stu uuid; cash uuid; bank uuid; inc uuid; exp uuid; v1 uuid; v2 uuid; v3 uuid; v4 uuid; n int; sfx text := substr(md5(random()::text), 1, 6);
  d date := public.today_ist(); rw record; rid uuid;
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Acc A', 'acca-' || sfx);
  b := public.create_school('Acc B', 'accb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, ac, 'Accountant'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (ac, 'accountant'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (a, 'AC1', 'Aarav', 'Sharma', cls) returning id into stu;

  -- defaults
  perform pg_temp.act_as(pr);
  perform public.ensure_account_defaults(a);
  select id into cash from public.account_books where school_id = a and kind = 'cash';
  perform pg_temp.check(cash is not null, 'a cash book exists by default');
  perform pg_temp.check((select count(*) from public.account_heads where school_id = a and kind = 'income') >= 5 and (select count(*) from public.account_heads where school_id = a and kind = 'expense') >= 8,
    'income and expense heads are seeded');
  select id into inc from public.account_heads where school_id = a and kind = 'income' and name = 'Donations';
  select id into exp from public.account_heads where school_id = a and kind = 'expense' and name = 'Electricity & water';
  insert into public.account_books (school_id, name, kind, opening_balance, opening_date) values (a, 'SBI current', 'bank', 10000, d - 30) returning id into bank;
  update public.account_books set opening_balance = 2000, opening_date = d - 30 where id = cash;

  -- teacher: no access
  perform pg_temp.act_as(te);
  begin perform public.save_voucher(a, null, 'receipt', d, inc, cash, null, 100, 'x', 'cash', null, null); perform pg_temp.check(false, 'teacher voucher');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot create vouchers'); end;
  perform pg_temp.check((select count(*) from public.vouchers) = 0 and (select count(*) from public.account_books) = 0, 'a class teacher sees no books or vouchers');

  -- principal vouchers
  perform pg_temp.act_as(pr);
  v1 := public.save_voucher(a, null, 'receipt', d, inc, cash, null, 3000, 'Mr Verma', 'cash', null, 'Annual day donation');
  v2 := public.save_voucher(a, null, 'payment', d, exp, cash, null, 1200, 'UPPCL', 'cash', 'BILL-77', 'Electricity bill');
  perform pg_temp.check((select status = 'posted' and no like 'RV-%' from public.vouchers where id = v1), 'a receipt voucher is posted with an RV number');
  perform pg_temp.check((select no like 'PV-%' from public.vouchers where id = v2), 'a payment voucher gets a PV number');
  begin perform public.save_voucher(a, null, 'payment', d, inc, cash, null, 100, null, 'cash', null, null); perform pg_temp.check(false, 'wrong head');
  exception when others then perform pg_temp.check(sqlerrm like '%does not belong%', 'an income head cannot be used on a payment'); end;
  begin perform public.save_voucher(a, null, 'receipt', d + 1, inc, cash, null, 100, null, 'cash', null, null); perform pg_temp.check(false, 'future');
  exception when others then perform pg_temp.check(sqlerrm like '%future%', 'a future date is refused'); end;
  begin perform public.save_voucher(a, null, 'receipt', d, inc, cash, null, 0, null, 'cash', null, null); perform pg_temp.check(false, 'zero');
  exception when others then perform pg_temp.check(sqlerrm like '%greater than zero%', 'a zero amount is refused'); end;
  begin perform public.save_voucher(a, null, 'transfer', d, null, cash, cash, 100, null, null, null, null); perform pg_temp.check(false, 'self transfer');
  exception when others then perform pg_temp.check(sqlerrm like '%two different%', 'a transfer needs two different books'); end;
  v3 := public.save_voucher(a, null, 'transfer', d, null, cash, bank, 1000, null, 'cash', null, 'Deposit to bank');

  -- fee money flows in without a voucher
  perform pg_temp.act_admin();
  insert into public.fee_receipts (school_id, receipt_no, student_id, paid_on, mode, amount, collected_by) values (a, 'R9001', stu, d, 'mixed', 1500, 'Accountant') returning id into rid;
  insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount) values (a, rid, 'cash', 1000), (a, rid, 'upi', 500);
  insert into public.fee_refunds (school_id, student_id, amount, reason, status, mode, paid_on) values (a, stu, 200, 'Excess paid', 'paid', 'cash', d);

  perform pg_temp.act_as(pr);
  select count(*) into n from public.account_daybook(a, d, d);
  perform pg_temp.check(n = 7, 'day book lists vouchers, a transfer (two legs), fee payments and the refund together');
  select * into rw from public.account_daybook(a, d, d, null, null, null, 'fee') limit 1;
  perform pg_temp.check(rw.total = 2 and rw.sum_in = 1500, 'source filter: fee receipts only (2 payment rows, 1,500)');
  select count(*) into n from public.account_daybook(a, d, d, null, null, null, null, 'Verma');
  perform pg_temp.check(n = 1, 'search finds a voucher by party in the database');
  select count(*) into n from public.account_daybook(a, d, d, null, 'out');
  perform pg_temp.check(n = 3, 'direction filter: payments, transfer out and refund');

  -- books
  select * into rw from public.account_books_summary(a, d, d) where kind = 'cash';
  -- cash: 2000 opening + 3000 donation - 1200 bill - 1000 transfer + 1000 fee cash - 200 refund = 3600
  perform pg_temp.check(rw.opening = 2000 and rw.closing = 3600, 'cash book: opening 2,000 and closing 3,600');
  select * into rw from public.account_books_summary(a, d, d) where kind = 'bank';
  -- bank: 10000 + 1000 transfer + 500 upi = 11500
  perform pg_temp.check(rw.opening = 10000 and rw.closing = 11500, 'bank book: transfer and non-cash fees land in the bank');

  -- head summary excludes transfers
  perform pg_temp.check((select sum(total) from public.account_head_summary(a, d, d) where dir = 'in') = 4500, 'head summary: income = donation + fees, no transfer');

  -- approval threshold
  update public.account_settings set approval_above = 5000 where school_id = a;
  perform pg_temp.act_as(ac);
  v4 := public.save_voucher(a, null, 'payment', d, exp, cash, null, 8000, 'Contractor', 'cash', null, 'Repairs');
  perform pg_temp.check((select status = 'pending' from public.vouchers where id = v4), 'an accountant voucher above the limit waits for approval');
  select count(*) into n from public.account_daybook(a, d, d, null, null, null, 'voucher');
  perform pg_temp.check(n = 4, 'a pending voucher is not in the day book');
  begin perform public.decide_voucher(v4, true); perform pg_temp.check(false, 'self approve');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'an accountant cannot approve'); end;
  perform pg_temp.act_as(pr);
  perform public.decide_voucher(v4, true, null);
  perform pg_temp.check((select status = 'posted' and decided_by_name = 'Principal' from public.vouchers where id = v4), 'the principal approves it');
  select count(*) into n from public.account_daybook(a, d, d, null, null, null, 'voucher');
  perform pg_temp.check(n = 5, 'an approved voucher enters the day book');

  -- cancel and edit
  begin perform public.cancel_voucher(v4, ' '); perform pg_temp.check(false, 'no reason');
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'cancelling needs a reason'); end;
  perform public.cancel_voucher(v4, 'Wrong contractor');
  select count(*) into n from public.account_daybook(a, d, d, null, null, null, 'voucher');
  perform pg_temp.check(n = 4, 'a cancelled voucher leaves the day book');
  begin perform public.save_voucher(a, v4, 'payment', d, exp, cash, null, 10, null, 'cash', null, null); perform pg_temp.check(false, 'edit cancelled');
  exception when others then perform pg_temp.check(sqlerrm like '%cannot be changed%', 'a cancelled voucher cannot be edited'); end;
  perform public.save_voucher(a, v2, 'payment', d, exp, cash, null, 1500, 'UPPCL', 'cash', 'BILL-77', 'Electricity bill (corrected)');
  perform pg_temp.check((select amount = 1500 from public.vouchers where id = v2), 'a posted voucher can be edited');
  select count(*) into n from public.voucher_list(a, d - 5, d, null, 'cancelled');
  perform pg_temp.check(n = 1, 'voucher list filters by status in the database');

  -- isolation
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.vouchers) = 0 and (select count(*) from public.account_daybook(a, d, d)) = 0, 'another school sees nothing');
  begin perform public.decide_voucher(v4, true); perform pg_temp.check(false, 'cross'); exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot decide our vouchers'); end;
  begin perform public._ledger(a, d, d); perform pg_temp.check(false, 'ledger'); exception when others then perform pg_temp.check(sqlerrm like '%permission denied%', 'the raw ledger is not callable'); end;
end $$;

rollback;
