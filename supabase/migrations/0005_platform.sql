-- ═══════════════════════════════════════════════════════════════════════════
-- Super Admin platform + multi-tenancy:
--   platform team roles, support sessions (reason + expiry, enforced here),
--   audit log, tenant branding / subdomain / custom domain, school groups with
--   owners, announcements, support tickets, dashboard & usage stats, archive.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Platform team roles ─────────────
alter table public.platform_admins add column if not exists role text not null default 'owner';
alter table public.platform_admins drop constraint if exists platform_admins_role_check;
alter table public.platform_admins add constraint platform_admins_role_check check (role in ('owner','admin','support','billing','sales','viewer'));
alter table public.platform_admins add column if not exists name text;
alter table public.platform_admins add column if not exists email text;
alter table public.platform_admins add column if not exists active boolean not null default true;

create or replace function public.platform_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.platform_admins where user_id = auth.uid() and active;
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid() and active);
$$;

-- What each platform role may do. Areas: tenants, billing, plans, support, team, settings, audit, announcements, impersonate
create or replace function public.platform_can(area text, w boolean default false) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.platform_role();
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if r = 'admin' then return area <> 'team' or not w; end if;
  if r = 'viewer' then return not w and area <> 'impersonate'; end if;
  if r = 'support' then
    return area in ('support','impersonate') or (not w and area in ('tenants','plans','audit','announcements','settings'));
  elsif r = 'billing' then
    return area = 'billing' or (not w and area in ('tenants','plans','audit','support','settings'));
  elsif r = 'sales' then
    return area = 'tenants' or (not w and area in ('plans','support','billing','settings'));
  end if;
  return false;
end $$;

-- Server-side calls (secret key) count as the platform for these checks
create or replace function public.platform_or_service(area text, w boolean default true) returns boolean
language sql stable as $$ select public.is_service() or public.platform_can(area, w); $$;

-- ───────────── Support sessions: platform staff may change a school's data only inside one ─────────────
create table if not exists public.support_sessions (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  reason     text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at   timestamptz
);
create index if not exists support_sessions_user_idx on public.support_sessions (user_id, school_id, expires_at desc);

