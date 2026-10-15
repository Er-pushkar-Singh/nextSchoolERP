-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO DATA, SCALE UP — for a school that should look "full".
--
-- Run AFTER supabase/seed/demo_data.sql (it needs the classes, fee structure and demo staff that script creates).
-- Adds, all marked so that demo_remove.sql takes it away again:
--   • ~30 students per class (SCALE-0001 …) with parents, categories, a few sibling pairs, dues, and fee payments in mixed modes
--   • 30 days of attendance for them (some students low) and today partly marked by scan
--   • two exams with marks for every student (some absent), one published
--   • homework, notices, a library with issues (returned, current, overdue) and reservations
--   • health records, medical-room visits and check-ups; discipline incidents and counselling notes
--   • two hostels (boys / girls) with rooms, boarders, three nights of roll call, outpasses, visitors and a mess menu
--   • staff leave (approved, pending, rejected), staff attendance for 25 days, last month's payroll (draft, to approve)
--   • visitors, calls, enquiries, vouchers for three months, more students on the buses
-- Change per_class below for a bigger or smaller school. Run it ONCE.
-- ═══════════════════════════════════════════════════════════════════════════
do $scale$
declare
  v_code text := 'YOUR-SCHOOL-CODE';
  per_class int := 30;

  sid uuid; uid uuid; sess uuid; sess_start date; n int; i int;
  boys text[] := array['Aarav','Vivaan','Aditya','Arjun','Reyansh','Krishna','Ishaan','Rohan','Kabir','Yash','Harsh','Ayush','Mohit','Nikhil','Sahil','Tanmay','Dev','Karan','Raghav','Pranav','Shivam','Aman','Vedant','Lakshya','Anuj','Naman','Parth','Rudra','Atharv','Om'];
  girls text[] := array['Ananya','Diya','Isha','Kavya','Meera','Nisha','Priya','Riya','Saanvi','Tanvi','Aisha','Pooja','Neha','Shreya','Sneha','Anjali','Kriti','Muskan','Palak','Simran','Khushi','Aadhya','Myra','Navya','Prisha','Anika','Sana','Zoya','Ira','Tara'];
  surn text[] := array['Sharma','Verma','Singh','Yadav','Gupta','Mishra','Pandey','Tiwari','Khan','Ansari','Maurya','Rai','Srivastava','Chauhan','Kushwaha','Patel','Saxena','Dubey','Shukla','Rathore'];
  fath text[] := array['Rajesh','Sunil','Anil','Manoj','Vijay','Ramesh','Suresh','Dinesh','Mukesh','Ashok','Pramod','Rakesh','Sanjay','Deepak','Amit','Vinod','Ajay','Sandeep','Rahul','Naresh'];
  moth text[] := array['Sunita','Anita','Rekha','Meena','Kavita','Seema','Poonam','Geeta','Savita','Ritu','Neelam','Pushpa','Usha','Manju','Rani','Sarita','Asha','Shobha','Madhu','Lata'];
  collectors text[] := array['Sunita (Accounts)', 'Rakesh (Front office)'];
  r record; stu uuid; cid uuid; secs uuid[]; k int; gender text; fn text; ln text; age int; dob date; cname text; due_ids uuid[]; bal numeric; pay numeric; s_i uuid; ex1 uuid; ex2 uuid;
  tt date := current_date;
