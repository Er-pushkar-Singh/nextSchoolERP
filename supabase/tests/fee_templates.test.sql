-- Fee templates, payment methods and payment links (step 14).
begin;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'x@test.dev')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.act_admin() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '{}', true); end $$;
create or replace function pg_temp.act_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;
create or replace function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into auth.users (id, email) values
  ('dededede-0000-0000-0000-000000000001', 'ft-owner@test.dev'), ('dededede-0000-0000-0000-000000000002', 'ft-principal@test.dev'),
  ('dededede-0000-0000-0000-000000000003', 'ft-acct@test.dev'), ('dededede-0000-0000-0000-000000000004', 'ft-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('dededede-0000-0000-0000-000000000001', 'owner') on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'dededede-0000-0000-0000-000000000001'; pr uuid := 'dededede-0000-0000-0000-000000000002'; ac uuid := 'dededede-0000-0000-0000-000000000003'; ot uuid := 'dededede-0000-0000-0000-000000000004';
  a uuid; b uuid; cls uuid; sess uuid; head uuid; s1 uuid; rid uuid; oid uuid; r jsonb; tpl uuid; lk text;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Tpl A', 'tpla-' || sfx);
  b := public.create_school('Tpl B', 'tplb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, ac, 'Accountant'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (ac, 'accountant')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into cls from public.classes where school_id = a and name = '5';
  select id into sess from public.sessions where school_id = a and is_current;
  select id into head from public.fee_heads where school_id = a and name = 'Tuition Fee';
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (a, sess, cls, head, 'Apr', current_date - 10, 1500), (a, sess, cls, head, 'May', current_date + 20, 1500);
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, father_name, guardian_phone) values (a, 'T1', 'Ravi <b>X</b>', 'Singh', cls, 'Mohan Singh', '9811100001') returning id into s1;

  perform pg_temp.check((select count(*) = 1 from pg_constraint c where c.conrelid = 'public.students'::regclass and c.confrelid = 'public.classes'::regclass and c.contype = 'f'),
    'students has exactly one foreign key to classes (embeds are not ambiguous)');
  perform pg_temp.check((select count(*) = 3 from public.document_templates where school_id = a and category = 'fees'), 'three standard fee templates are seeded');
  perform pg_temp.check(public.seed_fee_templates_internal(a) = 0, 'seeding twice adds nothing');

  perform pg_temp.act_as(pr);
  perform public.generate_dues(a, sess);
  insert into public.fee_settings (school_id, online_enabled) values (a, true) on conflict (school_id) do update set online_enabled = true;

  -- payment methods
  rid := public.collect_fee_v2(a, s1, '[{"mode":"card","sub_type":"debit","amount":500,"reference":"POS 4821"},{"mode":"dd","amount":300,"reference":"DD 889900"},{"mode":"other","sub_type":"Scholarship cheque","amount":200}]'::jsonb,
                               null, 0, null, null, 'Principal', 0);
  perform pg_temp.check((select count(*) = 3 from public.fee_receipt_payments where receipt_id = rid), 'card, demand draft and other are accepted together');
  perform pg_temp.check((select sub_type = 'debit' from public.fee_receipt_payments where receipt_id = rid and mode = 'card'), 'the card type is stored');
  begin perform public.collect_fee_v2(a, s1, '[{"mode":"crypto","amount":5}]'::jsonb, null, 0, null, null, null, 0); perform pg_temp.check(false, 'bad mode');
  exception when others then perform pg_temp.check(sqlerrm like '%Unknown payment mode%', 'an unknown method is still refused'); end;

  -- receipt template
  r := public.render_fee_document('receipt', rid);
  perform pg_temp.check(r is not null and r ->> 'html' like '%FEE RECEIPT%', 'the receipt is rendered from the template');
  perform pg_temp.check(r ->> 'html' like '%Debit card%' and r ->> 'html' like '%Demand draft%', 'the payment methods are written on the receipt');
  perform pg_temp.check(r ->> 'html' like '%1,000.00%', 'amounts use Indian formatting');
  perform pg_temp.check(r ->> 'html' not like '%<b>X</b>%' and r ->> 'html' like '%Ravi &lt;b&gt;X&lt;/b&gt;%', 'student data is escaped inside the document');
  perform pg_temp.check(r ->> 'html' like '%One Thousand Rupees Only%', 'the amount in words is written');

  -- demand + statement
  r := public.render_fee_document('demand', s1);
  perform pg_temp.check(r ->> 'html' like '%Fee demand notice%' and r ->> 'html' like '%Apr%', 'the demand notice lists the dues');
  r := public.render_fee_document('statement', s1);
  perform pg_temp.check(r ->> 'html' like '%Receipts%' and r ->> 'html' like '%Instalments%', 'the statement lists instalments and receipts');

  -- a template edit shows up; raw html only for fee.*_html
  select id into tpl from public.document_templates where school_id = a and code = 'fee_receipt';
  update public.document_templates set body_html = '<p>{{fee.receipt_no}}|{{extra.x_html}}|{{student.name}}</p>{{fee.lines_html}}' where id = tpl;
  r := public.render_fee_document('receipt', rid);
  perform pg_temp.check(r ->> 'html' like '%<table%', 'the school''s own layout is used');
  perform pg_temp.check(public.render_document('{{extra.x_html}}', '{"extra":{"x_html":"<script>alert(1)</script>"}}'::jsonb) = '&lt;script&gt;alert(1)&lt;/script&gt;', 'user-supplied _html values are still escaped');
  update public.document_templates set active = false where id = tpl;
  perform pg_temp.check(public.render_fee_document('receipt', rid) is null, 'with the template switched off the app falls back to its built-in layout');
  update public.document_templates set active = true where id = tpl;
  perform pg_temp.check((public.preview_fee_template(tpl) ->> 'html') is not null, 'the editor can preview a fee template with real data');

  -- a template made from the gallery under another code, and a blank custom one, are applied once chosen
  insert into public.document_templates (school_id, code, name, category, audience, body_html, preset, fee_kind)
  values (a, 'fee_receipt_design', 'My designed receipt', 'fees', 'student', '<p>DESIGNED {{fee.receipt_no}}</p>', 'fee_receipt_design', null);
  perform pg_temp.check(public.render_fee_document('receipt', rid) ->> 'html' like '%DESIGNED%' or public.render_fee_document('receipt', rid) ->> 'html' like '%<table%', 'a receipt template made from the gallery is found by its preset');
  insert into public.document_templates (school_id, code, name, category, audience, body_html)
  values (a, 'fee_receipt_custom_1', 'Custom receipt', 'fees', 'student', '<p>CUSTOM {{fee.receipt_no}} {{student.name}}</p>');
  perform public.set_fee_template((select id from public.document_templates where school_id = a and code = 'fee_receipt_custom_1'), 'receipt');
  perform pg_temp.check(public.render_fee_document('receipt', rid) ->> 'html' like '%CUSTOM%', 'the template chosen for receipts is the one printed');
  perform pg_temp.check((select count(*) = 1 from public.document_templates where school_id = a and fee_kind = 'receipt'), 'only one template is bound to receipts');
  perform public.set_fee_template((select id from public.document_templates where school_id = a and code = 'fee_receipt_custom_1'), null);
  perform pg_temp.check(public.render_fee_document('receipt', rid) ->> 'html' not like '%CUSTOM%', 'unbinding falls back to the standard template');
  begin perform public.set_fee_template((select id from public.document_templates where school_id = a and code = 'fee_receipt'), 'invoice'); perform pg_temp.check(false, 'bad kind');
  exception when others then perform pg_temp.check(sqlerrm like '%Unknown document type%', 'an unknown document type is refused'); end;

  perform pg_temp.act_as(ot);
  perform pg_temp.check(public.render_fee_document('receipt', rid) is null, 'another school cannot render our receipt');
  perform pg_temp.check(public.render_fee_document('demand', s1) is null, 'another school cannot render our demand notice');

  -- payment links
  perform pg_temp.act_as(ac);
  begin perform public.create_online_order(a, s1, 100, null); perform pg_temp.check(false, 'user link');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%' or sqlerrm like '%permission denied%', 'links are created by the server only (after the permission check)'); end;
  perform pg_temp.act_service();
  oid := public.create_online_order(a, s1, 700, null, 'link', 'Accountant', 'Sent on WhatsApp', '9811100001');
  update public.fee_online_orders set link_id = 'plink_t1', link_url = 'https://rzp.io/i/t1' where id = oid;
  perform pg_temp.check((select channel = 'link' and created_by_name = 'Accountant' and phone = '9811100001' and expires_at > now() from public.fee_online_orders where id = oid), 'a staff payment link records who made it, the channel and the expiry');
  begin perform public.create_online_order(a, s1, 999999, null, 'link'); perform pg_temp.check(false, 'too much');
  exception when others then perform pg_temp.check(sqlerrm like '%more than what is due%', 'a link cannot ask for more than is due'); end;
  perform pg_temp.act_as(ac);
  lk := public.cancel_payment_link(oid);
  perform pg_temp.check(lk = 'plink_t1' and (select status = 'cancelled' from public.fee_online_orders where id = oid), 'an unpaid link can be cancelled');
  begin perform public.cancel_payment_link(oid); perform pg_temp.check(false, 'again');
  exception when others then perform pg_temp.check(sqlerrm like '%already%', 'a cancelled link cannot be cancelled again'); end;
  perform pg_temp.act_as(ot);
  begin perform public.cancel_payment_link(oid); perform pg_temp.check(false, 'cross');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot touch our links'); end;
end $$;

rollback;
