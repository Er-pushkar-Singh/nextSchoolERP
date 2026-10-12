-- ═══════════════════════════════════════════════════════════════════════════
-- Step 11: Admissions & Fees add-ons.
--   admissions: follow-ups, offer validity + lapse, waitlist promotion, bulk test marks / bulk status,
--               pipeline report, sibling detection, fee quote at admission
--   fees      : sibling discount rule, promise-to-pay follow-ups, copy structure (class → classes, session → session),
--               split an instalment, outstanding by class × head, sibling list on the desk
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Settings ─────────────
create table if not exists public.admission_settings (
  school_id               uuid primary key references public.schools(id) on delete cascade,
  offer_days              int not null default 7 check (offer_days between 1 and 90),   -- how long an approval keeps the seat
  auto_sibling_discount   boolean not null default true,                                 -- apply the fee rule when a sibling is admitted
  updated_at              timestamptz not null default now()
);
drop trigger if exists admission_settings_touch on public.admission_settings;
create trigger admission_settings_touch before update on public.admission_settings for each row execute function public.touch_row();
alter table public.admission_settings enable row level security;
drop policy if exists "read" on public.admission_settings;
create policy "read" on public.admission_settings for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.view'));
drop policy if exists "write" on public.admission_settings;
create policy "write" on public.admission_settings for all to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.admissions.approve')) with check (public.has_perm_school(school_id, 'frontdesk.admissions.approve'));

alter table public.fee_settings add column if not exists sibling_percent numeric(5,2) not null default 0 check (sibling_percent between 0 and 100);
alter table public.fee_settings add column if not exists sibling_head_id uuid references public.fee_heads(id) on delete set null;

alter table public.admission_applications add column if not exists offer_valid_till date;

-- offer validity is stamped when an application is approved
create or replace function public.application_offer() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select offer_days into d from public.admission_settings where school_id = new.school_id;
    new.offer_valid_till := coalesce(new.offer_valid_till, public.today_ist() + coalesce(d, 7));
  elsif new.status <> 'approved' and old.status = 'approved' then
    new.offer_valid_till := null;
  end if;
  return new;
end $$;
drop trigger if exists admission_applications_offer on public.admission_applications;
create trigger admission_applications_offer before update on public.admission_applications for each row execute function public.application_offer();

-- ───────────── Follow-ups (admissions) ─────────────
create table if not exists public.application_followups (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  application_id  uuid references public.admission_applications(id) on delete cascade,
  enquiry_id      uuid references public.enquiries(id) on delete cascade,
  due_on          date not null,
  channel         text not null default 'call' check (channel in ('call','whatsapp','visit','email','sms')),
  note            text,
  outcome         text,
  done            boolean not null default false,
  done_at         timestamptz,
  done_by_name    text,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  check (application_id is not null or enquiry_id is not null)
);
create index if not exists application_followups_idx on public.application_followups (school_id, done, due_on);
alter table public.application_followups enable row level security;
drop policy if exists "read" on public.application_followups;
create policy "read" on public.application_followups for select to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.admissions.view') or public.has_perm_school(school_id, 'frontdesk.enquiries.view'));