create or replace function public.active_support_session(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.support_sessions
   where school_id = sid and user_id = auth.uid() and ended_at is null and expires_at > now()
   order by started_at desc limit 1;
$$;

-- ───────────── Groups (trusts with several branches) ─────────────
alter table public.school_groups add column if not exists city text;
alter table public.school_groups add column if not exists contact_name text;
alter table public.school_groups add column if not exists contact_phone text;
alter table public.school_groups add column if not exists contact_email text;
create table if not exists public.group_members (
  group_id uuid not null references public.school_groups(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  name     text,
  email    text,
  role     text not null default 'owner' check (role in ('owner','viewer')),
  primary key (group_id, user_id)
);

create or replace function public.in_school_group(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.schools s join public.group_members g on g.group_id = s.group_id
                 where s.id = sid and g.user_id = auth.uid());
$$;

-- ───────────── Tenant profile: branding, subdomain, custom domain, archive ─────────────
alter table public.schools add column if not exists logo_url text;
alter table public.schools add column if not exists brand_color text;
alter table public.schools add column if not exists subdomain text;
alter table public.schools add column if not exists custom_domain text;
alter table public.schools add column if not exists notes text;
alter table public.schools add column if not exists archived_at timestamptz;
update public.schools set subdomain = code where subdomain is null;
create unique index if not exists schools_subdomain_uniq on public.schools (lower(subdomain));
create unique index if not exists schools_custom_domain_uniq on public.schools (lower(custom_domain)) where custom_domain is not null;
alter table public.schools drop constraint if exists schools_subdomain_check;
alter table public.schools add constraint schools_subdomain_check check (subdomain is null or subdomain ~ '^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])?$');
alter table public.schools drop constraint if exists schools_brand_color_check;
alter table public.schools add constraint schools_brand_color_check check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');

create or replace function public.default_subdomain() returns trigger
language plpgsql as $$ begin if new.subdomain is null then new.subdomain := new.code; end if; return new; end $$;
drop trigger if exists schools_default_subdomain on public.schools;
create trigger schools_default_subdomain before insert on public.schools for each row execute function public.default_subdomain();

insert into public.platform_settings (key, value) values
  ('tenancy', '{"root_domain": "", "app_host": ""}'),
  ('branding', '{"product_name": "CodersDuniya School ERP", "support_whatsapp": "", "support_email": "", "support_phone": ""}')
on conflict (key) do nothing;

-- Which school does this host name belong to? (used before login, so callable by anyone; returns public branding only)
create or replace function public.tenant_by_host(h text) returns table (id uuid, name text, code text, logo_url text, brand_color text, status text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.code, s.logo_url, s.brand_color, s.status
  from public.schools s, (select coalesce(value ->> 'root_domain', '') as root from public.platform_settings where key = 'tenancy') t
  where s.archived_at is null
    and (lower(s.custom_domain) = lower(split_part(h, ':', 1))
         or (t.root <> '' and lower(split_part(h, ':', 1)) = lower(s.subdomain || '.' || t.root)))
  limit 1;
$$;
grant execute on function public.tenant_by_host(text) to anon, authenticated;

-- ───────────── Membership & permissions now know about groups and support sessions ─────────────
create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.school_members where school_id = sid and user_id = auth.uid())
      or exists (select 1 from public.member_roles where school_id = sid and user_id = auth.uid())
      or public.in_school_group(sid);
$$;

create or replace function public.perm_scope(sid uuid, pkey text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text; is_view boolean := split_part(pkey, '.', 3) = 'view';
begin
  if sid is null or auth.uid() is null then return null; end if;
  -- Platform team: may read every school; may change a school only inside an active support session
  if public.is_platform_admin() then
    if is_view then return 'school'; end if;
    if public.platform_can('impersonate', true) and public.active_support_session(sid) is not null and public.school_writable(sid) then return 'school'; end if;
    return null;
  end if;
  if not public.module_on(sid, split_part(pkey, '.', 1)) then return null; end if;
  if not is_view and not public.school_writable(sid) then return null; end if;
  if exists (select 1 from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = pkey and o.effect = 'deny') then return null; end if;
  select x.scope into s from (
    select rp.scope from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid() and rp.perm_key = pkey
    union all
    select o.scope from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = pkey and o.effect = 'grant'
  ) x order by array_position(array['school','assigned','own','child','self'], x.scope) limit 1;
  -- Group owners / viewers read every branch of their group
  if s is null and is_view and public.in_school_group(sid) then return 'school'; end if;
  return s;
end $$;

create or replace function public.my_permissions(sid uuid) returns table (perm_key text, scope text)
language plpgsql stable security definer set search_path = public as $$
declare w boolean := public.school_writable(sid);
begin
  if auth.uid() is null or sid is null then return; end if;
  if public.is_platform_admin() then
    return query select p.key, 'school'::text from public.erp_permissions p
      where p.action = 'view' or (public.platform_can('impersonate', true) and public.active_support_session(sid) is not null and w);
    return;
  end if;
  return query
  with g as (
    select rp.perm_key k, rp.scope sc from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid()
    union all
    select o.perm_key, o.scope from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.effect = 'grant'
    union all
    select p.key, 'school' from public.erp_permissions p where p.action = 'view' and public.in_school_group(sid)
  ), best as (
    select distinct on (k) k, sc from g order by k, array_position(array['school','assigned','own','child','self'], sc)
  )
  select b.k, b.sc from best b join public.erp_permissions p on p.key = b.k
   where public.module_on(sid, p.module_code) and (p.action = 'view' or w)
     and not exists (select 1 from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = b.k and o.effect = 'deny');
end $$;

-- Platform RPCs now follow the platform role
create or replace function public.apply_plan(sid uuid, p_plan text, p_cycle text default 'yearly', p_start date default null, p_period_end date default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl record; st date := coalesce(p_start, public.today_ist()); en date; is_trial boolean;
begin
  if not (public.is_service() or public.platform_can('billing', true) or public.platform_can('tenants', true)) then raise exception 'not allowed'; end if;
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
  perform public.log_event('plan.applied', sid, 'school_subscriptions', sid::text, jsonb_build_object('plan', p_plan, 'cycle', p_cycle, 'start', st, 'end', en));
end $$;

-- ───────────── Audit log ─────────────
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_email text,
  actor_kind  text not null default 'user' check (actor_kind in ('user','platform','service','system')),
  support_session uuid,
  school_id   uuid,                        -- no FK: the log outlives deleted rows
  action      text not null,               -- e.g. insert / update / delete / plan.applied / support.start
  entity      text,                        -- table or area
  entity_id   text,
  details     jsonb not null default '{}'
);
create index if not exists audit_log_school_idx on public.audit_log (school_id, at desc);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create or replace function public.actor_kind() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_service() then 'service' when auth.uid() is null then 'system' when public.is_platform_admin() then 'platform' else 'user' end;
$$;

create or replace function public.log_event(p_action text, p_school uuid, p_entity text, p_entity_id text, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor, actor_email, actor_kind, support_session, school_id, action, entity, entity_id, details)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), public.actor_kind(),
          case when p_school is not null and auth.uid() is not null then public.active_support_session(p_school) end,
          p_school, p_action, p_entity, p_entity_id, coalesce(p_details, '{}'));
end $$;

-- Row-level audit: inserts, deletes and changed columns of updates
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        diff jsonb := '{}'; k text; sid uuid;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','marked_at') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  end if;
  sid := coalesce((coalesce(n, o) ->> 'school_id')::uuid, case when tg_table_name = 'schools' then (coalesce(n, o) ->> 'id')::uuid end);
  perform public.log_event(lower(tg_op), sid, tg_table_name, coalesce(n, o) ->> 'id',
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', diff)
         when tg_op = 'DELETE' then jsonb_build_object('row', o - 'portal_token')
         else jsonb_build_object('row', n - 'portal_token') end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['schools','school_subscriptions','subscription_invoices','school_modules','roles','member_roles','member_overrides',
                           'school_members','students','fee_receipts','fee_plans','fee_heads','student_concessions','exams','sessions',
                           'staff_assignments','plans','platform_settings','platform_admins','school_groups','group_members'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
-- role_permissions has no id/school_id of its own: audit through its role
create or replace function public.audit_role_permission() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select id, school_id, name into r from public.roles where id = coalesce(new.role_id, old.role_id);
  if r.id is not null then
    perform public.log_event(case when tg_op = 'DELETE' then 'permission.removed' else 'permission.granted' end, r.school_id, 'roles', r.id::text,
      jsonb_build_object('role', r.name, 'permission', coalesce(new.perm_key, old.perm_key), 'scope', coalesce(new.scope, old.scope)));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists audit_role_permissions on public.role_permissions;
create trigger audit_role_permissions after insert or delete on public.role_permissions for each row execute function public.audit_role_permission();

-- ───────────── Support sessions: start / end (logged) ─────────────
create or replace function public.start_support_session(sid uuid, p_reason text, p_minutes int default 120) returns uuid
language plpgsql security definer set search_path = public as $$
declare sess uuid;
begin
  if not public.platform_can('impersonate', true) then raise exception 'Your platform role cannot open schools for changes.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Write a short reason (at least 5 characters).'; end if;
  update public.support_sessions set ended_at = now() where user_id = auth.uid() and school_id = sid and ended_at is null;
  insert into public.support_sessions (school_id, user_id, reason, expires_at)
    values (sid, auth.uid(), trim(p_reason), now() + make_interval(mins => least(greatest(coalesce(p_minutes, 120), 10), 240)))
  returning id into sess;
  perform public.log_event('support.start', sid, 'support_sessions', sess::text, jsonb_build_object('reason', trim(p_reason), 'minutes', p_minutes));
  return sess;
end $$;

create or replace function public.end_support_session(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.support_sessions set ended_at = now() where user_id = auth.uid() and school_id = sid and ended_at is null;
  perform public.log_event('support.end', sid, 'support_sessions', null, '{}');
end $$;

-- ───────────── Announcements (platform → schools) ─────────────
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text,
  level      text not null default 'info' check (level in ('info','warning','critical')),
  audience   text not null default 'all' check (audience in ('all','plan','schools')),
  plan_codes text[] not null default '{}',
  school_ids uuid[] not null default '{}',
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create or replace function public.my_announcements(sid uuid) returns setof public.announcements
language sql stable security definer set search_path = public as $$
  select a.* from public.announcements a, public.schools s
   where s.id = sid and public.is_member(sid) and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
     and (a.audience = 'all' or (a.audience = 'plan' and s.plan = any(a.plan_codes)) or (a.audience = 'schools' and sid = any(a.school_ids)))
   order by case a.level when 'critical' then 0 when 'warning' then 1 else 2 end, a.starts_at desc
   limit 5;
$$;

-- ───────────── Support tickets (school ↔ platform) ─────────────
create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  number      bigint generated always as identity,
  school_id   uuid not null references public.schools(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  created_by_name text,
  subject     text not null,
  category    text not null default 'question' check (category in ('question','bug','billing','feature','data','other')),
  priority    text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status      text not null default 'open' check (status in ('open','pending','resolved','closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tickets_school_idx on public.tickets (school_id, created_at desc);
create table if not exists public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  author      uuid references auth.users(id) on delete set null,
  author_name text,
  from_platform boolean not null default false,
  internal    boolean not null default false,       -- platform-only note
  body        text not null,
  created_at  timestamptz not null default now()
);
create or replace function public.touch_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tickets set updated_at = now(),
         status = case when new.from_platform and not new.internal and status = 'open' then 'pending'
                       when not new.from_platform and status in ('pending','resolved') then 'open' else status end
   where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists ticket_messages_touch on public.ticket_messages;
create trigger ticket_messages_touch after insert on public.ticket_messages for each row execute function public.touch_ticket();

-- ───────────── Stats for the platform dashboard and tenant pages ─────────────
create or replace function public.platform_tenant_stats() returns table (
  school_id uuid, students bigint, staff bigint, parents bigint, collected_month numeric, receipts_month bigint, last_activity timestamptz, open_tickets bigint)
language sql stable security definer set search_path = public as $$
  select s.id,
    (select count(*) from public.students x where x.school_id = s.id and x.status = 'active'),
    (select count(distinct mr.user_id) from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.school_id = s.id and r.kind = 'staff'),
    (select count(*) from public.guardians g where g.school_id = s.id and g.user_id is not null),
    (select coalesce(sum(amount), 0) from public.fee_receipts f where f.school_id = s.id and not f.cancelled and f.paid_on >= date_trunc('month', public.today_ist())::date),
    (select count(*) from public.fee_receipts f where f.school_id = s.id and not f.cancelled and f.paid_on >= date_trunc('month', public.today_ist())::date),
    greatest((select max(at) from public.audit_log a where a.school_id = s.id and a.actor_kind = 'user'),
             (select max(marked_at) from public.attendance a where a.school_id = s.id),
             (select max(created_at) from public.fee_receipts f where f.school_id = s.id)),
    (select count(*) from public.tickets t where t.school_id = s.id and t.status in ('open','pending'))
  from public.schools s
  where public.platform_can('tenants', false);
$$;

create or replace function public.platform_dashboard() returns json
language plpgsql stable security definer set search_path = public as $$
declare res json;
begin
  if not public.platform_can('tenants', false) then raise exception 'not allowed'; end if;
  select json_build_object(
    'schools', (select count(*) from public.schools where archived_at is null),
    'states', (select coalesce(json_object_agg(st, n), '{}') from (select public.subscription_state(id) st, count(*) n from public.schools where archived_at is null group by 1) x),
    'students', (select count(*) from public.students where status = 'active'),
    'trials_ending', (select count(*) from public.school_subscriptions s where s.status = 'trialing' and s.current_period_end between public.today_ist() and public.today_ist() + 7),
    'renewals_due', (select count(*) from public.school_subscriptions s where s.status = 'active' and s.current_period_end between public.today_ist() and public.today_ist() + 30),
    'overdue_amount', (select coalesce(sum(total), 0) from public.subscription_invoices where status = 'due' and due_date < public.today_ist()),
    'due_amount', (select coalesce(sum(total), 0) from public.subscription_invoices where status = 'due'),
    'open_tickets', (select count(*) from public.tickets where status in ('open','pending')),
    'urgent_tickets', (select count(*) from public.tickets where status in ('open','pending') and priority in ('high','urgent')),
    'pending_approval', (select count(*) from public.schools where status = 'pending' and archived_at is null),
    'signups', (select coalesce(json_agg(json_build_object('week', w, 'n', n) order by w), '[]') from (
        select to_char(date_trunc('week', g), 'YYYY-MM-DD') w, (select count(*) from public.schools s where date_trunc('week', s.created_at) = date_trunc('week', g)) n
        from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') g) x),
    'revenue', (select coalesce(json_agg(json_build_object('month', m, 'amount', a) order by m), '[]') from (
        select to_char(g, 'YYYY-MM') m, (select coalesce(sum(amount), 0) from public.subscription_invoices i where i.status = 'paid' and date_trunc('month', i.paid_at) = g) a
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') g) x)
  ) into res;
  return res;
end $$;

-- Group dashboard for trust owners
create or replace function public.group_overview() returns table (group_id uuid, group_name text, school_id uuid, school_name text, students bigint, collected_month numeric, overdue numeric, attendance_today numeric)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, s.id, s.name,
    (select count(*) from public.students x where x.school_id = s.id and x.status = 'active'),
    (select coalesce(sum(amount), 0) from public.fee_receipts f where f.school_id = s.id and not f.cancelled and f.paid_on >= date_trunc('month', public.today_ist())::date),
    (select coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), 0) from public.fee_dues d where d.school_id = s.id and d.due_date <= public.today_ist()),
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where status in ('P','L','H')) / count(*), 1) end from public.attendance a where a.school_id = s.id and a.date = public.today_ist())
  from public.school_groups g join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  join public.schools s on s.group_id = g.id and s.archived_at is null
  order by g.name, s.name;
$$;

-- Archive / restore a school (soft delete; data kept, logins stop working)
create or replace function public.archive_school(sid uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_can('tenants', true) then raise exception 'not allowed'; end if;
  update public.schools set archived_at = now(), status = 'suspended', notes = concat_ws(E'\n', notes, 'Archived: ' || coalesce(p_reason, '')) where id = sid;
end $$;
create or replace function public.restore_school(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_can('tenants', true) then raise exception 'not allowed'; end if;
  update public.schools set archived_at = null, status = 'active' where id = sid;
end $$;

-- ───────────── RLS ─────────────
alter table public.support_sessions enable row level security;
drop policy if exists "read" on public.support_sessions;
create policy "read" on public.support_sessions for select to authenticated using (user_id = auth.uid() or public.platform_can('audit') or public.has_perm(school_id, 'settings.audit.view'));

alter table public.group_members enable row level security;
drop policy if exists "read" on public.group_members;
drop policy if exists "platform" on public.group_members;
create policy "read" on public.group_members for select to authenticated using (user_id = auth.uid() or public.platform_can('tenants'));
create policy "platform" on public.group_members for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));

drop policy if exists "read" on public.school_groups;
drop policy if exists "platform" on public.school_groups;
create policy "read" on public.school_groups for select to authenticated using (public.platform_can('tenants') or exists (select 1 from public.group_members m where m.group_id = id and m.user_id = auth.uid()) or exists (select 1 from public.schools s where s.group_id = id and public.is_member(s.id)));
create policy "platform" on public.school_groups for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));

drop policy if exists "self" on public.platform_admins;
drop policy if exists "read" on public.platform_admins;
drop policy if exists "team" on public.platform_admins;
create policy "read" on public.platform_admins for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());
create policy "team" on public.platform_admins for all to authenticated using (public.platform_can('team', true)) with check (public.platform_can('team', true));

alter table public.audit_log enable row level security;
drop policy if exists "read" on public.audit_log;
create policy "read" on public.audit_log for select to authenticated using (public.platform_can('audit') or (school_id is not null and public.has_perm_school(school_id, 'settings.audit.view')));

alter table public.announcements enable row level security;
drop policy if exists "read" on public.announcements;
drop policy if exists "platform" on public.announcements;
create policy "read" on public.announcements for select to authenticated using (public.platform_can('announcements'));
create policy "platform" on public.announcements for all to authenticated using (public.platform_can('announcements', true)) with check (public.platform_can('announcements', true));

alter table public.tickets enable row level security;
drop policy if exists "read" on public.tickets;
drop policy if exists "create" on public.tickets;
drop policy if exists "platform" on public.tickets;
create policy "read" on public.tickets for select to authenticated using (
  public.platform_can('support') or created_by = auth.uid() or public.perm_scope(school_id, 'support.tickets.view') = 'school');
create policy "create" on public.tickets for insert to authenticated with check (public.has_perm(school_id, 'support.tickets.create') and created_by = auth.uid());
create policy "platform" on public.tickets for update to authenticated using (public.platform_can('support', true)) with check (public.platform_can('support', true));

alter table public.ticket_messages enable row level security;
drop policy if exists "read" on public.ticket_messages;
drop policy if exists "create" on public.ticket_messages;
create policy "read" on public.ticket_messages for select to authenticated using (
  exists (select 1 from public.tickets t where t.id = ticket_id) and (not internal or public.platform_can('support')));
create policy "create" on public.ticket_messages for insert to authenticated with check (
  author = auth.uid() and exists (select 1 from public.tickets t where t.id = ticket_id)
  and ((from_platform and public.platform_can('support', true)) or (not from_platform and not internal)));

-- Platform-owned tables: writes follow the platform role
drop policy if exists "platform" on public.plans;
create policy "platform" on public.plans for all to authenticated using (public.platform_can('plans', true)) with check (public.platform_can('plans', true));
drop policy if exists "platform" on public.platform_settings;
drop policy if exists "read" on public.platform_settings;
create policy "read" on public.platform_settings for select to authenticated using (public.platform_can('settings'));
create policy "platform" on public.platform_settings for all to authenticated using (public.platform_can('settings', true)) with check (public.platform_can('settings', true));
drop policy if exists "platform" on public.school_subscriptions;
create policy "platform" on public.school_subscriptions for all to authenticated using (public.platform_can('billing', true) or public.platform_can('tenants', true)) with check (public.platform_can('billing', true) or public.platform_can('tenants', true));
drop policy if exists "platform" on public.subscription_invoices;
create policy "platform" on public.subscription_invoices for all to authenticated using (public.platform_can('billing', true)) with check (public.platform_can('billing', true));
drop policy if exists "platform licence" on public.school_modules;
create policy "platform licence" on public.school_modules for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));
drop policy if exists "platform insert" on public.schools;
drop policy if exists "platform delete" on public.schools;
drop policy if exists "platform edit" on public.schools;
create policy "platform insert" on public.schools for insert to authenticated with check (public.platform_can('tenants', true));
create policy "platform edit" on public.schools for update to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));
create policy "platform delete" on public.schools for delete to authenticated using (public.platform_role() = 'owner');

