-- ═══════════════════════════════════════════════════════════════════════════
-- Step 20: Accounts — income & expense vouchers, cash / bank books, one day book.
--   Fee receipts, paid refunds and approved payroll flow into the day book by themselves (no double entry).
--   Manual vouchers (donation, electricity bill, repairs …) go through an optional approval threshold.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Heads, books, settings ─────────────
create table if not exists public.account_heads (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  kind       text not null check (kind in ('income', 'expense')),
  active
       boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists account_heads_name on public.account_heads (school_id, kind, lower(name));

create table if not exists public.account_books (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 60),
  kind            text not null check (kind in ('cash', 'bank')),
  opening_balance numeric(14,2) not null default 0,
  opening_date    date not null default (now() at time zone 'Asia/Kolkata')::date,
  account_no      text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index if not exists account_books_name on public.account_books (school_id, lower(name));

create table if not exists public.account_settings (
  school_id       uuid primary key references public.schools(id) on delete cascade,
  approval_above  numeric(14,2) not null default 0 check (approval_above >= 0),   -- 0 = no approval needed
  next_no         int not null default 1
);

-- ───────────── Vouchers ─────────────
create table if not exists public.vouchers (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  no              text not null,
  date            date not null,
  kind            text not null check (kind in ('receipt', 'payment', 'transfer')),
  head_id         uuid references public.account_heads(id) on delete restrict,
  book_id         uuid not null references public.account_books(id) on delete restrict,
  to_book_id      uuid references public.account_books(id) on delete restrict,
  amount          numeric(14,2) not null check (amount > 0),
  party           text,
  mode            text,
  ref_no          text,
  narration       text,
  status          text not null default 'posted' check (status in ('posted', 'pending', 'rejected', 'cancelled')),
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  decided_by_name text,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  unique (school_id, no),
  check ((kind = 'transfer' and to_book_id is not null and to_book_id <> book_id and head_id is null) or (kind <> 'transfer' and head_id is not null and to_book_id is null))
);
create index if not exists vouchers_day_idx on public.vouchers (school_id, date, status);

alter table public.account_heads enable row level security;
alter table public.account_books enable row level security;
alter table public.account_settings enable row level security;
alter table public.vouchers enable row level security;

drop policy if exists "read" on public.account_heads;
create policy "read" on public.account_heads for select to authenticated using (public.has_module_perm(school_id, 'accounts'));
drop policy if exists "write" on public.account_heads;
create policy "write" on public.account_heads for all to authenticated
  using (public.has_perm_school(school_id, 'accounts.vouchers.edit')) with check (public.has_perm_school(school_id, 'accounts.vouchers.edit'));
drop policy if exists "read" on public.account_books;
create policy "read" on public.account_books for select to authenticated using (public.has_module_perm(school_id, 'accounts'));
drop policy if exists "write" on public.account_books;
create policy "write" on public.account_books for all to authenticated
  using (public.has_perm_school(school_id, 'accounts.vouchers.edit')) with check (public.has_perm_school(school_id, 'accounts.vouchers.edit'));
drop policy if exists "read" on public.account_settings;
create policy "read" on public.account_settings for select to authenticated using (public.has_module_perm(school_id, 'accounts'));
drop policy if exists "write" on public.account_settings;
create policy "write" on public.account_settings for all to authenticated
  using (public.has_perm_school(school_id, 'accounts.vouchers.edit')) with check (public.has_perm_school(school_id, 'accounts.vouchers.edit'));
drop policy if exists "read" on public.vouchers;
create policy "read" on public.vouchers for select to authenticated
  using (public.has_perm_school(school_id, 'accounts.vouchers.view') or public.has_perm_school(school_id, 'accounts.books.view'));
-- vouchers are written only by the functions below

-- ───────────── Defaults ─────────────
create or replace function public._account_defaults(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.account_settings (school_id) values (sid) on conflict do nothing;
  if not exists (select 1 from public.account_books where school_id = sid) then
    insert into public.account_books (school_id, name, kind) values (sid, 'Cash in hand', 'cash');
  end if;
  if not exists (select 1 from public.account_heads where school_id = sid) then
    insert into public.account_heads (school_id, name, kind)
    select sid, x.n, x.k from (values
      ('Donations', 'income'), ('Sale of books & uniform', 'income'), ('Canteen / stationery sales', 'income'), ('Rent received', 'income'),
      ('Event & function income', 'income'), ('Interest received', 'income'), ('Other income', 'income'),
      ('Electricity & water', 'expense'), ('Repairs & maintenance', 'expense'), ('Stationery & printing', 'expense'), ('Fuel & vehicle running', 'expense'),
      ('Teaching aids & books', 'expense'), ('Events & functions', 'expense'), ('Telephone & internet', 'expense'), ('Rent paid', 'expense'),
      ('Cleaning & security', 'expense'), ('Bank charges', 'expense'), ('Other expense', 'expense')
    ) x(n, k);
  end if;
end $$;
revoke execute on function public._account_defaults(uuid) from public, anon, authenticated;

create or replace function public.ensure_account_defaults(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_perm_school(sid, 'accounts.vouchers.view') or public.has_perm_school(sid, 'accounts.books.view')) then raise exception 'not allowed'; end if;
  perform public._account_defaults(sid);
end $$;

-- existing schools get the defaults at once; new ones on first visit
do $$ declare s record; begin for s in select id from public.schools loop perform public._account_defaults(s.id); end loop; end $$;

-- ───────────── The unified ledger (internal) ─────────────
-- Every posted money movement of the school between two dates, whatever created it.
create or replace function public._ledger(sid uuid, d1 date, d2 date)
returns table (entry_key text, on_date date, at timestamptz, dir text, head text, book_id uuid, amount numeric, party text, mode text, ref text, narration text,
               source text, source_id uuid, voucher_no text, by_name text)
language sql stable security definer set search_path = public as $$
  with cb as (select id from public.account_books where school_id = sid and kind = 'cash' and active order by created_at limit 1),
       bb as (select id from public.account_books where school_id = sid and kind = 'bank' and active order by created_at limit 1)
  select 'v:' || v.id, v.date, v.created_at,
         case when v.kind = 'receipt' then 'in' else 'out' end, coalesce(h.name, 'Transfer'), v.book_id, v.amount, v.party, v.mode, v.ref_no, v.narration, 'voucher', v.id, v.no, v.created_by_name
    from public.vouchers v left join public.account_heads h on h.id = v.head_id
   where v.school_id = sid and v.status = 'posted' and v.date between d1 and d2
  union all
  select 'vt:' || v.id, v.date, v.created_at, 'in', 'Transfer in', v.to_book_id, v.amount, v.party, v.mode, v.ref_no, v.narration, 'voucher', v.id, v.no, v.created_by_name
    from public.vouchers v where v.school_id = sid and v.status = 'posted' and v.kind = 'transfer' and v.date between d1 and d2
  union all
  select 'fee:' || p.id, r.paid_on, r.created_at, 'in', 'Fee collection',
         case when p.mode = 'cash' then (select id from cb) else coalesce((select id from bb), (select id from cb)) end,
         p.amount, btrim(concat_ws(' ', s.first_name, s.last_name)), p.mode, r.receipt_no, null, 'fee', r.id, r.receipt_no, r.collected_by
    from public.fee_receipt_payments p
    join public.fee_receipts r on r.id = p.receipt_id
    join public.students s on s.id = r.student_id
   where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2
  union all
  select 'ref:' || f.id, f.paid_on, f.decided_at, 'out', 'Fee refunds',
         case when coalesce(f.mode, 'cash') = 'cash' then (select id from cb) else coalesce((select id from bb), (select id from cb)) end,
         f.amount, btrim(concat_ws(' ', s.first_name, s.last_name)), coalesce(f.mode, 'cash'), f.reference, f.reason, 'refund', f.id, null, f.requested_by_name
    from public.fee_refunds f join public.students s on s.id = f.student_id
   where f.school_id = sid and f.status = 'paid' and f.paid_on between d1 and d2
  union all
  select 'pay:' || r.id, (r.approved_at at time zone 'Asia/Kolkata')::date, r.approved_at, 'out', 'Salaries', (select id from bb),
         (select coalesce(sum(p.net), 0) from public.payslips p where p.run_id = r.id), 'Staff', 'bank_transfer', to_char(r.month, 'Mon YYYY'), 'Salary for ' || to_char(r.month, 'Mon YYYY'),
         'payroll', r.id, null, null
    from public.payroll_runs r
   where r.school_id = sid and r.status = 'approved' and r.approved_at is not null and (r.approved_at at time zone 'Asia/Kolkata')::date between d1 and d2;
$$;
revoke execute on function public._ledger(uuid, date, date) from public, anon, authenticated;

-- the payroll row above has no book when the school has no bank book: fall back to cash
create or replace function public._ledger_fixed(sid uuid, d1 date, d2 date)
returns table (entry_key text, on_date date, at timestamptz, dir text, head text, book_id uuid, amount numeric, party text, mode text, ref text, narration text,
               source text, source_id uuid, voucher_no text, by_name text)
language sql stable security definer set search_path = public as $$
  select l.entry_key, l.on_date, l.at, l.dir, l.head,
         coalesce(l.book_id, (select id from public.account_books where school_id = sid and active order by (kind = 'cash') desc, created_at limit 1)),
         l.amount, l.party, l.mode, l.ref, l.narration, l.source, l.source_id, l.voucher_no, l.by_name
    from public._ledger(sid, d1, d2) l where l.amount > 0;
$$;
revoke execute on function public._ledger_fixed(uuid, date, date) from public, anon, authenticated;

-- ───────────── Reports ─────────────
create or replace function public.account_daybook(sid uuid, d1 date, d2 date, p_book uuid default null, p_dir text default null, p_head text default null,
                                                  p_source text default null, p_q text default null, p_limit int default 50, p_offset int default 0)
returns table (entry_key text, on_date date, at timestamptz, dir text, head text, book_id uuid, book_name text, amount numeric, party text, mode text, ref text, narration text,
               source text, source_id uuid, voucher_no text, by_name text, total bigint, sum_in numeric, sum_out numeric)
language sql stable security definer set search_path = public as $$
  with l as (
    select x.*, b.name as bname from public._ledger_fixed(sid, d1, d2) x left join public.account_books b on b.id = x.book_id
     where (public.has_perm_school(sid, 'accounts.books.view') or public.has_perm_school(sid, 'accounts.vouchers.view'))
       and (p_book is null or x.book_id = p_book) and (p_dir is null or x.dir = p_dir) and (p_head is null or x.head = p_head) and (p_source is null or x.source = p_source)
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or concat_ws(' ', x.party, x.ref, x.narration, x.voucher_no, x.head) ilike public.like_escape(btrim(p_q)))
  )
  select l.entry_key, l.on_date, l.at, l.dir, l.head, l.book_id, l.bname, l.amount, l.party, l.mode, l.ref, l.narration, l.source, l.source_id, l.voucher_no, l.by_name,
         count(*) over (), sum(l.amount) filter (where l.dir = 'in') over (), sum(l.amount) filter (where l.dir = 'out') over ()
    from l order by l.on_date, l.at, l.entry_key
   limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- opening, receipts, payments and closing of every book for a period
create or replace function public.account_books_summary(sid uuid, d1 date, d2 date)
returns table (book_id uuid, name text, kind text, active boolean, opening numeric, receipts numeric, payments numeric, closing numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm_school(sid, 'accounts.books.view') or public.has_perm_school(sid, 'accounts.vouchers.view')) then return; end if;
  return query
    with l as (select x.book_id, x.on_date, x.dir, x.amount from public._ledger_fixed(sid, date '2000-01-01', d2) x)
    select b.id, b.name, b.kind, b.active,
           b.opening_balance + coalesce(sum(case when l.on_date >= b.opening_date and l.on_date < d1 then (case when l.dir = 'in' then l.amount else -l.amount end) end), 0),
           coalesce(sum(l.amount) filter (where l.dir = 'in' and l.on_date >= greatest(d1, b.opening_date)), 0),
           coalesce(sum(l.amount) filter (where l.dir = 'out' and l.on_date >= greatest(d1, b.opening_date)), 0),
           b.opening_balance + coalesce(sum(case when l.on_date >= b.opening_date then (case when l.dir = 'in' then l.amount else -l.amount end) end), 0)
      from public.account_books b left join l on l.book_id = b.id
     where b.school_id = sid
     group by b.id, b.name, b.kind, b.active, b.opening_balance, b.opening_date, b.created_at
     order by (b.kind = 'cash') desc, b.created_at;
end $$;

-- income and expense by head for a period
create or replace function public.account_head_summary(sid uuid, d1 date, d2 date)
returns table (dir text, head text, entries bigint, total numeric)
language sql stable security definer set search_path = public as $$
  select x.dir, x.head, count(*), sum(x.amount)
    from public._ledger_fixed(sid, d1, d2) x
   where (public.has_perm_school(sid, 'accounts.books.view') or public.has_perm_school(sid, 'accounts.vouchers.view'))
     and x.head not in ('Transfer', 'Transfer in')
   group by x.dir, x.head order by x.dir desc, sum(x.amount) desc;
$$;

-- ───────────── Voucher list (paged) ─────────────
create or replace function public.voucher_list(sid uuid, d1 date, d2 date, p_kind text default null, p_status text default null, p_head uuid default null,
                                               p_book uuid default null, p_q text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, no text, date date, kind text, head_name text, book_name text, to_book_name text, amount numeric, party text, mode text, ref_no text, narration text,
               status text, created_by_name text, decided_by_name text, decision_note text, created_at timestamptz, total bigint)
language sql stable security definer set search_path = public as $$
  select v.id, v.no, v.date, v.kind, h.name, b.name, tb.name, v.amount, v.party, v.mode, v.ref_no, v.narration, v.status, v.created_by_name, v.decided_by_name, v.decision_note,
         v.created_at, count(*) over ()
    from public.vouchers v
    join public.account_books b on b.id = v.book_id
    left join public.account_books tb on tb.id = v.to_book_id
    left join public.account_heads h on h.id = v.head_id
   where v.school_id = sid and v.date between d1 and d2
     and (public.has_perm_school(sid, 'accounts.vouchers.view') or public.has_perm_school(sid, 'accounts.books.view'))
     and (p_kind is null or v.kind = p_kind) and (p_status is null or v.status = p_status) and (p_head is null or v.head_id = p_head) and (p_book is null or v.book_id = p_book or v.to_book_id = p_book)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', v.party, v.ref_no, v.narration, v.no, h.name) ilike public.like_escape(btrim(p_q)))
   order by v.date desc, v.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── Writing vouchers ─────────────
create or replace function public.save_voucher(sid uuid, p_id uuid, p_kind text, p_date date, p_head uuid, p_book uuid, p_to_book uuid, p_amount numeric,
                                               p_party text, p_mode text, p_ref text, p_narration text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cfg public.account_settings; old public.vouchers; hk text; st text; n int; nm text; i uuid; me text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  if p_id is null then
    if not public.has_perm_school(sid, 'accounts.vouchers.create') then raise exception 'not allowed'; end if;
  else
    select * into old from public.vouchers where id = p_id and school_id = sid;
    if old.id is null then raise exception 'Voucher not found.'; end if;
    if not public.has_perm_school(sid, 'accounts.vouchers.edit') then raise exception 'not allowed'; end if;
    if old.status in ('cancelled', 'rejected') then raise exception 'A % voucher cannot be changed.', old.status; end if;
  end if;
  if p_kind not in ('receipt', 'payment', 'transfer') then raise exception 'Choose receipt, payment or transfer.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 99999999 then raise exception 'Enter an amount greater than zero.'; end if;
  if p_date is null or p_date > public.today_ist() then raise exception 'The voucher date cannot be in the future.'; end if;
  if p_date < public.today_ist() - 400 then raise exception 'That date is too far in the past.'; end if;
  if not exists (select 1 from public.account_books where id = p_book and school_id = sid and active) then raise exception 'Choose a cash or bank book.'; end if;
  if p_kind = 'transfer' then
    if p_to_book is null or p_to_book = p_book or not exists (select 1 from public.account_books where id = p_to_book and school_id = sid and active) then
      raise exception 'A transfer needs two different books.'; end if;
    p_head := null;
  else
    select kind into hk from public.account_heads where id = p_head and school_id = sid and active;
    if hk is null then raise exception 'Choose a head.'; end if;
    if (p_kind = 'receipt' and hk <> 'income') or (p_kind = 'payment' and hk <> 'expense') then raise exception 'That head does not belong to a %.', p_kind; end if;
    p_to_book := null;
  end if;
  if p_mode is not null and p_mode not in ('cash', 'upi', 'cheque', 'bank_transfer', 'card', 'other') then raise exception 'Unknown payment mode.'; end if;

  perform public._account_defaults(sid);
  select * into cfg from public.account_settings where school_id = sid;
  st := case when cfg.approval_above > 0 and p_amount > cfg.approval_above and p_kind <> 'transfer' and not public.has_perm_school(sid, 'accounts.vouchers.approve') then 'pending' else 'posted' end;
  select coalesce(m.name, 'User') into me from (select (select name from public.school_members where school_id = sid and user_id = auth.uid()) as name) m;

  if p_id is null then
    update public.account_settings set next_no = next_no + 1 where school_id = sid returning next_no - 1 into n;
    nm := (case p_kind when 'receipt' then 'RV' when 'payment' then 'PV' else 'TV' end) || '-' || lpad(n::text, 5, '0');
    insert into public.vouchers (school_id, no, date, kind, head_id, book_id, to_book_id, amount, party, mode, ref_no, narration, status, created_by_name)
    values (sid, nm, p_date, p_kind, p_head, p_book, p_to_book, p_amount, nullif(btrim(coalesce(p_party, '')), ''), p_mode, nullif(btrim(coalesce(p_ref, '')), ''),
            nullif(left(btrim(coalesce(p_narration, '')), 500), ''), st, me) returning id into i;
    return i;
  end if;
  update public.vouchers set date = p_date, kind = p_kind, head_id = p_head, book_id = p_book, to_book_id = p_to_book, amount = p_amount,
         party = nullif(btrim(coalesce(p_party, '')), ''), mode = p_mode, ref_no = nullif(btrim(coalesce(p_ref, '')), ''),
         narration = nullif(left(btrim(coalesce(p_narration, '')), 500), ''), status = st, decided_by_name = null, decided_at = null, decision_note = null
   where id = p_id;
  return p_id;
end $$;

create or replace function public.decide_voucher(vid uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.vouchers; me text;
begin
  select * into v from public.vouchers where id = vid;
  if v.id is null or auth.uid() is null or not public.has_perm_school(v.school_id, 'accounts.vouchers.approve') then raise exception 'not allowed'; end if;
  if v.status <> 'pending' then raise exception 'This voucher is not waiting for approval.'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Give a reason for rejecting.'; end if;
  select name into me from public.school_members where school_id = v.school_id and user_id = auth.uid();
  update public.vouchers set status = case when p_approve then 'posted' else 'rejected' end, decided_by_name = coalesce(me, 'User'), decided_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 300), '') where id = vid;
end $$;

create or replace function public.cancel_voucher(vid uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.vouchers; me text;
begin
  select * into v from public.vouchers where id = vid;
  if v.id is null or auth.uid() is null or not public.has_perm_school(v.school_id, 'accounts.vouchers.edit') then raise exception 'not allowed'; end if;
  if v.status in ('cancelled', 'rejected') then raise exception 'This voucher is already %.', v.status; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for cancelling.'; end if;
  select name into me from public.school_members where school_id = v.school_id and user_id = auth.uid();
  update public.vouchers set status = 'cancelled', decided_by_name = coalesce(me, 'User'), decided_at = now(), decision_note = left(btrim(p_reason), 300) where id = vid;
end $$;

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['account_heads', 'account_books', 'account_settings', 'vouchers'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
