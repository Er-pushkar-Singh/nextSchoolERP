-- Admissions & Fees add-ons test (step 11). Run on a THROWAWAY database after all migrations:
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/addons.test.sql
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
  ('adadadad-0000-0000-0000-000000000001', 'ad-owner@test.dev'),
  ('adadadad-0000-0000-0000-000000000002', 'ad-principal@test.dev'),
  ('adadadad-0000-0000-0000-000000000003', 'ad-front@test.dev'),
  ('adadadad-0000-0000-0000-000000000004', 'ad-acct@test.dev'),
  ('adadadad-0000-0000-0000-000000000005', 'ad-other@test.dev')
on conflict do nothing;
insert into public.platform_admins (user_id, role) values ('adadadad-0000-0000-0000-000000000001', 'owner')
on conflict (user_id) do update set role = excluded.role;

do $$
declare ow uuid := 'adadadad-0000-0000-0000-000000000001'; pr uuid := 'adadadad-0000-0000-0000-000000000002';
  fo uuid := 'adadadad-0000-0000-0000-000000000003'; ac uuid := 'adadadad-0000-0000-0000-000000000004'; ot uuid := 'adadadad-0000-0000-0000-000000000005';
  a uuid; b uuid; c6 uuid; c7 uuid; sec6 uuid; sess uuid; sess2 uuid; head uuid; s1 uuid; s2 uuid; app1 uuid; app2 uuid; app3 uuid; app4 uuid; fid uuid; enq uuid; d1 uuid; stu uuid; n int; r jsonb;
  sfx text := substr(md5(random()::text), 1, 6);
