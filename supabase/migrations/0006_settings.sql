
-- ═══════════════════════════════════════════════════════════════════════════
-- Step 4: Settings centre — integrations (payment gateway, Cloudinary, email,
-- SMS, WhatsApp) per school and for the platform, with secrets kept encrypted;
-- school preferences (locale, working days, notification channels); message log.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- School preferences: { timezone, date_format, week_start, working_days[], notify: { event: { sms, email, whatsapp } } }
alter table public.schools add column if not exists prefs jsonb not null default '{}';

-- One row per (school, provider); school_id null = the platform's own account.
-- `config` holds only non-secret values (key id, cloud name, SMTP host, sender id …).
create table if not exists public.integration_settings (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid references public.schools(id) on delete cascade,
  provider       text not null check (provider in ('razorpay','cloudinary','email','sms','whatsapp')),
  enabled        boolean not null default false,
  config         jsonb not null default '{}',
  secret_hints   jsonb not null default '{}',   -- { "key_secret": "••••a1b2" } — never the secret itself
  status         text not null default 'untested' check (status in ('untested','ok','failed')),
  status_message text,
  tested_at      timestamptz,
  updated_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists integration_settings_school_provider on public.integration_settings (school_id, provider) where school_id is not null;
create unique index if not exists integration_settings_platform_provider on public.integration_settings (provider) where school_id is null;

-- Secrets: AES-256-GCM ciphertext made by the app server (key in SETTINGS_ENCRYPTION_KEY, never in the database).
-- No policies: only the server's secret key can read or write this table.
create table if not exists public.integration_secrets (
  setting_id  uuid primary key references public.integration_settings(id) on delete cascade,
  ciphertext  text not null,
  key_version smallint not null default 1,
  updated_at  timestamptz not null default now()
);

-- Every SMS / email / WhatsApp the system sends (and test sends), for delivery tracking.
create table if not exists public.message_log (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references public.schools(id) on delete cascade,
  channel      text not null check (channel in ('sms','email','whatsapp')),
  event        text not null default 'test',
  recipient    text not null,
  subject      text,
  status       text not null default 'queued' check (status in ('queued','sent','failed')),
  provider_ref text,
  error        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists message_log_school on public.message_log (school_id, created_at desc);

alter table public.integration_settings enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.message_log enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

drop policy if exists "read" on public.integration_settings;
create policy "read" on public.integration_settings for select to authenticated using (
  case when school_id is null then public.platform_can('settings') else public.has_perm(school_id, 'settings.integrations.view') end);
drop policy if exists "write" on public.integration_settings;
create policy "write" on public.integration_settings for all to authenticated
  using (case when school_id is null then public.platform_can('settings', true) else public.has_perm(school_id, 'settings.integrations.edit') end)
  with check (case when school_id is null then public.platform_can('settings', true) else public.has_perm(school_id, 'settings.integrations.edit') end);

drop policy if exists "read" on public.message_log;
create policy "read" on public.message_log for select to authenticated using (
  case when school_id is null then public.platform_can('settings') else public.has_perm(school_id, 'settings.integrations.view') end);

-- Keep updated_at / updated_by honest
create or replace function public.touch_integration() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists integration_settings_touch on public.integration_settings;
create trigger integration_settings_touch before insert or update on public.integration_settings for each row execute function public.touch_integration();

-- Audit (config and hints only — secrets live in the other table)
drop trigger if exists audit_integration_settings on public.integration_settings;
create trigger audit_integration_settings after insert or update or delete on public.integration_settings for each row execute function public.audit_row();

-- Which integrations a school can use right now: its own, else the platform's shared account (when the platform allows sharing).
create or replace function public.effective_integrations(sid uuid) returns table (provider text, source text, enabled boolean, status text)
language sql stable security definer set search_path = public as $$
  select p.provider,
         case when s.enabled then 'school' when pl.enabled and coalesce((pl.config ->> 'share_with_schools')::boolean, false) then 'platform' else 'none' end,
         coalesce(s.enabled, false) or (coalesce(pl.enabled, false) and coalesce((pl.config ->> 'share_with_schools')::boolean, false)),
         coalesce(case when s.enabled then s.status end, case when pl.enabled then pl.status end, 'untested')
    from unnest(array['razorpay','cloudinary','email','sms','whatsapp']) p(provider)
    left join public.integration_settings s on s.school_id = sid and s.provider = p.provider
    left join public.integration_settings pl on pl.school_id is null and pl.provider = p.provider
   where public.is_member(sid) or public.platform_can('tenants');
$$;
