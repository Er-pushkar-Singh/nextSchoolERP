-- ═══════════════════════════════════════════════════════════════════════════
-- Step 15: collect fees structure-wise (each instalment / fee head with its own amount) and fetch the fine automatically.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════
-- (also in 0016; repeated so this migration works on its own)
alter table public.fee_receipts drop constraint if exists fee_receipts_mode_check;
alter table public.fee_receipts add constraint fee_receipts_mode_check
  check (mode in ('cash','upi','cheque','bank_transfer','card','online','dd','other','mixed','wallet'));
alter table public.fee_receipt_payments drop constraint if exists fee_receipt_payments_mode_check;
alter table public.fee_receipt_payments add constraint fee_receipt_payments_mode_check
  check (mode in ('cash','upi','cheque','bank_transfer','card','online','dd','other'));
alter table public.fee_receipt_payments add column if not exists sub_type text;     -- debit / credit, or the label of "other"

drop function if exists public.collect_fee_core(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric, boolean, uuid);
drop function if exists public.collect_fee_v2(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric);

create or replace function public.collect_fee_core(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[], p_wallet_use numeric, p_paid_on date, p_note text, p_by text,
                                                   p_fine numeric, p_force_advance boolean, p_online_order uuid default null, p_alloc jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st record; sp jsonb; rid uuid; rno text; money numeric := 0; wuse numeric := coalesce(p_wallet_use, 0); bal numeric; wallet numeric; alloc numeric; excess numeric;
        d record; take numeric; left_amt numeric; modes text[] := '{}'; m text; first_ref text; first_due uuid; pid uuid; any_line boolean := false;
        use_alloc boolean := false; al jsonb; a_ids uuid[] := '{}'; a_amt numeric[] := '{}'; i int; bal_d numeric; lbl text;
begin
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found'; end if;
  select * into st from public.fee_settings where school_id = sid;
  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    if (sp ->> 'mode') not in ('cash','upi','cheque','bank_transfer','card','online','dd','other') then raise exception 'Unknown payment mode "%".', sp ->> 'mode'; end if;
    if coalesce((sp ->> 'amount')::numeric, 0) <= 0 then raise exception 'Every payment line needs an amount.'; end if;
    money := money + (sp ->> 'amount')::numeric;
    if not ((sp ->> 'mode') = any(modes)) then modes := modes || (sp ->> 'mode'); end if;
  end loop;
  if money + wuse <= 0 then raise exception 'Amount must be more than zero'; end if;
  if wuse < 0 then raise exception 'Wallet amount cannot be negative.'; end if;
  select coalesce(sum(amount), 0) into wallet from public.fee_wallet_entries where student_id = stu;
  if wuse > wallet then raise exception 'The wallet has only % — use less.', wallet; end if;

  -- structure-wise collection: [{"due_id": "...", "amount": 500}, …]
  use_alloc := p_alloc is not null and jsonb_typeof(p_alloc) = 'array' and jsonb_array_length(p_alloc) > 0;
  if use_alloc then
    for al in select * from jsonb_array_elements(p_alloc) loop
      a_ids := a_ids || (al ->> 'due_id')::uuid;
      a_amt := a_amt || round((al ->> 'amount')::numeric, 2);
    end loop;
    if exists (select 1 from unnest(a_amt) x where x is null or x <= 0) then raise exception 'Every instalment you pay needs an amount above zero.'; end if;
    if (select count(distinct x) from unnest(a_ids) x) <> cardinality(a_ids) then raise exception 'An instalment appears twice.'; end if;
    if (select count(*) from public.fee_dues where id = any(a_ids) and student_id = stu and school_id = sid and status <> 'paid') <> cardinality(a_ids) then
      raise exception 'One of the chosen instalments is not open for this student.';
    end if;
    p_due_ids := a_ids;
  end if;

  -- automatic late fine up to the payment date, then an optional manual fine
  perform public.apply_late_fines_core(sid, stu, coalesce(p_paid_on, public.today_ist()));
  if coalesce(p_fine, 0) > 0 then
    if use_alloc then first_due := a_ids[1];
    else select id into first_due from public.fee_dues where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or id = any(p_due_ids)) order by due_date, label limit 1;
    end if;
    if first_due is null then raise exception 'No unpaid instalment to add the fine to'; end if;
    update public.fee_dues set fine = fine + p_fine where id = first_due;
    if use_alloc then a_amt[1] := a_amt[1] + p_fine; end if;
  end if;

  if use_alloc then
    for i in 1..cardinality(a_ids) loop
      select greatest(amount - concession + fine - paid, 0), label into bal_d, lbl from public.fee_dues where id = a_ids[i];
      if a_amt[i] > bal_d then raise exception 'The amount for "%" is more than its balance (%).', lbl, bal_d; end if;
    end loop;
    bal := (select coalesce(sum(x), 0) from unnest(a_amt) x);
    if money + wuse < bal then raise exception 'The payment (%) is less than the fees chosen (%).', money + wuse, bal; end if;
  else
    select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
     where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  end if;
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
    insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount, reference, sub_type)
    values (sid, rid, sp ->> 'mode', (sp ->> 'amount')::numeric, nullif(btrim(coalesce(sp ->> 'reference', sp ->> 'cheque_no', '')), ''), nullif(btrim(coalesce(sp ->> 'sub_type', '')), '')) returning id into pid;
    if (sp ->> 'mode') = 'cheque' then
      insert into public.fee_cheques (school_id, receipt_id, student_id, cheque_no, bank, cheque_date, amount)
      values (sid, rid, stu, coalesce(nullif(btrim(coalesce(sp ->> 'cheque_no', sp ->> 'reference', '')), ''), 'N/A'), nullif(sp ->> 'bank', ''), nullif(sp ->> 'cheque_date', '')::date, (sp ->> 'amount')::numeric);
    end if;
  end loop;

  left_amt := alloc;
  if use_alloc then
    for i in 1..cardinality(a_ids) loop
      insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, a_ids[i], a_amt[i]);
    end loop;
  else
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
  end if;
  if wuse > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'applied', -wuse, rid, 'Used against receipt ' || rno, p_by); end if;
  if excess > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'advance', excess, rid, 'Advance with receipt ' || rno, p_by); end if;
  return rid;
end $$;


revoke execute on function public.collect_fee_core(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric, boolean, uuid, jsonb) from public, anon, authenticated;

create or replace function public.collect_fee_v2(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[] default null, p_wallet_use numeric default 0,
                                                 p_paid_on date default null, p_note text default null, p_by text default null, p_fine numeric default 0,
                                                 p_alloc jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  return public.collect_fee_core(sid, stu, p_splits, p_due_ids, p_wallet_use, p_paid_on, p_note, p_by, p_fine, false, null, p_alloc);
end $$;

-- brings the late fine of one student up to date (the fee desk calls it when a student is opened)
create or replace function public.refresh_student_fines(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_perm_school(sid, 'fees.collection.create') or public.has_perm_school(sid, 'fees.collection.view')) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then return 0; end if;
  return public.apply_late_fines_core(sid, stu, public.today_ist());
end $$;