-- Invoices / plan changes check the platform role too
create or replace function public.create_subscription_invoice(sid uuid, p_start date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sub record; pl record; st date; en date; v_n int; stu int; rate numeric; amt numeric; gst numeric; v_fy text; num text; cfg jsonb; inv uuid;
begin
  if not (public.is_service() or public.platform_can('billing', true)) then raise exception 'not allowed'; end if;
  select * into sub from public.school_subscriptions where school_id = sid;
  if sub.id is null then raise exception 'School has no subscription'; end if;
  select * into pl from public.plans where id = sub.plan_id;
  if pl.trial_days > 0 then raise exception 'Move the school to a paid plan before invoicing.'; end if;
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

create or replace function public.mark_subscription_invoice_paid(inv_id uuid, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if not (public.is_service() or public.platform_can('billing', true)) then raise exception 'not allowed'; end if;
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

create or replace function public.approve_school(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl text;
begin
  if not public.platform_can('tenants', true) then raise exception 'not allowed'; end if;
  update public.schools set status = 'active' where id = sid and status = 'pending';
  select p.code into pl from public.school_subscriptions s join public.plans p on p.id = s.plan_id where s.school_id = sid and s.status = 'trialing';
  if pl is not null then perform public.apply_plan(sid, pl, 'yearly'); end if;
end $$;

create or replace function public.create_school(p_name text, p_code text, p_board text default 'CBSE', p_city text default 'Lucknow',
                                                p_plan text default 'trial', p_cycle text default 'yearly')
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.platform_can('tenants', true) then raise exception 'not allowed'; end if;
  sid := public._create_school_core(p_name, p_code, p_board, p_city);
  perform public.apply_plan(sid, p_plan, p_cycle);
  return sid;
end $$;

create or replace function public._create_school_core(p_name text, p_code text, p_board text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; cid uuid; c text; i int := 0; yr int;
begin
  if not (public.is_service() or public.platform_can('tenants', true)) then raise exception 'not allowed'; end if;
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
revoke execute on function public._create_school_core(text, text, text, text) from public, anon, authenticated;

create or replace function public.billing_run(on_day date default null) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(on_day, public.today_ist()); sub record; days int; inv uuid;
begin
  if not (public.is_service() or public.platform_can('billing', true)) then raise exception 'not allowed'; end if;
  select coalesce((value ->> 'renew_days_before')::int, 7) into days from public.platform_settings where key = 'billing';
  for sub in select s.* from public.school_subscriptions s join public.plans p on p.id = s.plan_id join public.schools sc on sc.id = s.school_id
             where s.status = 'active' and s.auto_renew and p.trial_days = 0 and sc.status = 'active' and sc.archived_at is null
               and s.current_period_end - d <= days
               and not exists (select 1 from public.subscription_invoices i where i.subscription_id = s.id and i.period_start > s.current_period_end and i.status <> 'void') loop
    inv := public.create_subscription_invoice(sub.school_id, sub.current_period_end + 1);
    return next inv;
  end loop;
end $$;

-- Existing schools: new permissions (support tickets) for every role template
do $$
declare s record;
begin
  for s in select id from public.schools loop
    perform public.sync_role_templates(s.id);
    insert into public.role_permissions (role_id, perm_key, scope)
      select r.id, tp.perm_key, tp.scope from public.roles r join public.role_template_permissions tp on tp.template_code = r.template_code
      where r.school_id = s.id and tp.perm_key like 'support.%'
      on conflict do nothing;
  end loop;
end $$;

-- Platform staff (tenants write) may manage a school's users without a support session
drop policy if exists "platform" on public.school_members;
create policy "platform" on public.school_members for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));
drop policy if exists "platform" on public.member_roles;
create policy "platform" on public.member_roles for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));
