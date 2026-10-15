-- ═══════════════════════════════════════════════════════════════════════════
-- Step 36: Inventory & sales — items with a stock ledger (one source of truth), suppliers and purchases, uniform / book / stationery
--          sales to a student, staff member or walk-in (paid at the counter, or charged to the student's fee account), issue to
--          staff and classes, stock take, low-stock alerts and a dashboard. Money flows into the day book by itself.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.inventory_settings (
  school_id        uuid primary key references public.schools(id) on delete cascade,
  sale_prefix      text not null default 'SL' check (length(sale_prefix) between 1 and 8),
  purchase_prefix  text not null default 'PU' check (length(purchase_prefix) between 1 and 8),
  next_sale_no     int not null default 1,
  next_purchase_no int not null default 1,
  post_to_accounts boolean not null default true,
  receipt_footer   text
);

create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  sku           text,
  name          text not null check (length(btrim(name)) between 1 and 120),
  category      text not null default 'General',
  variant       text,                                      -- size / class / colour
  unit          text not null default 'pcs',
  cost          numeric(12,2) not null default 0 check (cost >= 0),
  price         numeric(12,2) not null default 0 check (price >= 0),
  gst_rate      numeric(5,2) not null default 0 check (gst_rate between 0 and 40),
  reorder_level int not null default 0 check (reorder_level >= 0),
  track_stock   boolean not null default true,
  on_hand       int not null default 0,
  for_class_id  uuid references public.classes(id) on delete set null,   -- a book / uniform meant for one class
  location      text,
  barcode       text,
  active        boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  check (not track_stock or on_hand >= 0)
);
create unique index if not exists inventory_items_sku on public.inventory_items (school_id, lower(sku)) where sku is not null;
create index if not exists inventory_items_school on public.inventory_items (school_id, active, category, name);

