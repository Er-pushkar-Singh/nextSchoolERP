-- ═══════════════════════════════════════════════════════════════════════════
-- Step 3: school registration, subscription plans (monthly / yearly), invoices,
-- trial → grace → read-only. Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- Schools can now wait for approval after self-registration
alter table public.schools drop constraint if exists schools_status_check;
alter table public.schools add constraint schools_status_check check (status in ('pending','active','suspended'));
alter table public.schools add column if not exists principal_phone text;
alter table public.schools add column if not exists source text not null default 'platform';  -- platform | self_signup

-- Key/value settings owned by the platform (more arrive in the settings-centre step)
create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value) values
  ('signup',  '{"enabled": true, "require_approval": true, "trial_plan": "trial"}'),
  ('billing', '{"gst_rate": 18, "invoice_prefix": "CDS", "grace_days": 7, "renew_days_before": 7, "seller_name": "CodersDuniya", "seller_gstin": "", "seller_state": "09"}')
on conflict (key) do nothing;

-- ───────────── Plans ─────────────
create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null check (code ~ '^[a-z0-9_]{2,30}$'),
  name          text not null,
  description   text,
  price_type    text not null default 'per_student' check (price_type in ('per_student','flat')),
  price_monthly numeric(10,2) not null default 0,   -- per student per month, or flat per month
  price_yearly  numeric(10,2) not null default 0,   -- per student per year, or flat per year
  min_students  int not null default 0,             -- bill at least this many students
  student_limit int not null default 2000,
  storage_mb    int not null default 1024,
  trial_days    int not null default 0,             -- > 0 = a trial plan
  modules       text[] not null default '{}',       -- licensed module codes (core modules are always on)
  is_public     boolean not null default true,      -- shown on the school's billing page
  active        boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
insert into public.plans (code, name, description, price_type, price_monthly, price_yearly, min_students, student_limit, storage_mb, trial_days, modules, sort) values
  ('trial', 'Free trial', 'Every module for 30 days, then pick a plan.', 'per_student', 0, 0, 0, 300, 512, 30,
    array['frontdesk','students','academics','homework','attendance','exams','fees','accounts','hr','comms','transport','library','hostel','inventory','wellbeing','reports'], 0),
  ('starter', 'Starter', 'Admissions, students, attendance, exams, fees, notices.', 'per_student', 10, 99, 100, 500, 2048, 0,
    array['frontdesk','students','academics','attendance','exams','fees','comms','reports'], 1),
  ('standard', 'Standard', 'Starter + homework, staff & payroll, transport, library.', 'per_student', 15, 149, 200, 2000, 10240, 0,
    array['frontdesk','students','academics','homework','attendance','exams','fees','hr','comms','transport','library','reports'], 2),
  ('premium', 'Premium', 'Every module, multi-branch ready, priority support.', 'per_student', 20, 199, 300, 10000, 51200, 0,
    array['frontdesk','students','academics','homework','attendance','exams','fees','accounts','hr','comms','transport','library','hostel','inventory','wellbeing','reports'], 3)
on conflict (code) do nothing;

-- ───────────── Subscriptions (one per school) — named school_subscriptions so it never clashes with a CRM "subscriptions" table in the same project ─────────────
create table if not exists public.school_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid unique not null references public.schools(id) on delete cascade,
  plan_id              uuid not null references public.plans(id),
  billing_cycle        text not null default 'yearly' check (billing_cycle in ('monthly','yearly')),
  status               text not null default 'trialing' check (status in ('trialing','active','cancelled')),
  current_period_start date not null,
  current_period_end   date not null,
  grace_days           int not null default 7,
  auto_renew           boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.invoice_counters (fy text primary key, n int not null default 0);

create table if not exists public.subscription_invoices (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  subscription_id  uuid not null references public.school_subscriptions(id) on delete cascade,
  number           text unique not null,
  plan_code        text not null,
  billing_cycle    text not null,
  period_start     date not null,
  period_end       date not null,
  students         int not null default 0,
  rate             numeric(10,2) not null default 0,
  amount           numeric(12,2) not null,
  gst_rate         numeric(5,2) not null default 18,
  gst_amount       numeric(12,2) not null default 0,
  total            numeric(12,2) not null,
  status           text not null default 'due' check (status in ('due','paid','void')),
  due_date         date not null,
  paid_at          timestamptz,
  payment_ref      text,
  razorpay_link_id text,
  razorpay_link_url text,
  created_at       timestamptz not null default now(),
  unique (subscription_id, period_start)
);
create index if not exists subscription_invoices_school_idx on public.subscription_invoices (school_id, created_at desc);

