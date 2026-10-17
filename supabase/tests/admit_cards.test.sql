-- Admit cards from the date sheet (step 42, migration 0044).
-- Run on a THROWAWAY database after all migrations:  psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/admit_cards.test.sql
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
  ('acacacac-0000-0000-0000-000000000001', 'ac-owner@test.dev'),
  ('acacacac-0000-0000-0000-000000000002', 'ac-principal@test.dev'),
  ('acacacac-0000-0000-0000-000000000003', 'ac-teacher@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('acacacac-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'acacacac-0000-0000-0000-000000000001'; pr uuid := 'acacacac-0000-0000-0000-000000000002'; te uuid := 'acacacac-0000-0000-0000-000000000003';
  a uuid; c uuid; c2 uuid; sess uuid; e1 uuid; e2 uuid; sub1 uuid; sub2 uuid; tpl uuid; s1 uuid; s2 uuid; n int; h text; sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Admit Cards', 'adc-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into sess from public.sessions where school_id = a and is_current;
  select id into c from public.classes where school_id = a order by sort limit 1;
  select id into c2 from public.classes where school_id = a order by sort offset 1 limit 1;
  insert into public.subjects (school_id, name) values (a, 'English <Lang>') returning id into sub1;
  insert into public.subjects (school_id, name) values (a, 'Maths') returning id into sub2;
  insert into public.exams (school_id, session_id, name) values (a, sess, 'Half Yearly') returning id into e1;
  insert into public.exams (school_id, session_id, name) values (a, sess, 'Annual') returning id into e2;
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, exam_date, start_time, end_time, room) values
    (a, e1, c, sub1, date '2026-11-05', time '09:00', time '12:00', 'Hall A'), (a, e1, c, sub2, date '2026-11-07', time '09:00', time '11:30', 'Hall B');
  insert into public.students (school_id, admission_no, first_name, class_id, status, roll_no) values (a, 'AC1', 'Asha', c, 'active', 1) returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id, status, roll_no) values (a, 'AC2', 'Bala', c, 'active', 2) returning id into s2;
  insert into public.document_templates (school_id, code, name, category, audience, body_html, fields, numbering_prefix)
    values (a, 'admit_t', 'Admit card', 'certificate', 'student', '<p>{{student.name}} {{exam.name}} roll {{student.roll_no}} {{extra.centre}}</p>{{exam.datesheet_html}}',
            '[{"key":"exam_ref","label":"Examination","type":"exam","required":true},{"key":"centre","label":"Centre","type":"text"}]', 'ADM') returning id into tpl;

  perform pg_temp.act_as(pr);
  n := public.issue_admit_cards(a, tpl, e1, c, null, '{"centre":"Main hall"}', 'Principal');
  perform pg_temp.check(n = 2, 'an admit card is issued for every active student of the class');
  h := (select html from public.issued_documents where student_id = s1 and template_code = 'admit_t');
  perform pg_temp.check(h like '%Asha%' and h like '%Half Yearly%' and h like '%roll 1%' and h like '%Main hall%', 'the card carries the student, the examination, roll number and centre');
  perform pg_temp.check(h like '%05/11/2026%' and h like '%09:00 – 12:00%' and h like '%Hall A%' and h like '%Maths%', 'and the date sheet with date, time and room');
  perform pg_temp.check(h like '%English &lt;Lang&gt;%' and h not like '%<Lang>%', 'subject names are HTML-escaped');
  perform pg_temp.check(public.issue_admit_cards(a, tpl, e1, c, null, '{}', 'Principal') = 0, 'running it again for the same examination adds nothing');
  begin perform public.issue_admit_cards(a, tpl, e2, c, null, '{}', null); perform pg_temp.check(false, 'no date sheet');
  exception when others then perform pg_temp.check(sqlerrm like '%no subjects in the date sheet%', 'an examination without a date sheet for the class is refused'); end;
  begin perform public.issue_admit_cards(a, tpl, e1, c2, null, '{}', null); perform pg_temp.check(false, 'other class');
  exception when others then perform pg_temp.check(sqlerrm like '%no subjects in the date sheet%', 'so is a class that has no papers in it'); end;
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, exam_date) values (a, e2, c, sub1, date '2027-03-01');
  perform pg_temp.check(public.issue_admit_cards(a, tpl, e2, c, null, '{}', null) = 2, 'a second examination gets its own cards');
  perform pg_temp.check((select count(*) from public.issued_documents where template_code = 'admit_t' and student_id = s1) = 2, 'a student keeps one card per examination');
  perform pg_temp.act_admin();

  perform pg_temp.act_as(te);
  begin perform public.issue_admit_cards(a, tpl, e1, c, null, '{}', null); perform pg_temp.check(false, 'teacher');
  exception when others then perform pg_temp.check(sqlerrm = 'not allowed', 'a class teacher cannot issue admit cards'); end;
  perform pg_temp.act_admin();

  perform pg_temp.act_as(pr);
  insert into public.document_templates (school_id, code, name, category, audience, body_html, fields, numbering_prefix) values (a, 'plain_t', 'Plain', 'certificate', 'student', '<p>x</p>', '[]', 'PL');
  begin perform public.issue_admit_cards(a, (select id from public.document_templates where code = 'plain_t' and school_id = a), e1, c, null, '{}', null); perform pg_temp.check(false, 'no exam field');
  exception when others then perform pg_temp.check(sqlerrm like '%does not ask for an examination%', 'a template without an examination question is refused'); end;
  perform pg_temp.act_admin();
end $$;

select 'ALL ADMIT CARD TESTS PASSED' as result;
rollback;
