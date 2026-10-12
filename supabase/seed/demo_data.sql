-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO DATA for one school — admissions pipeline + fee structure + fee collection.
--
-- HOW TO RUN
--   1. Apply supabase/setup.sql first (all 13 migrations).
--   2. Create a school (Platform → Tenants → New) and at least one user with the Principal role.
--   3. Put the school's code below (v_code), paste this whole file into the Supabase SQL editor, Run.
--   4. Remove everything again with supabase/seed/demo_remove.sql.
--
-- What it creates (all marked "DEMO"):
--   • Settings: late fine, concession approval, sibling discount, seats per class, extra sections
--   • Fee structure for Nursery–10 (tuition monthly, admission, annual, exam) → dues for every student
--   • 39 students (3 per class) incl. 3 sibling pairs and 2 RTE students
--   • 6 enquiries and 16 admission applications in every state (received … admitted, waitlisted, rejected)
--   • Concessions (approved / pending / rejected), receipts (cash, UPI, split, cheque), advance, bounced cheque,
--     refunds (paid / approved / requested), waivers, extension, split instalment, promises to pay, day close
-- Also: 8 staff (one left, one blocked) and one blocked student.
-- It uses the real functions as the school's Principal, so every rule and audit entry is the same as in the app.
-- Run it ONCE; it stops if the demo students already exist.
-- ═══════════════════════════════════════════════════════════════════════════
do $demo$
declare
  v_code   text := 'YOUR-SCHOOL-CODE';           -- ← the school's code (see Platform → Tenants)

  sid uuid; uid uuid; sess uuid; sess_start date; yr int; mo int;
  boys text[] := array['Aarav','Vivaan','Aditya','Arjun','Reyansh','Krishna','Ishaan','Rohan','Kabir','Yash','Harsh','Ayush','Mohit','Nikhil','Sahil','Tanmay','Dev','Karan','Raghav','Pranav'];
  girls text[] := array['Ananya','Diya','Isha','Kavya','Meera','Nisha','Priya','Riya','Saanvi','Tanvi','Aisha','Pooja','Neha','Shreya','Sneha','Anjali','Kriti','Muskan','Palak','Simran'];
  surn text[] := array['Sharma','Verma','Singh','Yadav','Gupta','Mishra','Pandey','Tiwari','Khan','Ansari','Maurya','Rai','Srivastava','Chauhan','Kushwaha','Patel'];
  fath text[] := array['Rajesh','Sunil','Anil','Manoj','Vijay','Ramesh','Suresh','Dinesh','Mukesh','Ashok','Pramod','Rakesh','Sanjay','Deepak','Amit','Vinod'];
  moth text[] := array['Sunita','Anita','Rekha','Meena','Kavita','Seema','Poonam','Geeta','Savita','Ritu','Neelam','Pushpa','Usha','Manju','Rani','Sarita'];
  cnames text[] := array['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10'];
  collectors text[] := array['Sunita (Accounts)', 'Rakesh (Front office)'];
  cname text; cid uuid; secA uuid; secB uuid; i int; k int; n int;
  head_tui uuid; head_adm uuid; head_ann uuid; head_exm uuid;
  tier numeric; m int; d date; stu uuid; gender text; fn text; ln text; age int; dob date;
  student_ids uuid[] := '{}'; sids_class uuid[] := '{}';
  app uuid; f jsonb; r record; due_ids uuid[]; bal numeric; pay numeric; fine_total numeric; rid uuid; cq uuid; s_i uuid;
  c5 uuid; c6 uuid; c9 uuid; c1 uuid; marker text := 'DEMO';
  cnt_students int; cnt_apps int; cnt_receipts int; cnt_dues int;
