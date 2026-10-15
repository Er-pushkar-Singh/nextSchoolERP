-- ═══════════════════════════════════════════════════════════════════════════
-- Step 24: Payroll v2 — unpaid days from staff attendance (holidays excluded), PF / ESI / professional tax,
--          salary advances with monthly recovery, salary revision history, statutory columns for reports.
-- Safe to run again. Replaces payslip_compute() and generate_payroll() from 0007.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Settings ─────────────
create table if not exists public.payroll_settings (
  school_id        uuid primary key references public.schools(id) on delete cascade,
  use_attendance   boolean not null default true,
  pf_on            boolean not null default false,
  pf_rate          numeric(5,2) not null default 12 check (pf_rate between 0 and 30),
  pf_ceiling       numeric(10,2) not null default 15000 check (pf_ceiling >= 0),
  esi_on           boolean not null default false,
  esi_rate         numeric(5,2) not null default 0.75 check (esi_rate between 0 and 10),
  esi_employer_rate numeric(5,2) not null default 3.25 check (esi_employer_rate between 0 and 10),
  esi_ceiling      numeric(10,2) not null default 21000 check (esi_ceiling >= 0),
  pt_on            boolean not null default false,
  pt_slabs         jsonb not null default '[{"upto": 15000, "amount": 0}, {"upto": null, "amount": 200}]'
);
alter table public.payroll_settings enable row level security;
drop policy if exists "read" on public.payroll_settings;
create policy "read" on public.payroll_settings for select to authenticated using (public.has_perm_school(school_id, 'hr.payroll.view'));
drop policy if exists "write" on public.payroll_settings;
create policy "write" on public.payroll_settings for all to authenticated
  using (public.has_perm_school(school_id, 'hr.payroll.edit')) with check (public.has_perm_school(school_id, 'hr.payroll.edit'));

alter table public.staff add column if not exists pf_applicable boolean not null default true;
alter table public.staff add column if not exists esi_applicable boolean not null default true;
alter table public.staff add column if not exists pt_applicable boolean not null default true;

alter table public.payslips add column if not exists att_lop numeric(5,1) not null default 0;
alter table public.payslips add column if not exists advance_recovery numeric(12,2) not null default 0 check (advance_recovery >= 0);
alter table public.payslips add column if not exists pf_employee numeric(12,2) not null default 0;
alter table public.payslips add column if not exists esi_employee numeric(12,2) not null default 0;
alter table public.payslips add column if not exists prof_tax numeric(12,2) not null default 0;
alter table public.payslips add column if not exists employer_pf numeric(12,2) not null default 0;
alter table public.payslips add column if not exists employer_esi numeric(12,2) not null default 0;