-- ───────────── Helpers ─────────────
create or replace function public.today_ist() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function public.cycle_end(start date, cycle text) returns date
language sql immutable as $$
  select (start + case when cycle = 'yearly' then interval '1 year' else interval '1 month' end - interval '1 day')::date;
$$;

create or replace function public.is_service() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'role', '') = 'service_role'; $$;

-- trial | ok | grace | expired | pending | suspended
create or replace function public.subscription_state(sid uuid, on_day date default null) returns text
language sql stable security definer set search_path = public as $$
  select case
    when s.status = 'suspended' then 'suspended'
    when s.status = 'pending' then 'pending'
    when sub.id is null then 'ok'
    when sub.status = 'cancelled' and coalesce(on_day, public.today_ist()) > sub.current_period_end then 'expired'
    when coalesce(on_day, public.today_ist()) <= sub.current_period_end then case when sub.status = 'trialing' then 'trial' else 'ok' end
    when sub.status <> 'trialing' and coalesce(on_day, public.today_ist()) <= sub.current_period_end + sub.grace_days then 'grace'
    else 'expired' end
  from public.schools s left join public.school_subscriptions sub on sub.school_id = s.id
  where s.id = sid;
$$;

-- Writes are allowed only while the subscription is live (trial / paid / grace).
create or replace function public.school_writable(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.subscription_state(sid) in ('ok','trial','grace'), false);
$$;

create or replace function public.guard_student_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if not public.school_writable(new.school_id) then
    raise exception 'This school is read-only (%). Renew the subscription to add students.', public.subscription_state(new.school_id);
  end if;
  select student_limit into lim from public.schools where id = new.school_id;
  select count(*) into n from public.students where school_id = new.school_id and status = 'active';
  if n >= lim then raise exception 'Student limit (%) reached for your plan. Please upgrade.', lim; end if;
  return new;
end $$;