begin
  -- ── Find the school and act as its Principal ──
  if v_code = 'YOUR-SCHOOL-CODE' then
    select count(*) into n from public.schools;
    if n = 1 then select code into v_code from public.schools;
    else raise exception 'Put your school code in v_code at the top of this script. Codes: %', (select string_agg(code, ', ') from public.schools);
    end if;
  end if;
  select id into sid from public.schools where code = v_code;
  if sid is null then raise exception 'No school with code "%".', v_code; end if;
  if exists (select 1 from public.students where school_id = sid and admission_no like 'DEMO-%') then
    raise notice 'Demo data is already present for "%". Run supabase/seed/demo_remove.sql first to start again.', v_code; return;
  end if;
  select mr.user_id into uid from public.member_roles mr join public.roles ro on ro.id = mr.role_id where mr.school_id = sid and ro.code = 'principal' limit 1;
  if uid is null then select user_id into uid from public.platform_admins limit 1; end if;
  if uid is null then raise exception 'The school has no Principal user yet. Add one under Settings → Team, then run this again.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'demo-seed@school.local')::text, true);

  select id, start_date into sess, sess_start from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then raise exception 'The school has no current session.'; end if;
  yr := extract(year from sess_start)::int; mo := extract(month from sess_start)::int;

  -- ── Settings ──
  insert into public.fee_settings (school_id, fine_enabled, fine_mode, fine_amount, fine_grace_days, fine_cap, concession_approval, advance_allowed, bounce_charge, sibling_percent, receipt_footer)
  values (sid, true, 'per_day', 5, 5, 200, true, true, 100, 10, 'Fees once paid are not refundable. Please keep this receipt.')
  on conflict (school_id) do update set fine_enabled = true, fine_mode = 'per_day', fine_amount = 5, fine_grace_days = 5, fine_cap = 200, concession_approval = true,
        advance_allowed = true, bounce_charge = 100, sibling_percent = 10, receipt_footer = excluded.receipt_footer;
  insert into public.admission_settings (school_id, offer_days, auto_sibling_discount) values (sid, 7, true)
  on conflict (school_id) do update set offer_days = 7, auto_sibling_discount = true;

  select id into head_tui from public.fee_heads where school_id = sid and name = 'Tuition Fee';
  select id into head_adm from public.fee_heads where school_id = sid and name = 'Admission Fee';
  select id into head_ann from public.fee_heads where school_id = sid and name = 'Annual Charges';
  select id into head_exm from public.fee_heads where school_id = sid and name = 'Exam Fee';
  if head_tui is null then insert into public.fee_heads (school_id, name, sort) values (sid, 'Tuition Fee', 0) returning id into head_tui; end if;
  if head_adm is null then insert into public.fee_heads (school_id, name, sort) values (sid, 'Admission Fee', 1) returning id into head_adm; end if;
  if head_ann is null then insert into public.fee_heads (school_id, name, sort) values (sid, 'Annual Charges', 2) returning id into head_ann; end if;
  if head_exm is null then insert into public.fee_heads (school_id, name, sort) values (sid, 'Exam Fee', 3) returning id into head_exm; end if;
  update public.fee_settings set sibling_head_id = head_tui where school_id = sid;

  -- ── Classes: seats, a second section in a few ──
  foreach cname in array cnames loop
    select id into cid from public.classes where school_id = sid and name = cname;
    if cid is null then insert into public.classes (school_id, name, sort) values (sid, cname, 100 + array_position(cnames, cname)) returning id into cid; end if;
    if not exists (select 1 from public.sections where class_id = cid) then insert into public.sections (school_id, class_id, name) values (sid, cid, 'A'); end if;
    update public.classes set seats = case when cname in ('Nursery','LKG','UKG') then 30 else 40 end where id = cid;
    if cname in ('6', '8', '10') and not exists (select 1 from public.sections where class_id = cid and name = 'B') then
      insert into public.sections (school_id, class_id, name) values (sid, cid, 'B');
    end if;
  end loop;
  -- class 6 is nearly full so seat control and the waitlist can be seen
  select id into c6 from public.classes where school_id = sid and name = '6';
  update public.classes set seats = 5 where id = c6;

  -- ── Fee structure ──
  foreach cname in array cnames loop
    select id into cid from public.classes where school_id = sid and name = cname;
    -- a class that already has a fee structure for this session keeps it
    continue when exists (select 1 from public.fee_plans where school_id = sid and session_id = sess and class_id = cid);
    tier := case when cname in ('Nursery','LKG','UKG') then 700 when cname in ('1','2','3','4','5') then 900 when cname in ('6','7','8') then 1200 else 1500 end;
    for m in 0..11 loop
      d := make_date(yr, mo, 10) + make_interval(months => m);
      insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount)
      values (sid, sess, cid, head_tui, to_char(d, 'Mon YYYY'), d, tier)
      on conflict do nothing;
    end loop;
    insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (sid, sess, cid, head_adm, 'One time', sess_start, tier * 3) on conflict do nothing;
    insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (sid, sess, cid, head_ann, 'Annual ' || to_char(sess_start, 'YYYY'), sess_start + 14, tier * 2) on conflict do nothing;
    insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (sid, sess, cid, head_exm, 'Half-yearly', make_date(yr, 9, 15), 400) on conflict do nothing;
    insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount) values (sid, sess, cid, head_exm, 'Annual exam', make_date(yr + 1, 2, 15), 500) on conflict do nothing;
  end loop;

  -- ── Students: 3 per class ──
  i := 0;
  foreach cname in array cnames loop
    select id into cid from public.classes where school_id = sid and name = cname;
    select id into secA from public.sections where class_id = cid and name = 'A';
    select id into secB from public.sections where class_id = cid and name = 'B';
    age := case cname when 'Nursery' then 3 when 'LKG' then 4 when 'UKG' then 5 else cname::int + 5 end;
    for k in 1..3 loop
      i := i + 1;
      gender := case when i % 2 = 0 then 'F' else 'M' end;
      fn := case when gender = 'F' then girls[1 + (i * 7) % 20] else boys[1 + (i * 3) % 20] end;
      ln := surn[1 + (i * 5) % 16];
      dob := make_date(yr - age, 1 + (i * 5) % 12, 1 + (i * 11) % 27);
      insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, roll_no, gender, dob, father_name, mother_name, guardian_phone, address, city, district, state, pincode,
                                   category, admission_date, status, medium, nationality)
      values (sid, 'DEMO-' || lpad(i::text, 3, '0'), fn, ln, cid, case when secB is not null and k = 3 then secB else secA end, k, gender, dob,
              fath[1 + (i * 3) % 16] || ' ' || ln, moth[1 + (i * 5) % 16] || ' ' || ln, '98' || lpad((10000000 + i * 7919)::text, 8, '0'),
              'House ' || (10 + i) || ', Gandhi Nagar', 'Lucknow', 'Lucknow', 'Uttar Pradesh', '2260' || lpad((i % 90 + 10)::text, 2, '0'),
              (array['General','OBC','SC','OBC','General'])[1 + i % 5], sess_start, 'active', 'hindi', 'Indian')
      returning id into stu;
      student_ids := student_ids || stu;
    end loop;
  end loop;
  -- sibling pairs: same parents and phone
  for r in select * from (values (5, 17), (9, 28), (14, 36)) v(a, b) loop
    update public.students s set father_name = x.father_name, mother_name = x.mother_name, guardian_phone = x.guardian_phone, last_name = x.last_name
      from public.students x where x.id = student_ids[r.a] and s.id = student_ids[r.b];
  end loop;
  -- RTE students
  update public.students set admission_category = 'rte' where id in (student_ids[3], student_ids[22]);

  -- ── Concessions (before dues so approved ones are billed) ──
  insert into public.student_concessions (school_id, student_id, kind, value, reason, category) values
    (sid, student_ids[3],  'percent', 100, 'RTE 25% quota', 'rte'),
    (sid, student_ids[22], 'percent', 100, 'RTE 25% quota', 'rte'),
    (sid, student_ids[8],  'percent', 20, 'Scholarship — 90% in last class', 'merit');
  insert into public.student_concessions (school_id, student_id, fee_head_id, kind, value, reason, category) values
    (sid, student_ids[11], head_tui, 'percent', 50, 'Teacher''s ward', 'staff_ward'),
    (sid, student_ids[20], head_tui, 'percent', 15, 'Father lost job', 'hardship'),
    (sid, student_ids[30], head_tui, 'amount', 200, 'State sports medal', 'sports');
  update public.student_concessions set status = 'approved' where student_id in (student_ids[3], student_ids[22], student_ids[8], student_ids[30]) and school_id = sid;
  update public.student_concessions set status = 'rejected', decision_note = 'Documents not submitted' where student_id = student_ids[20] and school_id = sid;
  -- the staff-ward concession stays PENDING so the approval screen has something to show
  update public.student_concessions set status = 'pending' where student_id = student_ids[11] and school_id = sid;

  -- ── Dues for everyone ──
  perform public.generate_dues(sid, sess);
  -- sibling rule for the second child of each pair
  perform public.apply_sibling_discount(sid, student_ids[17]);
  perform public.apply_sibling_discount(sid, student_ids[28]);
  perform public.apply_sibling_discount(sid, student_ids[36]);
  -- an extra charge for one class
  select id into c5 from public.classes where school_id = sid and name = '5';
  perform public.add_charge(sid, sess, '{}', c5, null, null, 'Annual day fee', current_date + 7, 150);
  perform public.apply_late_fines(sid, current_date);

  -- ── Collection: different kinds of payers ──
  for i in 1..array_length(student_ids, 1) loop
    s_i := student_ids[i];
    select coalesce(array_agg(id), '{}'), coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0)
      into due_ids, bal from public.fee_dues where student_id = s_i and due_date <= current_date and status <> 'paid';
    continue when bal <= 0 or cardinality(due_ids) = 0;
    continue when i % 10 in (6, 9);                                   -- defaulters: pay nothing
    pay := case when i % 10 in (0, 1, 2, 3, 8) then bal when i % 10 in (4, 5) then round(bal * 0.5) else round(bal * 0.25) end;
    continue when pay <= 0;
    if i % 10 = 8 then                                                -- split: cash + UPI
      perform public.collect_fee_v2(sid, s_i, jsonb_build_array(jsonb_build_object('mode', 'cash', 'amount', round(pay / 2)),
                                    jsonb_build_object('mode', 'upi', 'amount', pay - round(pay / 2), 'reference', 'UPI' || (400000 + i * 31))),
                                    due_ids, 0, current_date - (i % 20), 'Demo: split payment', collectors[1 + i % 2], 0);
    elsif i in (5, 15, 25, 35) then                                   -- cheques
      perform public.collect_fee_v2(sid, s_i, jsonb_build_array(jsonb_build_object('mode', 'cheque', 'amount', pay, 'cheque_no', '5560' || lpad(i::text, 2, '0'),
                                    'bank', (array['SBI','PNB','HDFC','Bank of Baroda'])[1 + i % 4], 'cheque_date', current_date - (i % 10))),
                                    due_ids, 0, current_date - (i % 10), 'Demo: cheque', collectors[1], 0);
    else
      perform public.collect_fee_v2(sid, s_i, jsonb_build_array(jsonb_build_object('mode', (array['cash','upi','bank_transfer','card'])[1 + i % 4],
                                    'amount', pay, 'reference', case when i % 4 = 0 then '' else 'REF' || (700000 + i * 17) end)),
                                    due_ids, 0, current_date - (i % 25), 'Demo payment', collectors[1 + i % 2], 0);
    end if;
  end loop;

  -- cheque life cycle: 5 cleared, 15 deposited, 25 received, 35 bounced
  for r in select c.id, c.student_id from public.fee_cheques c where c.school_id = sid order by c.created_at loop
    if r.student_id = student_ids[5] then perform public.set_cheque_status(r.id, 'cleared', current_date - 2);
    elsif r.student_id = student_ids[15] then perform public.set_cheque_status(r.id, 'deposited', current_date - 1);
    elsif r.student_id = student_ids[35] then perform public.set_cheque_status(r.id, 'bounced', current_date - 1, 'Insufficient funds');
    end if;
  end loop;

  -- one family pays the whole year and keeps an advance
  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues where student_id = student_ids[1] and status <> 'paid';
  if bal > 0 then
    perform public.collect_fee_v2(sid, student_ids[1], jsonb_build_array(jsonb_build_object('mode', 'bank_transfer', 'amount', bal + 2000, 'reference', 'NEFT2026ADV01')),
                                  null, 0, current_date - 3, 'Demo: full-year payment with advance', collectors[1], 0);
  end if;

  -- ── Exceptions the principal handles ──
  -- waive a fine and a due
  select d.id into rid from public.fee_dues d where d.student_id = student_ids[7] and d.fine > 0 and d.status <> 'paid' order by d.due_date limit 1;
  if rid is not null then perform public.waive_fine(rid, null, 'Parent was in hospital'); end if;
  select d.id into rid from public.fee_dues d where d.student_id = student_ids[13] and d.status <> 'paid' and d.paid = 0 order by d.due_date limit 1;
  if rid is not null then perform public.waive_due(rid, 200, 'Principal''s discretion — two children in school'); end if;
  -- custom fee for a student
  select d.id into rid from public.fee_dues d join public.fee_heads h on h.id = d.fee_head_id where d.student_id = student_ids[16] and h.name = 'Annual Charges' and d.paid = 0 limit 1;
  if rid is not null then perform public.adjust_due_amount(rid, 1500, 'Reduced annual charges agreed with the parent'); end if;
  -- extension
  select coalesce(array_agg(d.id), '{}') into due_ids from public.fee_dues d where d.student_id = student_ids[26] and d.status <> 'paid' and d.due_date between current_date - 15 and current_date + 15;
  if cardinality(due_ids) > 0 then perform public.extend_dues(sid, due_ids, current_date + 20, 'Harvest season — parent asked for time'); end if;
  -- split an overdue instalment into three
  select d.id into rid from public.fee_dues d where d.student_id = student_ids[27] and d.paid = 0 and d.status <> 'paid' and d.due_date < current_date and d.kind = 'plan' order by d.amount desc limit 1;
  if rid is not null then perform public.split_due(rid, 3, current_date + 5, 30, 'Family hardship — instalments agreed'); end if;

  -- refunds: paid / approved / requested
  for r in select * from (values (student_ids[2], 300, 'paid'), (student_ids[4], 200, 'approved'), (student_ids[10], 150, 'requested')) v(s, a, st) loop
    select d.id into rid from public.fee_dues d where d.student_id = r.s and d.paid >= r.a order by d.due_date limit 1;
    continue when rid is null;
    perform public.reverse_payment(rid, r.a, 'Paid twice by mistake');
    stu := public.request_refund(sid, r.s, r.a, 'Excess fee received — refund to parent');
    if r.st in ('paid', 'approved') then perform public.decide_refund(stu, true, 'Verified with the receipts'); end if;
    if r.st = 'paid' then perform public.pay_refund(stu, 'bank_transfer', 'REFUND-NEFT-001', current_date - 1); end if;
  end loop;

  -- promises to pay for some defaulters
  for r in select s.id, row_number() over (order by s.admission_no) rn from public.students s where s.school_id = sid and s.admission_no like 'DEMO-%'
           and exists (select 1 from public.fee_dues d where d.student_id = s.id and d.due_date < current_date and d.paid = 0 and d.status <> 'paid') limit 4 loop
    perform public.add_fee_followup(sid, r.id, current_date + (r.rn::int * 2), 1000 * r.rn, 'Parent promised on call: ' || (array['salary day','after harvest','next week','after Diwali'])[1 + r.rn::int % 4]);
  end loop;

  -- day close for yesterday
  perform public.close_day(sid, current_date - 1, collectors[1], greatest(public.cash_expected(sid, current_date - 1, collectors[1]) - 50, 0), 'Demo: ₹50 short');

  -- ═════════════════ Admissions ═════════════════
  select id into c1 from public.classes where school_id = sid and name = '1';
  select id into c9 from public.classes where school_id = sid and name = '9';

  insert into public.enquiries (school_id, student_name, class_sought, parent_name, phone, source, status, follow_up_date, notes) values
    (sid, 'Ayaan Khan',     'LKG', 'Imran Khan',    '9810011001', 'Walk-in',            'new',       current_date,     'DEMO · wants morning batch'),
    (sid, 'Mishti Sharma',  '1',   'Pankaj Sharma', '9810011002', 'Referral',           'contacted', current_date - 2, 'DEMO · referred by a current parent'),
    (sid, 'Rudra Pratap',   '6',   'Ajay Pratap',   '9810011003', 'Google',             'visited',   current_date + 1, 'DEMO · visited school, liked labs'),
    (sid, 'Zoya Ansari',    '9',   'Faisal Ansari', '9810011004', 'Facebook/Instagram', 'test',      current_date + 3, 'DEMO · entrance on Saturday'),
    (sid, 'Lakshya Verma',  '3',   'Sandeep Verma', '9810011005', 'Banner/Hoarding',    'lost',      null,             'DEMO · joined another school'),
    (sid, 'Navya Mishra',   'UKG', 'Alok Mishra',   '9810011006', 'WhatsApp',           'new',       current_date - 1, 'DEMO · asked about transport');

  -- 16 applications: class 6 (5 seats, nearly full) and 1 / 9
  for i in 1..16 loop
    gender := case when i % 2 = 0 then 'F' else 'M' end;
    fn := case when gender = 'F' then girls[1 + (i * 9) % 20] else boys[1 + (i * 7) % 20] end;
    ln := surn[1 + (i * 3) % 16];
    f := jsonb_build_object('first_name', fn, 'last_name', ln, 'gender', gender, 'father_name', fath[1 + (i * 5) % 16] || ' ' || ln, 'mother_name', moth[1 + (i * 7) % 16] || ' ' || ln,
         'guardian_phone', '97' || lpad((20000000 + i * 6007)::text, 8, '0'), 'city', 'Lucknow', 'district', 'Lucknow', 'state', 'Uttar Pradesh', 'category', (array['General','OBC','SC'])[1 + i % 3],
         'medium', 'hindi', 'previous_school', 'Little Angels School', 'demo', true,
         'dob', make_date(yr - case when i <= 10 then 11 when i <= 13 then 6 else 14 end, 1 + i % 12, 1 + (i * 3) % 27)::text);
    -- application 16 is the brother of student 5; application 15 of student 9 → sibling discount at admit
    if i = 16 then f := f || jsonb_build_object('father_name', (select father_name from public.students where id = student_ids[5]), 'mother_name', (select mother_name from public.students where id = student_ids[5]),
                                                 'guardian_phone', (select guardian_phone from public.students where id = student_ids[5]), 'last_name', (select last_name from public.students where id = student_ids[5])); end if;
    app := public.create_application(sid, case when i <= 10 then c6 when i <= 13 then c1 else c9 end, null, f, i in (4, 12), case when i in (4, 12) then 'RTE/UP/2026/' || (1000 + i) end,
                                     (array['Walk-in','Online','Referral','Google','Online'])[1 + i % 5]);
    -- documents
    insert into public.application_documents (school_id, application_id, doc_type, status, due_by) values
      (sid, app, 'transfer_certificate', 'pending', current_date + (i % 15)),
      (sid, app, 'birth_certificate', case when i % 3 = 0 then 'not_applicable' else 'pending' end, current_date + 7)
    on conflict do nothing;

    -- spread across the workflow
    if i in (1, 2, 3) then null;                                                                 -- received
    elsif i in (4, 5) then update public.admission_applications set status = 'under_review' where id = app;
    elsif i in (6, 7) then update public.admission_applications set test_on = current_date + i, interview_on = current_date + i, status = 'test_scheduled' where id = app;
    elsif i in (8, 9, 10) then
      update public.admission_applications set test_on = current_date - 5, test_marks = 30 + i * 2, test_max = 50, fee_amount = 300, fee_paid_on = current_date - 6, fee_mode = 'cash' where id = app;
      update public.admission_applications set status = 'approved', decision_note = 'Good performance in the entrance test' where id = app;
      if i = 10 then update public.admission_applications set offer_valid_till = current_date + 1 where id = app; end if;      -- offer about to lapse
    elsif i = 11 then
      update public.admission_applications set status = 'waitlisted', decision_note = 'Seats full — waitlisted' where id = app;
    elsif i = 12 then
      update public.admission_applications set status = 'waitlisted', decision_note = 'RTE verification pending' where id = app;
    elsif i = 13 then
      update public.admission_applications set status = 'rejected', decision_note = 'Age below the minimum for the class' where id = app;
    elsif i = 14 then
      update public.admission_applications set status = 'cancelled', decision_note = 'Parents withdrew the application' where id = app;
    elsif i in (15, 16) then
      update public.admission_applications set test_on = current_date - 10, test_marks = 42, test_max = 50 where id = app;
      update public.admission_applications set status = 'approved', decision_note = 'Approved' where id = app;
      perform public.admit_application(app, case when i = 15 then c9 else c6 end,
              (select id from public.sections where class_id = case when i = 15 then c9 else c6 end order by name limit 1), null, current_date - 4, null);
    end if;

    -- follow-ups on a few
    if i in (1, 2) then perform public.add_followup(sid, app, null, current_date - i, 'call', 'Documents reminder'); end if;
    if i in (4, 8) then perform public.add_followup(sid, app, null, current_date + i, 'whatsapp', 'Share fee details and last date'); end if;
  end loop;
  perform public.add_followup(sid, null, (select id from public.enquiries where school_id = sid and student_name = 'Ayaan Khan'), current_date, 'call', 'First call to the parent');
  perform public.add_followup(sid, null, (select id from public.enquiries where school_id = sid and student_name = 'Rudra Pratap'), current_date + 2, 'visit', 'Invite for a campus tour');

  -- ═════════════════ Staff and a blocked student ═════════════════
  insert into public.staff (school_id, emp_code, name, designation, department, kind, gender, phone, email, joining_date, qualification, earnings, deductions, status, leaving_date)
  select sid, 'DEMO-E' || lpad(x.n::text, 2, '0'), x.name, x.des, x.dept, x.kind, x.g, '97' || lpad((30000000 + x.n * 4813)::text, 8, '0'),
         lower(replace(x.name, ' ', '.')) || '@demo-school.example', current_date - (x.n * 170), x.q,
         jsonb_build_array(jsonb_build_object('name', 'Basic', 'amount', x.basic), jsonb_build_object('name', 'HRA', 'amount', round(x.basic * 0.2))),
         jsonb_build_array(jsonb_build_object('name', 'PF', 'amount', round(x.basic * 0.12))), x.st, case when x.st = 'left' then current_date - 40 end
    from (values
      (1, 'Meena Srivastava', 'PGT Physics',     'Science',  'teaching',     'F', 'M.Sc., B.Ed.', 32000, 'active'),
      (2, 'Ramesh Pandey',    'TGT Mathematics', 'Maths',    'teaching',     'M', 'M.Sc., B.Ed.', 28000, 'active'),
      (3, 'Anjali Mishra',    'PRT',             'Primary',  'teaching',     'F', 'B.A., B.El.Ed.', 18000, 'active'),
      (4, 'Sanjay Verma',     'Accountant',      'Office',   'non_teaching', 'M', 'B.Com.', 22000, 'active'),
      (5, 'Poonam Yadav',     'Receptionist',    'Office',   'non_teaching', 'F', '12th', 14000, 'active'),
      (6, 'Mohd. Irfan',      'Bus driver',      'Transport','support',      'M', '10th', 13000, 'active'),
      (7, 'Sunil Kumar',      'Peon',            'Support',  'support',      'M', '8th', 10000, 'active'),
      (8, 'Kavita Singh',     'TGT Hindi',       'Hindi',    'teaching',     'F', 'M.A., B.Ed.', 26000, 'left')
    ) as x(n, name, des, dept, kind, g, q, basic, st)
  on conflict do nothing;
  -- one working staff member and one student are blocked, so the "blocked" screens have something to show
  update public.staff set blocked_at = now() - interval '2 days', block_reason = 'Suspended pending inquiry', blocked_by_name = 'demo-seed@school.local'
   where school_id = sid and emp_code = 'DEMO-E07';
  update public.students set blocked_at = now() - interval '1 day', block_reason = 'Fee default — meeting with parents called', blocked_till = current_date + 7, blocked_by_name = 'demo-seed@school.local'
   where id = student_ids[26];

  -- ── Summary ──
  select count(*) into cnt_students from public.students where school_id = sid and (admission_no like 'DEMO-%' or application_id is not null);
  select count(*) into cnt_apps from public.admission_applications where school_id = sid and form ? 'demo';
  select count(*) into cnt_receipts from public.fee_receipts where school_id = sid;
  select count(*) into cnt_dues from public.fee_dues where school_id = sid;
  raise notice 'DEMO DATA READY for "%": % students, % applications, % fee dues, % receipts. Open Admissions → Pipeline and Fees → Overview.', v_code, cnt_students, cnt_apps, cnt_dues, cnt_receipts;
end
$demo$;