-- ───────────── Advances ─────────────
create table if not exists public.staff_advances (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  amount          numeric(12,2) not null check (amount > 0),
  monthly_emi     numeric(12,2) not null check (monthly_emi > 0),
  balance         numeric(12,2) not null check (balance >= 0),
  taken_on        date not null default (now() at time zone 'Asia/Kolkata')::date,
  reason          text,
  status          text not null default 'active' check (status in ('active', 'closed', 'cancelled')),
  created_by_name text,
  created_at      timestamptz not null default now(),
  check (monthly_emi <= amount)
);
create index if not exists staff_advances_idx on public.staff_advances (school_id, staff_id, status);
create table if not exists public.advance_recoveries (
  id         uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.staff_advances(id) on delete cascade,
  payslip_id uuid not null references public.payslips(id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  unique (advance_id, payslip_id)
);

create table if not exists public.staff_salary_history (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  changed_on      date not null default (now() at time zone 'Asia/Kolkata')::date,
  old_gross       numeric(12,2) not null default 0,
  new_gross       numeric(12,2) not null default 0,
  old_earnings    jsonb,
  new_earnings    jsonb,
  changed_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists staff_salary_history_idx on public.staff_salary_history (staff_id, created_at desc);

alter table public.staff_advances enable row level security;
alter table public.advance_recoveries enable row level security;
alter table public.staff_salary_history enable row level security;
drop policy if exists "read" on public.staff_advances;
create policy "read" on public.staff_advances for select to authenticated using (public.has_perm_school(school_id, 'hr.payroll.view'));
drop policy if exists "read" on public.advance_recoveries;
create policy "read" on public.advance_recoveries for select to authenticated
  using (exists (select 1 from public.staff_advances a where a.id = advance_id and public.has_perm_school(a.school_id, 'hr.payroll.view')));
drop policy if exists "read" on public.staff_salary_history;
create policy "read" on public.staff_salary_history for select to authenticated using (public.has_perm_school(school_id, 'hr.payroll.view'));

create or replace function public.add_advance(sid uuid, p_staff uuid, p_amount numeric, p_emi numeric, p_on date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i uuid; me text;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'hr.payroll.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.staff where id = p_staff and school_id = sid and status = 'active') then raise exception 'Choose a working staff member.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the advance amount.'; end if;
  if p_emi is null or p_emi <= 0 or p_emi > p_amount then raise exception 'The monthly recovery must be above zero and not more than the advance.'; end if;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();
  insert into public.staff_advances (school_id, staff_id, amount, monthly_emi, balance, taken_on, reason, created_by_name)
  values (sid, p_staff, round(p_amount, 2), round(p_emi, 2), round(p_amount, 2), coalesce(p_on, public.today_ist()), nullif(left(btrim(coalesce(p_reason, '')), 200), ''), coalesce(me, 'User'))
  returning id into i;
  return i;
end $$;

create or replace function public.cancel_advance(aid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.staff_advances;
begin
  select * into a from public.staff_advances where id = aid;
  if a.id is null or auth.uid() is null or not public.has_perm_school(a.school_id, 'hr.payroll.edit') then raise exception 'not allowed'; end if;
  if a.status <> 'active' then raise exception 'This advance is already %.', a.status; end if;
  if exists (select 1 from public.advance_recoveries where advance_id = aid) then raise exception 'Part of it has already been recovered; it cannot be cancelled.'; end if;
  update public.staff_advances set status = 'cancelled', balance = 0 where id = aid;
end $$;

-- ───────────── Payslip computation (replaces 0007) ─────────────
create or replace function public.payslip_compute() returns trigger
language plpgsql security definer set search_path = public as $$
declare f numeric; st text; cfg public.payroll_settings; stf public.staff; basic numeric := 0; slab jsonb; pf numeric := 0; esi numeric := 0; pt numeric := 0;
        fixed jsonb; lines jsonb := '[]'; wage numeric; e jsonb;
begin
  select status into st from public.payroll_runs where id = new.run_id;
  if tg_op = 'UPDATE' and st = 'approved' then
    if new.lop_days is distinct from old.lop_days or new.base_earnings is distinct from old.base_earnings or new.deductions is distinct from old.deductions
       or new.adjustment is distinct from old.adjustment or new.working_days is distinct from old.working_days or new.advance_recovery is distinct from old.advance_recovery then
      raise exception 'Payroll for this month is approved and locked. Reopen it to make changes.';
    end if;
    -- an approved slip keeps its figures even if settings changed afterwards
    new.earnings := old.earnings; new.gross := old.gross; new.total_deductions := old.total_deductions;
    new.pf_employee := old.pf_employee; new.esi_employee := old.esi_employee; new.prof_tax := old.prof_tax; new.employer_pf := old.employer_pf; new.employer_esi := old.employer_esi;
    return new;
  end if;
  if tg_op = 'UPDATE' and st = 'draft' and new.paid_on is not null and old.paid_on is null then
    raise exception 'Approve the payroll before marking salaries paid.';
  end if;
  f := greatest(new.working_days - new.lop_days, 0) / new.working_days;
  select coalesce(jsonb_agg(jsonb_build_object('name', x ->> 'name', 'amount', round(coalesce((x ->> 'amount')::numeric, 0) * f))), '[]'::jsonb)
    into new.earnings from jsonb_array_elements(new.base_earnings) x;
  select coalesce(sum((x ->> 'amount')::numeric), 0) into new.gross from jsonb_array_elements(new.earnings) x;

  -- fixed deductions typed by HR stay; automatic lines are rebuilt every time
  select coalesce(jsonb_agg(x), '[]'::jsonb) into fixed from jsonb_array_elements(new.deductions) x where coalesce((x ->> 'auto')::boolean, false) = false;
  select * into cfg from public.payroll_settings where school_id = new.school_id;
  select * into stf from public.staff where id = new.staff_id;
  new.pf_employee := 0; new.esi_employee := 0; new.prof_tax := 0; new.employer_pf := 0; new.employer_esi := 0;
  if cfg.school_id is not null then
    select coalesce(sum((x ->> 'amount')::numeric), 0) into basic from jsonb_array_elements(new.earnings) x where lower(x ->> 'name') like 'basic%';
    if basic = 0 then basic := new.gross; end if;
    if cfg.pf_on and coalesce(stf.pf_applicable, true) then
      wage := least(basic, cfg.pf_ceiling);
      new.pf_employee := round(wage * cfg.pf_rate / 100);
      new.employer_pf := round(wage * cfg.pf_rate / 100);
    end if;
    if cfg.esi_on and coalesce(stf.esi_applicable, true) and new.gross > 0 and new.gross <= cfg.esi_ceiling then
      new.esi_employee := ceil(new.gross * cfg.esi_rate / 100);
      new.employer_esi := ceil(new.gross * cfg.esi_employer_rate / 100);
    end if;
    if cfg.pt_on and coalesce(stf.pt_applicable, true) and new.gross > 0 then
      for slab in select * from jsonb_array_elements(cfg.pt_slabs) loop
        if (slab ->> 'upto') is null or new.gross <= (slab ->> 'upto')::numeric then pt := coalesce((slab ->> 'amount')::numeric, 0); exit; end if;
      end loop;
      new.prof_tax := pt;
    end if;
  end if;
  -- an advance is never recovered beyond what is left of the month's pay
  select coalesce(sum(coalesce((x ->> 'amount')::numeric, 0)), 0) into wage from jsonb_array_elements(fixed) x;
  new.advance_recovery := least(coalesce(new.advance_recovery, 0), greatest(new.gross - wage - new.pf_employee - new.esi_employee - new.prof_tax, 0));
  if new.pf_employee > 0 then lines := lines || jsonb_build_array(jsonb_build_object('name', 'PF (employee)', 'amount', new.pf_employee, 'auto', true)); end if;
  if new.esi_employee > 0 then lines := lines || jsonb_build_array(jsonb_build_object('name', 'ESI (employee)', 'amount', new.esi_employee, 'auto', true)); end if;
  if new.prof_tax > 0 then lines := lines || jsonb_build_array(jsonb_build_object('name', 'Professional tax', 'amount', new.prof_tax, 'auto', true)); end if;
  if coalesce(new.advance_recovery, 0) > 0 then lines := lines || jsonb_build_array(jsonb_build_object('name', 'Advance recovery', 'amount', new.advance_recovery, 'auto', true)); end if;
  new.deductions := fixed || lines;
  select coalesce(sum(coalesce((x ->> 'amount')::numeric, 0)), 0) into new.total_deductions from jsonb_array_elements(new.deductions) x;
  return new;
end $$;

-- ───────────── Advances follow the payroll status ─────────────
create or replace function public.payroll_run_advances() returns trigger
language plpgsql security definer set search_path = public as $$
declare ps record; adv record; rest numeric; take numeric;
begin
  if new.status = 'approved' and old.status = 'draft' then
    for ps in select id, staff_id, advance_recovery from public.payslips where run_id = new.id and advance_recovery > 0 loop
      rest := ps.advance_recovery;
      for adv in select * from public.staff_advances where staff_id = ps.staff_id and status = 'active' and balance > 0 order by taken_on, created_at loop
        exit when rest <= 0;
        take := least(adv.balance, rest);
        insert into public.advance_recoveries (advance_id, payslip_id, amount) values (adv.id, ps.id, take) on conflict do nothing;
        update public.staff_advances set balance = balance - take, status = case when balance - take <= 0 then 'closed' else status end where id = adv.id;
        rest := rest - take;
      end loop;
    end loop;
  elsif new.status = 'draft' and old.status = 'approved' then
    update public.staff_advances a set balance = a.balance + r.amt, status = 'active'
      from (select rc.advance_id, sum(rc.amount) amt from public.advance_recoveries rc join public.payslips p on p.id = rc.payslip_id where p.run_id = new.id group by rc.advance_id) r
     where a.id = r.advance_id;
    delete from public.advance_recoveries rc using public.payslips p where rc.payslip_id = p.id and p.run_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists payroll_runs_advances on public.payroll_runs;
create trigger payroll_runs_advances after update on public.payroll_runs for each row execute function public.payroll_run_advances();

-- ───────────── Salary history ─────────────
create or replace function public.staff_salary_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare og numeric; ng numeric; me text;
begin
  if new.earnings is not distinct from old.earnings then return new; end if;
  select coalesce(sum((x ->> 'amount')::numeric), 0) into og from jsonb_array_elements(coalesce(old.earnings, '[]')) x;
  select coalesce(sum((x ->> 'amount')::numeric), 0) into ng from jsonb_array_elements(coalesce(new.earnings, '[]')) x;
  select name into me from public.school_members where school_id = new.school_id and user_id = auth.uid();
  insert into public.staff_salary_history (school_id, staff_id, old_gross, new_gross, old_earnings, new_earnings, changed_by_name)
  values (new.school_id, new.id, og, ng, old.earnings, new.earnings, me);
  return new;
end $$;
drop trigger if exists staff_salary_log on public.staff;
create trigger staff_salary_log after update of earnings on public.staff for each row execute function public.staff_salary_log();

-- ───────────── Attendance → unpaid days ─────────────
-- explicit absences (A = 1, H = 0.5) in the month that are not already approved leave without pay
create or replace function public.attendance_lop(stf uuid, d1 date, d2 date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case a.status when 'A' then 1 when 'H' then 0.5 else 0 end), 0)
    from public.staff_attendance a
   where a.staff_id = stf and a.date between d1 and d2 and a.status in ('A', 'H')
     and not exists (select 1 from public.staff_leaves l where l.staff_id = stf and l.status = 'approved' and l.kind = 'LWP' and a.date between l.from_date and l.to_date);
$$;

-- working days of a month: school working weekdays minus holidays and vacations
create or replace function public.month_working_days(sid uuid, p_month date) returns int
language plpgsql stable security definer set search_path = public as $$
declare m1 date := date_trunc('month', p_month)::date; m2 date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date; days int[]; n int;
begin
  select coalesce(array(select jsonb_array_elements_text(prefs -> 'working_days')::int), array[1,2,3,4,5,6]) into days from public.schools where id = sid;
  if days is null or cardinality(days) = 0 then days := array[1,2,3,4,5,6]; end if;
  select count(*) into n from generate_series(m1, m2, interval '1 day') g
   where extract(isodow from g)::int = any(days)
     and not exists (select 1 from public.school_events e where e.school_id = sid and e.kind in ('holiday', 'vacation') and g::date between e.start_date and e.end_date);
  return greatest(n, 1);
end $$;

-- ───────────── Generation (replaces 0007) ─────────────
create or replace function public.generate_payroll(sid uuid, p_month date, p_days int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m1 date := date_trunc('month', p_month)::date; m2 date; d int; rid uuid; st text; cfg public.payroll_settings;
begin
  if not public.has_perm_school(sid, 'hr.payroll.create') then raise exception 'not allowed'; end if;
  m2 := (m1 + interval '1 month - 1 day')::date;
  select * into cfg from public.payroll_settings where school_id = sid;
  d := coalesce(p_days, case when coalesce(cfg.use_attendance, false) then public.month_working_days(sid, m1) else extract(day from m2)::int end);
  if d < 1 or d > 31 then raise exception 'Working days must be between 1 and 31.'; end if;
  insert into public.payroll_runs (school_id, month) values (sid, m1) on conflict (school_id, month) do nothing;
  select id, status into rid, st from public.payroll_runs where school_id = sid and month = m1;
  if st <> 'draft' then raise exception 'Payroll for this month is already approved.'; end if;
  delete from public.payslips where run_id = rid and paid_on is null;
  insert into public.payslips (school_id, run_id, staff_id, working_days, lop_days, att_lop, advance_recovery, base_earnings, deductions)
  select sid, rid, s.id, d,
         least(d, public.lwp_days(s.id, m1, m2)
                  + case when coalesce(cfg.use_attendance, false) then public.attendance_lop(s.id, m1, m2) else 0 end
                  + case when s.joining_date > m1 then least(d, s.joining_date - m1) else 0 end
                  + case when s.leaving_date < m2 then least(d, m2 - s.leaving_date) else 0 end),
         case when coalesce(cfg.use_attendance, false) then public.attendance_lop(s.id, m1, m2) else 0 end,
         coalesce((select least(sum(a.monthly_emi), sum(a.balance)) from public.staff_advances a where a.staff_id = s.id and a.status = 'active' and a.balance > 0 and a.taken_on <= m2), 0),
         s.earnings, s.deductions
    from public.staff s
   where s.school_id = sid and jsonb_array_length(s.earnings) > 0
     and (s.joining_date is null or s.joining_date <= m2)
     and (s.status = 'active' or s.leaving_date >= m1)
  on conflict (run_id, staff_id) do nothing;
  return rid;
end $$;

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['payroll_settings', 'staff_advances'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
