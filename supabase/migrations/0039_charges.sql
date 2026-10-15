-- ═══════════════════════════════════════════════════════════════════════════
-- Step 37: one money trail per student — whatever a module charges a student (UP Board registration fee, library fine,
--          discipline fine, uniform & book bills, damaged / lost property, hostel, transport …) becomes a due on the student's
--          FEE ACCOUNT, collected at the one fee counter and shown in the one ledger. Payment status flows back to the module.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── the internal helper every module uses ─────────────
-- Creates (or updates, while still unpaid) one due for a student. The source key makes it idempotent: the same event never bills twice.
create or replace function public.charge_student(sid uuid, p_student uuid, p_head text, p_label text, p_amount numeric, p_due date, p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare head uuid; sess uuid; ex public.fee_dues; nid uuid;
begin
  if p_amount is null or p_amount <= 0 then return null; end if;
  select id into ex.id from public.fee_dues where student_id = p_student and source_key = p_key;
  if ex.id is not null then
    update public.fee_dues set amount = p_amount, label = left(p_label, 120) where id = ex.id and paid = 0 and amount is distinct from p_amount;
    return ex.id;
  end if;
  select id into sess from public.sessions where school_id = sid and is_current;
  if sess is null then select id into sess from public.sessions where school_id = sid order by start_date desc limit 1; end if;
  if sess is null then raise exception 'The school has no session to bill the student in.'; end if;
  select id into head from public.fee_heads where school_id = sid and lower(name) = lower(p_head);
  if head is null then insert into public.fee_heads (school_id, name, sort) values (sid, p_head, 90) returning id into head; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, source_key)
  values (sid, sess, p_student, head, left(p_label, 120), coalesce(p_due, public.today_ist()), round(p_amount, 2), 0, p_key) returning id into nid;
  return nid;
end $$;
revoke execute on function public.charge_student(uuid, uuid, text, text, numeric, date, text) from public, anon, authenticated;