create table if not exists public.inventory_suppliers (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name      text not null check (length(btrim(name)) between 1 and 100),
  phone     text,
  email     text,
  gstin     text,
  address   text,
  active    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.inventory_purchases (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  no          text not null,
  supplier_id uuid references public.inventory_suppliers(id) on delete set null,
  on_date     date not null default (now() at time zone 'Asia/Kolkata')::date,
  bill_no     text,
  total       numeric(14,2) not null check (total >= 0),
  paid        numeric(14,2) not null default 0 check (paid >= 0),
  mode        text,
  note        text,
  voucher_id  uuid references public.vouchers(id) on delete set null,
  status      text not null default 'posted' check (status in ('posted', 'cancelled')),
  by_name     text,
  created_at  timestamptz not null default now(),
  unique (school_id, no)
);
create table if not exists public.inventory_purchase_lines (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.inventory_purchases(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  item_id     uuid not null references public.inventory_items(id) on delete restrict,
  qty         int not null check (qty > 0),
  unit_cost   numeric(12,2) not null check (unit_cost >= 0),
  line_total  numeric(14,2) not null
);

create table if not exists public.inventory_sales (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  no               text not null,
  on_date          date not null default (now() at time zone 'Asia/Kolkata')::date,
  kind             text not null default 'student' check (kind in ('student', 'staff', 'walkin')),
  student_id       uuid references public.students(id) on delete set null,
  staff_id         uuid references public.staff(id) on delete set null,
  customer_name    text,
  phone            text,
  subtotal         numeric(14,2) not null default 0,
  discount         numeric(14,2) not null default 0 check (discount >= 0),
  total            numeric(14,2) not null default 0 check (total >= 0),
  mode             text not null default 'cash' check (mode in ('cash', 'upi', 'card', 'cheque', 'bank_transfer', 'fee_account')),
  status           text not null default 'paid' check (status in ('paid', 'on_fee_account', 'cancelled')),
  fee_due_id       uuid references public.fee_dues(id) on delete set null,
  voucher_id       uuid references public.vouchers(id) on delete set null,
  note             text,
  by_name          text,
  created_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_reason text,
  unique (school_id, no)
);
create index if not exists inventory_sales_day on public.inventory_sales (school_id, on_date desc);
create index if not exists inventory_sales_student on public.inventory_sales (student_id);
create table if not exists public.inventory_sale_lines (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references public.inventory_sales(id) on delete cascade,
  school_id  uuid not null references public.schools(id) on delete cascade,
  item_id    uuid not null references public.inventory_items(id) on delete restrict,
  item_name  text not null,
  qty        int not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null
);

-- every change of stock, signed; items.on_hand is kept equal to the sum by the trigger
create table if not exists public.inventory_moves (
  id         bigint generated always as identity primary key,
  school_id  uuid not null references public.schools(id) on delete cascade,
  item_id    uuid not null references public.inventory_items(id) on delete cascade,
  kind       text not null check (kind in ('opening', 'purchase', 'sale', 'sale_return', 'issue', 'issue_return', 'adjust', 'damage', 'stock_take')),
  qty        int not null check (qty <> 0),
  unit_cost  numeric(12,2),
  ref_type   text,
  ref_id     uuid,
  party      text,                                   -- who it was issued to, or the supplier / customer
  note       text,
  by_name    text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_moves_item on public.inventory_moves (item_id, created_at desc);
create index if not exists inventory_moves_school on public.inventory_moves (school_id, created_at desc);

create or replace function public._inv_apply_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.inventory_items set on_hand = on_hand + new.qty where id = new.item_id;
  return new;
end $$;
drop trigger if exists inventory_apply_move on public.inventory_moves;
create trigger inventory_apply_move after insert on public.inventory_moves for each row execute function public._inv_apply_move();

alter table public.inventory_settings enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_suppliers enable row level security;
alter table public.inventory_purchases enable row level security;
alter table public.inventory_purchase_lines enable row level security;
alter table public.inventory_sales enable row level security;
alter table public.inventory_sale_lines enable row level security;
alter table public.inventory_moves enable row level security;

-- reads
do $$
declare r record;
begin
  for r in select * from (values
      ('inventory_items', 'inventory.items.view'), ('inventory_moves', 'inventory.items.view'), ('inventory_suppliers', 'inventory.purchase.view'),
      ('inventory_purchases', 'inventory.purchase.view'), ('inventory_purchase_lines', 'inventory.purchase.view'),
      ('inventory_sales', 'inventory.sales.view'), ('inventory_sale_lines', 'inventory.sales.view')) v(t, p) loop
    execute format('drop policy if exists "read" on public.%I', r.t);
    execute format('create policy "read" on public.%I for select to authenticated using (public.has_perm_school(school_id, %L))', r.t, r.p);
  end loop;
end $$;
-- the sales counter needs to see items and suppliers' names where it sells / buys
drop policy if exists "read" on public.inventory_items;
create policy "read" on public.inventory_items for select to authenticated
  using (public.has_perm_school(school_id, 'inventory.items.view') or public.has_perm_school(school_id, 'inventory.sales.create') or public.has_perm_school(school_id, 'inventory.purchase.create'));
drop policy if exists "read" on public.inventory_settings;
create policy "read" on public.inventory_settings for select to authenticated using (public.has_module_perm(school_id, 'inventory'));
drop policy if exists "write" on public.inventory_settings;
create policy "write" on public.inventory_settings for all to authenticated
  using (public.has_perm_school(school_id, 'inventory.items.edit')) with check (public.has_perm_school(school_id, 'inventory.items.edit'));

-- items and suppliers are edited directly (policies); money and stock only through the functions below
drop policy if exists "create" on public.inventory_items;
create policy "create" on public.inventory_items for insert to authenticated with check (public.has_perm_school(school_id, 'inventory.items.create'));
drop policy if exists "edit" on public.inventory_items;
create policy "edit" on public.inventory_items for update to authenticated using (public.has_perm_school(school_id, 'inventory.items.edit')) with check (public.has_perm_school(school_id, 'inventory.items.edit'));
drop policy if exists "delete" on public.inventory_items;
create policy "delete" on public.inventory_items for delete to authenticated using (public.has_perm_school(school_id, 'inventory.items.delete'));
drop policy if exists "write" on public.inventory_suppliers;
create policy "write" on public.inventory_suppliers for all to authenticated
  using (public.has_perm_school(school_id, 'inventory.purchase.edit')) with check (public.has_perm_school(school_id, 'inventory.purchase.create'));

-- on_hand must not be edited by hand
create or replace function public._inv_guard_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.on_hand := 0; return new; end if;
  if new.on_hand is distinct from old.on_hand and coalesce(current_setting('app.inv_move', true), '') <> '1' and pg_trigger_depth() < 2 then new.on_hand := old.on_hand; end if;
  return new;
end $$;
drop trigger if exists inventory_guard_item on public.inventory_items;
create trigger inventory_guard_item before insert or update on public.inventory_items for each row execute function public._inv_guard_item();

-- ───────────── helpers ─────────────
create or replace function public._inv_cfg(sid uuid) returns public.inventory_settings
language plpgsql security definer set search_path = public as $$
declare c public.inventory_settings;
begin
  insert into public.inventory_settings (school_id) values (sid) on conflict do nothing;
  select * into c from public.inventory_settings where school_id = sid;
  return c;
end $$;
revoke execute on function public._inv_cfg(uuid) from public, anon, authenticated;

-- one voucher in the day book: kind receipt / payment, under an income / expense head created on first use
create or replace function public._inv_voucher(sid uuid, p_kind text, p_head text, p_amount numeric, p_party text, p_mode text, p_narr text, p_by text, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare head uuid; bk uuid; n int; v uuid; hk text := case when p_kind = 'receipt' then 'income' else 'expense' end;
begin
  perform public._account_defaults(sid);
  select id into head from public.account_heads where school_id = sid and kind = hk and lower(name) = lower(p_head);
  if head is null then insert into public.account_heads (school_id, name, kind) values (sid, p_head, hk) returning id into head; end if;
  select id into bk from public.account_books where school_id = sid and active
   order by (kind = case when p_mode in ('upi', 'card', 'cheque', 'bank_transfer') then 'bank' else 'cash' end) desc, created_at limit 1;
  update public.account_settings set next_no = next_no + 1 where school_id = sid returning next_no - 1 into n;
  insert into public.vouchers (school_id, no, date, kind, head_id, book_id, amount, party, mode, narration, status, created_by_name)
  values (sid, case when p_kind = 'receipt' then 'RV-' else 'PV-' end || lpad(n::text, 5, '0'), p_date, p_kind, head, bk, p_amount, p_party,
          case when p_mode in ('cash', 'upi', 'cheque', 'bank_transfer', 'card') then p_mode else 'cash' end, left(p_narr, 500), 'posted', coalesce(p_by, 'User'))
  returning id into v;
  return v;
end $$;
revoke execute on function public._inv_voucher(uuid, text, text, numeric, text, text, text, text, date) from public, anon, authenticated;

create or replace function public._inv_me(sid uuid) returns text
language sql stable security definer set search_path = public as $$ select coalesce((select name from public.school_members where school_id = sid and user_id = auth.uid()), 'User'); $$;
revoke execute on function public._inv_me(uuid) from public, anon, authenticated;

-- ───────────── stock adjustments ─────────────
-- p_kind: opening (first count), adjust (+/-), damage (written off, always out)
create or replace function public.inventory_adjust(sid uuid, p_item uuid, p_qty int, p_kind text default 'adjust', p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; q int := p_qty;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.items.edit') then raise exception 'not allowed'; end if;
  if p_kind not in ('opening', 'adjust', 'damage') then raise exception 'Unknown stock change.'; end if;
  if q is null or q = 0 then raise exception 'Enter how many.'; end if;
  if p_kind = 'damage' then q := -abs(q); end if;
  if p_kind = 'opening' and q < 0 then raise exception 'Opening stock cannot be negative.'; end if;
  select * into it from public.inventory_items where id = p_item and school_id = sid for update;
  if it.id is null then raise exception 'Item not found.'; end if;
  if it.track_stock and it.on_hand + q < 0 then raise exception 'Only % in stock — cannot remove %.', it.on_hand, abs(q); end if;
  insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, note, by_name) values (sid, p_item, p_kind, q, it.cost, nullif(left(btrim(coalesce(p_note, '')), 200), ''), public._inv_me(sid));
  return it.on_hand + q;
end $$;

-- physical count: [{item, counted}] — the difference becomes one 'stock_take' move per item
create or replace function public.inventory_stock_take(sid uuid, p_counts jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c jsonb; it public.inventory_items; diff int; n int := 0; me text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.items.edit') then raise exception 'not allowed'; end if;
  me := public._inv_me(sid);
  for c in select * from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) loop
    continue when nullif(c ->> 'counted', '') is null;
    select * into it from public.inventory_items where id = (c ->> 'item')::uuid and school_id = sid and track_stock for update;
    continue when it.id is null;
    if (c ->> 'counted')::int < 0 then raise exception 'A count cannot be negative.'; end if;
    diff := (c ->> 'counted')::int - it.on_hand;
    continue when diff = 0;
    insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, note, by_name) values (sid, it.id, 'stock_take', diff, it.cost, 'Stock take', me);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────── purchases ─────────────
-- p_lines: [{item, qty, unit_cost}]  — raises stock, updates the item's cost, posts a payment voucher for what was paid
create or replace function public.inventory_purchase(sid uuid, p_supplier uuid, p_date date, p_bill text, p_lines jsonb, p_paid numeric default 0, p_mode text default 'cash', p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.inventory_settings; l jsonb; it public.inventory_items; qty int; uc numeric; tot numeric := 0; pid uuid; no text; me text; sup text; vid uuid; k int := 0; d date := coalesce(p_date, public.today_ist());
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.purchase.create') then raise exception 'not allowed'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  if d > public.today_ist() then raise exception 'The purchase date cannot be in the future.'; end if;
  if p_supplier is not null then
    select name into sup from public.inventory_suppliers where id = p_supplier and school_id = sid;
    if sup is null then raise exception 'Supplier not found.'; end if;
  end if;
  c := public._inv_cfg(sid);
  me := public._inv_me(sid);
  update public.inventory_settings set next_purchase_no = next_purchase_no + 1 where school_id = sid returning next_purchase_no - 1 into k;
  no := c.purchase_prefix || '-' || lpad(k::text, 4, '0');
  insert into public.inventory_purchases (school_id, no, supplier_id, on_date, bill_no, total, paid, mode, note, by_name)
  values (sid, no, p_supplier, d, nullif(left(btrim(coalesce(p_bill, '')), 40), ''), 0, 0, p_mode, nullif(left(btrim(coalesce(p_note, '')), 200), ''), me) returning id into pid;
  for l in select * from jsonb_array_elements(p_lines) loop
    qty := (l ->> 'qty')::int; uc := coalesce(nullif(l ->> 'unit_cost', '')::numeric, 0);
    if qty is null or qty <= 0 then raise exception 'Quantity must be at least 1.'; end if;
    if uc < 0 then raise exception 'The rate cannot be negative.'; end if;
    select * into it from public.inventory_items where id = (l ->> 'item')::uuid and school_id = sid for update;
    if it.id is null then raise exception 'Item not found.'; end if;
    insert into public.inventory_purchase_lines (purchase_id, school_id, item_id, qty, unit_cost, line_total) values (pid, sid, it.id, qty, uc, round(qty * uc, 2));
    insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, ref_type, ref_id, party, by_name) values (sid, it.id, 'purchase', qty, uc, 'purchase', pid, sup, me);
    update public.inventory_items set cost = uc where id = it.id;
    tot := tot + round(qty * uc, 2);
  end loop;
  if coalesce(p_paid, 0) < 0 or coalesce(p_paid, 0) > tot then raise exception 'The amount paid cannot be more than the bill (₹%).', tot; end if;
  if coalesce(p_paid, 0) > 0 and c.post_to_accounts then
    vid := public._inv_voucher(sid, 'payment', 'Inventory purchases', p_paid, coalesce(sup, 'Supplier'), p_mode, 'Purchase ' || no || coalesce(' · bill ' || nullif(btrim(coalesce(p_bill, '')), ''), ''), me, d);
  end if;
  update public.inventory_purchases set total = tot, paid = coalesce(p_paid, 0), voucher_id = vid where id = pid;
  return jsonb_build_object('id', pid, 'no', no, 'total', tot);
end $$;

-- ───────────── sales ─────────────
-- p_lines: [{item, qty, price?}] — a different price needs inventory.sales.edit.  p_mode 'fee_account' bills the student's fee account.
create or replace function public.inventory_sell(sid uuid, p_kind text, p_student uuid, p_staff uuid, p_name text, p_phone text, p_lines jsonb,
                                                 p_discount numeric default 0, p_mode text default 'cash', p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.inventory_settings; l jsonb; it public.inventory_items; qty int; price numeric; sub numeric := 0; tot numeric; sid2 uuid; no text; me text; k int;
        nm text; vid uuid; due uuid; head uuid; sess uuid; st text; can_price boolean; ids uuid[] := '{}'; d date := public.today_ist(); disc numeric := greatest(coalesce(p_discount, 0), 0);
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.sales.create') then raise exception 'not allowed'; end if;
  if p_kind not in ('student', 'staff', 'walkin') then raise exception 'Choose who is buying.'; end if;
  if p_mode not in ('cash', 'upi', 'card', 'cheque', 'bank_transfer', 'fee_account') then raise exception 'Choose how it is paid.'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  if p_kind = 'student' then
    select btrim(concat_ws(' ', first_name, last_name)), status into nm, st from public.students where id = p_student and school_id = sid;
    if nm is null then raise exception 'Choose the student.'; end if;
    if st not in ('active', 'admission_pending') then raise exception 'This student is no longer on roll.'; end if;
  elsif p_kind = 'staff' then
    select name into nm from public.staff where id = p_staff and school_id = sid;
    if nm is null then raise exception 'Choose the staff member.'; end if;
    if p_mode = 'fee_account' then raise exception 'Only a student can be charged to the fee account.'; end if;
  else
    nm := nullif(btrim(coalesce(p_name, '')), '');
    if p_mode = 'fee_account' then raise exception 'Only a student can be charged to the fee account.'; end if;
  end if;
  if p_mode = 'fee_account' and p_kind <> 'student' then raise exception 'Only a student can be charged to the fee account.'; end if;
  can_price := public.has_perm_school(sid, 'inventory.sales.edit');
  c := public._inv_cfg(sid);
  me := public._inv_me(sid);
  update public.inventory_settings set next_sale_no = next_sale_no + 1 where school_id = sid returning next_sale_no - 1 into k;
  no := c.sale_prefix || '-' || lpad(k::text, 5, '0');
  insert into public.inventory_sales (school_id, no, on_date, kind, student_id, staff_id, customer_name, phone, mode, status, note, by_name)
  values (sid, no, d, p_kind, case when p_kind = 'student' then p_student end, case when p_kind = 'staff' then p_staff end, nm, nullif(btrim(coalesce(p_phone, '')), ''), p_mode,
          case when p_mode = 'fee_account' then 'on_fee_account' else 'paid' end, nullif(left(btrim(coalesce(p_note, '')), 200), ''), me) returning id into sid2;
  -- lock the items in a fixed order so two counters never deadlock
  for l in select x from jsonb_array_elements(p_lines) x order by (x ->> 'item') loop
    qty := (l ->> 'qty')::int;
    if qty is null or qty <= 0 then raise exception 'Quantity must be at least 1.'; end if;
    select * into it from public.inventory_items where id = (l ->> 'item')::uuid and school_id = sid for update;
    if it.id is null or not it.active then raise exception 'An item is missing or withdrawn.'; end if;
    if (l ->> 'item')::uuid = any(ids) then raise exception '“%” is listed twice — combine the quantity.', it.name; end if;
    ids := ids || it.id;
    if it.track_stock and it.on_hand < qty then raise exception 'Only % of “%” in stock.', it.on_hand, it.name; end if;
    price := case when can_price and nullif(l ->> 'price', '') is not null then (l ->> 'price')::numeric else it.price end;
    if price < 0 then raise exception 'The price cannot be negative.'; end if;
    insert into public.inventory_sale_lines (sale_id, school_id, item_id, item_name, qty, unit_price, line_total)
    values (sid2, sid, it.id, it.name || coalesce(' (' || it.variant || ')', ''), qty, price, round(qty * price, 2));
    if it.track_stock then
      insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, ref_type, ref_id, party, by_name) values (sid, it.id, 'sale', -qty, it.cost, 'sale', sid2, nm, me);
    end if;
    sub := sub + round(qty * price, 2);
  end loop;
  if disc > sub then raise exception 'The discount is more than the bill.'; end if;
  if disc > 0 and not can_price then raise exception 'A discount needs the sales-edit permission.'; end if;
  tot := sub - disc;
  if p_mode = 'fee_account' then
    select id into sess from public.sessions where school_id = sid and is_current;
    if sess is null then raise exception 'There is no current session to bill the student in.'; end if;
    select id into head from public.fee_heads where school_id = sid and name = 'Uniform & Books';
    if head is null then insert into public.fee_heads (school_id, name, sort) values (sid, 'Uniform & Books', 70) returning id into head; end if;
    insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, source_key)
    values (sid, sess, p_student, head, 'Uniform & Books · ' || no, d, tot, 0, 'sale:' || sid2) returning id into due;
  elsif tot > 0 and c.post_to_accounts then
    vid := public._inv_voucher(sid, 'receipt', 'Sale of books & uniform', tot, coalesce(nm, 'Walk-in customer'), p_mode, 'Sale ' || no, me, d);
  end if;
  update public.inventory_sales set subtotal = sub, discount = disc, total = tot, fee_due_id = due, voucher_id = vid where id = sid2;
  return jsonb_build_object('id', sid2, 'no', no, 'total', tot, 'on_fee_account', p_mode = 'fee_account');
end $$;

-- cancel a sale: stock goes back, the voucher is cancelled, an unpaid fee-account charge is removed
create or replace function public.inventory_cancel_sale(sid uuid, p_sale uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.inventory_sales; l record; d public.fee_dues;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.sales.edit') then raise exception 'not allowed'; end if;
  select * into s from public.inventory_sales where id = p_sale and school_id = sid for update;
  if s.id is null then raise exception 'Sale not found.'; end if;
  if s.status = 'cancelled' then raise exception 'This sale is already cancelled.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for cancelling.'; end if;
  if s.fee_due_id is not null then
    select * into d from public.fee_dues where id = s.fee_due_id;
    if d.id is not null and d.paid > 0 then raise exception 'The parent has already paid ₹% of this charge — refund it from Fees first.', d.paid; end if;
    delete from public.fee_dues where id = s.fee_due_id;
  end if;
  for l in select sl.item_id, sl.qty from public.inventory_sale_lines sl join public.inventory_items i on i.id = sl.item_id where sl.sale_id = p_sale and i.track_stock loop
    insert into public.inventory_moves (school_id, item_id, kind, qty, ref_type, ref_id, note, by_name) values (sid, l.item_id, 'sale_return', l.qty, 'sale', p_sale, 'Sale ' || s.no || ' cancelled', public._inv_me(sid));
  end loop;
  if s.voucher_id is not null then
    update public.vouchers set status = 'cancelled', decided_by_name = public._inv_me(sid), decided_at = now(), decision_note = 'Sale ' || s.no || ' cancelled' where id = s.voucher_id and status = 'posted';
  end if;
  update public.inventory_sales set status = 'cancelled', cancelled_at = now(), cancelled_reason = left(btrim(p_reason), 300), fee_due_id = null where id = p_sale;
end $$;

-- ───────────── issue to staff / class (no money) ─────────────
create or replace function public.inventory_issue(sid uuid, p_item uuid, p_qty int, p_to text, p_note text default null, p_return boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare it public.inventory_items; q int := p_qty;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'inventory.items.edit') then raise exception 'not allowed'; end if;
  if q is null or q <= 0 then raise exception 'Enter how many.'; end if;
  if coalesce(btrim(p_to), '') = '' then raise exception 'Write who it is for (a teacher, a class, a department).'; end if;
  select * into it from public.inventory_items where id = p_item and school_id = sid for update;
  if it.id is null then raise exception 'Item not found.'; end if;
  if not p_return and it.track_stock and it.on_hand < q then raise exception 'Only % in stock.', it.on_hand; end if;
  insert into public.inventory_moves (school_id, item_id, kind, qty, unit_cost, party, note, by_name)
  values (sid, p_item, case when p_return then 'issue_return' else 'issue' end, case when p_return then q else -q end, it.cost, left(btrim(p_to), 80), nullif(left(btrim(coalesce(p_note, '')), 200), ''), public._inv_me(sid));
  return it.on_hand + case when p_return then q else -q end;
end $$;

-- ───────────── lists and dashboard ─────────────
create or replace function public.inventory_item_list(sid uuid, p_q text default null, p_category text default null, p_state text default null, p_active text default 'yes',
                                                      p_limit int default 25, p_offset int default 0)
returns table (id uuid, sku text, name text, category text, variant text, unit text, cost numeric, price numeric, reorder_level int, track_stock boolean, on_hand int,
               stock_value numeric, active boolean, class_name text, location text, sold_30 bigint, state text, total bigint)
language sql stable security definer set search_path = public as $$
  select i.id, i.sku, i.name, i.category, i.variant, i.unit, i.cost, i.price, i.reorder_level, i.track_stock, i.on_hand, round(i.on_hand * i.cost, 2), i.active, c.name, i.location,
         coalesce((select sum(-m.qty) from public.inventory_moves m where m.item_id = i.id and m.kind = 'sale' and m.created_at >= now() - interval '30 days'), 0)::bigint,
         case when not i.track_stock then 'na' when i.on_hand <= 0 then 'out' when i.on_hand <= i.reorder_level then 'low' else 'ok' end, count(*) over ()
    from public.inventory_items i left join public.classes c on c.id = i.for_class_id
   where i.school_id = sid and (public.has_perm_school(sid, 'inventory.items.view') or public.has_perm_school(sid, 'inventory.sales.create') or public.has_perm_school(sid, 'inventory.purchase.create'))
     and (p_active is null or p_active = 'all' or (p_active = 'yes' and i.active) or (p_active = 'no' and not i.active))
     and (p_category is null or i.category = p_category)
     and (p_state is null or (p_state = 'out' and i.track_stock and i.on_hand <= 0) or (p_state = 'low' and i.track_stock and i.on_hand > 0 and i.on_hand <= i.reorder_level)
          or (p_state = 'attention' and i.track_stock and i.on_hand <= i.reorder_level) or (p_state = 'ok' and (not i.track_stock or i.on_hand > i.reorder_level)))
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', i.name, i.sku, i.category, i.variant, i.barcode) ilike public.like_escape(btrim(p_q)))
   order by i.category, i.name, i.variant
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.inventory_sale_list(sid uuid, p_q text default null, p_from date default null, p_to date default null, p_status text default null, p_kind text default null,
                                                      p_limit int default 25, p_offset int default 0)
returns table (id uuid, no text, on_date date, kind text, customer_name text, student_id uuid, admission_no text, class_name text, total numeric, mode text, status text, items text,
               fee_paid numeric, by_name text, cancelled_reason text, total_rows bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.no, s.on_date, s.kind, coalesce(btrim(concat_ws(' ', st.first_name, st.last_name)), w.name, s.customer_name), s.student_id, st.admission_no, c.name, s.total, s.mode, s.status,
         (select string_agg(l.item_name || ' ×' || l.qty, ', ' order by l.item_name) from public.inventory_sale_lines l where l.sale_id = s.id),
         case when d.id is not null then d.paid end, s.by_name, s.cancelled_reason, count(*) over ()
    from public.inventory_sales s
    left join public.students st on st.id = s.student_id
    left join public.classes c on c.id = st.class_id
    left join public.staff w on w.id = s.staff_id
    left join public.fee_dues d on d.id = s.fee_due_id
   where s.school_id = sid and public.has_perm_school(sid, 'inventory.sales.view')
     and (p_from is null or s.on_date >= p_from) and (p_to is null or s.on_date <= p_to) and (p_status is null or s.status = p_status) and (p_kind is null or s.kind = p_kind)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', s.no, s.customer_name, st.first_name, st.last_name, st.admission_no, w.name, s.phone) ilike public.like_escape(btrim(p_q)))
   order by s.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.inventory_move_list(sid uuid, p_item uuid default null, p_kind text default null, p_from date default null, p_to date default null,
                                                      p_limit int default 25, p_offset int default 0)
returns table (id bigint, created_at timestamptz, item_id uuid, item_name text, kind text, qty int, unit_cost numeric, party text, note text, by_name text, total bigint)
language sql stable security definer set search_path = public as $$
  select m.id, m.created_at, i.id, i.name || coalesce(' (' || i.variant || ')', ''), m.kind, m.qty, m.unit_cost, m.party, m.note, m.by_name, count(*) over ()
    from public.inventory_moves m join public.inventory_items i on i.id = m.item_id
   where m.school_id = sid and public.has_perm_school(sid, 'inventory.items.view')
     and (p_item is null or m.item_id = p_item) and (p_kind is null or m.kind = p_kind)
     and (p_from is null or (m.created_at at time zone 'Asia/Kolkata')::date >= p_from) and (p_to is null or (m.created_at at time zone 'Asia/Kolkata')::date <= p_to)
   order by m.created_at desc, m.id desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.inventory_dashboard(sid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := public.today_ist();
begin
  if not (public.has_perm_school(sid, 'inventory.items.view') or public.has_perm_school(sid, 'inventory.sales.view') or public.has_perm_school(sid, 'inventory.purchase.view')) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'items', (select count(*) from public.inventory_items where school_id = sid and active),
    'units', (select coalesce(sum(on_hand), 0) from public.inventory_items where school_id = sid and active and track_stock),
    'stock_value', (select coalesce(sum(on_hand * cost), 0) from public.inventory_items where school_id = sid and active and track_stock),
    'low', (select count(*) from public.inventory_items where school_id = sid and active and track_stock and on_hand > 0 and on_hand <= reorder_level),
    'out', (select count(*) from public.inventory_items where school_id = sid and active and track_stock and on_hand <= 0),
    'sales_today', (select coalesce(sum(total), 0) from public.inventory_sales where school_id = sid and on_date = d and status <> 'cancelled'),
    'sales_month', (select coalesce(sum(total), 0) from public.inventory_sales where school_id = sid and on_date >= date_trunc('month', d)::date and status <> 'cancelled'),
    'bills_month', (select count(*) from public.inventory_sales where school_id = sid and on_date >= date_trunc('month', d)::date and status <> 'cancelled'),
    'on_fee_account', (select coalesce(sum(greatest(f.amount - f.concession + f.fine - f.paid, 0)), 0) from public.inventory_sales s join public.fee_dues f on f.id = s.fee_due_id where s.school_id = sid and s.status = 'on_fee_account'),
    'purchases_month', (select coalesce(sum(total), 0) from public.inventory_purchases where school_id = sid and on_date >= date_trunc('month', d)::date and status <> 'cancelled'),
    'per_month', coalesce((select jsonb_agg(jsonb_build_object('m', to_char(m, 'Mon'), 'sales', s, 'purchases', p) order by m) from (
        select g::date m,
               (select coalesce(sum(total), 0) from public.inventory_sales x where x.school_id = sid and x.status <> 'cancelled' and date_trunc('month', x.on_date) = g) s,
               (select coalesce(sum(total), 0) from public.inventory_purchases x where x.school_id = sid and x.status <> 'cancelled' and date_trunc('month', x.on_date) = g) p
          from generate_series(date_trunc('month', d) - interval '5 months', date_trunc('month', d), interval '1 month') g) q), '[]'::jsonb),
    'top_items', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'amount', a)) from (
        select l.item_name name, sum(l.qty) q, sum(l.line_total) a from public.inventory_sale_lines l join public.inventory_sales s on s.id = l.sale_id
         where s.school_id = sid and s.status <> 'cancelled' and s.on_date >= d - 90 group by l.item_name order by sum(l.line_total) desc limit 6) x), '[]'::jsonb),
    'reorder', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name || coalesce(' (' || variant || ')', ''), 'on_hand', on_hand, 'reorder', reorder_level) order by on_hand) from (
        select id, name, variant, on_hand, reorder_level from public.inventory_items where school_id = sid and active and track_stock and on_hand <= reorder_level order by on_hand limit 8) x), '[]'::jsonb));
end $$;

do $$
declare t text;
begin
  foreach t in array array['inventory_items', 'inventory_suppliers', 'inventory_purchases', 'inventory_sales', 'inventory_settings'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