begin
  perform pg_temp.act_as(ow);
  a := public.create_school('Add A', 'adda-' || sfx);
  b := public.create_school('Add B', 'addb-' || sfx);
  perform pg_temp.act_admin();
  insert into public.school_members (school_id, user_id, name) values (a, pr, 'Principal'), (a, fo, 'Front'), (a, ac, 'Accountant'), (b, ot, 'Other');
  insert into public.member_roles (school_id, user_id, role_id)
    select a, x.u, r.id from (values (pr, 'principal'), (fo, 'front_office'), (ac, 'accountant')) x(u, c) join public.roles r on r.school_id = a and r.code = x.c;
  insert into public.member_roles (school_id, user_id, role_id) select b, ot, id from public.roles where school_id = b and code = 'principal';
  select id into c6 from public.classes where school_id = a and name = '6';
  select id into c7 from public.classes where school_id = a and name = '7';
  select id into sec6 from public.sections where class_id = c6 limit 1;
  select id into sess from public.sessions where school_id = a and is_current;
  select id into head from public.fee_heads where school_id = a and name = 'Tuition Fee';
  update public.classes set seats = 2 where id = c6;
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (a, sess, c6, head, 'Apr', current_date + 10, 1200);
  insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, father_name, mother_name, guardian_phone)
    values (a, 'E1', 'Riya', 'Gupta', c7, null, 'Sunil Gupta', 'Meena Gupta', '9822200001') returning id into s1;

  -- ── Follow-ups ──
  perform pg_temp.act_as(fo);
  app1 := public.create_application(a, c6, null, jsonb_build_object('first_name', 'Tara', 'last_name', 'Gupta', 'dob', '2014-05-01', 'father_name', 'Sunil Gupta', 'mother_name', 'Meena Gupta', 'guardian_phone', '9822200001'), false, null, 'Walk-in');
  app2 := public.create_application(a, c6, null, jsonb_build_object('first_name', 'Dev', 'dob', '2014-06-01', 'father_name', 'A'), false, null, 'Referral');
  app3 := public.create_application(a, c6, null, jsonb_build_object('first_name', 'Esha', 'dob', '2014-07-01', 'father_name', 'B'), false, null, 'Online');
  app4 := public.create_application(a, c6, null, jsonb_build_object('first_name', 'Farhan', 'dob', '2014-08-01', 'father_name', 'C'), false, null, 'Online');
  fid := public.add_followup(a, app1, null, current_date, 'call', 'Ask about documents');
  perform pg_temp.check(fid is not null, 'front office adds a follow-up');
  begin perform public.add_followup(a, app1, null, null, 'call', 'x'); perform pg_temp.check(false, 'no date');
  exception when others then perform pg_temp.check(sqlerrm like '%date%', 'a follow-up needs a date'); end;
  perform public.complete_followup(fid, 'Will bring TC on Monday', current_date + 4, 'Check TC');
  perform pg_temp.check((select done and outcome like 'Will bring%' from public.application_followups where id = fid) and exists (select 1 from public.application_followups where application_id = app1 and not done and due_on = current_date + 4), 'completing records the outcome and books the next one');
  begin perform public.complete_followup(fid, 'again'); perform pg_temp.check(false, 'twice');
  exception when others then perform pg_temp.check(sqlerrm like '%already done%', 'a follow-up is completed only once'); end;
  perform pg_temp.act_as(ac);
  begin perform public.add_followup(a, app1, null, current_date, 'call', 'x'); perform pg_temp.check(false, 'acct');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'the accountant cannot add admission follow-ups'); end;
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) = 0 from public.application_followups), 'another school sees no follow-ups');
  begin perform public.add_followup(a, app1, null, current_date, 'call', 'x'); perform pg_temp.check(false, 'cross');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot add a follow-up here'); end;

  -- ── Siblings and the fee rule ──
  perform pg_temp.act_admin();
  perform pg_temp.check((select count(*) = 1 from public.application_siblings(app1)), 'an applicant is matched with the sibling already studying (same phone)');
  perform pg_temp.check((select count(*) = 0 from public.application_siblings(app2)), 'a different family is not matched');

  -- ── Offer validity, tests, bulk status ──
  perform pg_temp.act_as(pr);
  insert into public.admission_settings (school_id, offer_days) values (a, 5);
  insert into public.fee_settings (school_id, sibling_percent, sibling_head_id) values (a, 10, head)
    on conflict (school_id) do update set sibling_percent = 10, sibling_head_id = head;
  update public.admission_applications set status = 'approved' where id = app2;
  perform pg_temp.check((select offer_valid_till = current_date + 5 from public.admission_applications where id = app2), 'approval stamps the offer validity from the school setting');
  perform pg_temp.act_as(fo);
  n := public.record_test_marks(a, jsonb_build_array(jsonb_build_object('id', app1, 'marks', 41, 'max', 50, 'test_on', current_date), jsonb_build_object('id', app3, 'marks', 22, 'max', 50)));
  perform pg_temp.check(n = 2 and (select test_marks = 41 from public.admission_applications where id = app1), 'test marks for many applicants in one go');
  r := public.bulk_application_status(a, array[app1, app3], 'under_review');
  perform pg_temp.check((r ->> 'ok')::int = 2, 'bulk: both move to under review');
  r := public.bulk_application_status(a, array[app4], 'approved');
  perform pg_temp.check((r ->> 'ok')::int = 0 and jsonb_array_length(r -> 'failed') = 1, 'bulk: front office cannot approve; the failure is reported per application');
  begin perform public.bulk_application_status(a, array[app4], 'admitted'); perform pg_temp.check(false, 'bulk admit');
  exception when others then perform pg_temp.check(sqlerrm like '%bulk%', 'admitted cannot be set in bulk'); end;
  perform pg_temp.act_as(pr);
  r := public.bulk_application_status(a, array[app1, app3, app4], 'approved');
  perform pg_temp.check((r ->> 'ok')::int = 3, 'bulk: principal approves several');
  perform pg_temp.check((select (r2 ->> 'avg_days_to_decision') is not null from (select public.admission_pipeline(a, sess) r2) x), 'pipeline report works');
  perform pg_temp.check((public.admission_pipeline(a, sess) -> 'by_status' ->> 'approved')::int = 4, 'pipeline counts four approved');

  -- seats: class 6 has 2 seats, 4 approved → admitting is for later; promote_waitlist needs waitlisted ones
  update public.admission_applications set status = 'waitlisted' where id = app3;
  update public.admission_applications set status = 'waitlisted' where id = app4;
  perform pg_temp.check((select waitlist_no from public.admission_applications where id = app3) = 1 and (select waitlist_no from public.admission_applications where id = app4) = 2, 'waitlist numbers are 1 and 2');
  n := public.promote_waitlist(a, c6, sess);
  perform pg_temp.check((select status = 'waitlisted' from public.admission_applications where id = app3), 'no free seat: nobody is promoted (2 seats, 2 approved)');
  update public.classes set seats = 3 where id = c6;
  n := public.promote_waitlist(a, c6, sess);
  perform pg_temp.check(n = 1 and (select status = 'approved' from public.admission_applications where id = app3), 'one seat frees: the first on the waitlist is promoted');
  perform pg_temp.check((select status = 'waitlisted' from public.admission_applications where id = app4), 'the next one keeps waiting');

  -- offers lapse
  update public.admission_applications set offer_valid_till = current_date - 1 where id = app2;
  n := public.lapse_expired_offers(a);
  perform pg_temp.check(n = 1 and (select status = 'cancelled' from public.admission_applications where id = app2), 'an expired offer is cancelled and the seat is released');

  -- ── Admit with the sibling rule ──
  stu := public.admit_application(app1, c6, sec6, null, null, 1);
  perform pg_temp.check(exists (select 1 from public.student_concessions where student_id = stu and category = 'sibling' and value = 10 and status = 'approved'), 'admitting a sibling applies the school''s sibling discount');
  perform pg_temp.check((select concession = 120 from public.fee_dues where student_id = stu limit 1), 'and the new dues already carry it (10% of 1200)');
  perform pg_temp.check((select count(*) = 1 from public.student_siblings(a, stu)), 'the new student lists the elder sibling');
  perform pg_temp.check(public.apply_sibling_discount(a, stu) = false, 'the rule is applied once only');
  perform pg_temp.check((select count(*) >= 1 from public.admission_fee_quote(app3)), 'the fee quote lists what the family will be asked to pay');

  -- ── Promise to pay ──
  perform pg_temp.act_as(ac);
  fid := public.add_fee_followup(a, stu, current_date + 3, 500, 'Father will pay on salary day');
  perform pg_temp.check(fid is not null, 'accountant records a promise to pay');
  begin perform public.add_fee_followup(a, stu, current_date - 10, 1, 'x'); perform pg_temp.check(false, 'past');
  exception when others then perform pg_temp.check(sqlerrm like '%today%', 'a promise cannot be in the past'); end;
  perform public.close_fee_followup(fid, 'kept');
  perform pg_temp.check((select status = 'kept' from public.fee_followups where id = fid), 'promise marked kept');
  perform pg_temp.act_as(ot);
  perform pg_temp.check((select count(*) = 0 from public.fee_followups), 'another school sees no promises');
  -- the daily job settles promises whose date has passed
  perform pg_temp.act_admin();
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount) values (a, sess, s1, head, 'Old due', current_date - 20, 500);
  insert into public.fee_followups (school_id, student_id, promised_on, amount) values (a, s1, current_date - 3, 500);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  perform pg_temp.check(public.mark_broken_promises() >= 1, 'the daily job closes promises that are past their date');
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  perform pg_temp.check(exists (select 1 from public.fee_followups where student_id = s1 and promised_on = current_date - 3 and status = 'broken'), 'a promise with the money still owing is marked broken');

  -- ── Structure tools ──
  perform pg_temp.act_as(ac);
  n := public.copy_fee_plans(a, sess, c6, array[c7]);
  perform pg_temp.check(n = 1 and exists (select 1 from public.fee_plans where class_id = c7 and amount = 1200), 'copy a class''s fee plan to other classes');
  n := public.copy_fee_plans(a, sess, c6, array[c7]);
  perform pg_temp.check(n = 0, 'copying twice adds nothing');
  perform pg_temp.act_admin();
  insert into public.sessions (school_id, name, start_date, end_date, is_current) values (a, '2098-99', date '2098-04-01', date '2099-03-31', false) returning id into sess2;
  perform pg_temp.act_as(ac);
  n := public.copy_session_plans(a, sess, sess2, 72, 10);
  perform pg_temp.check(n = 2 and exists (select 1 from public.fee_plans where session_id = sess2 and class_id = c6 and amount = 1320), 'copy a whole session''s structure with a 10% increase');

  -- ── Split an instalment ──
  select id into d1 from public.fee_dues where student_id = s1 limit 1;
  perform pg_temp.act_admin();
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount) values (a, sess, s1, head, 'Big instalment', current_date - 5, 1000) returning id into d1;
  perform pg_temp.act_as(ac);
  n := public.split_due(d1, 3, current_date + 5, 30, 'Family hardship');
  perform pg_temp.check(n = 3 and (select count(*) = 3 and sum(amount) = 1000 from public.fee_dues where student_id = s1 and label like 'Big instalment%'), 'an instalment is split into 3 parts that add up to the original');
  begin perform public.split_due(d1, 3, current_date, 30, ''); perform pg_temp.check(false, 'no reason');
  exception when others then perform pg_temp.check(sqlerrm like '%reason%', 'splitting needs a reason'); end;
  perform pg_temp.check((select count(*) >= 1 from public.fee_outstanding(a, sess)), 'outstanding by class and head');
  perform pg_temp.check((select count(*) = 1 from public.student_siblings(a, s1)), 'the elder sibling lists the new student');

  -- ── Isolation ──
  perform pg_temp.act_as(ot);
  begin perform public.split_due(d1, 2, current_date, 10, 'x'); perform pg_temp.check(false, 'cross');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot split our dues'); end;
  begin perform public.promote_waitlist(a, c6, sess); perform pg_temp.check(false, 'cross promote');
  exception when others then perform pg_temp.check(sqlerrm like '%not allowed%', 'another school cannot promote our waitlist'); end;
  begin perform public.sibling_discount_core(a, s1); perform pg_temp.check(false, 'core');
  exception when others then perform pg_temp.check(sqlerrm not like 'FAIL%', 'the internal sibling function is not callable'); end;
end $$;

rollback;