create or replace function public.add_followup(sid uuid, p_app uuid, p_enq uuid, p_due date, p_channel text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if not (public.has_perm_school(sid, 'frontdesk.admissions.edit') or public.has_perm_school(sid, 'frontdesk.enquiries.edit')) then raise exception 'not allowed'; end if;
  if p_due is null then raise exception 'Choose the follow-up date.'; end if;
  if p_app is null and p_enq is null then raise exception 'Choose an application or enquiry.'; end if;
  if p_app is not null and not exists (select 1 from public.admission_applications where id = p_app and school_id = sid) then raise exception 'Application not found.'; end if;
  if p_enq is not null and not exists (select 1 from public.enquiries where id = p_enq and school_id = sid) then raise exception 'Enquiry not found.'; end if;
  insert into public.application_followups (school_id, application_id, enquiry_id, due_on, channel, note, created_by_name)
  values (sid, p_app, p_enq, p_due, coalesce(nullif(p_channel, ''), 'call'), nullif(btrim(coalesce(p_note, '')), ''), coalesce(auth.jwt() ->> 'email', ''))
  returning id into fid;
  return fid;
end $$;

create or replace function public.complete_followup(fid uuid, p_outcome text, p_next_due date default null, p_next_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select * into f from public.application_followups where id = fid for update;
  if f.id is null then raise exception 'Follow-up not found.'; end if;
  if not (public.has_perm_school(f.school_id, 'frontdesk.admissions.edit') or public.has_perm_school(f.school_id, 'frontdesk.enquiries.edit')) then raise exception 'not allowed'; end if;
  if f.done then raise exception 'This follow-up is already done.'; end if;
  update public.application_followups set done = true, done_at = now(), outcome = nullif(btrim(coalesce(p_outcome, '')), ''), done_by_name = coalesce(auth.jwt() ->> 'email', '') where id = fid;
  if p_next_due is not null then
    insert into public.application_followups (school_id, application_id, enquiry_id, due_on, channel, note, created_by_name)
    values (f.school_id, f.application_id, f.enquiry_id, p_next_due, f.channel, nullif(btrim(coalesce(p_next_note, '')), ''), coalesce(auth.jwt() ->> 'email', ''));
  end if;
end $$;

-- ───────────── Siblings ─────────────
-- Same parent phone, or same father and mother name, in the same school.
create or replace function public.student_siblings(sid uuid, stu uuid)
returns table (student_id uuid, name text, admission_no text, class_name text, status text, balance numeric)
language sql stable set search_path = public as $$
  select o.id, btrim(concat_ws(' ', o.first_name, o.middle_name, o.last_name)), o.admission_no, c.name, o.status,
         coalesce((select sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) from public.fee_dues d where d.student_id = o.id), 0)
    from public.students s
    join public.students o on o.school_id = s.school_id and o.id <> s.id and o.status = 'active'
    left join public.classes c on c.id = o.class_id
   where s.id = stu and s.school_id = sid
     and ((s.guardian_phone is not null and s.guardian_phone = o.guardian_phone)
       or (s.father_name is not null and s.mother_name is not null and lower(s.father_name) = lower(o.father_name) and lower(s.mother_name) = lower(o.mother_name)))
   order by o.admission_no;
$$;

create or replace function public.application_siblings(app uuid)
returns table (student_id uuid, name text, admission_no text, class_name text)
language sql stable set search_path = public as $$
  select o.id, btrim(concat_ws(' ', o.first_name, o.middle_name, o.last_name)), o.admission_no, c.name
    from public.admission_applications a
    join public.students o on o.school_id = a.school_id and o.status = 'active'
    left join public.classes c on c.id = o.class_id
   where a.id = app
     and ((nullif(a.phone, '') is not null and a.phone = o.guardian_phone)
       or (nullif(a.form ->> 'father_name', '') is not null and nullif(a.form ->> 'mother_name', '') is not null
           and lower(a.form ->> 'father_name') = lower(o.father_name) and lower(a.form ->> 'mother_name') = lower(o.mother_name)))
   order by o.admission_no;
$$;

-- sibling discount: one approved percent concession per student, only when the school has a rule
create or replace function public.sibling_discount_core(sid uuid, stu uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare st record;
begin
  select * into st from public.fee_settings where school_id = sid;
  if st.school_id is null or coalesce(st.sibling_percent, 0) <= 0 then return false; end if;
  if exists (select 1 from public.student_concessions where student_id = stu and category = 'sibling') then return false; end if;
  if not exists (select 1 from public.student_siblings(sid, stu)) then return false; end if;
  insert into public.student_concessions (school_id, student_id, fee_head_id, kind, value, reason, category, status)
  values (sid, stu, st.sibling_head_id, 'percent', st.sibling_percent, 'Sibling discount', 'sibling', 'approved');
  return true;
end $$;
revoke execute on function public.sibling_discount_core(uuid, uuid) from public, anon, authenticated;

create or replace function public.apply_sibling_discount(sid uuid, stu uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare done boolean;
begin
  if not public.has_perm_school(sid, 'fees.concessions.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found.'; end if;
  if not exists (select 1 from public.fee_settings where school_id = sid and sibling_percent > 0) then raise exception 'Set the sibling discount in Fee settings first.'; end if;
  done := public.sibling_discount_core(sid, stu);
  if done then perform public.reapply_concessions(sid, stu); end if;
  return done;
end $$;

-- admission bills the dues; the sibling rule goes first so the concession is on the new dues
create or replace function public.bill_student_dues(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int; sess uuid; auto boolean;
begin
  select id into sess from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then return 0; end if;
  select coalesce(auto_sibling_discount, true) into auto from public.admission_settings where school_id = sid;
  if coalesce(auto, true) then perform public.sibling_discount_core(sid, stu); end if;
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

-- ───────────── Admission workflow helpers ─────────────
create or replace function public.lapse_expired_offers(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; r record;
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  for r in select id from public.admission_applications where school_id = sid and status = 'approved' and offer_valid_till < public.today_ist() loop
    update public.admission_applications set status = 'cancelled', decision_note = 'Offer expired — seat released' where id = r.id;
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

create or replace function public.promote_waitlist(sid uuid, cls uuid, sess uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; free int; r record;
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  select s.seats - s.active_students - s.approved into free from public.admission_seats(sid, sess) s where s.class_id = cls and s.seats is not null;
  if free is null then raise exception 'Set the seats for this class first (Settings → Classes).'; end if;
  for r in select id from public.admission_applications where school_id = sid and class_id = cls and session_id = sess and status = 'waitlisted' order by waitlist_no loop
    exit when free <= 0;
    update public.admission_applications set status = 'approved', decision_note = 'Promoted from the waitlist' where id = r.id;
    free := free - 1; cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

-- rows: [{"id": "...", "marks": 41, "max": 50, "test_on": "2026-10-01"}]
create or replace function public.record_test_marks(sid uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; cnt int := 0;
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.edit') then raise exception 'not allowed'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    update public.admission_applications
       set test_marks = nullif(r ->> 'marks', '')::numeric, test_max = coalesce(nullif(r ->> 'max', '')::numeric, test_max),
           test_on = coalesce(nullif(r ->> 'test_on', '')::date, test_on)
     where id = (r ->> 'id')::uuid and school_id = sid and status not in ('admitted', 'cancelled');
    if found then cnt := cnt + 1; end if;
  end loop;
  return cnt;
end $$;

-- returns {"ok": n, "failed": [{"id":..., "error":...}]}
create or replace function public.bulk_application_status(sid uuid, p_ids uuid[], p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i uuid; ok int := 0; bad jsonb := '[]'::jsonb;
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.edit') then raise exception 'not allowed'; end if;
  if p_status not in ('under_review', 'approved', 'waitlisted', 'rejected', 'cancelled') then raise exception 'That status cannot be set in bulk.'; end if;
  foreach i in array coalesce(p_ids, '{}') loop
    begin
      update public.admission_applications set status = p_status, decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
       where id = i and school_id = sid;
      if found then ok := ok + 1; end if;
    exception when others then
      bad := bad || jsonb_build_object('id', i, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', ok, 'failed', bad);
end $$;

-- Pipeline numbers for the admissions dashboard
create or replace function public.admission_pipeline(sid uuid, sess uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.admission_applications where school_id = sid and session_id = sess group by status) x), '{}'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', coalesce(source, 'Unknown'), 'applications', n, 'admitted', adm) order by n desc)
                  from (select source, count(*) n, count(*) filter (where status = 'admitted') adm from public.admission_applications where school_id = sid and session_id = sess group by source) x), '[]'::jsonb),
    'avg_days_to_decision', (select round(avg(extract(epoch from (decided_at - created_at)) / 86400)::numeric, 1) from public.admission_applications where school_id = sid and session_id = sess and decided_at is not null),
    'oldest_open_days', (select max(public.today_ist() - applied_on) from public.admission_applications where school_id = sid and session_id = sess and status in ('submitted', 'under_review', 'test_scheduled')),
    'docs_pending', (select count(distinct d.application_id) from public.application_documents d join public.admission_applications a on a.id = d.application_id
                      where a.school_id = sid and a.session_id = sess and a.status not in ('admitted', 'cancelled', 'rejected') and d.status in ('pending', 'rejected')),
    'offers_expiring', (select count(*) from public.admission_applications where school_id = sid and session_id = sess and status = 'approved' and offer_valid_till <= public.today_ist() + 2),
    'followups_due', (select count(*) from public.application_followups where school_id = sid and not done and due_on <= public.today_ist()),
    'fee_received', (select coalesce(sum(fee_amount), 0) from public.admission_applications where school_id = sid and session_id = sess and fee_paid_on is not null)
  ) into r;
  return r;
end $$;

-- What the family will be asked to pay: every instalment of the class's plan that falls due within a month, plus one-time heads
create or replace function public.admission_fee_quote(app uuid) returns table (head text, label text, due_date date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null or not public.has_perm_school(a.school_id, 'frontdesk.admissions.view') then return; end if;
  return query
    select h.name, p.label, p.due_date, p.amount
      from public.fee_plans p join public.fee_heads h on h.id = p.fee_head_id
     where p.school_id = a.school_id and p.class_id = a.class_id and p.session_id = a.session_id
       and (p.due_date <= public.today_ist() + 31 or h.name in ('Admission Fee', 'Annual Charges'))
     order by p.due_date, h.name;
end $$;

-- ───────────── Fees: promise to pay ─────────────
create table if not exists public.fee_followups (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  promised_on  date not null,
  amount       numeric(10,2) check (amount is null or amount > 0),
  note         text,
  status       text not null default 'open' check (status in ('open', 'kept', 'broken', 'closed')),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  closed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists fee_followups_idx on public.fee_followups (school_id, status, promised_on);
alter table public.fee_followups enable row level security;
drop policy if exists "read" on public.fee_followups;
create policy "read" on public.fee_followups for select to authenticated using (public.can_student(school_id, 'fees.defaulters.view', student_id));

create or replace function public.add_fee_followup(sid uuid, stu uuid, p_on date, p_amount numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if not (public.has_perm_school(sid, 'fees.defaulters.create') or public.has_perm_school(sid, 'fees.collection.create')) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found.'; end if;
  if p_on is null or p_on < public.today_ist() - 1 then raise exception 'Choose a date from today onwards.'; end if;
  insert into public.fee_followups (school_id, student_id, promised_on, amount, note, created_by_name)
  values (sid, stu, p_on, nullif(p_amount, 0), nullif(btrim(coalesce(p_note, '')), ''), coalesce(auth.jwt() ->> 'email', '')) returning id into fid;
  return fid;
end $$;

create or replace function public.close_fee_followup(fid uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select * into f from public.fee_followups where id = fid;
  if f.id is null then raise exception 'Not found.'; end if;
  if not (public.has_perm_school(f.school_id, 'fees.defaulters.create') or public.has_perm_school(f.school_id, 'fees.collection.create')) then raise exception 'not allowed'; end if;
  if p_status not in ('kept', 'broken', 'closed') then raise exception 'Unknown status.'; end if;
  update public.fee_followups set status = p_status, closed_at = now() where id = fid and status = 'open';
end $$;

-- ───────────── Fees: structure tools ─────────────
create or replace function public.copy_fee_plans(sid uuid, sess uuid, from_class uuid, to_classes uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.has_perm_school(sid, 'fees.structure.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.classes where id = from_class and school_id = sid) then raise exception 'Class not found.'; end if;
  if coalesce(cardinality(to_classes), 0) = 0 then raise exception 'Choose at least one class to copy to.'; end if;
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount)
  select p.school_id, p.session_id, c.id, p.fee_head_id, p.label, p.due_date, p.amount
    from public.fee_plans p cross join public.classes c
   where p.school_id = sid and p.session_id = sess and p.class_id = from_class and c.school_id = sid and c.id = any(to_classes) and c.id <> from_class
     and not exists (select 1 from public.fee_plans x where x.class_id = c.id and x.session_id = sess and x.fee_head_id = p.fee_head_id and x.label = p.label);
  get diagnostics cnt = row_count;
  return cnt;
end $$;

create or replace function public.copy_session_plans(sid uuid, from_sess uuid, to_sess uuid, p_years int default 1, p_increase_percent numeric default 0) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.has_perm_school(sid, 'fees.structure.create') then raise exception 'not allowed'; end if;
  if from_sess = to_sess then raise exception 'Choose two different sessions.'; end if;
  if not exists (select 1 from public.sessions where id = from_sess and school_id = sid) or not exists (select 1 from public.sessions where id = to_sess and school_id = sid) then raise exception 'Session not found.'; end if;
  if coalesce(p_increase_percent, 0) < 0 or coalesce(p_increase_percent, 0) > 100 then raise exception 'The increase must be between 0 and 100 per cent.'; end if;
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount)
  select p.school_id, to_sess, p.class_id, p.fee_head_id, p.label, (p.due_date + make_interval(years => coalesce(p_years, 1)))::date,
         round(p.amount * (1 + coalesce(p_increase_percent, 0) / 100), 2)
    from public.fee_plans p
   where p.school_id = sid and p.session_id = from_sess
     and not exists (select 1 from public.fee_plans x where x.class_id = p.class_id and x.session_id = to_sess and x.fee_head_id = p.fee_head_id and x.label = p.label);
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ───────────── Fees: split one instalment into parts ─────────────
alter table public.fee_adjustments drop constraint if exists fee_adjustments_kind_check;
alter table public.fee_adjustments add constraint fee_adjustments_kind_check
  check (kind in ('reversal','waiver','carried','extension','amount_change','fine_waiver','split'));

create or replace function public.split_due(did uuid, p_parts int, p_first date, p_gap_days int, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare d record; i int; base numeric; cbase numeric; amt numeric; con numeric;
begin
  select * into d from public.fee_dues where id = did for update;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_parts is null or p_parts < 2 or p_parts > 12 then raise exception 'Choose 2 to 12 parts.'; end if;
  if p_first is null or coalesce(p_gap_days, 0) < 1 or p_gap_days > 180 then raise exception 'Choose the first date and the gap between parts (1–180 days).'; end if;
  if d.paid > 0 then raise exception 'Part-paid instalments cannot be split. Collect or reverse the payment first.'; end if;
  base := round(d.amount / p_parts, 2);
  cbase := round(d.concession / p_parts, 2);
  update public.fee_dues set amount = base, concession = least(cbase, base), due_date = p_first, label = d.label || ' · 1/' || p_parts,
         original_due_date = coalesce(original_due_date, d.due_date) where id = did;
  for i in 2..p_parts loop
    amt := case when i = p_parts then d.amount - base * (p_parts - 1) else base end;
    con := case when i = p_parts then d.concession - cbase * (p_parts - 1) else cbase end;
    insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, kind, source_key, original_due_date)
    values (d.school_id, d.session_id, d.student_id, d.fee_head_id, d.label || ' · ' || i || '/' || p_parts, p_first + (i - 1) * p_gap_days, amt, least(con, amt),
            'charge', 'split:' || did || ':' || i, d.due_date);
  end loop;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, old_value, new_value, reason, created_by_name)
  values (d.school_id, did, d.student_id, 'split', 0, d.amount::text, p_parts || ' parts', btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
  return p_parts;
end $$;

-- ───────────── Fees: outstanding by class × head ─────────────
create or replace function public.fee_outstanding(sid uuid, sess uuid)
returns table (class_id uuid, class_name text, head_name text, students bigint, billed numeric, concession numeric, collected numeric, outstanding numeric)
language sql stable set search_path = public as $$
  select c.id, c.name, coalesce(h.name, 'Other charges'), count(distinct d.student_id)::bigint,
         sum(d.amount + d.fine), sum(d.concession), sum(d.paid), sum(greatest(d.amount - d.concession + d.fine - d.paid, 0))
    from public.fee_dues d
    join public.students s on s.id = d.student_id
    left join public.classes c on c.id = s.class_id
    left join public.fee_heads h on h.id = d.fee_head_id
   where d.school_id = sid and d.session_id = sess and s.status = 'active'
   group by c.id, c.name, c.sort, h.name
   order by c.sort nulls last, h.name;
$$;

-- Daily job (service role): a promise whose date has passed becomes "kept" if the student now owes nothing that was due by then,
-- otherwise "broken".
create or replace function public.mark_broken_promises() returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  update public.fee_followups f
     set status = case when exists (select 1 from public.fee_dues d where d.student_id = f.student_id and d.due_date <= f.promised_on and d.status <> 'paid') then 'broken' else 'kept' end,
         closed_at = now()
   where f.status = 'open' and f.promised_on < public.today_ist();
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.mark_broken_promises() from public, anon, authenticated;
grant execute on function public.mark_broken_promises() to service_role;

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['admission_settings', 'application_followups', 'fee_followups'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
