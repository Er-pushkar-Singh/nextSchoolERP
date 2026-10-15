-- Marksheet data for templates, branding placeholders (step 29).
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email) values
  ('d0d0d0d0-0000-0000-0000-000000000001', 'ed-owner@test.dev'), ('d0d0d0d0-0000-0000-0000-000000000002', 'ed-principal@test.dev'), ('d0d0d0d0-0000-0000-0000-000000000003', 'ed-teacher@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('d0d0d0d0-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'd0d0d0d0-0000-0000-0000-000000000001'; pr uuid := 'd0d0d0d0-0000-0000-0000-000000000002'; te uuid := 'd0d0d0d0-0000-0000-0000-000000000003';
  a uuid; cls uuid; sess uuid; ex1 uuid; ex2 uuid; m uuid; e uuid; s1 uuid; s2 uuid; tpl uuid; did uuid; html text; sfx text := substr(md5(random()::text), 1, 6); sig text := 'data:image/png;base64,iVBORw0KGgo=';
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('ED A', 'eda-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'subject_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  select id into cls from public.classes where school_id = a and name = '5';
  select id into sess from public.sessions where school_id = a and is_current;
  select id into m from public.subjects where school_id = a order by name limit 1;
  select id into e from public.subjects where school_id = a and id <> m order by name limit 1;
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, father_name) values (a, 'D1', 'Aarav', 'Sharma', cls, 'Rajesh Sharma') returning id into s1;
  insert into public.students (school_id, admission_no, first_name, class_id) values (a, 'D2', 'Diya', cls) returning id into s2;
  insert into public.exams (school_id, session_id, name, sort) values (a, sess, 'Unit Test', 1) returning id into ex1;
  insert into public.exams (school_id, session_id, name, sort) values (a, sess, 'Half Yearly', 2) returning id into ex2;
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, max_marks) values (a, ex1, cls, m, 25), (a, ex1, cls, e, 25), (a, ex2, cls, m, 100), (a, ex2, cls, e, 100);
  insert into public.marks (school_id, exam_id, student_id, subject_id, marks) values
    (a, ex1, s1, m, 20), (a, ex1, s1, e, 22), (a, ex1, s2, m, 10), (a, ex1, s2, e, 12),
    (a, ex2, s1, m, 80), (a, ex2, s1, e, 90), (a, ex2, s2, m, 50), (a, ex2, s2, e, 45);
  insert into public.document_templates (school_id, code, name, category, audience, body_html, fields, numbering_prefix)
  values (a, 'marksheet_t', 'Marksheet', 'certificate', 'student',
          '<p>{{student.name}} — {{exam.name}} — {{exam.result}} — rank {{exam.rank}}/{{exam.strength}} — {{exam.percent}} {{exam.grade}}</p>{{exam.marks_html}}{{exam.all_html}}<div>{{school.signature}}</div><div>{{school.seal}}</div>',
          '[{"key":"exam_id","label":"Examination","type":"exam","required":true}]', 'MS') returning id into tpl;

  perform pg_temp.act_as(pr);
  begin perform public.issue_document(a, tpl, s1, null, null, jsonb_build_object('exam_id', ex1::text)); perform pg_temp.check(false, 'undeclared');
  exception when others then perform pg_temp.check(sqlerrm like '%not declared%', 'a marksheet cannot be issued before the result is declared'); end;
  perform public.declare_exam_result(a, ex1, cls, true);
  perform public.declare_exam_result(a, ex2, cls, true);
  did := public.issue_document(a, tpl, s1, null, null, jsonb_build_object('exam_id', ex2::text), false, 'Principal');
  select i.html into html from public.issued_documents i where i.id = did;
  perform pg_temp.check(html like '%Aarav Sharma%' and html like '%Half Yearly%' and html like '%PASS%' and html like '%rank 1/2%', 'the marksheet carries name, exam, result and rank');
  perform pg_temp.check(html like '%<table%' and html like '%170%' and html like '%200%', 'the marks table is built with the total 170 of 200');
  perform pg_temp.check(html like '%Unit Test%' and html like '%20/25%' and html like '%80/100%', 'the cumulative table lists every declared exam of the session');
  perform pg_temp.check(html like '%data-brand="signature"%' and html like '%data-brand="seal"%', 'signature and seal slots are rendered for the printing page to fill');
  perform pg_temp.check(html not like '%<script%', 'no script in the output');

  -- branding is kept per school and validated
  insert into public.school_branding (school_id, signature, watermark_mode, watermark_text, watermark_opacity) values (a, sig, 'text', 'SAMPLE SCHOOL', 12);
  perform pg_temp.check((select signature = sig from public.school_branding where school_id = a), 'the principal signature is stored');
  begin update public.school_branding set signature = 'https://evil.example/x.png' where school_id = a; perform pg_temp.check(false, 'url sig');
  exception when check_violation then perform pg_temp.check(true, 'a signature must be an inline image, not a link'); end;
  perform pg_temp.act_as(te);
  begin update public.school_branding set watermark_mode = 'none' where school_id = a; perform pg_temp.check((select watermark_mode from public.school_branding where school_id = a) = 'text', 'teacher change ignored');
  exception when others then perform pg_temp.check(true, 'a teacher cannot change the branding'); end;
end $$;

rollback;
