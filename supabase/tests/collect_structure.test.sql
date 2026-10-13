-- Structure-wise collection and automatic fine (step 15).
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
  ('efefefef-0000-0000-0000-000000000001', 'cs-owner@test.dev'), ('efefefef-0000-0000-0000-000000000002', 'cs-principal@test.dev'),
  ('efefefef-0000-0000-0000-000000000003', 'cs-acct@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('efefefef-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'efefefef-0000-0000-0000-000000000001'; pr uuid := 'efefefef-0000-0000-0000-000000000002'; ac uuid := 'efefefef-0000-0000-0000-000000000003';
  a uuid; cls uuid; sess uuid; h1 uuid; h2 uuid; s1 uuid; s2 uuid; d_ann uuid; d_apr uuid; d_may uuid; d_other uuid; rid uuid; n int;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Struct A', 'stra-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, ac, 'Accountant');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (ac, 'accountant')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into cls from public.classes where school_id = a and name = '5';
  select id into sess from public.sessions where school_id = a and is_current;
  select id into h1 from public.fee_heads where school_id = a and name = 'Tuition Fee';
  select id into h2 from public.fee_heads where school_id = a and name = 'Annual Charges';
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values
    (a, sess, cls, h2, 'Annual', current_date - 40, 2000), (a, sess, cls, h1, 'Apr', current_date - 30, 1000), (a, sess, cls, h1, 'May', current_date + 10, 1000);
  insert into public.students (school_id, admission_no, first_name, class_id) values (a, 'S1', 'Aman', cls) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id) values (a, 'S2', 'Bela', cls) returning id into s2;
  insert into public.fee_settings (school_id, fine_enabled, fine_mode, fine_amount, fine_grace_days, fine_cap) values (a, true, 'per_day', 2, 5, 100);
  perform pg_temp.act_as(pr);
  perform public.generate_dues(a, sess);
  select id into d_ann from public.fee_dues where student_id = s1 and label like '%Annual%';
  select id into d_apr from public.fee_dues where student_id = s1 and label like '%Apr%';
  select id into d_may from public.fee_dues where student_id = s1 and label like '%May%';
  select id into d_other from public.fee_dues where student_id = s2 and label like '%Apr%';

  -- fine fetched automatically when the student is opened
  perform pg_temp.act_as(ac);
  n := public.refresh_student_fines(a, s1);
  perform pg_temp.check(n = 2, 'opening the student brings the late fine of both overdue instalments up to date');
  perform pg_temp.check((select fine = 70 from public.fee_dues where id = d_ann) and (select fine = 50 from public.fee_dues where id = d_apr), 'fine = (days late − grace) × rate: 35 days → 70, 25 days → 50');

  -- pay each fee its own amount
  rid := public.collect_fee_v2(a, s1, '[{"mode":"cash","amount":1500}]'::jsonb, null, 0, null, null, 'Accountant', 0,
          jsonb_build_array(jsonb_build_object('due_id', d_apr, 'amount', 1050), jsonb_build_object('due_id', d_ann, 'amount', 450)));
  perform pg_temp.check((select paid = 1050 from public.fee_dues where id = d_apr), 'the tuition instalment got exactly the amount chosen for it');
  perform pg_temp.check((select paid = 450 from public.fee_dues where id = d_ann), 'the annual charge got its own amount (oldest-first rule not applied)');
  perform pg_temp.check((select paid = 0 from public.fee_dues where id = d_may), 'an instalment that was not chosen is untouched');
  perform pg_temp.check((select count(*) = 2 and sum(amount) = 1500 from public.fee_receipt_lines where receipt_id = rid), 'the receipt lists one line per fee');

  -- errors
  begin perform public.collect_fee_v2(a, s1, '[{"mode":"cash","amount":10000}]'::jsonb, null, 0, null, null, null, 0, jsonb_build_array(jsonb_build_object('due_id', d_may, 'amount', 5000)));
    perform pg_temp.check(false, 'over balance'); exception when others then perform pg_temp.check(sqlerrm like '%more than its balance%', 'an amount above the instalment''s balance is refused'); end;
  begin perform public.collect_fee_v2(a, s1, '[{"mode":"cash","amount":100}]'::jsonb, null, 0, null, null, null, 0, jsonb_build_array(jsonb_build_object('due_id', d_may, 'amount', 500)));
    perform pg_temp.check(false, 'short'); exception when others then perform pg_temp.check(sqlerrm like '%less than the fees chosen%', 'a payment smaller than the chosen fees is refused'); end;
  begin perform public.collect_fee_v2(a, s1, '[{"mode":"cash","amount":100}]'::jsonb, null, 0, null, null, null, 0, jsonb_build_array(jsonb_build_object('due_id', d_other, 'amount', 100)));
    perform pg_temp.check(false, 'other student'); exception when others then perform pg_temp.check(sqlerrm like '%not open for this student%', 'another student''s instalment cannot be paid here'); end;
  begin perform public.collect_fee_v2(a, s1, '[{"mode":"cash","amount":200}]'::jsonb, null, 0, null, null, null, 0, jsonb_build_array(jsonb_build_object('due_id', d_may, 'amount', 100), jsonb_build_object('due_id', d_may, 'amount', 100)));
    perform pg_temp.check(false, 'twice'); exception when others then perform pg_temp.check(sqlerrm like '%twice%', 'the same instalment twice is refused'); end;

  -- extra payment becomes advance; a manual fine joins the first chosen fee
  rid := public.collect_fee_v2(a, s1, '[{"mode":"upi","amount":1200,"reference":"U1"}]'::jsonb, null, 0, null, null, 'Accountant', 25,
          jsonb_build_array(jsonb_build_object('due_id', d_may, 'amount', 1000)));
  perform pg_temp.check((select advance_amount = 175 from public.fee_receipts where id = rid), 'the amount above the chosen fees is kept as advance');
  perform pg_temp.check((select fine = 25 and paid = 1025 from public.fee_dues where id = d_may), 'the manual fine was added to that instalment and collected with it');

  -- the old behaviour (no allocation) still works
  rid := public.collect_fee_v2(a, s2, '[{"mode":"cash","amount":500}]'::jsonb, null, 0, null, null, null, 0);
  perform pg_temp.check((select sum(amount) = 500 from public.fee_receipt_lines where receipt_id = rid), 'payments without an allocation still go to the oldest fee first');
end $$;

rollback;
