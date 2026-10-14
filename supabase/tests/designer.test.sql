-- Template designer storage (step 16): design JSON, compiled html, versions, restore.
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
  ('aeaeaeae-0000-0000-0000-000000000001', 'dz-owner@test.dev'), ('aeaeaeae-0000-0000-0000-000000000002', 'dz-principal@test.dev'),
  ('aeaeaeae-0000-0000-0000-000000000003', 'dz-teacher@test.dev'), ('aeaeaeae-0000-0000-0000-000000000004', 'dz-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('aeaeaeae-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'aeaeaeae-0000-0000-0000-000000000001'; pr uuid := 'aeaeaeae-0000-0000-0000-000000000002'; te uuid := 'aeaeaeae-0000-0000-0000-000000000003'; ot uuid := 'aeaeaeae-0000-0000-0000-000000000004';
  a uuid; b uuid; tid uuid; v1 int; cls uuid; s1 uuid; html text; d jsonb;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Dz A', 'dza-' || sfx);
  b := public.create_school('Dz B', 'dzb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, te, 'Teacher'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (te, 'class_teacher')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, father_name) values (a, 'D1', 'Dev', 'Rai', cls, 'Hari Rai') returning id into s1;

  perform pg_temp.act_as(pr);
  html := '<div style="position:relative;width:86mm;height:54mm"><div style="position:absolute;left:4mm;top:4mm;width:60mm;height:8mm">{{student.name}}</div><script>alert(1)</script></div>';
  insert into public.document_templates (school_id, code, name, category, audience, body_html, page_size, card_width_mm, card_height_mm, design, module, preset)
  values (a, 'custom_1', 'Sports pass', 'id_card', 'student', html, 'card', 86, 54, '{"v":1,"w":86,"h":54,"bg":"#ffffff","items":[]}'::jsonb, 'students', 'id_student_landscape') returning id, version into tid, v1;
  perform pg_temp.check((select design is not null and module = 'students' from public.document_templates where id = tid), 'a template stores its canvas and its module');
  perform pg_temp.check((select body_html not like '%<script%' and body_html like '%position:absolute%' from public.document_templates where id = tid), 'the html is sanitised on save but positioned layouts survive');

  update public.document_templates set design = '{"v":1,"w":86,"h":54,"bg":"#ffeeee","items":[]}'::jsonb where id = tid;
  perform pg_temp.check((select version = v1 + 1 from public.document_templates where id = tid), 'changing only the design makes a new version');
  perform pg_temp.check((select count(*) = 2 and bool_and(design is not null) from public.document_template_versions where template_id = tid), 'each version keeps its design');

  -- renders with real data
  perform pg_temp.check(public.preview_document(tid, s1, null) like '%Dev Rai%', 'the designed template renders with the student''s data');

  -- permissions
  perform pg_temp.act_as(te);
  update public.document_templates set name = 'hacked' where id = tid;
  perform pg_temp.act_admin();
  perform pg_temp.check((select name = 'Sports pass' from public.document_templates where id = tid), 'a teacher cannot edit a template');
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) = 0 from public.document_templates where id = tid), 'another school cannot see the template');
end $$;

rollback;
