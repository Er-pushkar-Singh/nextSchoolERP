-- HR letters test (step 40, migration 0042): the data a staff letter needs is built from the staff record, never typed by hand.
-- Run on a THROWAWAY database after all migrations:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/hr_letters.test.sql
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
  ('e1e1e1e1-0000-0000-0000-000000000001', 'hl-owner@test.dev'),
  ('e1e1e1e1-0000-0000-0000-000000000002', 'hl-principal@test.dev'),
  ('e1e1e1e1-0000-0000-0000-000000000003', 'hl-teacher@test.dev'),
  ('e1e1e1e1-0000-0000-0000-000000000004', 'hl-newhire@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('e1e1e1e1-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'e1e1e1e1-0000-0000-0000-000000000001'; pr uuid := 'e1e1e1e1-0000-0000-0000-000000000002'; te uuid := 'e1e1e1e1-0000-0000-0000-000000000003';
  nh uuid := 'e1e1e1e1-0000-0000-0000-000000000004';
  a uuid; b uuid; w1 uuid; w2 uuid; w3 uuid; tpl uuid; tpl2 uuid; d1 uuid; d2 uuid; h text; j jsonb; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('HR Letters A', 'hla-' || sfx);
  b := public.create_school('HR Letters B', 'hlb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name, email) values (a, pr, 'Principal', 'hl-principal@test.dev'), (a, te, 'Teacher', 'hl-teacher@test.dev');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;

  insert into public.staff (school_id, name, gender, designation, department, emp_code, joining_date, address, probation_months, status,
                            earnings, deductions)
  values (a, 'Meena Srivastava', 'F', 'PGT Physics', 'Science', 'E-14', date '2018-07-01', '45 <Jankipuram>, Lucknow', 6, 'active',
          '[{"name":"Basic","amount":30000},{"name":"HRA","amount":12500}]', '[{"name":"PF","amount":3600}]') returning id into w1;
  insert into public.staff (school_id, name, gender, designation, joining_date, leaving_date, status, earnings)
  values (a, 'Rajesh Kumar', 'M', 'Clerk', date '2020-01-15', date '2026-09-30', 'left', '[{"name":"Basic","amount":18000}]') returning id into w2;
  insert into public.staff (school_id, name, designation, joining_date, status) values (a, 'Sam Rivers', 'Helper', date '2026-10-01', 'active') returning id into w3;

  insert into public.document_templates (school_id, code, name, category, audience, module, preset, body_html, fields, numbering_prefix)
  values (a, 'appointment_letter', 'Appointment letter', 'letter', 'staff', 'staff', 'appointment_letter',
          '<p>{{staff.mr_ms}} {{staff.name}} — {{staff.he_she}} / {{staff.his_her}} / {{staff.him_her}} — Rs. {{staff.gross}} ({{staff.gross_words}}) — net {{staff.net}} ({{staff.net_words}}) — probation {{staff.probation_months}} months — service {{staff.service_years}} — {{staff.address}}</p>{{staff.earnings_html}}',
          '[]', 'APT') returning id into tpl;
  insert into public.document_templates (school_id, code, name, category, audience, module, preset, body_html, fields, numbering_prefix)
  values (a, 'experience_letter', 'Experience certificate', 'letter', 'staff', 'staff', 'experience_letter',
          '<p>{{staff.name}} worked {{staff.joining_date}} to {{staff.leaving_date}} ({{staff.service_years}}) — {{extra.conduct}}</p>',
          '[{"key":"conduct","label":"Conduct","type":"text"}]', 'EXP') returning id into tpl2;

  -- the letter data is built from the record
  j := public.document_data(a, null, w1, 'APT/1', date '2026-10-16', null, '{}');
  perform pg_temp.check(j #>> '{staff,mr_ms}' = 'Ms.' and j #>> '{staff,he_she}' = 'she' and j #>> '{staff,his_her}' = 'her' and j #>> '{staff,him_her}' = 'her', 'pronouns and Ms. follow the staff gender');
  perform pg_temp.check(j #>> '{staff,gross}' = '42,500' and j #>> '{staff,net}' = '38,900', 'gross and net salary are worked out from the salary structure');
  perform pg_temp.check(replace(j #>> '{staff,gross_words}', '-', ' ') ilike '%forty two thousand five hundred%' and replace(j #>> '{staff,net_words}', '-', ' ') ilike '%thirty eight thousand nine hundred%', 'salary in words');
  perform pg_temp.check(j #>> '{staff,service_years}' = '8 years 3 months', 'length of service up to the letter date');
  perform pg_temp.check(j #>> '{staff,probation_months}' = '6', 'probation months');
  perform pg_temp.check((j #>> '{staff,earnings_html}') like '%Basic%30,000.00%' and (j #>> '{staff,earnings_html}') like '%Net monthly salary%38,900.00%', 'salary breakup table lists components and the net');
  j := public.document_data(a, null, w3, 'APT/2', date '2026-10-16', null, '{}');
  perform pg_temp.check(j #>> '{staff,mr_ms}' = '' and j #>> '{staff,he_she}' = 'the employee' and j #>> '{staff,earnings_html}' = '' and j #>> '{staff,gross}' = '0', 'no gender / no salary: neutral wording, no table, zero salary');
  perform pg_temp.check(public.document_data(a, null, w1, 'x', date '2026-10-16', null, '{}') #>> '{staff,name}' = 'Meena Srivastava', 'the base staff fields are still there');
  j := public.document_data(a, null, w2, 'EXP/1', date '2026-10-16', null, '{}');
  perform pg_temp.check(j #>> '{staff,service_years}' = '6 years 8 months' and j #>> '{staff,mr_ms}' = 'Mr.' and j #>> '{staff,his_her}' = 'his', 'service of someone who left counts up to the leaving date');

  -- issuing
  perform pg_temp.act_as(pr);
  d1 := public.issue_document(a, tpl, null, w1, date '2026-10-16', '{}', false, 'Principal');
  h := (select html from public.issued_documents where id = d1);
  perform pg_temp.check(h like '%Ms. Meena Srivastava%' and h like '%Rs. 42,500%' and h like '%probation 6 months%' and h like '%service 8 years 3 months%', 'the issued appointment letter carries the staff data');
  perform pg_temp.check(h like '%<table%' and h like '%Net monthly salary%', 'the salary table is real HTML, not escaped text');
  perform pg_temp.check(h like '%45 &lt;Jankipuram&gt;, Lucknow%' and h not like '%<Jankipuram>%', 'free text from the record is HTML-escaped');
  perform pg_temp.check((select doc_no like 'APT/%' and staff_id = w1 and status = 'issued' from public.issued_documents where id = d1), 'letters are numbered by their prefix and tied to the staff member');
  d2 := public.issue_document(a, tpl2, null, w2, date '2026-10-16', '{"conduct":"very good"}', false, 'Principal');
  perform pg_temp.check((select html like '%30/09/2026%' from public.issued_documents where id = d2), 'leaving date is printed on the experience certificate');
  perform pg_temp.check((select html like '%very good%' from public.issued_documents where id = d2), 'the questions asked at issue appear in the letter');
  perform pg_temp.check((select count(*) from public.issued_documents where staff_id = w1) = 1, 'the staff member has one letter on file');
  perform pg_temp.act_admin();

  -- a teacher cannot issue HR letters
  perform pg_temp.act_as(te);
  begin perform public.issue_document(a, tpl, null, w1, date '2026-10-16', '{}', false, 'T'); perform pg_temp.check(false, 'teacher issues');
  exception when others then perform pg_temp.check(true, 'a class teacher cannot issue an HR letter'); end;
  perform pg_temp.act_admin();

  -- probation is validated
  begin update public.staff set probation_months = 30 where id = w1; perform pg_temp.check(false, 'probation range');
  exception when check_violation then perform pg_temp.check(true, 'probation is limited to 0-24 months'); end;

  -- isolation: another school cannot issue to this school's staff
  perform pg_temp.act_as(ow);
  begin perform public.issue_document(b, tpl, null, w1, date '2026-10-16', '{}', false, 'x'); perform pg_temp.check(false, 'cross school');
  exception when others then perform pg_temp.check(true, 'another school cannot issue with this school''s template or staff'); end;
  perform pg_temp.act_admin();
end $$;

select 'ALL HR LETTER TESTS PASSED' as result;
rollback;
