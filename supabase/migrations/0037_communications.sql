-- ═══════════════════════════════════════════════════════════════════════════
-- Step 35: Communications 2.0 — one outbox for email, SMS and WhatsApp. Every school sends through its OWN accounts
--          (Settings → Integrations); CodersDuniya's own messages (invoices, welcome) go through the platform account.
--          Nothing calls a provider inline: events enqueue, a worker drains the outbox with retry and back-off.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── contact hygiene ─────────────
alter table public.students add column if not exists guardian_email text;
alter table public.students add column if not exists msg_opt_out boolean not null default false;       -- parent asked to stop automatic messages
alter table public.guardians add column if not exists opted_out_at timestamptz;

-- ───────────── templates (a school's own wording; missing rows fall back to the built-in defaults in the app) ─────────────
create table if not exists public.message_templates (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete cascade,
  event             text not null,
  channel           text not null check (channel in ('sms', 'email', 'whatsapp')),
  language          text not null default 'en' check (language in ('en', 'hi')),
  subject           text,
  body              text not null check (length(btrim(body)) > 0),
  provider_template text,                  -- WhatsApp template name / SMS flow id approved by the provider
  active            boolean not null default true,
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  unique (school_id, event, channel, language)
);

-- ───────────── outbox ─────────────
create table if not exists public.message_outbox (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid references public.schools(id) on delete cascade,        -- null = a platform (CodersDuniya) message
  channel           text not null check (channel in ('sms', 'email', 'whatsapp')),
  event             text not null,
  to_addr           text not null,
  recipient_name    text,
  student_id        uuid references public.students(id) on delete set null,
  subject           text,
  body              text not null,
  provider_template text,
  variables         jsonb not null default '[]',        -- ordered values for SMS flow variables / WhatsApp body parameters
  status            text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  attempts          int not null default 0,
  last_error        text,
  provider_ref      text,
  account_source    text,                               -- 'school' | 'platform' — whose account carried it
  dedupe_key        text,
  send_after        timestamptz not null default now(),
  created_by_name   text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);
create index if not exists message_outbox_school on public.message_outbox (school_id, created_at desc);
create index if not exists message_outbox_queue on public.message_outbox (send_after) where status = 'queued';
create unique index if not exists message_outbox_dedupe on public.message_outbox (coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key) where dedupe_key is not null;

alter table public.message_templates enable row level security;
alter table public.message_outbox enable row level security;

drop policy if exists "read" on public.message_templates;
create policy "read" on public.message_templates for select to authenticated using (public.has_perm_school(school_id, 'comms.templates.view'));
drop policy if exists "create" on public.message_templates;
create policy "create" on public.message_templates for insert to authenticated with check (public.has_perm_school(school_id, 'comms.templates.create'));
drop policy if exists "edit" on public.message_templates;
create policy "edit" on public.message_templates for update to authenticated using (public.has_perm_school(school_id, 'comms.templates.edit')) with check (public.has_perm_school(school_id, 'comms.templates.edit'));
drop policy if exists "delete" on public.message_templates;
create policy "delete" on public.message_templates for delete to authenticated using (public.has_perm_school(school_id, 'comms.templates.delete'));

drop policy if exists "read" on public.message_outbox;
create policy "read" on public.message_outbox for select to authenticated using (
  case when school_id is null then public.platform_can('settings') else public.has_perm_school(school_id, 'comms.outbox.view') end);
-- rows are written by the service functions below and by retry / cancel

-- ───────────── service-side queue functions (the app server's secret key only) ─────────────
create or replace function public.enqueue_messages(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  insert into public.message_outbox (school_id, channel, event, to_addr, recipient_name, student_id, subject, body, provider_template, variables, status, last_error, dedupe_key, send_after, created_by_name)
  select nullif(x.school_id, '')::uuid, x.channel, x.event, x.to_addr, x.recipient_name, nullif(x.student_id, '')::uuid, x.subject, x.body, x.provider_template,
         coalesce(x.variables, '[]'::jsonb), coalesce(x.status, 'queued'), x.last_error, x.dedupe_key, coalesce(x.send_after, now()), x.created_by_name
    from jsonb_to_recordset(p_rows) as x(school_id text, channel text, event text, to_addr text, recipient_name text, student_id text, subject text, body text, provider_template text,
                                          variables jsonb, status text, last_error text, dedupe_key text, send_after timestamptz, created_by_name text)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- takes up to p_limit due messages (a school's, or anyone's) and marks them 'sending'; rows stuck for 10 minutes are released first
create or replace function public.claim_messages(p_limit int default 20, p_school uuid default null) returns setof public.message_outbox
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  update public.message_outbox set status = 'queued' where status = 'sending' and send_after < now() - interval '10 minutes';
  return query
    with c as (
      select id from public.message_outbox
       where status = 'queued' and send_after <= now() and (p_school is null or school_id = p_school)
       order by send_after, created_at limit least(greatest(coalesce(p_limit, 20), 1), 200) for update skip locked)
    update public.message_outbox m set status = 'sending', attempts = m.attempts + 1, send_after = now()
      from c where m.id = c.id returning m.*;
end $$;

-- records the outcome: sent, or retried later (10, 20 minutes), or failed after the third attempt
create or replace function public.finish_message(p_id uuid, p_ok boolean, p_ref text, p_error text, p_source text default null) returns text
language plpgsql security definer set search_path = public as $$
declare m public.message_outbox; st text;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into m from public.message_outbox where id = p_id;
  if m.id is null then return null; end if;
  if p_ok then
    st := 'sent';
    update public.message_outbox set status = 'sent', sent_at = now(), provider_ref = p_ref, account_source = p_source, last_error = null where id = p_id;
  elsif m.attempts >= 3 then
    st := 'failed';
    update public.message_outbox set status = 'failed', last_error = left(p_error, 300), account_source = p_source where id = p_id;
  else
    st := 'queued';
    update public.message_outbox set status = 'queued', last_error = left(p_error, 300), send_after = now() + (m.attempts * 10) * interval '1 minute' where id = p_id;
  end if;
  if st in ('sent', 'failed') then
    insert into public.message_log (school_id, channel, event, recipient, subject, status, provider_ref, error)
    values (m.school_id, m.channel, m.event, m.to_addr, m.subject, case when st = 'sent' then 'sent' else 'failed' end, p_ref, left(p_error, 300));
  end if;
  return st;
end $$;

-- ───────────── staff-side functions ─────────────
create or replace function public.outbox_retry(sid uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'comms.outbox.edit') then raise exception 'not allowed'; end if;
  update public.message_outbox set status = 'queued', attempts = 0, send_after = now(), last_error = null
   where id = p_id and school_id = sid and status in ('failed', 'skipped', 'cancelled');
end $$;

create or replace function public.outbox_cancel(sid uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'comms.outbox.edit') then raise exception 'not allowed'; end if;
  update public.message_outbox set status = 'cancelled' where id = p_id and school_id = sid and status = 'queued';
end $$;

-- sid null = the platform's own messages (super admin)
create or replace function public.outbox_list(sid uuid, p_status text default null, p_channel text default null, p_event text default null, p_q text default null,
                                              p_limit int default 25, p_offset int default 0)
returns table (id uuid, channel text, event text, to_addr text, recipient_name text, student_id uuid, subject text, body text, status text, attempts int, last_error text,
               provider_ref text, account_source text, send_after timestamptz, created_at timestamptz, sent_at timestamptz, total bigint)
language sql stable security definer set search_path = public as $$
  select o.id, o.channel, o.event, o.to_addr, o.recipient_name, o.student_id, o.subject, o.body, o.status, o.attempts, o.last_error, o.provider_ref, o.account_source,
         o.send_after, o.created_at, o.sent_at, count(*) over ()
    from public.message_outbox o
   where o.school_id is not distinct from sid
     and case when sid is null then public.platform_can('settings') else public.has_perm_school(sid, 'comms.outbox.view') end
     and (p_status is null or o.status = p_status) and (p_channel is null or o.channel = p_channel) and (p_event is null or o.event = p_event)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', o.to_addr, o.recipient_name, o.body, o.subject) ilike public.like_escape(btrim(p_q)))
   order by o.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.outbox_stats(sid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(case when sid is null then public.platform_can('settings') else public.has_perm_school(sid, 'comms.outbox.view') end, false) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'queued', (select count(*) from public.message_outbox where school_id is not distinct from sid and status in ('queued', 'sending')),
    'sent_30', (select count(*) from public.message_outbox where school_id is not distinct from sid and status = 'sent' and sent_at >= now() - interval '30 days'),
    'failed_30', (select count(*) from public.message_outbox where school_id is not distinct from sid and status = 'failed' and created_at >= now() - interval '30 days'),
    'skipped_30', (select count(*) from public.message_outbox where school_id is not distinct from sid and status = 'skipped' and created_at >= now() - interval '30 days'),
    'by_channel', coalesce((select jsonb_object_agg(channel, n) from (
        select channel, count(*) n from public.message_outbox where school_id is not distinct from sid and status = 'sent' and sent_at >= now() - interval '30 days' group by channel) x), '{}'::jsonb),
    'by_event', coalesce((select jsonb_agg(jsonb_build_object('event', event, 'n', n) order by n desc) from (
        select event, count(*) n from public.message_outbox where school_id is not distinct from sid and created_at >= now() - interval '30 days' group by event) x), '[]'::jsonb));
end $$;

do $$
declare t text;
begin
  foreach t in array array['message_templates'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- service functions: the browser never calls them
revoke execute on function public.enqueue_messages(jsonb) from public, anon, authenticated;
revoke execute on function public.claim_messages(int, uuid) from public, anon, authenticated;
revoke execute on function public.finish_message(uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_messages(jsonb) to service_role;
grant execute on function public.claim_messages(int, uuid) to service_role;
grant execute on function public.finish_message(uuid, boolean, text, text, text) to service_role;

notify pgrst, 'reload schema';
