-- ═══════════════════════════════════════════════════════════════════════════
-- Step 10: Fees 2.0 — every way a school manages fees.
--   billing   : deposit heads, ad-hoc charges, due-date extension, waiver, amount change, arrears carry-forward
--   concession: categories, approval workflow, validity window
--   late fine : school rule (per day / per month / flat, grace, cap), automatic, waivable
--   collection: choose instalments, split modes, cheques, advance / wallet, day-end closing
--   cheques   : register with deposit / clear / bounce
--   refunds   : request → approve → pay (wallet, deposits, withdrawal)
--   online    : orders + automatic receipt on payment (Razorpay, school's own account)
--   reports   : collection by day / head / class / mode / collector, ageing
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Settings ─────────────
create table if not exists public.fee_settings (
  school_id            uuid primary key references public.schools(id) on delete cascade,
  fine_enabled         boolean not null default false,
  fine_mode            text not null default 'per_day' check (fine_mode in ('per_day','per_month','flat')),
  fine_amount          numeric(10,2) not null default 0 check (fine_amount >= 0),
  fine_grace_days      int not null default 0 check (fine_grace_days >= 0),
  fine_cap             numeric(10,2) not null default 0 check (fine_cap >= 0),     -- 0 = no cap
  concession_approval  boolean not null default false,    -- requests by staff wait for the principal
  advance_allowed      boolean not null default true,     -- take more than is due (kept as a wallet balance)
  bounce_charge        numeric(10,2) not null default 0 check (bounce_charge >= 0),
  online_enabled       boolean not null default false,
  online_min_amount    numeric(10,2) not null default 1 check (online_min_amount >= 0),
  online_allow_partial boolean not null default true,
  receipt_footer       text,
  updated_by           uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at           timestamptz not null default now()
);
drop trigger if exists fee_settings_touch on public.fee_settings;
create trigger fee_settings_touch before update on public.fee_settings for each row execute function public.touch_row();

-- ───────────── Column additions ─────────────
alter table public.fee_heads add column if not exists kind text not null default 'regular' check (kind in ('regular','deposit','other'));
alter table public.fee_heads add column if not exists active boolean not null default true;

alter table public.fee_dues add column if not exists fine_auto numeric(10,2) not null default 0 check (fine_auto >= 0);
alter table public.fee_dues add column if not exists fine_waived numeric(10,2) not null default 0 check (fine_waived >= 0);
alter table public.fee_dues add column if not exists kind text not null default 'plan' check (kind in ('plan','charge','arrears','bounce'));
alter table public.fee_dues add column if not exists note text;
alter table public.fee_dues add column if not exists original_due_date date;

alter table public.student_concessions
  add column if not exists category text not null default 'other' check (category in ('rte','staff_ward','sibling','merit','sports','hardship','other')),
  add column if not exists status text not null default 'approved' check (status in ('pending','approved','rejected')),
  add column if not exists requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  add column if not exists decided_by uuid references auth.users(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists created_at timestamptz not null default now();

alter table public.fee_receipts drop constraint if exists fee_receipts_mode_check;
alter table public.fee_receipts add constraint fee_receipts_mode_check check (mode in ('cash','upi','cheque','bank_transfer','card','online','mixed','wallet'));
alter table public.fee_receipts add column if not exists advance_amount numeric(10,2) not null default 0 check (advance_amount >= 0);
alter table public.fee_receipts add column if not exists wallet_used numeric(10,2) not null default 0 check (wallet_used >= 0);
alter table public.fee_receipts drop constraint if exists fee_receipts_amount_check;
alter table public.fee_receipts add constraint fee_receipts_amount_check check (amount >= 0);

-- ───────────── Money trail tables ─────────────
create table if not exists public.fee_receipt_payments (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  receipt_id uuid not null references public.fee_receipts(id) on delete cascade,
  mode       text not null check (mode in ('cash','upi','cheque','bank_transfer','card','online')),
  amount     numeric(10,2) not null check (amount > 0),
  reference  text
);
create index if not exists fee_receipt_payments_receipt_idx on public.fee_receipt_payments (receipt_id);
-- receipts made before this step get one payment row each
insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount, reference)
select r.school_id, r.id, r.mode, r.amount, r.reference from public.fee_receipts r
 where r.mode in ('cash','upi','cheque','bank_transfer','card','online') and r.amount > 0
   and not exists (select 1 from public.fee_receipt_payments p where p.receipt_id = r.id);

create table if not exists public.fee_wallet_entries (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind       text not null check (kind in ('advance','applied','reversal','refund','adjust')),
  amount     numeric(10,2) not null check (amount <> 0),     -- + credit / − debit
  receipt_id uuid references public.fee_receipts(id) on delete set null,
  note       text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists fee_wallet_student_idx on public.fee_wallet_entries (student_id);

create table if not exists public.fee_cheques (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  receipt_id   uuid not null references public.fee_receipts(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  cheque_no    text not null,
  bank         text,
  cheque_date  date,
  amount       numeric(10,2) not null check (amount > 0),
  status       text not null default 'received' check (status in ('received','deposited','cleared','bounced')),
  deposited_on date, cleared_on date, bounced_on date,
  bounce_reason text,
  bounce_charge numeric(10,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists fee_cheques_status_idx on public.fee_cheques (school_id, status);

create table if not exists public.fee_adjustments (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  due_id     uuid references public.fee_dues(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind       text not null check (kind in ('reversal','waiver','carried','extension','amount_change','fine_waiver')),
  amount     numeric(10,2) not null default 0,
  old_value  text, new_value text,
  reason     text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists fee_adjustments_due_idx on public.fee_adjustments (due_id);

create table if not exists public.fee_refunds (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  amount       numeric(10,2) not null check (amount > 0),
  reason       text not null,
  status       text not null default 'requested' check (status in ('requested','approved','paid','rejected')),
  mode         text check (mode in ('cash','upi','cheque','bank_transfer')),
  reference    text,
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  requested_by_name text,
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  decision_note text,
  paid_on      date,
  created_at   timestamptz not null default now()
);
create index if not exists fee_refunds_idx on public.fee_refunds (school_id, status);

create table if not exists public.fee_day_close (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  day           date not null,
  collector     text not null,
  expected_cash numeric(12,2) not null,
  counted_cash  numeric(12,2) not null,
  difference    numeric(12,2) generated always as (counted_cash - expected_cash) stored,
  note          text,
  closed_by     uuid default auth.uid() references auth.users(id) on delete set null,
  closed_at     timestamptz not null default now(),
  unique (school_id, day, collector)
);

create table if not exists public.fee_online_orders (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  amount      numeric(10,2) not null check (amount > 0),
  status      text not null default 'created' check (status in ('created','paid','failed','expired','cancelled')),
  provider    text not null default 'razorpay',
  link_id     text,
  link_url    text,
  payment_id  text,
  due_ids     uuid[],
  receipt_id  uuid references public.fee_receipts(id) on delete set null,
  error       text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create unique index if not exists fee_online_orders_payment on public.fee_online_orders (school_id, payment_id) where payment_id is not null;
create unique index if not exists fee_online_orders_link on public.fee_online_orders (link_id) where link_id is not null;
create index if not exists fee_online_orders_idx on public.fee_online_orders (school_id, status, created_at desc);

-- ───────────── recalc: reversals reduce what was paid ─────────────
create or replace function public.recalc_due(did uuid) returns void
language sql security definer set search_path = public as $$
  update public.fee_dues d set paid = greatest(coalesce((
      select sum(l.amount) from public.fee_receipt_lines l join public.fee_receipts r on r.id = l.receipt_id
       where l.due_id = did and not r.cancelled), 0)
    - coalesce((select sum(a.amount) from public.fee_adjustments a where a.due_id = did and a.kind = 'reversal'), 0), 0)
  where d.id = did;
$$;
revoke execute on function public.recalc_due(uuid) from public, anon, authenticated;

create or replace function public.wallet_balance(stu uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.fee_wallet_entries
   where student_id = stu and (public.can_student(school_id, 'fees.collection.view', student_id) or public.is_service());
$$;

-- ───────────── Concessions: approval workflow + only approved ones are billed ─────────────
create or replace function public.concession_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare need boolean; actor boolean := auth.uid() is not null and not public.is_service();
begin
  if tg_op = 'INSERT' then
    select coalesce(concession_approval, false) into need from public.fee_settings where school_id = new.school_id;
    if actor and coalesce(need, false) and not public.has_perm_school(new.school_id, 'fees.concessions.approve') then
      new.status := 'pending'; new.decided_by := null; new.decided_at := null;
    elsif new.status = 'approved' then new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    if new.status = 'rejected' then new.status := 'pending'; end if;
  elsif new.status is distinct from old.status then
    if actor and not public.has_perm_school(new.school_id, 'fees.concessions.approve') then raise exception 'Only the principal can approve or reject concessions.'; end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  end if;
  if new.valid_from is not null and new.valid_to is not null and new.valid_to < new.valid_from then raise exception 'The end date is before the start date.'; end if;
  return new;
end $$;
drop trigger if exists student_concessions_guard on public.student_concessions;
create trigger student_concessions_guard before insert or update on public.student_concessions for each row execute function public.concession_guard();

drop policy if exists "edit" on public.student_concessions;
create policy "edit" on public.student_concessions for update to authenticated
  using (public.has_perm_school(school_id, 'fees.concessions.approve')) with check (public.has_perm_school(school_id, 'fees.concessions.approve'));

-- the concession on one instalment, from approved concessions valid on its due date
create or replace function public.concession_for(stu uuid, head uuid, amt numeric, due date) returns numeric
language sql stable security definer set search_path = public as $$
  select least(amt, coalesce(sum(case when c.kind = 'percent' then amt * c.value / 100 else c.value end), 0))
    from public.student_concessions c
   where c.student_id = stu and c.status = 'approved' and (c.fee_head_id is null or c.fee_head_id = head)
     and (c.valid_from is null or c.valid_from <= due) and (c.valid_to is null or c.valid_to >= due);
$$;
revoke execute on function public.concession_for(uuid, uuid, numeric, date) from public, anon, authenticated;

create or replace function public.generate_dues(sid uuid, sess uuid, cls uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         public.concession_for(s.id, p.fee_head_id, p.amount, p.due_date)
  from public.fee_plans p
  join public.fee_heads h on h.id = p.fee_head_id
  join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.status = 'active'
  where p.school_id = sid and p.session_id = sess and (cls is null or p.class_id = cls)
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

create or replace function public.bill_student_dues(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int; sess uuid;
begin
  select id into sess from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then return 0; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         public.concession_for(s.id, p.fee_head_id, p.amount, p.due_date)
    from public.fee_plans p
    join public.fee_heads h on h.id = p.fee_head_id
    join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.id = stu and s.status = 'active'
   where p.school_id = sid and p.session_id = sess
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.bill_student_dues(uuid, uuid) from public, anon, authenticated;

create or replace function public.generate_transport_dues(sid uuid, sess uuid, p_label text, p_due date, p_months numeric default 1) returns int
language plpgsql security definer set search_path = public as $$
declare head uuid; cnt int; k text;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_label), '') = '' or p_due is null then raise exception 'Label and due date are required.'; end if;
  if p_months is null or p_months <= 0 or p_months > 12 then raise exception 'Months must be between 1 and 12.'; end if;
  if not exists (select 1 from public.sessions where id = sess and school_id = sid) then raise exception 'Session not found.'; end if;
  select id into head from public.fee_heads where school_id = sid and name = 'Transport Fee';
  if head is null then insert into public.fee_heads (school_id, name, sort) values (sid, 'Transport Fee', 50) returning id into head; end if;
  k := 'transport:' || sess || ':' || lower(trim(p_label));
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, source_key)
  select sid, sess, x.student_id, head, 'Transport Fee · ' || trim(p_label), p_due, x.amt, public.concession_for(x.student_id, head, x.amt, p_due), k
    from (select a.student_id, round(coalesce(a.monthly_fee, st.monthly_fee) * p_months, 2) as amt
            from public.transport_allocations a
            join public.transport_stops st on st.id = a.stop_id
            join public.students s on s.id = a.student_id and s.status = 'active'
           where a.school_id = sid and a.session_id = sess and a.start_date <= p_due and (a.end_date is null or a.end_date >= p_due)) x
   where x.amt > 0
  on conflict (student_id, source_key) where source_key is not null do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- recompute concessions on a student's unpaid instalments (waivers / carried amounts are kept)
create or replace function public.reapply_concessions(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not (public.has_perm_school(sid, 'fees.concessions.create') or public.has_perm_school(sid, 'fees.concessions.approve')) then raise exception 'not allowed'; end if;
  update public.fee_dues d
     set concession = least(d.amount, public.concession_for(d.student_id, d.fee_head_id, d.amount, d.due_date)
                         + coalesce((select sum(a.amount) from public.fee_adjustments a where a.due_id = d.id and a.kind in ('waiver','carried')), 0))
   where d.student_id = stu and d.school_id = sid and d.status <> 'paid' and d.kind = 'plan';
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ───────────── Late fine ─────────────
create or replace function public.apply_late_fines_core(sid uuid, stu uuid, on_day date) returns int
language plpgsql security definer set search_path = public as $$
declare st record; cnt int := 0;
begin
  select * into st from public.fee_settings where school_id = sid;
  if st.school_id is null or not st.fine_enabled or st.fine_amount <= 0 then return 0; end if;
  with calc as (
    select d.id, d.fine_auto, d.fine_waived,
           greatest(on_day - d.due_date - st.fine_grace_days, 0) as late
      from public.fee_dues d
     where d.school_id = sid and d.status <> 'paid' and d.kind in ('plan','charge') and d.due_date < on_day and (stu is null or d.student_id = stu)
  ), amt as (
    select id, fine_auto,
           greatest(case when late <= 0 then 0
                         when st.fine_mode = 'per_day' then late * st.fine_amount
                         when st.fine_mode = 'per_month' then ceil(late / 30.0) * st.fine_amount
                         else st.fine_amount end, 0) as raw, fine_waived
      from calc
  ), capped as (
    select id, fine_auto, greatest(least(case when st.fine_cap > 0 then least(raw, st.fine_cap) else raw end, raw) - fine_waived, 0) as want from amt
  ), up as (
    update public.fee_dues d set fine = d.fine - d.fine_auto + c.want, fine_auto = c.want
      from capped c where d.id = c.id and c.want > c.fine_auto returning d.id
  )
  select count(*) into cnt from up;
  return cnt;
end $$;
revoke execute on function public.apply_late_fines_core(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.apply_late_fines(sid uuid, on_day date default null) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  return public.apply_late_fines_core(sid, null, coalesce(on_day, public.today_ist()));
end $$;

-- run by the daily job (service role only)
create or replace function public.apply_late_fines_all(on_day date default null) returns int
language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  for s in select school_id from public.fee_settings where fine_enabled loop
    n := n + public.apply_late_fines_core(s.school_id, null, coalesce(on_day, public.today_ist()));
  end loop;
  return n;
end $$;
revoke execute on function public.apply_late_fines_all(date) from public, anon, authenticated;
grant execute on function public.apply_late_fines_all(date) to service_role;

-- ───────────── Waive / adjust / extend / charge / carry forward ─────────────
create or replace function public.waive_due(did uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.fee_dues where id = did;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.concessions.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount to waive.'; end if;
  if p_amount > greatest(d.amount - d.concession + d.fine - d.paid, 0) then raise exception 'You can waive at most the unpaid balance (%).', greatest(d.amount - d.concession + d.fine - d.paid, 0); end if;
  update public.fee_dues set concession = concession + p_amount where id = did;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, reason, created_by_name) values (d.school_id, did, d.student_id, 'waiver', p_amount, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
end $$;

create or replace function public.waive_fine(did uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record; take numeric;
begin
  select * into d from public.fee_dues where id = did;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.concessions.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  take := least(coalesce(p_amount, d.fine), d.fine, greatest(d.amount - d.concession + d.fine - d.paid, 0));
  if take is null or take <= 0 then raise exception 'There is no unpaid fine on this instalment.'; end if;
  update public.fee_dues set fine = fine - take, fine_auto = greatest(fine_auto - take, 0), fine_waived = fine_waived + take where id = did;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, reason, created_by_name) values (d.school_id, did, d.student_id, 'fine_waiver', take, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
end $$;

create or replace function public.adjust_due_amount(did uuid, p_new numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.fee_dues where id = did;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_new is null or p_new < 0 then raise exception 'Enter the new amount.'; end if;
  if p_new - d.concession + d.fine < d.paid then raise exception 'The new amount is less than what has already been paid (%).', d.paid; end if;
  update public.fee_dues set amount = p_new, concession = least(concession, p_new) where id = did;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, old_value, new_value, reason, created_by_name)
  values (d.school_id, did, d.student_id, 'amount_change', p_new - d.amount, d.amount::text, p_new::text, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
end $$;

create or replace function public.extend_dues(sid uuid, p_ids uuid[], p_date date, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; d record;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_date is null then raise exception 'Choose the new due date.'; end if;
  for d in select * from public.fee_dues where school_id = sid and id = any(p_ids) and status <> 'paid' loop
    update public.fee_dues set original_due_date = coalesce(original_due_date, due_date), due_date = p_date where id = d.id;
    insert into public.fee_adjustments (school_id, due_id, student_id, kind, old_value, new_value, reason, created_by_name)
    values (sid, d.id, d.student_id, 'extension', d.due_date::text, p_date::text, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

-- one charge to chosen students, or to a whole class / section
create or replace function public.add_charge(sid uuid, sess uuid, p_students uuid[], p_class uuid, p_section uuid, p_head uuid, p_label text, p_due date, p_amount numeric)
returns int language plpgsql security definer set search_path = public as $$
declare cnt int; k text := 'charge:' || gen_random_uuid()::text; hn text;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_label), '') = '' or p_due is null then raise exception 'Label and due date are required.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  if not exists (select 1 from public.sessions where id = sess and school_id = sid) then raise exception 'Session not found.'; end if;
  if p_head is not null and not exists (select 1 from public.fee_heads where id = p_head and school_id = sid) then raise exception 'Fee head not found.'; end if;
  if coalesce(cardinality(p_students), 0) = 0 and p_class is null then raise exception 'Choose students or a class.'; end if;
  select name into hn from public.fee_heads where id = p_head;
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, kind, source_key)
  select sid, sess, s.id, p_head, case when hn is null then btrim(p_label) else hn || ' · ' || btrim(p_label) end, p_due, p_amount, 'charge', k
    from public.students s
   where s.school_id = sid and s.status = 'active'
     and ((coalesce(cardinality(p_students), 0) > 0 and s.id = any(p_students))
          or (coalesce(cardinality(p_students), 0) = 0 and s.class_id = p_class and (p_section is null or s.section_id = p_section)));
  get diagnostics cnt = row_count;
  return cnt;
end $$;

create or replace function public.carry_forward_dues(sid uuid, from_sess uuid, to_sess uuid, p_due date) returns int
language plpgsql security definer set search_path = public as $$
declare r record; cnt int := 0; fname text;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if from_sess = to_sess then raise exception 'Choose two different sessions.'; end if;
  if not exists (select 1 from public.sessions where id = from_sess and school_id = sid) or not exists (select 1 from public.sessions where id = to_sess and school_id = sid) then raise exception 'Session not found.'; end if;
  select name into fname from public.sessions where id = from_sess;
  for r in
    select d.student_id, sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) as bal
      from public.fee_dues d join public.students s on s.id = d.student_id
     where d.school_id = sid and d.session_id = from_sess and d.status <> 'paid' and s.status = 'active'
     group by d.student_id having sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) > 0
  loop
    insert into public.fee_dues (school_id, session_id, student_id, label, due_date, amount, kind, source_key)
    values (sid, to_sess, r.student_id, 'Arrears of ' || fname, p_due, r.bal, 'arrears', 'arrears:' || from_sess)
    on conflict (student_id, source_key) where source_key is not null do nothing;
    if found then
      insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, reason, created_by_name)
        select sid, d.id, d.student_id, 'carried', greatest(d.amount - d.concession + d.fine - d.paid, 0), 'Carried forward to ' || (select name from public.sessions where id = to_sess), coalesce(auth.jwt() ->> 'email', '')
          from public.fee_dues d where d.student_id = r.student_id and d.session_id = from_sess and d.school_id = sid and d.status <> 'paid';
      update public.fee_dues d set concession = concession + greatest(d.amount - d.concession + d.fine - d.paid, 0)
       where d.student_id = r.student_id and d.session_id = from_sess and d.school_id = sid and d.status <> 'paid';
      cnt := cnt + 1;
    end if;
  end loop;
  return cnt;
end $$;

-- ───────────── Collection ─────────────
-- Core (no permission check): used by the desk function and by the online-payment completion.
create or replace function public.collect_fee_core(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[], p_wallet_use numeric, p_paid_on date, p_note text, p_by text,
                                                   p_fine numeric, p_force_advance boolean, p_online_order uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st record; sp jsonb; rid uuid; rno text; money numeric := 0; wuse numeric := coalesce(p_wallet_use, 0); bal numeric; wallet numeric; alloc numeric; excess numeric;
        d record; take numeric; left_amt numeric; modes text[] := '{}'; m text; first_ref text; first_due uuid; pid uuid; any_line boolean := false;
begin
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found'; end if;
  select * into st from public.fee_settings where school_id = sid;
  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    if (sp ->> 'mode') not in ('cash','upi','cheque','bank_transfer','card','online') then raise exception 'Unknown payment mode "%".', sp ->> 'mode'; end if;
    if coalesce((sp ->> 'amount')::numeric, 0) <= 0 then raise exception 'Every payment line needs an amount.'; end if;
    money := money + (sp ->> 'amount')::numeric;
    if not ((sp ->> 'mode') = any(modes)) then modes := modes || (sp ->> 'mode'); end if;
  end loop;
  if money + wuse <= 0 then raise exception 'Amount must be more than zero'; end if;
  if wuse < 0 then raise exception 'Wallet amount cannot be negative.'; end if;
  select coalesce(sum(amount), 0) into wallet from public.fee_wallet_entries where student_id = stu;
  if wuse > wallet then raise exception 'The wallet has only % — use less.', wallet; end if;

  -- automatic late fine up to the payment date, then an optional manual fine
  perform public.apply_late_fines_core(sid, stu, coalesce(p_paid_on, public.today_ist()));
  if coalesce(p_fine, 0) > 0 then
    select id into first_due from public.fee_dues where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or id = any(p_due_ids)) order by due_date, label limit 1;
    if first_due is null then raise exception 'No unpaid instalment to add the fine to'; end if;
    update public.fee_dues set fine = fine + p_fine where id = first_due;
  end if;

  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
   where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  excess := greatest(money + wuse - bal, 0);
  if excess > 0 then
    if wuse > 0 and excess > money then raise exception 'The wallet use is more than what is due. Use less.'; end if;
    if not coalesce(st.advance_allowed, true) and not p_force_advance then raise exception 'Amount is more than the total due'; end if;
  end if;
  alloc := money + wuse - excess;

  rno := public.next_school_number_core(sid, 'receipt');
  insert into public.fee_receipts (school_id, receipt_no, student_id, paid_on, mode, reference, amount, note, collected_by, advance_amount, wallet_used, online_order_id)
  values (sid, rno, stu, coalesce(p_paid_on, public.today_ist()),
          case when cardinality(modes) > 1 then 'mixed' when cardinality(modes) = 1 then modes[1] else 'wallet' end,
          nullif(p_splits -> 0 ->> 'reference', ''), alloc, p_note, p_by, excess, wuse, p_online_order)
  returning id into rid;

  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount, reference)
    values (sid, rid, sp ->> 'mode', (sp ->> 'amount')::numeric, nullif(btrim(coalesce(sp ->> 'reference', sp ->> 'cheque_no', '')), '')) returning id into pid;
    if (sp ->> 'mode') = 'cheque' then
      insert into public.fee_cheques (school_id, receipt_id, student_id, cheque_no, bank, cheque_date, amount)
      values (sid, rid, stu, coalesce(nullif(btrim(coalesce(sp ->> 'cheque_no', sp ->> 'reference', '')), ''), 'N/A'), nullif(sp ->> 'bank', ''), nullif(sp ->> 'cheque_date', '')::date, (sp ->> 'amount')::numeric);
    end if;
  end loop;

  left_amt := alloc;
  for d in select id, greatest(amount - concession + fine - paid, 0) as b from public.fee_dues
            where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids))
            order by due_date, label for update loop
    exit when left_amt <= 0;
    take := least(d.b, left_amt);
    if take > 0 then
      insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, d.id, take);
      left_amt := left_amt - take; any_line := true;
    end if;
  end loop;
  if wuse > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'applied', -wuse, rid, 'Used against receipt ' || rno, p_by); end if;
  if excess > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'advance', excess, rid, 'Advance with receipt ' || rno, p_by); end if;
  return rid;
end $$;
revoke execute on function public.collect_fee_core(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric, boolean, uuid) from public, anon, authenticated;

alter table public.fee_receipts add column if not exists online_order_id uuid;

-- number allocator without the permission check (the callers have already checked)
create or replace function public.next_school_number_core(sid uuid, kind text) returns text
language plpgsql security definer set search_path = public as $$
declare n int; p text;
begin
  if kind = 'receipt' then
    update public.schools set next_receipt_no = next_receipt_no + 1 where id = sid returning next_receipt_no - 1, receipt_prefix into n, p;
    return p || lpad(n::text, 5, '0');
  end if;
  raise exception 'unknown kind %', kind;
end $$;
revoke execute on function public.next_school_number_core(uuid, text) from public, anon, authenticated;

create or replace function public.collect_fee_v2(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[] default null, p_wallet_use numeric default 0,
                                                 p_paid_on date default null, p_note text default null, p_by text default null, p_fine numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  return public.collect_fee_core(sid, stu, p_splits, p_due_ids, p_wallet_use, p_paid_on, p_note, p_by, p_fine, false, null);
end $$;

-- the old single-mode entry point keeps working
create or replace function public.collect_fee(sid uuid, stu uuid, amt numeric, p_mode text, p_ref text, p_note text, p_paid_on date, p_fine numeric, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  if amt is null or amt <= 0 then raise exception 'Amount must be more than zero'; end if;
  return public.collect_fee_core(sid, stu, jsonb_build_array(jsonb_build_object('mode', p_mode, 'amount', amt, 'reference', p_ref)), null, 0, p_paid_on, p_note, p_by, p_fine, false, null);
end $$;

-- ───────────── Cheques ─────────────
create or replace function public.set_cheque_status(cid uuid, p_status text, p_day date default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c record; ch numeric; st record; on_day date := coalesce(p_day, public.today_ist());
begin
  select * into c from public.fee_cheques where id = cid;
  if c.id is null then raise exception 'Cheque not found.'; end if;
  if p_status not in ('deposited','cleared','bounced') then raise exception 'Unknown status.'; end if;
  if p_status = 'bounced' then
    if not public.has_perm_school(c.school_id, 'fees.receipts.approve') then raise exception 'Only the principal can mark a cheque bounced.'; end if;
  elsif not public.has_perm_school(c.school_id, 'fees.collection.create') then raise exception 'not allowed';
  end if;
  if c.status in ('cleared','bounced') then raise exception 'This cheque is already %.', c.status; end if;
  if p_status = 'deposited' then
    update public.fee_cheques set status = 'deposited', deposited_on = on_day where id = cid;
  elsif p_status = 'cleared' then
    update public.fee_cheques set status = 'cleared', cleared_on = on_day, deposited_on = coalesce(deposited_on, on_day) where id = cid;
  else
    if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason (insufficient funds, signature…).'; end if;
    select * into st from public.fee_settings where school_id = c.school_id;
    ch := coalesce(st.bounce_charge, 0);
    update public.fee_cheques set status = 'bounced', bounced_on = on_day, bounce_reason = btrim(p_reason), bounce_charge = ch where id = cid;
    -- the receipt's money did not arrive: cancel it (dues come back), and bill the bank charge
    update public.fee_receipts set cancelled = true, cancelled_reason = 'Cheque ' || c.cheque_no || ' bounced: ' || btrim(p_reason) where id = c.receipt_id and not cancelled;
    if ch > 0 then
      insert into public.fee_dues (school_id, session_id, student_id, label, due_date, amount, kind, source_key)
      select c.school_id, coalesce((select session_id from public.fee_dues x join public.fee_receipt_lines l on l.due_id = x.id where l.receipt_id = c.receipt_id limit 1),
                                   (select id from public.sessions where school_id = c.school_id and is_current limit 1)),
             c.student_id, 'Cheque bounce charge · ' || c.cheque_no, on_day, ch, 'bounce', 'bounce:' || c.id
       where exists (select 1 from public.sessions where school_id = c.school_id and is_current)
      on conflict (student_id, source_key) where source_key is not null do nothing;
    end if;
  end if;
end $$;

-- ───────────── Wallet, reversal, refunds ─────────────
create or replace function public.reverse_payment(did uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.fee_dues where id = did;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.refunds.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > d.paid then raise exception 'Enter an amount up to what was paid (%).', d.paid; end if;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, reason, created_by_name) values (d.school_id, did, d.student_id, 'reversal', p_amount, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
  perform public.recalc_due(did);
  insert into public.fee_wallet_entries (school_id, student_id, kind, amount, note, created_by)
  values (d.school_id, d.student_id, 'reversal', p_amount, 'Payment moved back from "' || d.label || '": ' || btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
end $$;

create or replace function public.request_refund(sid uuid, stu uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare bal numeric; pend numeric; rid uuid;
begin
  if not public.has_perm_school(sid, 'fees.refunds.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  select coalesce(sum(amount), 0) into bal from public.fee_wallet_entries where student_id = stu;
  select coalesce(sum(amount), 0) into pend from public.fee_refunds where student_id = stu and status in ('requested','approved');
  if p_amount > bal - pend then raise exception 'Only % is available in the wallet for refund (move a paid fee back to the wallet first).', greatest(bal - pend, 0); end if;
  insert into public.fee_refunds (school_id, student_id, amount, reason, requested_by_name) values (sid, stu, p_amount, btrim(p_reason), coalesce(auth.jwt() ->> 'email', '')) returning id into rid;
  return rid;
end $$;

create or replace function public.decide_refund(rid uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.fee_refunds where id = rid;
  if r.id is null then raise exception 'Refund not found.'; end if;
  if not public.has_perm_school(r.school_id, 'fees.refunds.approve') then raise exception 'not allowed'; end if;
  if r.status <> 'requested' then raise exception 'This request is already %.', r.status; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Write the reason for rejecting.'; end if;
  update public.fee_refunds set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = rid;
end $$;

create or replace function public.pay_refund(rid uuid, p_mode text, p_ref text, p_paid_on date default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record; bal numeric;
begin
  select * into r from public.fee_refunds where id = rid for update;
  if r.id is null then raise exception 'Refund not found.'; end if;
  if not (public.has_perm_school(r.school_id, 'fees.refunds.approve') or public.has_perm_school(r.school_id, 'fees.refunds.create')) then raise exception 'not allowed'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved refund can be paid (this one is %).', r.status; end if;
  if p_mode not in ('cash','upi','cheque','bank_transfer') then raise exception 'Choose how it was paid.'; end if;
  select coalesce(sum(amount), 0) into bal from public.fee_wallet_entries where student_id = r.student_id;
  if bal < r.amount then raise exception 'The wallet no longer has this amount (%).', bal; end if;
  insert into public.fee_wallet_entries (school_id, student_id, kind, amount, note, created_by) values (r.school_id, r.student_id, 'refund', -r.amount, 'Refund: ' || r.reason, coalesce(auth.jwt() ->> 'email', ''));
  update public.fee_refunds set status = 'paid', mode = p_mode, reference = nullif(btrim(coalesce(p_ref, '')), ''), paid_on = coalesce(p_paid_on, public.today_ist()) where id = rid;
end $$;

-- ───────────── Day-end closing ─────────────
create or replace function public.cash_expected(sid uuid, p_day date, p_collector text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(p.amount) from public.fee_receipt_payments p join public.fee_receipts r on r.id = p.receipt_id
                    where r.school_id = sid and r.paid_on = p_day and not r.cancelled and p.mode = 'cash' and coalesce(r.collected_by, '') = coalesce(p_collector, '')), 0)
       - coalesce((select sum(f.amount) from public.fee_refunds f where f.school_id = sid and f.paid_on = p_day and f.status = 'paid' and f.mode = 'cash'), 0);
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon;

create or replace function public.close_day(sid uuid, p_day date, p_collector text, p_counted numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare exp numeric; cid uuid;
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the cash counted.'; end if;
  if p_day > public.today_ist() then raise exception 'A future day cannot be closed.'; end if;
  exp := public.cash_expected(sid, p_day, p_collector);
  insert into public.fee_day_close (school_id, day, collector, expected_cash, counted_cash, note) values (sid, p_day, coalesce(p_collector, ''), exp, p_counted, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (school_id, day, collector) do update set expected_cash = excluded.expected_cash, counted_cash = excluded.counted_cash, note = excluded.note, closed_by = auth.uid(), closed_at = now()
  returning id into cid;
  return cid;
end $$;

-- ───────────── Online payments (service role) ─────────────
create or replace function public.create_online_order(sid uuid, stu uuid, p_amount numeric, p_due_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare st record; bal numeric; oid uuid;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into st from public.fee_settings where school_id = sid;
  if st.school_id is null or not st.online_enabled then raise exception 'Online payment is not switched on for this school.'; end if;
  if not public.school_writable(sid) then raise exception 'This school cannot take payments right now.'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid and status = 'active') then raise exception 'Student not found.'; end if;
  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
   where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  if bal <= 0 then raise exception 'Nothing is due.'; end if;
  if p_amount is null or p_amount < st.online_min_amount then raise exception 'The minimum online payment is %.', st.online_min_amount; end if;
  if p_amount > bal then raise exception 'The amount is more than what is due (%).', bal; end if;
  if not st.online_allow_partial and p_amount < bal then raise exception 'Please pay the full amount due (%).', bal; end if;
  update public.fee_online_orders set status = 'expired' where student_id = stu and status = 'created' and created_at < now() - interval '2 days';
  insert into public.fee_online_orders (school_id, student_id, amount, due_ids) values (sid, stu, p_amount, nullif(p_due_ids, '{}')) returning id into oid;
  return oid;
end $$;
revoke execute on function public.create_online_order(uuid, uuid, numeric, uuid[]) from public, anon, authenticated;
grant execute on function public.create_online_order(uuid, uuid, numeric, uuid[]) to service_role;

create or replace function public.complete_online_order(p_link text, p_payment text, p_paise bigint) returns json
language plpgsql security definer set search_path = public as $$
declare o record; rid uuid; rno text;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into o from public.fee_online_orders where link_id = p_link for update;
  if o.id is null then return json_build_object('ok', false, 'note', 'no matching order'); end if;
  if o.status = 'paid' then return json_build_object('ok', true, 'note', 'already recorded', 'receipt_id', o.receipt_id); end if;
  if p_payment is not null and exists (select 1 from public.fee_online_orders where school_id = o.school_id and payment_id = p_payment) then
    return json_build_object('ok', true, 'note', 'payment already recorded');
  end if;
  if p_paise is not null and p_paise <> round(o.amount * 100) then
    update public.fee_online_orders set status = 'failed', error = 'Amount mismatch: paid ' || (p_paise / 100.0)::text where id = o.id;
    return json_build_object('ok', false, 'note', 'amount mismatch');
  end if;
  rid := public.collect_fee_core(o.school_id, o.student_id, jsonb_build_array(jsonb_build_object('mode', 'online', 'amount', o.amount, 'reference', p_payment)),
                                 o.due_ids, 0, public.today_ist(), 'Paid online', 'Online payment', 0, true, o.id);
  update public.fee_online_orders set status = 'paid', payment_id = p_payment, receipt_id = rid, paid_at = now() where id = o.id;
  select receipt_no into rno from public.fee_receipts where id = rid;
  return json_build_object('ok', true, 'receipt_id', rid, 'receipt_no', rno);
end $$;
revoke execute on function public.complete_online_order(text, text, bigint) from public, anon, authenticated;
grant execute on function public.complete_online_order(text, text, bigint) to service_role;

-- ───────────── Reports (RLS applies: staff see only what they may) ─────────────
create or replace function public.fee_report(sid uuid, d1 date, d2 date, by text) returns table (key text, label text, receipts bigint, amount numeric)
language plpgsql stable set search_path = public as $$
begin
  if by = 'day' then
    return query select r.paid_on::text, to_char(r.paid_on, 'DD Mon YYYY'), count(*)::bigint, sum(r.amount) from public.fee_receipts r
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by r.paid_on order by r.paid_on;
  elsif by = 'month' then
    return query select to_char(r.paid_on, 'YYYY-MM'), to_char(r.paid_on, 'Mon YYYY'), count(*)::bigint, sum(r.amount) from public.fee_receipts r
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by 1, 2 order by 1;
  elsif by = 'collector' then
    return query select coalesce(r.collected_by, '—'), coalesce(r.collected_by, '—'), count(*)::bigint, sum(r.amount) from public.fee_receipts r
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by 1 order by 4 desc;
  elsif by = 'mode' then
    return query select p.mode, p.mode, count(distinct p.receipt_id)::bigint, sum(p.amount) from public.fee_receipt_payments p join public.fee_receipts r on r.id = p.receipt_id
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by p.mode order by 4 desc;
  elsif by = 'head' then
    return query select coalesce(h.id::text, 'other'), coalesce(h.name, 'Other charges'), count(distinct l.receipt_id)::bigint, sum(l.amount)
      from public.fee_receipt_lines l join public.fee_receipts r on r.id = l.receipt_id join public.fee_dues d on d.id = l.due_id left join public.fee_heads h on h.id = d.fee_head_id
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by 1, 2 order by 4 desc;
  elsif by = 'class' then
    return query select coalesce(c.id::text, 'none'), coalesce('Class ' || c.name, 'No class'), count(distinct r.id)::bigint, sum(r.amount)
      from public.fee_receipts r join public.students s on s.id = r.student_id left join public.classes c on c.id = s.class_id
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by 1, 2, c.sort order by c.sort nulls last;
  else
    raise exception 'Unknown grouping.';
  end if;
end $$;

create or replace function public.fee_aging(sid uuid, sess uuid, on_day date default null) returns table (bucket text, students bigint, amount numeric)
language sql stable set search_path = public as $$
  with b as (
    select d.student_id, greatest(d.amount - d.concession + d.fine - d.paid, 0) as bal,
           case when d.due_date >= coalesce(on_day, public.today_ist()) then '0 · Not yet due'
                when coalesce(on_day, public.today_ist()) - d.due_date <= 30 then '1 · 1–30 days'
                when coalesce(on_day, public.today_ist()) - d.due_date <= 60 then '2 · 31–60 days'
                when coalesce(on_day, public.today_ist()) - d.due_date <= 90 then '3 · 61–90 days'
                else '4 · Over 90 days' end as bucket
      from public.fee_dues d join public.students s on s.id = d.student_id
     where d.school_id = sid and d.session_id = sess and d.status <> 'paid' and s.status = 'active')
  select bucket, count(distinct student_id)::bigint, sum(bal) from b where bal > 0 group by bucket order by bucket;
$$;

-- Money columns of a due change only through the functions above (they run as the owner, not as the signed-in role).
create or replace function public.guard_fee_due() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.amount is distinct from old.amount or new.concession is distinct from old.concession or new.fine is distinct from old.fine
    or new.paid is distinct from old.paid or new.fine_auto is distinct from old.fine_auto or new.fine_waived is distinct from old.fine_waived
    or new.due_date is distinct from old.due_date or new.kind is distinct from old.kind) then
    raise exception 'Fee amounts change only through the fee screens (adjust, waive, extend, concession).';
  end if;
  return new;
end $$;
drop trigger if exists fee_dues_guard on public.fee_dues;
create trigger fee_dues_guard before update on public.fee_dues for each row execute function public.guard_fee_due();

-- ───────────── Row Level Security ─────────────
alter table public.fee_settings enable row level security;
alter table public.fee_receipt_payments enable row level security;
alter table public.fee_wallet_entries enable row level security;
alter table public.fee_cheques enable row level security;
alter table public.fee_adjustments enable row level security;
alter table public.fee_refunds enable row level security;
alter table public.fee_day_close enable row level security;
alter table public.fee_online_orders enable row level security;

drop policy if exists "read" on public.fee_settings;
create policy "read" on public.fee_settings for select to authenticated using (public.has_module_perm(school_id, 'fees'));
drop policy if exists "write" on public.fee_settings;
create policy "write" on public.fee_settings for all to authenticated
  using (public.has_perm_school(school_id, 'fees.structure.edit')) with check (public.has_perm_school(school_id, 'fees.structure.edit'));

drop policy if exists "read" on public.fee_receipt_payments;
create policy "read" on public.fee_receipt_payments for select to authenticated using (public.has_perm_school(school_id, 'fees.collection.view') or public.has_perm_school(school_id, 'fees.receipts.view'));
drop policy if exists "read" on public.fee_wallet_entries;
create policy "read" on public.fee_wallet_entries for select to authenticated using (public.can_student(school_id, 'fees.collection.view', student_id));
drop policy if exists "read" on public.fee_cheques;
create policy "read" on public.fee_cheques for select to authenticated using (public.has_perm_school(school_id, 'fees.collection.view'));
drop policy if exists "read" on public.fee_adjustments;
create policy "read" on public.fee_adjustments for select to authenticated using (public.can_student(school_id, 'fees.collection.view', student_id));
drop policy if exists "read" on public.fee_refunds;
create policy "read" on public.fee_refunds for select to authenticated using (public.has_perm_school(school_id, 'fees.refunds.view'));
drop policy if exists "read" on public.fee_day_close;
create policy "read" on public.fee_day_close for select to authenticated using (public.has_perm_school(school_id, 'fees.collection.view'));
drop policy if exists "read" on public.fee_online_orders;
create policy "read" on public.fee_online_orders for select to authenticated using (public.has_perm_school(school_id, 'fees.online.view'));
-- all of these are written only through the functions above

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['fee_settings','fee_refunds','fee_cheques','fee_adjustments','fee_day_close','fee_online_orders','fee_wallet_entries'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- new permission keys for schools that already exist: nothing new (fees.online / fees.refunds were in the catalogue); mark them built