begin
  if v_code = 'YOUR-SCHOOL-CODE' then
    select count(*) into n from public.schools;
    if n = 1 then select code into v_code from public.schools;
    else raise exception 'Put your school code in v_code at the top. Codes: %', (select string_agg(code, ', ') from public.schools); end if;
  end if;
  select id into sid from public.schools where code = v_code;
  if sid is null then raise exception 'No school with code "%".', v_code; end if;
  if exists (select 1 from public.students where school_id = sid and admission_no like 'SCALE-%') then
    raise notice 'Scale data is already present. Run demo_remove.sql first.'; return;
  end if;
  select mr.user_id into uid from public.member_roles mr join public.roles ro on ro.id = mr.role_id where mr.school_id = sid and ro.code = 'principal' limit 1;
  if uid is null then select user_id into uid from public.platform_admins limit 1; end if;
  if uid is null then raise exception 'The school has no Principal user yet.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'demo-seed@school.local')::text, true);
  select id, start_date into sess, sess_start from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then raise exception 'The school has no current session.'; end if;

  -- ── Students ──
  i := 0;
  for r in select c.id, c.name, c.sort from public.classes c where c.school_id = sid order by c.sort, c.name loop
    cid := r.id; cname := r.name;
    select array_agg(id order by name) into secs from public.sections where class_id = cid;
    if secs is null then insert into public.sections (school_id, class_id, name) values (sid, cid, 'A') returning id into stu; secs := array[stu]; end if;
    age := case when cname ~ '^[0-9]+$' then cname::int + 5 when cname ilike 'nursery%' then 3 when cname ilike 'lkg%' then 4 when cname ilike 'ukg%' then 5 else 8 end;
    for k in 1..per_class loop
      i := i + 1;
      gender := case when i % 2 = 0 then 'F' else 'M' end;
      fn := case when gender = 'F' then girls[1 + (i * 7) % 30] else boys[1 + (i * 3) % 30] end;
      ln := surn[1 + (i * 5) % 20];
      dob := make_date(extract(year from sess_start)::int - age, 1 + (i * 5) % 12, 1 + (i * 11) % 27);
      insert into public.students (school_id, admission_no, first_name, last_name, class_id, section_id, roll_no, gender, dob, father_name, mother_name, guardian_phone, address, city, district, state, pincode,
                                   category, admission_date, status, medium, nationality)
      values (sid, 'SCALE-' || lpad(i::text, 4, '0'), fn, ln, cid, secs[1 + (k - 1) % cardinality(secs)], ((k - 1) / cardinality(secs)) + 1, gender, dob,
              fath[1 + (i * 3) % 20] || ' ' || ln, moth[1 + (i * 5) % 20] || ' ' || ln, '97' || lpad((20000000 + i * 6007)::text, 8, '0'),
              'House ' || (100 + i) || ', ' || (array['Gomti Nagar','Aliganj','Indira Nagar','Mahanagar','Rajajipuram','Chowk'])[1 + i % 6], 'Lucknow', 'Lucknow', 'Uttar Pradesh', '2260' || lpad((i % 90 + 10)::text, 2, '0'),
              (array['General','OBC','SC','OBC','General','ST'])[1 + i % 6], sess_start, 'active', case when i % 3 = 0 then 'english' else 'hindi' end, 'Indian');
    end loop;
  end loop;
  -- siblings: every 40th student shares parents with the next one
  update public.students s set father_name = x.father_name, mother_name = x.mother_name, guardian_phone = x.guardian_phone, last_name = x.last_name
    from (select id, father_name, mother_name, guardian_phone, last_name, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') x,
         (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') y
   where s.id = y.id and x.rn = y.rn - 1 and y.rn % 40 = 0;
  update public.students set admission_category = 'rte' where school_id = sid and admission_no like 'SCALE-%' and (right(admission_no, 3))::int % 37 = 0;

  -- ── Dues and fee payments ──
  perform public.generate_dues(sid, sess);
  i := 0;
  for r in select s.id from public.students s where s.school_id = sid and s.admission_no like 'SCALE-%' order by s.admission_no loop
    i := i + 1;
    s_i := r.id;
    select coalesce(array_agg(d.id order by d.due_date), '{}'), coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), 0)
      into due_ids, bal from public.fee_dues d where d.student_id = s_i and d.status <> 'paid' and d.due_date <= current_date;
    continue when cardinality(due_ids) = 0 or bal <= 0;
    pay := case when i % 10 in (0, 1, 2, 3, 4, 5) then bal when i % 10 in (6, 7) then round(bal * 0.5) else 0 end;   -- 20% pay nothing
    continue when pay <= 0;
    if i % 9 = 0 then
      perform public.collect_fee_v2(sid, s_i, jsonb_build_array(jsonb_build_object('mode', 'cash', 'amount', round(pay / 2)),
              jsonb_build_object('mode', 'upi', 'amount', pay - round(pay / 2), 'reference', 'UPI' || (500000 + i * 13))), due_ids, 0, current_date - (i % 25), 'Demo: split payment', collectors[1 + i % 2], 0);
    else
      perform public.collect_fee_v2(sid, s_i, jsonb_build_array(jsonb_build_object('mode', (array['cash','upi','bank_transfer','card','cash'])[1 + i % 5],
              'amount', pay, 'reference', case when i % 5 in (0, 4) then '' else 'REF' || (800000 + i * 19) end)), due_ids, 0, current_date - (i % 28), 'Demo payment', collectors[1 + i % 2], 0);
    end if;
  end loop;

  -- ── Attendance: 30 days (not Sundays or calendar holidays), a few students low, today partly scanned ──
  insert into public.attendance (school_id, student_id, class_id, section_id, date, status, marked_by, source)
  select sid, s.id, s.class_id, s.section_id, g::date,
         case when abs(hashtext(s.id::text || g::text)) % 100 < case when s.rn % 11 = 0 then 40 else 7 end then 'A'
              when abs(hashtext(s.id::text || g::text)) % 100 > 94 then 'L' else 'P' end, 'DEMO', 'manual'
    from (select id, class_id, section_id, row_number() over (order by admission_no) rn from public.students
           where school_id = sid and admission_no like 'SCALE-%' and section_id is not null) s
    cross join generate_series(tt - 30, tt - 1, interval '1 day') g
   where extract(isodow from g) <> 7
     and not exists (select 1 from public.school_events e where e.school_id = sid and e.kind in ('holiday', 'vacation') and g::date between e.start_date and e.end_date)
  on conflict (student_id, date) do nothing;
  insert into public.attendance (school_id, student_id, class_id, section_id, date, status, marked_by, source, in_time)
  select sid, s.id, s.class_id, s.section_id, tt, case when s.rn % 12 = 0 then 'L' else 'P' end, 'DEMO Main gate', 'qr',
         case when s.rn % 12 = 0 then time '08:24' else ('07:' || lpad((38 + s.rn % 21)::text, 2, '0'))::time end
    from (select id, class_id, section_id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%' and section_id is not null) s
   where s.rn % 4 <> 0
  on conflict (student_id, date) do nothing;

  -- ── Exams and marks ──
  insert into public.exams (school_id, session_id, name, start_date, sort, published) values
    (sid, sess, 'Unit Test 1 [demo]', sess_start + 60, 1, true) on conflict do nothing;
  insert into public.exams (school_id, session_id, name, start_date, sort, published) values
    (sid, sess, 'Half-yearly [demo]', sess_start + 170, 2, false) on conflict do nothing;
  select id into ex1 from public.exams where school_id = sid and session_id = sess and name = 'Unit Test 1 [demo]';
  select id into ex2 from public.exams where school_id = sid and session_id = sess and name = 'Half-yearly [demo]';
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, max_marks)
  select sid, e.id, c.id, s.id, case when e.id = ex1 then 25 else 100 end
    from (values (ex1), (ex2)) e(id)
    cross join public.classes c
    cross join (select id from public.subjects where school_id = sid order by sort, name limit 5) s
   where c.school_id = sid
  on conflict do nothing;
  insert into public.marks (school_id, exam_id, student_id, subject_id, marks, absent, entered_by)
  select sid, es.exam_id, st.id, es.subject_id,
         case when abs(hashtext(st.id::text || es.subject_id::text || es.exam_id::text)) % 50 = 0 then null
              else least(es.max_marks, greatest(0, round(es.max_marks * (0.32 + (abs(hashtext(st.id::text || es.subject_id::text)) % 62) / 100.0)))) end,
         abs(hashtext(st.id::text || es.subject_id::text || es.exam_id::text)) % 50 = 0, 'DEMO'
    from public.exam_subjects es
    join public.students st on st.class_id = es.class_id and st.school_id = sid and st.status = 'active'
   where es.exam_id in (ex1, ex2) and (es.exam_id = ex1 or st.admission_no like 'DEMO-%')   -- half-yearly marks only for the original demo students
  on conflict do nothing;

  -- ── Homework and material ──
  insert into public.homework (school_id, session_id, kind, class_id, subject_id, title, details, assigned_on, due_on, created_by_name)
  select sid, sess, case when g.n = 3 then 'material' else 'homework' end, c.id, s.id,
         case g.n when 1 then s.name || ': exercise 3 (page ' || (10 + g.n * 4) || ')' when 2 then s.name || ': revise the last chapter' else s.name || ': notes and practice sheet' end,
         'Written neatly in the notebook.', tt - g.n, case when g.n = 3 then null else tt + 5 - g.n end, 'DEMO'
    from public.classes c
    cross join (select id, name, row_number() over (order by sort, name) rn from public.subjects where school_id = sid limit 3) s
    cross join (values (1), (2), (3)) g(n)
   where c.school_id = sid and g.n = s.rn
  on conflict do nothing;

  -- ── Notices ──
  insert into public.notices (school_id, title, body, class_id, published_on, created_by) values
    (sid, '[Demo] Parent-teacher meeting on Saturday', 'The PTM will be held this Saturday from 9 am to 12 noon. Please bring the diary.', null, tt - 2, 'DEMO'),
    (sid, '[Demo] Winter uniform from 1 November', 'Students must wear the winter uniform from 1 November.', null, tt - 6, 'DEMO'),
    (sid, '[Demo] Fee reminder — second instalment', 'The second instalment is due. A late fine applies after the grace days.', null, tt - 9, 'DEMO'),
    (sid, '[Demo] Annual sports day practice', 'Practice for the annual sports day starts from Monday for classes 5 to 10.', null, tt - 12, 'DEMO');

  -- ── Library ──
  insert into public.library_books (school_id, accession_no, title, author, category, language, shelf, copies, price)
  select sid, 'DEMO-B' || lpad(g::text, 3, '0'),
         (array['The Jungle Book','Panchatantra Stories','Wings of Fire','Malgudi Days','Tenali Rama','Gitanjali','Ramayana for Children','Science Experiments','Atlas of India','Oxford Dictionary',
                'Hindi Vyakaran','Mathematics Magic','Story of the Stars','Akbar and Birbal','Discovery of India','Young Scientist','Chacha Chaudhary','Tinkle Digest','Learning English','General Knowledge'])[1 + g % 20] || ' ' || (1 + g / 20),
         (array['R. Kipling','Vishnu Sharma','A. P. J. Abdul Kalam','R. K. Narayan','Various','R. Tagore','Valmiki','NCERT','Survey of India','Oxford'])[1 + g % 10],
         (array['Fiction','Folk tales','Biography','Science','Reference','Language'])[1 + g % 6], case when g % 4 = 0 then 'Hindi' else 'English' end, 'Shelf ' || (1 + g % 8), 2 + g % 4, 120 + (g % 9) * 35
    from generate_series(1, 60) g
  on conflict do nothing;
  insert into public.library_issues (school_id, book_id, student_id, issued_on, due_on, returned_on, fine, issued_by_name)
  select sid, b.id, s.id, tt - x.ago, tt - x.ago + 14, case when x.k = 'returned' then tt - x.ago + 9 when x.k = 'late' then tt - x.ago + 18 end,
         case when x.k = 'late' then 20 else 0 end, 'DEMO'
    from (select id, row_number() over (order by accession_no) rn from public.library_books where school_id = sid and accession_no like 'DEMO-B%') b
    join (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') s on s.rn = b.rn * 7
    cross join lateral (select ((b.rn * 3) % 25 + 1)::int as ago, case b.rn % 5 when 0 then 'late' when 1 then 'returned' when 2 then 'returned' else 'out' end as k) x
   where b.rn <= 30
  ;

  -- ── Staff: leave, attendance, last month's payroll ──
  insert into public.staff_leaves (school_id, staff_id, kind, from_date, to_date, reason, status)
  select sid, t.id, x.kind, tt + x.a, tt + x.b, x.reason, 'pending'
    from (select id, row_number() over (order by emp_code) rn from public.staff where school_id = sid and emp_code like 'DEMO-E%' and status = 'active') t
    join (values (1, 'CL', 2, 2, 'Family function'), (2, 'SL', -3, -2, 'Fever'), (3, 'EL', 7, 11, 'Wedding in the family'), (4, 'LWP', 5, 6, 'Personal work'), (5, 'CL', -10, -10, 'Bank work')) x(rn, kind, a, b, reason) on x.rn = t.rn;
  update public.staff_leaves set status = 'approved' where school_id = sid and reason in ('Fever', 'Bank work', 'Wedding in the family');
  update public.staff_leaves set status = 'rejected', decision_note = 'Exam week — please reschedule' where school_id = sid and reason = 'Personal work';
  insert into public.staff_attendance (school_id, staff_id, date, status, in_time, source, marked_by)
  select sid, t.id, g::date, case when abs(hashtext(t.id::text || g::text)) % 100 < 6 then 'A' when abs(hashtext(t.id::text || g::text)) % 100 > 90 then 'L' else 'P' end,
         ('07:' || lpad((30 + abs(hashtext(t.id::text || g::text)) % 28)::text, 2, '0'))::time, 'biometric', 'DEMO'
    from public.staff t cross join generate_series(tt - 25, tt - 1, interval '1 day') g
   where t.school_id = sid and t.emp_code like 'DEMO-E%' and t.status = 'active' and extract(isodow from g) <> 7
  on conflict (staff_id, date) do nothing;
  begin
    perform public.generate_payroll(sid, date_trunc('month', tt - 20)::date, null);
  exception when others then raise notice 'Payroll not generated: %', sqlerrm; end;

  -- ── Front office, enquiries, vouchers, transport ──
  insert into public.visitors (school_id, pass_no, name, phone, purpose, to_meet, people, in_at, out_at, created_by_name)
  select sid, 'V-S-' || lpad(g::text, 4, '0'), (array['Mr','Mrs','Ms'])[1 + g % 3] || ' ' || fath[1 + g % 20] || ' ' || surn[1 + (g * 3) % 20], '96' || lpad((30000000 + g * 4421)::text, 8, '0'),
         (array['meeting','parent','admission','vendor','delivery','official','parent','parent'])[1 + g % 8], (array['Principal','Class teacher','Office','Accounts','Library'])[1 + g % 5], 1 + g % 3,
         (tt - (g % 14))::timestamp + time '08:30' + (g % 240) * interval '1 minute', (tt - (g % 14))::timestamp + time '08:30' + ((g % 240) + 15 + g % 30) * interval '1 minute', 'DEMO'
    from generate_series(1, 70) g
  on conflict do nothing;
  insert into public.phone_calls (school_id, direction, name, phone, purpose, summary, call_at, follow_up_on, followed_up_at, handled_by_name)
  select sid, case when g % 4 = 0 then 'outgoing' else 'incoming' end, fath[1 + g % 20] || ' ' || surn[1 + (g * 7) % 20], '95' || lpad((40000000 + g * 3571)::text, 8, '0'),
         (array['enquiry','fees','leave','transport','complaint','staff','enquiry'])[1 + g % 7],
         (array['Asked about admission and fee structure','Will pay the fee tomorrow','Child is unwell, leave for two days','Bus timing change request','Complaint about homework load','Asked for TC procedure'])[1 + g % 6],
         (tt - (g % 12))::timestamp + time '09:00' + (g % 300) * interval '1 minute', case when g % 5 = 0 then tt + (g % 4) - 1 end, case when g % 5 = 0 and g % 2 = 0 then now() end, 'DEMO'
    from generate_series(1, 45) g;
  insert into public.enquiries (school_id, student_name, class_sought, parent_name, phone, source, status, follow_up_date, notes)
  select sid, (case when g % 2 = 0 then girls[1 + g % 30] else boys[1 + g % 30] end) || ' ' || surn[1 + (g * 3) % 20], (array['Nursery','LKG','UKG','1','2','3','5','6','9'])[1 + g % 9],
         fath[1 + g % 20] || ' ' || surn[1 + (g * 3) % 20], '94' || lpad((50000000 + g * 2999)::text, 8, '0'), (array['Walk-in','Website','Referral','Banner','Phone'])[1 + g % 5],
         (array['new','new','contacted','visited','contacted','lost','test'])[1 + g % 7], case when g % 3 = 0 then tt + g % 6 end, 'DEMO scale enquiry'
    from generate_series(1, 30) g;
  insert into public.vouchers (school_id, no, date, kind, head_id, book_id, amount, party, mode, ref_no, narration, status, created_by_name)
  select sid, 'PV-S' || lpad(g::text, 4, '0'), tt - (g * 2 + g % 5), 'payment',
         (select id from public.account_heads where school_id = sid and kind = 'expense' order by name offset (g % 10) limit 1),
         (select id from public.account_books where school_id = sid and active order by (kind = 'cash') desc, created_at limit 1),
         500 + (g * 1731) % 14000, (array['UPPCL','Local vendor','Aggarwal Stationers','Indian Oil pump','Shree Ram Builders','Telecom','Water supply'])[1 + g % 7], 'cash', 'B-' || (1000 + g), 'Demo expense', 'posted', 'DEMO'
    from generate_series(1, 40) g
  where exists (select 1 from public.account_books where school_id = sid)
  on conflict do nothing;
  update public.transport_vehicles set capacity = greatest(coalesce(capacity, 0), 60) where school_id = sid and reg_no like 'DEMO %';
  insert into public.transport_allocations (school_id, session_id, student_id, route_id, stop_id, trip, start_date)
  select sid, sess, s.id, st.route_id, st.id, 'both', sess_start
    from (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%' and status = 'active') s
    join lateral (select t.* from public.transport_stops t where t.school_id = sid order by t.id limit 1 offset (s.rn % 7)) st on true
   where s.rn % 8 = 0
  on conflict do nothing;

  -- ── Question bank and an online exam (class 5, first subject) ──
  declare qc uuid; qs uuid; oe uuid;
  begin
    select id into qc from public.classes where school_id = sid and name = '5' limit 1;
    select id into qs from public.subjects where school_id = sid order by sort, name limit 1;
    if qc is not null and qs is not null and not exists (select 1 from public.question_bank where school_id = sid and created_by_name = 'DEMO') then
      insert into public.question_bank (school_id, class_id, subject_id, kind, text, options, answer, marks, negative_marks, difficulty, chapter, explanation, created_by_name)
      select sid, qc, qs, 'single', 'What is ' || a || ' + ' || b || '?',
             jsonb_build_array(jsonb_build_object('id','a','text',(a+b-1)::text), jsonb_build_object('id','b','text',(a+b)::text), jsonb_build_object('id','c','text',(a+b+1)::text), jsonb_build_object('id','d','text',(a+b+2)::text)),
             '["b"]'::jsonb, 1, 0.25, (array['easy','easy','medium','hard'])[1 + g % 4], (array['Addition','Place value','Numbers'])[1 + g % 3], 'Add the two numbers.', 'DEMO'
        from (select g, 10 + g * 3 as a, 7 + g * 2 as b from generate_series(1, 30) g) x;
      insert into public.question_bank (school_id, class_id, subject_id, kind, text, options, answer, marks, difficulty, chapter, created_by_name) values
        (sid, qc, qs, 'multi', 'Which of these are even numbers?', '[{"id":"a","text":"2"},{"id":"b","text":"7"},{"id":"c","text":"10"},{"id":"d","text":"15"}]', '["a","c"]', 2, 'medium', 'Numbers', 'DEMO'),
        (sid, qc, qs, 'truefalse', 'Zero is a whole number.', '[{"id":"t","text":"True"},{"id":"f","text":"False"}]', '["t"]', 1, 'easy', 'Numbers', 'DEMO');
      insert into public.online_exams (school_id, session_id, class_id, subject_id, title, instructions, duration_min, starts_at, ends_at, status, pool_mode, random_count, shuffle_questions,
                                       shuffle_options, negative_marking, max_tab_switches, total_marks, created_by_name)
      values (sid, sess, qc, qs, 'Unit quiz [demo]', 'Read each question carefully. Do not leave the screen.', 20, now() - interval '1 hour', now() + interval '2 days', 'scheduled', 'random', 10, true, true, true, 3, 10, 'DEMO')
      returning id into oe;
    end if;
  end;

  -- ── Library (rules, paid fines, reservations) ──
  insert into public.library_settings (school_id) values (sid) on conflict do nothing;
  update public.library_issues set fine_paid_on = returned_on + 1
   where school_id = sid and issued_by_name = 'DEMO' and fine > 0 and returned_on is not null and abs(hashtext(id::text)) % 2 = 0;
  insert into public.library_reservations (school_id, book_id, student_id)
  select sid, x.book_id, s.id
    from (select d.book_id, row_number() over (order by d.book_id) rn
            from (select distinct i.book_id from public.library_issues i where i.school_id = sid and i.issued_by_name = 'DEMO' and i.returned_on is null) d) x
    join (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') s on s.rn = 200 + x.rn
   where x.rn <= 8;

  -- ── Health: records, medical-room visits, check-ups ──
  insert into public.student_health (student_id, school_id, blood_group, allergies, conditions, emergency_name, emergency_phone, updated_by_name)
  select s.id, sid, (array['A+','B+','O+','AB+','O-','B-','A-'])[1 + s.rn % 7],
         case when s.rn % 11 = 0 then (array['Peanuts','Dust','Penicillin','Eggs'])[1 + s.rn % 4] end,
         case when s.rn % 17 = 0 then (array['Asthma','Mild anaemia','Short-sightedness'])[1 + s.rn % 3] end,
         s.father_name, s.guardian_phone, 'DEMO'
    from (select id, father_name, guardian_phone, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') s
   where s.rn % 3 = 0
  on conflict do nothing;
  insert into public.health_visits (school_id, student_id, visited_at, complaint, temperature_c, treatment, medicine, outcome, parent_informed, parent_informed_at, follow_up_on, attended_by_name)
  select sid, s.id, ((tt - (g % 20))::timestamp + time '09:10' + (g % 280) * interval '1 minute') at time zone 'Asia/Kolkata',
         (array['Headache','Stomach ache','Fever','Cut on the knee','Nausea','Tooth ache','Dizziness','Sprained ankle','Cold and cough'])[1 + g % 9],
         case when g % 3 = 0 then 37.5 + (g % 20) / 10.0 end, (array['Rest and water','Dressing applied','Cold compress','Observed for 30 minutes'])[1 + g % 4],
         case when g % 2 = 0 then (array['Paracetamol','ORS','Antiseptic cream','None'])[1 + g % 4] end,
         x.outcome, x.outcome in ('sent_home', 'hospital') or g % 3 = 0, case when x.outcome in ('sent_home', 'hospital') or g % 3 = 0 then now() - interval '1 day' end,
         case when g % 9 = 0 then tt + (g % 5) - 2 end, 'DEMO'
    from generate_series(1, 60) g
    cross join lateral (select (array['rested','returned_class','returned_class','sent_home','referred','rested','hospital'])[1 + g % 7] as outcome) x
    join (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') s on s.rn = g * 5;
  insert into public.health_checkups (school_id, student_id, on_date, height_cm, weight_kg, vision_left, vision_right, dental, camp, by_name)
  select sid, s.id, tt - 60, 105 + s.rn % 55, 17 + s.rn % 33, (array['6/6','6/6','6/9','6/6'])[1 + s.rn % 4], (array['6/6','6/9','6/6','6/12'])[1 + s.rn % 4],
         case when s.rn % 7 = 0 then 'Cavity — see dentist' else 'Healthy' end, 'Annual health camp', 'DEMO'
    from (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') s
   where s.rn % 9 = 0;

  -- ── Discipline and counselling ──
  declare di uuid; g2 int; sev text; stt text; d_on date;
  begin
    for g2 in 1..16 loop
      sev := (array['minor','minor','moderate','serious'])[1 + g2 % 4];
      stt := case when sev = 'serious' then (array['under_review','closed','escalated'])[1 + g2 % 3] else (array['open','action_taken','closed','closed'])[1 + g2 % 4] end;
      d_on := tt - (g2 * 4 % 70);
      insert into public.discipline_incidents (school_id, incident_on, category, severity, location, description, action_taken, status, parent_informed, follow_up_on, closed_on, confidential, reported_by_name)
      values (sid, d_on, (array['misbehaviour','late_coming','uniform','fighting','mobile_phone','bullying','property_damage','cheating'])[1 + g2 % 8], sev,
              (array['Classroom','Playground','School bus','Corridor','Canteen'])[1 + g2 % 5],
              (array['Disturbed the class repeatedly','Came late three days in a week','Not in proper uniform','Pushing and shouting during break','Mobile phone found in the bag','Teasing a classmate',
                     'Broke a window pane','Copying during the unit test'])[1 + g2 % 8],
              case when stt in ('action_taken', 'closed', 'escalated') then 'Warned, parents called and a written undertaking taken' end, stt, stt <> 'open',
              case when stt in ('open', 'under_review') then tt + g2 % 6 end, case when stt = 'closed' then d_on + 2 end, g2 % 8 = 5, 'DEMO')
      returning id into di;
      insert into public.discipline_students (incident_id, student_id, school_id, role)
      select di, s.id, sid, case when y.kk = 2 and g2 % 8 = 5 then 'victim' else 'involved' end
        from (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') s
        join (select kk from generate_series(1, 1 + (g2 % 3 = 0)::int) kk) y on s.rn = 13 * g2 + y.kk
      on conflict do nothing;
    end loop;
    insert into public.counselling_notes (school_id, student_id, on_date, note, by_name)
    select sid, s.id, tt - g * 5, (array['Spoke about difficulty in focusing; agreed on a daily study routine.','Conflict with a classmate — both heard separately; will review next week.',
             'Anxious before exams; shared breathing exercises, parents informed.','Frequent absence — home situation discussed with the mother.'])[1 + g % 4], 'DEMO'
      from generate_series(1, 6) g
      join (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and admission_no like 'SCALE-%') s on s.rn = 13 * g;
  end;

  -- ── Hostel: two houses, rooms, boarders, roll call, outpass, visitors, mess menu ──
  declare hb uuid; hg uuid;
  begin
    if not exists (select 1 from public.hostels where school_id = sid and name like 'DEMO %') then
      insert into public.hostels (school_id, name, kind) values (sid, 'DEMO Gandhi House', 'boys') returning id into hb;
      insert into public.hostels (school_id, name, kind) values (sid, 'DEMO Sarojini House', 'girls') returning id into hg;
      insert into public.hostel_rooms (school_id, hostel_id, room_no, floor, beds, room_type, monthly_fee)
      select sid, hb, (case when g <= 4 then '1' else '2' end) || '0' || (case when g <= 4 then g else g - 4 end), case when g <= 4 then 0 else 1 end, 4, 'dormitory', 3000 from generate_series(1, 8) g;
      insert into public.hostel_rooms (school_id, hostel_id, room_no, floor, beds, room_type, monthly_fee)
      select sid, hg, 'G' || g, case when g <= 3 then 0 else 1 end, 4, 'dormitory', 3200 from generate_series(1, 6) g;
      insert into public.hostel_allocations (school_id, session_id, student_id, room_id, bed_no, start_date, created_by_name)
      select sid, sess, s.id, hr.id, ((s.rn - 1) % 4) + 1, sess_start, 'DEMO'
        from (select x.id, row_number() over (order by x.admission_no) rn
                from (select st.id, st.admission_no from public.students st join public.classes c on c.id = st.class_id
                       where st.school_id = sid and st.admission_no like 'SCALE-%' and st.gender = 'M' and case when c.name ~ '^[0-9]+$' then c.name::int end >= 6) x) s
        join (select id, row_number() over (order by room_no) rn from public.hostel_rooms where hostel_id = hb) hr on hr.rn = ((s.rn - 1) / 4) + 1
       where s.rn <= 28;
      insert into public.hostel_allocations (school_id, session_id, student_id, room_id, bed_no, start_date, created_by_name)
      select sid, sess, s.id, hr.id, ((s.rn - 1) % 4) + 1, sess_start, 'DEMO'
        from (select x.id, row_number() over (order by x.admission_no) rn
                from (select st.id, st.admission_no from public.students st join public.classes c on c.id = st.class_id
                       where st.school_id = sid and st.admission_no like 'SCALE-%' and st.gender = 'F' and case when c.name ~ '^[0-9]+$' then c.name::int end >= 6) x) s
        join (select id, row_number() over (order by room_no) rn from public.hostel_rooms where hostel_id = hg) hr on hr.rn = ((s.rn - 1) / 4) + 1
       where s.rn <= 20;
      insert into public.hostel_attendance (school_id, hostel_id, student_id, on_date, slot, status, note, marked_by_name)
      select sid, hr.hostel_id, a.student_id, tt - d, 'night',
             case when abs(hashtext(a.student_id::text || d::text)) % 100 < 7 then 'A' when abs(hashtext(a.student_id::text || d::text)) % 100 > 94 then 'LV' else 'P' end, null, 'DEMO'
        from public.hostel_allocations a join public.hostel_rooms hr on hr.id = a.room_id cross join generate_series(1, 3) d
       where a.school_id = sid and a.created_by_name = 'DEMO'
      on conflict do nothing;
      insert into public.hostel_outpasses (school_id, student_id, kind, reason, out_at, expected_back, guardian_name, guardian_phone, status, requested_by_name, decided_by_name, left_at, returned_at)
      select sid, a.student_id, x.kind, x.reason, now() + x.o * interval '1 hour', now() + x.b * interval '1 hour', 'Parent', '9811100000', x.status, 'DEMO',
             case when x.status <> 'requested' then 'DEMO' end, case when x.status in ('out', 'returned') then now() + x.o * interval '1 hour' end,
             case when x.status = 'returned' then now() + x.b * interval '1 hour' end
        from (select student_id, row_number() over (order by created_at, id) rn from public.hostel_allocations where school_id = sid and created_by_name = 'DEMO') a
        join (values (1, 'requested', 'home', 'Festival at home', 20, 72), (2, 'approved', 'medical', 'Dental check-up', 3, 30), (3, 'out', 'home', 'Family function', -5, 40),
                     (4, 'out', 'home', 'Sister''s wedding', -30, -2), (5, 'returned', 'event', 'Inter-school quiz', -72, -48), (6, 'rejected', 'local', 'Market visit', 10, 14)) x(rn, status, kind, reason, o, b)
          on a.rn = x.rn * 5;
      insert into public.hostel_visitors (school_id, hostel_id, student_id, visitor_name, relation, phone, in_at, out_at, by_name)
      select sid, hb, a.student_id, fath[1 + g % 20] || ' ' || surn[1 + g % 20], (array['Father','Mother','Uncle','Sister'])[1 + g % 4], '9811' || lpad((100000 + g)::text, 6, '0'),
             now() - (g % 6) * interval '1 day' - interval '3 hours', case when g % 4 <> 0 then now() - (g % 6) * interval '1 day' - interval '2 hours' end, 'DEMO'
        from generate_series(1, 8) g
        join (select student_id, row_number() over (order by created_at, id) rn from public.hostel_allocations where school_id = sid and created_by_name = 'DEMO') a on a.rn = g * 2;
      insert into public.mess_menu (school_id, hostel_id, weekday, meal, items)
      select sid, h.hid, d, m.meal,
             case m.meal
               when 'breakfast' then (array['Poha, tea','Aloo paratha, curd','Idli, sambar','Bread, omelette','Upma, banana','Puri, sabzi','Cornflakes, milk'])[1 + d % 7]
               when 'lunch' then (array['Dal, rice, roti, sabzi','Rajma, rice, salad','Kadhi, rice, roti','Chole, bhature','Dal tadka, jeera rice','Paneer, roti, rice','Veg pulao, raita'])[1 + d % 7]
               when 'snacks' then (array['Tea, biscuits','Fruit chaat','Sprouts','Samosa, chutney','Milk, banana','Bread pakora','Lemon water, namkeen'])[1 + d % 7]
               else (array['Dal, roti, sabzi, rice','Egg curry / paneer, roti','Khichdi, papad','Mixed veg, roti, dal','Aloo gobi, roti','Dal makhani, naan','Kheer, puri, sabzi'])[1 + d % 7] end
        from generate_series(1, 7) d cross join (values ('breakfast'), ('lunch'), ('snacks'), ('dinner')) m(meal) cross join (values (hb), (hg)) h(hid)
      on conflict do nothing;
    end if;
  end;

  raise notice 'SCALE DEMO DATA READY for "%": % students added, % attendance rows, % marks, % library issues.', v_code,
    (select count(*) from public.students where school_id = sid and admission_no like 'SCALE-%'),
    (select count(*) from public.attendance where school_id = sid), (select count(*) from public.marks where school_id = sid), (select count(*) from public.library_issues where school_id = sid);
end
$scale$;
