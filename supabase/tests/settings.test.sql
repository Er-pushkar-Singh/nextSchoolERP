-- Settings centre test. Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/settings.test.sql
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'set-owner@test.dev'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'set-support@test.dev'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'set-principal-a@test.dev'),
  ('eeeeeeee-0000-0000-0000-000000000004', 'set-teacher-a@test.dev'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'set-principal-b@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'owner'), ('eeeeeeee-0000-0000-0000-000000000002', 'support')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'eeeeeeee-0000-0000-0000-000000000001'; sup uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  pa uuid := 'eeeeeeee-0000-0000-0000-000000000003'; te uuid := 'eeeeeeee-0000-0000-0000-000000000004'; pb uuid := 'eeeeeeee-0000-0000-0000-000000000005';
  a uuid; b uuid; sa uuid; n int; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Set A', 'seta-' || sfx);
  b := public.create_school('Set B', 'setb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pa, 'Principal A'), (a, te, 'Teacher A'), (b, pb, 'Principal B');
  insert into public.member_roles (school_id, user_id, role_id) select a, pa, id from public.roles where school_id = a and code = 'principal';
  insert into public.member_roles (school_id, user_id, role_id) select a, te, id from public.roles where school_id = a and code = 'subject_teacher';
  insert into public.member_roles (school_id, user_id, role_id) select b, pb, id from public.roles where school_id = b and code = 'principal';

  -- School integrations
  perform pg_temp.act_as(pa);
  insert into public.integration_settings (school_id, provider, enabled, config, secret_hints) values (a, 'razorpay', true, '{"key_id":"rzp_test_A","mode":"test"}', '{"key_secret":"••••1234"}') returning id into sa;
  perform pg_temp.check(sa is not null, 'principal saves the school''s Razorpay settings');
  perform pg_temp.check((select updated_by from public.integration_settings where id = sa) = pa, 'updated_by is stamped');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(te);
  perform pg_temp.check((select count(*) from public.integration_settings where school_id = a) = 0, 'teacher cannot see integrations');
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pb);
  perform pg_temp.check((select count(*) from public.integration_settings where school_id = a) = 0, 'another school cannot see them');
  begin
    insert into public.integration_settings (school_id, provider) values (a, 'sms');
    perform pg_temp.check(false, 'other principal wrote into school A');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'another school cannot write them'); end;
  perform pg_temp.act_admin();

  -- Secrets are invisible to every signed-in user
  insert into public.integration_secrets (setting_id, ciphertext) values (sa, 'v1.x.y.z');
  perform pg_temp.act_as(pa);
  begin
    select count(*) into n from public.integration_secrets;
    perform pg_temp.check(n = 0, 'principal reads no secrets');
  exception when insufficient_privilege then perform pg_temp.check(true, 'principal reads no secrets (no privilege)'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(ow);
  begin
    select count(*) into n from public.integration_secrets;
    perform pg_temp.check(n = 0, 'even the platform owner reads no secrets through the API');
  exception when insufficient_privilege then perform pg_temp.check(true, 'even the platform owner reads no secrets (no privilege)'); end;

  -- Platform integrations and sharing
  insert into public.integration_settings (school_id, provider, enabled, config) values (null, 'sms', true, '{"share_with_schools":"true"}')
    on conflict (provider) where school_id is null do update set enabled = true, config = excluded.config;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(sup);
  perform pg_temp.check((select count(*) from public.integration_settings where school_id is null and provider = 'sms') = 1, 'support staff can read platform integrations');
  begin
    update public.integration_settings set enabled = false where school_id is null;
    get diagnostics n = row_count;
    perform pg_temp.check(n = 0, 'support staff cannot change platform integrations');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'support staff cannot change platform integrations'); end;
  perform pg_temp.act_admin();
  perform pg_temp.act_as(pa);
  perform pg_temp.check((select source from public.effective_integrations(a) where provider = 'razorpay') = 'school'
                    and (select source from public.effective_integrations(a) where provider = 'sms') = 'platform'
                    and (select source from public.effective_integrations(a) where provider = 'email') = 'none', 'effective integrations: own, shared, none');
  -- Preferences
  update public.schools set prefs = '{"week_start":"mon","working_days":[1,2,3,4,5,6]}' where id = a;
  perform pg_temp.act_admin();
  perform pg_temp.check((select prefs ->> 'week_start' from public.schools where id = a) = 'mon', 'principal saves preferences');
  perform pg_temp.check(exists (select 1 from public.audit_log where school_id = a and entity = 'integration_settings' and action = 'insert'), 'integration changes are audited');
  perform pg_temp.check(not exists (select 1 from public.audit_log where details::text like '%v1.x.y.z%'), 'secrets never reach the audit log');
end $$;

select 'ALL SETTINGS TESTS PASSED' as result;
rollback;