-- removes an UNPAID charge again (the event was cancelled); a partly paid one is left for a refund
create or replace function public.uncharge_student(p_student uuid, p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.fee_dues where student_id = p_student and source_key = p_key and paid = 0;
  return found;
end $$;
revoke execute on function public.uncharge_student(uuid, text) from public, anon, authenticated;

-- ───────────── UP Board registration fee → fee account ─────────────
create or replace function public.board_fee_to_account() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fee_total > 0 then
    perform public.charge_student(new.school_id, new.student_id, 'Board Registration Fee',
      case new.kind when 'advance_registration' then 'UP Board registration fee' else 'UP Board exam form fee' end || ' · Class ' || new.class_level,
      new.fee_total, public.today_ist(), 'board:' || new.id);
  else
    perform public.uncharge_student(new.student_id, 'board:' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists board_fee_to_account on public.board_registrations;
create trigger board_fee_to_account after insert or update of fee_total on public.board_registrations
  for each row execute function public.board_fee_to_account();

-- existing registrations get their charge once
insert into public.fee_heads (school_id, name, sort)
select distinct b.school_id, 'Board Registration Fee', 90 from public.board_registrations b
 where b.fee_total > 0 and not exists (select 1 from public.fee_heads h where h.school_id = b.school_id and lower(h.name) = 'board registration fee');
do $$
declare r record;
begin
  for r in select * from public.board_registrations where fee_total > 0 loop
    perform public.charge_student(r.school_id, r.student_id, 'Board Registration Fee',
      case r.kind when 'advance_registration' then 'UP Board registration fee' else 'UP Board exam form fee' end || ' · Class ' || r.class_level,
      r.fee_total, public.today_ist(), 'board:' || r.id);
  end loop;
end $$;

-- ───────────── library fine → fee account (students) ─────────────
alter table public.library_issues add column if not exists fine_due_id uuid references public.fee_dues(id) on delete set null;

create or replace function public.library_fine_to_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare did uuid; t text;
begin
  if new.returned_on is not null and coalesce(new.fine, 0) > 0 and not coalesce(new.fine_waived, false) and new.student_id is not null and new.fine_due_id is null and new.fine_paid_on is null then
    select title into t from public.library_books where id = new.book_id;
    did := public.charge_student(new.school_id, new.student_id, 'Library Fine', 'Library fine · ' || coalesce(t, 'book') || case when new.lost then ' (lost)' else '' end,
                                 new.fine, public.today_ist(), 'libfine:' || new.id);
    if did is not null then update public.library_issues set fine_due_id = did where id = new.id; end if;
  end if;
  return new;
end $$;
drop trigger if exists library_fine_to_account on public.library_issues;
create trigger library_fine_to_account after update of returned_on, fine on public.library_issues
  for each row execute function public.library_fine_to_account();

-- unpaid student fines from before this step move to the fee account once
do $$
declare r record; did uuid;
begin
  for r in select i.id, i.school_id, i.student_id, i.fine, i.lost, b.title from public.library_issues i join public.library_books b on b.id = i.book_id
            where i.returned_on is not null and i.fine > 0 and i.fine_paid_on is null and not i.fine_waived and i.student_id is not null and i.fine_due_id is null loop
    did := public.charge_student(r.school_id, r.student_id, 'Library Fine', 'Library fine · ' || r.title || case when r.lost then ' (lost)' else '' end, r.fine, public.today_ist(), 'libfine:' || r.id);
    update public.library_issues set fine_due_id = did where id = r.id;
  end loop;
end $$;

-- a fine already on the fee account is collected there, not twice
create or replace function public.library_collect_fine(sid uuid, p_issue uuid, p_mode text default 'cash') returns void
language plpgsql security definer set search_path = public as $$
declare it public.library_issues; head uuid; bk uuid; n int; me text; nm text; ttl text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'library.circulation.edit') then raise exception 'not allowed'; end if;
  select * into it from public.library_issues where id = p_issue and school_id = sid;
  if it.id is null or it.returned_on is null then raise exception 'Return the book first.'; end if;
  if it.fine <= 0 or it.fine_paid_on is not null then raise exception 'There is no fine to collect.'; end if;
  if it.fine_due_id is not null then raise exception 'This fine is on the student''s fee account — collect it at the fee counter.'; end if;
  perform public._account_defaults(sid);
  select id into head from public.account_heads where school_id = sid and kind = 'income' and lower(name) = 'library fines';
  if head is null then insert into public.account_heads (school_id, name, kind) values (sid, 'Library fines', 'income') returning id into head; end if;
  select id into bk from public.account_books where school_id = sid and active order by (kind = 'cash') desc, created_at limit 1;
  update public.account_settings set next_no = next_no + 1 where school_id = sid returning next_no - 1 into n;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  select coalesce((select btrim(concat_ws(' ', first_name, last_name)) from public.students where id = it.student_id), (select name from public.staff where id = it.staff_id)) into nm;
  select title into ttl from public.library_books where id = it.book_id;
  insert into public.vouchers (school_id, no, date, kind, head_id, book_id, amount, party, mode, narration, status, created_by_name)
  values (sid, 'RV-' || lpad(n::text, 5, '0'), public.today_ist(), 'receipt', head, bk, it.fine, nm, case when p_mode in ('cash', 'upi', 'cheque', 'bank_transfer', 'card') then p_mode else 'cash' end,
          left('Library fine — ' || ttl, 500), 'posted', coalesce(me, 'User'));
  update public.library_issues set fine_paid_on = public.today_ist() where id = p_issue;
end $$;

-- ───────────── discipline fine → fee account ─────────────
alter table public.discipline_incidents add column if not exists fine_amount numeric(10,2) not null default 0 check (fine_amount >= 0);

create or replace function public.discipline_set_fine(sid uuid, p_incident uuid, p_amount numeric) returns int
language plpgsql security definer set search_path = public as $$
declare i public.discipline_incidents; r record; n int := 0; amt numeric := coalesce(p_amount, 0);
begin
  select * into i from public.discipline_incidents where id = p_incident and school_id = sid;
  if i.id is null or auth.uid() is null or not public.has_perm_school(sid, 'wellbeing.discipline.approve') then raise exception 'not allowed'; end if;
  if amt < 0 or amt > 100000 then raise exception 'The fine must be between ₹0 and ₹1,00,000.'; end if;
  update public.discipline_incidents set fine_amount = amt where id = p_incident;
  for r in select ds.student_id from public.discipline_students ds where ds.incident_id = p_incident and ds.role = 'involved' loop
    if amt > 0 then
      perform public.charge_student(sid, r.student_id, 'Discipline Fine', 'Discipline fine · ' || replace(i.category, '_', ' ') || ' · ' || to_char(i.incident_on, 'DD Mon'), amt, public.today_ist(), 'disc:' || p_incident || ':' || r.student_id);
      n := n + 1;
    else
      perform public.uncharge_student(r.student_id, 'disc:' || p_incident || ':' || r.student_id);
    end if;
  end loop;
  return n;
end $$;

-- ───────────── payment status flows back to the module that raised the charge ─────────────
create or replace function public.charge_paid_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source_key is null or new.paid < new.amount - new.concession + new.fine or new.paid is not distinct from old.paid then return new; end if;
  if new.source_key like 'board:%' then
    update public.board_registrations set fee_paid_on = coalesce(fee_paid_on, public.today_ist()) where id = nullif(substr(new.source_key, 7), '')::uuid and fee_paid_on is null;
  elsif new.source_key like 'libfine:%' then
    update public.library_issues set fine_paid_on = coalesce(fine_paid_on, public.today_ist()) where id = nullif(substr(new.source_key, 9), '')::uuid and fine_paid_on is null;
  end if;
  return new;
end $$;
drop trigger if exists charge_paid_sync on public.fee_dues;
create trigger charge_paid_sync after update of paid on public.fee_dues for each row execute function public.charge_paid_sync();

-- a student's charges that came from other modules (profile card)
create or replace function public.student_charges(sid uuid, p_student uuid)
returns table (id uuid, head text, label text, amount numeric, paid numeric, balance numeric, due_date date, source text)
language sql stable security definer set search_path = public as $$
  select d.id, h.name, d.label, d.amount - d.concession + d.fine, d.paid, greatest(d.amount - d.concession + d.fine - d.paid, 0), d.due_date,
         split_part(d.source_key, ':', 1)
    from public.fee_dues d left join public.fee_heads h on h.id = d.fee_head_id
   where d.school_id = sid and d.student_id = p_student and d.source_key is not null and d.source_key not like 'dues:%'
     and (public.can_student(sid, 'fees.collection.view', p_student) or public.can_student(sid, 'students.profile.view', p_student))
   order by d.due_date desc;
$$;

notify pgrst, 'reload schema';
