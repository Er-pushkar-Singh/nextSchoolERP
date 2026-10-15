-- Inventory & sales (step 36).
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
  ('e7e7e7e7-0000-0000-0000-000000000001', 'iv-owner@test.dev'), ('e7e7e7e7-0000-0000-0000-000000000002', 'iv-principal@test.dev'),
  ('e7e7e7e7-0000-0000-0000-000000000003', 'iv-frontoffice@test.dev'), ('e7e7e7e7-0000-0000-0000-000000000004', 'iv-teacher@test.dev'),
  ('e7e7e7e7-0000-0000-0000-000000000005', 'iv-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('e7e7e7e7-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'e7e7e7e7-0000-0000-0000-000000000001'; pr uuid := 'e7e7e7e7-0000-0000-0000-000000000002'; fo uuid := 'e7e7e7e7-0000-0000-0000-000000000003';
  te uuid := 'e7e7e7e7-0000-0000-0000-000000000004'; ot uuid := 'e7e7e7e7-0000-0000-0000-000000000005';
  a uuid; b uuid; cls uuid; s1 uuid; shirt uuid; book uuid; sup uuid; j jsonb; sale uuid; sale2 uuid; sale3 uuid; n int; rw record; sess uuid; due uuid; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('IV A', 'iva-' || sfx);
  b := public.create_school('IV B', 'ivb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fo, 'Front Office'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fo, 'front_office'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  select id into sess from public.sessions where school_id = a and is_current;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id) values (a, 'IV1', 'Aarav', 'Sharma', cls) returning id into s1;

  -- items: the principal creates; on_hand cannot be typed in
  perform pg_temp.act_as(pr);
  insert into public.inventory_items (school_id, sku, name, category, variant, cost, price, reorder_level, on_hand) values (a, 'SH-32', 'School shirt', 'Uniform', '32', 150, 250, 5, 99) returning id into shirt;
  insert into public.inventory_items (school_id, sku, name, category, cost, price, reorder_level) values (a, 'BK-5M', 'Maths textbook class 5', 'Books', 90, 120, 3) returning id into book;
  perform pg_temp.check((select on_hand = 0 from public.inventory_items where id = shirt), 'a new item starts with zero stock whatever is typed');
  update public.inventory_items set on_hand = 500 where id = shirt;
  perform pg_temp.check((select on_hand = 0 from public.inventory_items where id = shirt), 'stock cannot be edited by hand');
  begin insert into public.inventory_items (school_id, sku, name) values (a, 'sh-32', 'Dup'); perform pg_temp.check(false, 'dup sku');
  exception when unique_violation then perform pg_temp.check(true, 'a SKU is unique within the school (case-insensitive)'); end;

  -- purchase
  insert into public.inventory_suppliers (school_id, name, phone) values (a, 'Sharma Uniforms', '9811100009') returning id into sup;
  j := public.inventory_purchase(a, sup, public.today_ist(), 'B-77', jsonb_build_array(jsonb_build_object('item', shirt, 'qty', 20, 'unit_cost', 140), jsonb_build_object('item', book, 'qty', 10, 'unit_cost', 85)), 2000, 'cash', null);
  perform pg_temp.check((j ->> 'total')::numeric = 3650 and (select on_hand = 20 from public.inventory_items where id = shirt) and (select on_hand = 10 from public.inventory_items where id = book), 'a purchase raises stock and totals the bill');
  perform pg_temp.check((select cost = 140 from public.inventory_items where id = shirt), 'the item''s cost follows the last purchase');
  perform pg_temp.check((select count(*) from public.vouchers where school_id = a and kind = 'payment' and amount = 2000) = 1, 'the amount paid is posted as a payment voucher in the day book');
  begin perform public.inventory_purchase(a, null, null, null, jsonb_build_array(jsonb_build_object('item', shirt, 'qty', 1, 'unit_cost', 100)), 500, 'cash'); perform pg_temp.check(false, 'overpaid');
  exception when others then perform pg_temp.check(sqlerrm like '%cannot be more than the bill%', 'paying more than the bill is refused'); end;

  -- sale at the counter by front office
  perform pg_temp.act_as(fo);
  j := public.inventory_sell(a, 'student', s1, null, null, null, jsonb_build_array(jsonb_build_object('item', shirt, 'qty', 2), jsonb_build_object('item', book, 'qty', 1)), 0, 'upi');
  sale := (j ->> 'id')::uuid;
  perform pg_temp.check((j ->> 'total')::numeric = 620 and (select on_hand = 18 from public.inventory_items where id = shirt), 'a sale totals at the item prices and lowers stock');
  perform pg_temp.check((select status = 'paid' and voucher_id is not null from public.inventory_sales where id = sale), 'a paid sale posts a receipt voucher');
  begin perform public.inventory_sell(a, 'walkin', null, null, 'Visitor', null, jsonb_build_array(jsonb_build_object('item', shirt, 'qty', 50)), 0, 'cash'); perform pg_temp.check(false, 'oversell');
  exception when others then perform pg_temp.check(sqlerrm like '%in stock%', 'selling more than the stock is refused'); end;
  perform pg_temp.check((select on_hand = 18 from public.inventory_items where id = shirt) and (select count(*) = 1 from public.inventory_sales where school_id = a), 'a refused sale leaves no half-saved bill');
  j := public.inventory_sell(a, 'student', s1, null, null, null, jsonb_build_array(jsonb_build_object('item', book, 'qty', 1, 'price', 1)), 0, 'cash');
  sale3 := (j ->> 'id')::uuid;
  perform pg_temp.check((select unit_price = 120 from public.inventory_sale_lines where sale_id = sale3), 'a price typed by a counter clerk is ignored (list price applies)');
  begin perform public.inventory_sell(a, 'student', s1, null, null, null, jsonb_build_array(jsonb_build_object('item', book, 'qty', 1)), 20, 'cash'); perform pg_temp.check(false, 'discount');
  exception when others then perform pg_temp.check(sqlerrm like '%discount needs%', 'a discount needs the sales-edit permission'); end;
  begin perform public.inventory_sell(a, 'walkin', null, null, 'Visitor', null, jsonb_build_array(jsonb_build_object('item', book, 'qty', 1)), 0, 'fee_account'); perform pg_temp.check(false, 'walkin fee');
  exception when others then perform pg_temp.check(sqlerrm like '%Only a student%', 'only a student can be charged to the fee account'); end;

  -- charged to the fee account
  j := public.inventory_sell(a, 'student', s1, null, null, null, jsonb_build_array(jsonb_build_object('item', shirt, 'qty', 1)), 0, 'fee_account');
  sale2 := (j ->> 'id')::uuid;
  select fee_due_id into due from public.inventory_sales where id = sale2;
  perform pg_temp.check(due is not null and (select amount = 250 and student_id = s1 from public.fee_dues where id = due), 'a fee-account sale becomes a due on the student');
  perform pg_temp.check((select voucher_id is null and status = 'on_fee_account' from public.inventory_sales where id = sale2), 'and posts no voucher until the parent pays through Fees');

  -- permissions
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.inventory_items) = 0, 'a class teacher cannot see items');
  begin perform public.inventory_sell(a, 'walkin', null, null, 'x', null, jsonb_build_array(jsonb_build_object('item', book, 'qty', 1)), 0, 'cash'); perform pg_temp.check(false, 'teacher sell');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'a class teacher cannot sell'); end;
  perform pg_temp.act_as(fo);
  begin perform public.inventory_cancel_sale(a, sale, 'x'); perform pg_temp.check(false, 'fo cancel');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot cancel a sale'); end;
  begin perform public.inventory_adjust(a, shirt, 5, 'adjust', 'x'); perform pg_temp.check(false, 'fo adjust');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'front office cannot adjust stock'); end;

  -- principal: cancel, adjust, issue, stock take, lists
  perform pg_temp.act_as(pr);
  perform public.inventory_cancel_sale(a, sale2, 'Parent changed mind');
  perform pg_temp.check((select on_hand = 18 from public.inventory_items where id = shirt) and not exists (select 1 from public.fee_dues where id = due), 'cancelling a fee-account sale returns the stock and removes the charge');
  perform public.inventory_cancel_sale(a, sale, 'Wrong size');
  perform pg_temp.check((select on_hand = 20 from public.inventory_items where id = shirt) and (select status = 'cancelled' from public.vouchers where id = (select voucher_id from public.inventory_sales where id = sale)), 'cancelling a paid sale returns the stock and cancels the voucher');
  perform public.inventory_cancel_sale(a, sale3, 'Test bill');
  begin perform public.inventory_cancel_sale(a, sale, 'again'); perform pg_temp.check(false, 'cancel twice');
  exception when others then perform pg_temp.check(sqlerrm like '%already cancelled%', 'a sale cannot be cancelled twice'); end;
  perform public.inventory_adjust(a, shirt, 3, 'damage', 'Torn in storage');
  perform pg_temp.check((select on_hand = 17 from public.inventory_items where id = shirt), 'damaged stock is written off');
  begin perform public.inventory_adjust(a, shirt, 100, 'damage', 'x'); perform pg_temp.check(false, 'damage over');
  exception when others then perform pg_temp.check(sqlerrm like '%Only 17 in stock%', 'cannot write off more than is in stock'); end;
  n := public.inventory_issue(a, book, 2, 'Class 5 teacher', 'Reference copies');
  perform pg_temp.check(n = 8, 'issuing to a teacher lowers stock');
  n := public.inventory_stock_take(a, jsonb_build_array(jsonb_build_object('item', shirt, 'counted', 15), jsonb_build_object('item', book, 'counted', 8)));
  perform pg_temp.check(n = 1 and (select on_hand = 15 from public.inventory_items where id = shirt), 'a stock take corrects only the items that differ');
  select * into rw from public.inventory_item_list(a, 'shirt') limit 1;
  perform pg_temp.check(rw.on_hand = 15 and rw.state = 'ok' and rw.stock_value = 2100, 'the item list shows stock, value and state');
  perform pg_temp.check((select count(*) from public.inventory_item_list(a, null, null, 'attention')) = 0, 'no item needs attention yet');
  perform public.inventory_adjust(a, shirt, 11, 'damage', 'x');
  perform pg_temp.check((select count(*) from public.inventory_item_list(a, null, null, 'low')) = 1, 'an item at or below its reorder level is low');
  perform pg_temp.check((select count(*) from public.inventory_sale_list(a)) = 3, 'the sale list shows every bill');
  perform pg_temp.check((select count(*) from public.inventory_sale_list(a, null, null, null, 'cancelled')) = 3, 'filter sales by status');
  j := public.inventory_dashboard(a);
  perform pg_temp.check((j ->> 'low')::int = 1 and (j ->> 'sales_month')::numeric = 0 and (j ->> 'items')::int = 2, 'the dashboard counts low stock and non-cancelled sales');
  perform pg_temp.check((select sum(qty) from public.inventory_moves where item_id = shirt) = (select on_hand from public.inventory_items where id = shirt), 'stock always equals the sum of the ledger');

  -- another school
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) from public.inventory_items) = 0 and (select count(*) from public.inventory_sales) = 0 and (select count(*) from public.inventory_moves) = 0, 'another school sees nothing');
  begin perform public.inventory_sell(a, 'walkin', null, null, 'x', null, jsonb_build_array(jsonb_build_object('item', book, 'qty', 1)), 0, 'cash'); perform pg_temp.check(false, 'cross sell');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot sell from this stock'); end;
end $$;

rollback;