-- schools.plan check allowed only trial/standard/premium; widen it to any plan code
alter table public.schools drop constraint if exists schools_plan_check;
-- Licence modules + limits from a plan and start / change the subscription.
create or replace function public.apply_plan(sid uuid, p_plan text, p_cycle text default 'yearly', p_start date default null, p_period_end date default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl record; st date := coalesce(p_start, public.today_ist()); en date; is_trial boolean;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  select * into pl from public.plans where code = p_plan;
  if pl.id is null then raise exception 'Unknown plan %', p_plan; end if;
  if p_cycle not in ('monthly','yearly') then raise exception 'Cycle must be monthly or yearly'; end if;
  is_trial := pl.trial_days > 0;
  en := coalesce(p_period_end, case when is_trial then st + pl.trial_days - 1 else public.cycle_end(st, p_cycle) end);
  update public.schools set plan = pl.code, student_limit = pl.student_limit, price_per_student = pl.price_yearly where id = sid;
  insert into public.school_modules (school_id, module_code, licensed, enabled)
    select sid, m.code, (m.core or m.code = any(pl.modules)), true from public.erp_modules m
  on conflict (school_id, module_code) do update set licensed = excluded.licensed;
  insert into public.school_subscriptions (school_id, plan_id, billing_cycle, status, current_period_start, current_period_end, grace_days)
    values (sid, pl.id, p_cycle, case when is_trial then 'trialing' else 'active' end, st, en,
            coalesce((select (value ->> 'grace_days')::int from public.platform_settings where key = 'billing'), 7))
  on conflict (school_id) do update set plan_id = excluded.plan_id, billing_cycle = excluded.billing_cycle, status = excluded.status,
     current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, updated_at = now();
end $$;

-- Invoice for the NEXT period of a school's subscription (or for a plan change starting today).
create or replace function public.create_subscription_invoice(sid uuid, p_start date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sub record; pl record; st date; en date; v_n int; stu int; rate numeric; amt numeric; gst numeric; v_fy text; num text; cfg jsonb; inv uuid;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  select * into sub from public.school_subscriptions where school_id = sid;
  if sub.id is null then raise exception 'School has no subscription'; end if;
  select * into pl from public.plans where id = sub.plan_id;
  if pl.trial_days > 0 then raise exception 'Move the school to a paid plan before invoicing.'; end if;
  -- default: expired → from today; current paid period not yet invoiced → that period; else the next period
  st := coalesce(p_start, case
          when sub.current_period_end < public.today_ist() then public.today_ist()
          when not exists (select 1 from public.subscription_invoices i where i.subscription_id = sub.id and i.status <> 'void'
                             and i.period_start <= sub.current_period_start and i.period_end >= sub.current_period_start) then sub.current_period_start
          else sub.current_period_end + 1 end);
  select id into inv from public.subscription_invoices where subscription_id = sub.id and period_start = st and status <> 'void';
  if inv is not null then return inv; end if;
  en := public.cycle_end(st, sub.billing_cycle);
  select count(*) into v_n from public.students where school_id = sid and status = 'active';
  stu := greatest(v_n, pl.min_students);
  rate := case when sub.billing_cycle = 'yearly' then pl.price_yearly else pl.price_monthly end;
  amt := case when pl.price_type = 'per_student' then round(rate * stu, 2) else rate end;
  select value into cfg from public.platform_settings where key = 'billing';
  gst := round(amt * coalesce((cfg ->> 'gst_rate')::numeric, 18) / 100, 2);
  v_fy := case when extract(month from public.today_ist()) >= 4 then extract(year from public.today_ist())::int else extract(year from public.today_ist())::int - 1 end
        || '-' || lpad(((case when extract(month from public.today_ist()) >= 4 then extract(year from public.today_ist())::int else extract(year from public.today_ist())::int - 1 end + 1) % 100)::text, 2, '0');
  insert into public.invoice_counters as c (fy, n) values (v_fy, 1) on conflict (fy) do update set n = c.n + 1 returning c.n into v_n;
  num := coalesce(cfg ->> 'invoice_prefix', 'CDS') || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
  insert into public.subscription_invoices (school_id, subscription_id, number, plan_code, billing_cycle, period_start, period_end, students, rate, amount, gst_rate, gst_amount, total, due_date)
    values (sid, sub.id, num, pl.code, sub.billing_cycle, st, en, case when pl.price_type = 'per_student' then stu else 0 end, rate, amt,
            coalesce((cfg ->> 'gst_rate')::numeric, 18), gst, amt + gst, greatest(st - 1, public.today_ist() + 3))
  returning id into inv;
  return inv;
end $$;

-- Payment received → the subscription runs until the invoice's period end.
create or replace function public.mark_subscription_invoice_paid(inv_id uuid, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  select * into inv from public.subscription_invoices where id = inv_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.status = 'paid' then return; end if;
  if inv.status = 'void' then raise exception 'Invoice is void'; end if;
  update public.subscription_invoices set status = 'paid', paid_at = now(), payment_ref = coalesce(p_ref, payment_ref) where id = inv_id;
  update public.school_subscriptions s set status = 'active',
         current_period_start = case when s.status = 'trialing' or inv.period_start > s.current_period_end then inv.period_start else s.current_period_start end,
         current_period_end = greatest(s.current_period_end, inv.period_end),
         updated_at = now()
   where s.id = inv.subscription_id;
end $$;

-- Daily job: create renewal invoices that fall due within N days. Returns the new invoice ids.
create or replace function public.billing_run(on_day date default null) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(on_day, public.today_ist()); sub record; days int; inv uuid;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  select coalesce((value ->> 'renew_days_before')::int, 7) into days from public.platform_settings where key = 'billing';
  for sub in select s.* from public.school_subscriptions s join public.plans p on p.id = s.plan_id join public.schools sc on sc.id = s.school_id
             where s.status = 'active' and s.auto_renew and p.trial_days = 0 and sc.status = 'active'
               and s.current_period_end - d <= days
               and not exists (select 1 from public.subscription_invoices i where i.subscription_id = s.id and i.period_start > s.current_period_end and i.status <> 'void') loop
    inv := public.create_subscription_invoice(sub.school_id, sub.current_period_end + 1);
    return next inv;
  end loop;
end $$;

-- ───────────── School creation (shared by platform onboarding and self-registration) ─────────────
create or replace function public._create_school_core(p_name text, p_code text, p_board text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; cid uuid; c text; i int := 0; yr int;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  insert into public.schools (name, code, board, city) values (p_name, p_code, p_board, p_city) returning id into sid;
  yr := case when extract(month from now()) >= 4 then extract(year from now())::int else extract(year from now())::int - 1 end;
  insert into public.sessions (school_id, name, start_date, end_date, is_current)
    values (sid, yr || '-' || lpad(((yr + 1) % 100)::text, 2, '0'), make_date(yr, 4, 1), make_date(yr + 1, 3, 31), true);
  foreach c in array array['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'] loop
    insert into public.classes (school_id, name, sort) values (sid, c, i) returning id into cid;
    insert into public.sections (school_id, class_id, name) values (sid, cid, 'A');
    i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['English','Hindi','Mathematics','Science','Social Science','Computer','Sanskrit','EVS','Drawing'] loop
    insert into public.subjects (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['Tuition Fee','Admission Fee','Annual Charges','Exam Fee','Transport Fee'] loop
    insert into public.fee_heads (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  perform public.seed_school_modules(sid);
  perform public.sync_role_templates(sid);
  return sid;
end $$;

drop function if exists public.create_school(text, text, text, text);
create or replace function public.create_school(p_name text, p_code text, p_board text default 'CBSE', p_city text default 'Lucknow',
                                                p_plan text default 'trial', p_cycle text default 'yearly')
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.is_platform_admin() then raise exception 'not allowed'; end if;
  sid := public._create_school_core(p_name, p_code, p_board, p_city);
  perform public.apply_plan(sid, p_plan, p_cycle);
  return sid;
end $$;

-- Self-registration (called only by the server with the secret key, after it created the login).
create or replace function public.register_school(p_name text, p_board text, p_city text, p_user uuid, p_principal text, p_email text, p_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; cfg jsonb; v_code text; rid uuid;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select value into cfg from public.platform_settings where key = 'signup';
  if not coalesce((cfg ->> 'enabled')::boolean, false) then raise exception 'Registration is closed. Please contact us.'; end if;
  if exists (select 1 from public.school_members where user_id = p_user) then raise exception 'This email already belongs to a school. Sign in instead.'; end if;
  v_code := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 22) || '-' || substr(md5(random()::text), 1, 5);
  if length(v_code) < 9 then v_code := 'school-' || substr(md5(random()::text), 1, 8); end if;
  sid := public._create_school_core(p_name, v_code, p_board, p_city);
  update public.schools set status = case when coalesce((cfg ->> 'require_approval')::boolean, true) then 'pending' else 'active' end,
         principal_name = p_principal, principal_phone = p_phone, phone = p_phone, email = p_email, source = 'self_signup' where id = sid;
  perform public.apply_plan(sid, coalesce(cfg ->> 'trial_plan', 'trial'), 'yearly');
  insert into public.school_members (school_id, user_id, name, email, phone) values (sid, p_user, p_principal, p_email, p_phone);
  select id into rid from public.roles where school_id = sid and roles.code = 'principal';
  insert into public.member_roles (school_id, user_id, role_id) values (sid, p_user, rid);
  return sid;
end $$;

-- Only the server (service role) may call these directly
revoke execute on function public._create_school_core(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.register_school(text, text, text, uuid, text, text, text) from public, anon, authenticated;

-- Approving a pending school (platform) restarts its trial from today.
create or replace function public.approve_school(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl text;
begin
  if not public.is_platform_admin() then raise exception 'not allowed'; end if;
  update public.schools set status = 'active' where id = sid and status = 'pending';
  select p.code into pl from public.school_subscriptions s join public.plans p on p.id = s.plan_id where s.school_id = sid and s.status = 'trialing';
  if pl is not null then perform public.apply_plan(sid, pl, 'yearly'); end if;
end $$;

-- ───────────── RLS ─────────────
alter table public.platform_settings enable row level security;
drop policy if exists "platform" on public.platform_settings;
create policy "platform" on public.platform_settings for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.plans enable row level security;
drop policy if exists "read" on public.plans;
drop policy if exists "platform" on public.plans;
create policy "read" on public.plans for select to authenticated using (active or public.is_platform_admin());
create policy "platform" on public.plans for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.school_subscriptions enable row level security;
drop policy if exists "read" on public.school_subscriptions;
drop policy if exists "platform" on public.school_subscriptions;
create policy "read" on public.school_subscriptions for select to authenticated using (public.is_platform_admin() or public.is_member(school_id));
create policy "platform" on public.school_subscriptions for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.subscription_invoices enable row level security;
drop policy if exists "read" on public.subscription_invoices;
drop policy if exists "platform" on public.subscription_invoices;
create policy "read" on public.subscription_invoices for select to authenticated using (public.is_platform_admin() or public.has_perm(school_id, 'settings.billing.view'));
create policy "platform" on public.subscription_invoices for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.invoice_counters enable row level security;

-- ───────────── Existing schools: new permissions + a 30-day trial if they have no subscription ─────────────
do $$
declare s record;
begin
  for s in select id from public.schools loop
    perform public.sync_role_templates(s.id);
    if not exists (select 1 from public.school_subscriptions where school_id = s.id) then
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      perform public.apply_plan(s.id, 'trial', 'yearly');
      perform set_config('request.jwt.claims', '{}', true);
    end if;
  end loop;
end $$;

-- Seller details for subscription invoices (readable by schools that can see billing)
create or replace function public.billing_seller() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('seller_name', value ->> 'seller_name', 'seller_gstin', value ->> 'seller_gstin',
                            'seller_address', value ->> 'seller_address', 'seller_state', value ->> 'seller_state')
  from public.platform_settings where key = 'billing';
$$;
