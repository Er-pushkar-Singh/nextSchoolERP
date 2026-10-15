-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO DATA for the newer modules: Library (books, loans, reservations), Health (records, medical-room visits, check-ups),
-- Discipline (incidents, counselling notes) and Hostel (two houses, rooms, boarders, roll call, outpass, visitors, mess menu).
--
-- Works on ANY school that already has active students (the scale seed or your own). Run it in the Supabase SQL editor
-- AFTER migrations 0032 … 0035 are applied. Safe to run again: each part is skipped when its demo data is already there.
-- Everything is marked DEMO, so supabase/seed/demo_remove.sql takes it away again.
-- ═══════════════════════════════════════════════════════════════════════════
do $modules$
declare
  v_code text := 'YOUR-SCHOOL-CODE';
  sid uuid; uid uuid; sess uuid; sess_start date; n int;
  tt date := current_date;
  fath text[] := array['Rajesh','Sunil','Anil','Manoj','Vijay','Ramesh','Suresh','Dinesh','Mukesh','Ashok','Pramod','Rakesh','Sanjay','Deepak','Amit','Vinod','Ajay','Sandeep','Rahul','Naresh'];
  surn text[] := array['Sharma','Verma','Singh','Yadav','Gupta','Mishra','Pandey','Tiwari','Khan','Ansari','Maurya','Rai','Srivastava','Chauhan','Kushwaha','Patel','Saxena','Dubey','Shukla','Rathore'];
  hb uuid; hg uuid; di uuid; g2 int; sev text; stt text; d_on date;
begin
  -- the migrations behind these modules must be applied first
  if to_regclass('public.library_settings') is null or to_regclass('public.student_health') is null or to_regclass('public.hostels') is null then
    raise exception 'The Library / Health / Hostel tables are missing: apply migrations 0032, 0033, 0034 and 0035 (or re-run supabase/setup.sql), then run this again. supabase/check_setup.sql shows exactly what is missing.';
  end if;
  if v_code = 'YOUR-SCHOOL-CODE' then
    select count(*) into n from public.schools;
    if n = 1 then select code into v_code from public.schools;
    else raise exception 'Put your school code in v_code at the top. Codes: %', (select string_agg(code, ', ') from public.schools); end if;
  end if;
  select id into sid from public.schools where code = v_code;
  if sid is null then raise exception 'No school with code "%".', v_code; end if;
  select count(*) into n from public.students where school_id = sid and status = 'active';
  if n < 20 then raise exception 'The school has only % active students. Add students (or run demo_data.sql / demo_scale.sql) first.', n; end if;
  select mr.user_id into uid from public.member_roles mr join public.roles ro on ro.id = mr.role_id where mr.school_id = sid and ro.code = 'principal' limit 1;
  if uid is null then select user_id into uid from public.platform_admins limit 1; end if;
  if uid is null then raise exception 'The school has no Principal user yet.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'email', 'demo-seed@school.local')::text, true);
  select id, start_date into sess, sess_start from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then raise exception 'The school has no current session.'; end if;

  -- ── Library: books and loans (only if the school has no books), loan rules, paid fines, reservations ──
  if not exists (select 1 from public.library_books where school_id = sid) then
    insert into public.library_books (school_id, accession_no, title, author, category, language, shelf, copies, price)
    select sid, 'DEMO-B' || lpad(g::text, 3, '0'),
           (array['The Jungle Book','Panchatantra Stories','Wings of Fire','Malgudi Days','Tenali Rama','Gitanjali','Ramayana for Children','Science Experiments','Atlas of India','Oxford Dictionary',
                  'Hindi Vyakaran','Mathematics Magic','Story of the Stars','Akbar and Birbal','Discovery of India','Young Scientist','Chacha Chaudhary','Tinkle Digest','Learning English','General Knowledge'])[1 + g % 20] || ' ' || (1 + g / 20),
           (array['R. Kipling','Vishnu Sharma','A. P. J. Abdul Kalam','R. K. Narayan','Various','R. Tagore','Valmiki','NCERT','Survey of India','Oxford'])[1 + g % 10],
           (array['Fiction','Folk tales','Biography','Science','Reference','Language'])[1 + g % 6], case when g % 4 = 0 then 'Hindi' else 'English' end, 'Shelf ' || (1 + g % 8), 2 + g % 4, 120 + (g % 9) * 35
      from generate_series(1, 60) g
    on conflict do nothing;
  end if;
  if not exists (select 1 from public.library_issues where school_id = sid) then
    insert into public.library_issues (school_id, book_id, student_id, issued_on, due_on, returned_on, fine, issued_by_name)
    select sid, b.id, s.id, tt - x.ago, tt - x.ago + 14, case when x.k = 'returned' then tt - x.ago + 9 when x.k = 'late' then tt - x.ago + 18 end,
           case when x.k = 'late' then 20 else 0 end, 'DEMO'
      from (select id, row_number() over (order by accession_no) rn from public.library_books where school_id = sid) b
      join (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and status = 'active') s on s.rn = b.rn * 3
      cross join lateral (select ((b.rn * 3) % 25 + 1)::int as ago, case b.rn % 5 when 0 then 'late' when 1 then 'returned' when 2 then 'returned' else 'out' end as k) x
     where b.rn <= 30;
  end if;
  insert into public.library_settings (school_id) values (sid) on conflict do nothing;
  update public.library_issues set fine_paid_on = returned_on + 1
   where school_id = sid and issued_by_name = 'DEMO' and fine > 0 and returned_on is not null and fine_paid_on is null and abs(hashtext(id::text)) % 2 = 0;
  if not exists (select 1 from public.library_reservations where school_id = sid) then
    insert into public.library_reservations (school_id, book_id, student_id)
    select sid, x.book_id, s.id
      from (select d.book_id, row_number() over (order by d.book_id) rn
              from (select distinct i.book_id from public.library_issues i where i.school_id = sid and i.returned_on is null) d) x
      join (select id, row_number() over (order by admission_no desc) rn from public.students where school_id = sid and status = 'active') s on s.rn = 5 + x.rn
     where x.rn <= 8;
  end if;

  -- ── Health: records, medical-room visits, check-ups ──
  if not exists (select 1 from public.health_visits where school_id = sid and attended_by_name = 'DEMO') then
    insert into public.student_health (student_id, school_id, blood_group, allergies, conditions, emergency_name, emergency_phone, updated_by_name)
    select s.id, sid, (array['A+','B+','O+','AB+','O-','B-','A-'])[1 + s.rn % 7],
           case when s.rn % 11 = 0 then (array['Peanuts','Dust','Penicillin','Eggs'])[1 + s.rn % 4] end,
           case when s.rn % 17 = 0 then (array['Asthma','Mild anaemia','Short-sightedness'])[1 + s.rn % 3] end,
           coalesce(s.father_name, 'Parent'), s.guardian_phone, 'DEMO'
      from (select id, father_name, guardian_phone, row_number() over (order by admission_no) rn from public.students where school_id = sid and status = 'active') s
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
      join (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and status = 'active') s on s.rn = 1 + (g * 7) % n;
    insert into public.health_checkups (school_id, student_id, on_date, height_cm, weight_kg, vision_left, vision_right, dental, camp, by_name)
    select sid, s.id, tt - 60, 105 + s.rn % 55, 17 + s.rn % 33, (array['6/6','6/6','6/9','6/6'])[1 + s.rn % 4], (array['6/6','6/9','6/6','6/12'])[1 + s.rn % 4],
           case when s.rn % 7 = 0 then 'Cavity — see dentist' else 'Healthy' end, 'Annual health camp', 'DEMO'
      from (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and status = 'active') s
     where s.rn % 9 = 0;
  end if;

  -- ── Discipline and counselling ──
  if not exists (select 1 from public.discipline_incidents where school_id = sid and reported_by_name = 'DEMO') then
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
        from (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and status = 'active') s
        join (select kk from generate_series(1, 1 + (g2 % 3 = 0)::int) kk) y on s.rn = 1 + (13 * g2 + y.kk) % n
      on conflict do nothing;
    end loop;
    insert into public.counselling_notes (school_id, student_id, on_date, note, by_name)
    select sid, s.id, tt - g * 5, (array['Spoke about difficulty in focusing; agreed on a daily study routine.','Conflict with a classmate — both heard separately; will review next week.',
             'Anxious before exams; shared breathing exercises, parents informed.','Frequent absence — home situation discussed with the mother.'])[1 + g % 4], 'DEMO'
      from generate_series(1, 6) g
      join (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and status = 'active') s on s.rn = 1 + (13 * g) % n;
  end if;

  -- ── Hostel: two houses, rooms, boarders, roll call, outpass, visitors, mess menu ──
  if not exists (select 1 from public.hostels where school_id = sid and name like 'DEMO %') then
    insert into public.hostels (school_id, name, kind) values (sid, 'DEMO Gandhi House', 'boys') returning id into hb;
    insert into public.hostels (school_id, name, kind) values (sid, 'DEMO Sarojini House', 'girls') returning id into hg;
    insert into public.hostel_rooms (school_id, hostel_id, room_no, floor, beds, room_type, monthly_fee)
    select sid, hb, (case when g <= 4 then '1' else '2' end) || '0' || (case when g <= 4 then g else g - 4 end), case when g <= 4 then 0 else 1 end, 4, 'dormitory', 3000 from generate_series(1, 8) g;
    insert into public.hostel_rooms (school_id, hostel_id, room_no, floor, beds, room_type, monthly_fee)
    select sid, hg, 'G' || g, case when g <= 3 then 0 else 1 end, 4, 'dormitory', 3200 from generate_series(1, 6) g;
    -- boys from the senior classes (or any boys when the school has no numbered classes), no student already in a hostel
    insert into public.hostel_allocations (school_id, session_id, student_id, room_id, bed_no, start_date, created_by_name)
    select sid, sess, s.id, hr.id, ((s.rn - 1) % 4) + 1, sess_start, 'DEMO'
      from (select x.id, row_number() over (order by x.admission_no) rn
              from (select st.id, st.admission_no from public.students st left join public.classes c on c.id = st.class_id
                     where st.school_id = sid and st.status = 'active' and st.gender = 'M'
                       and not exists (select 1 from public.hostel_allocations ha where ha.student_id = st.id and ha.status = 'active')
                     order by (case when c.name ~ '^[0-9]+$' then c.name::int else 0 end) desc, st.admission_no limit 28) x) s
      join (select id, row_number() over (order by room_no) rn from public.hostel_rooms where hostel_id = hb) hr on hr.rn = ((s.rn - 1) / 4) + 1
     where s.rn <= 28;
    insert into public.hostel_allocations (school_id, session_id, student_id, room_id, bed_no, start_date, created_by_name)
    select sid, sess, s.id, hr.id, ((s.rn - 1) % 4) + 1, sess_start, 'DEMO'
      from (select x.id, row_number() over (order by x.admission_no) rn
              from (select st.id, st.admission_no from public.students st left join public.classes c on c.id = st.class_id
                     where st.school_id = sid and st.status = 'active' and st.gender = 'F'
                       and not exists (select 1 from public.hostel_allocations ha where ha.student_id = st.id and ha.status = 'active')
                     order by (case when c.name ~ '^[0-9]+$' then c.name::int else 0 end) desc, st.admission_no limit 20) x) s
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

  -- ── Inventory & sales: items, a supplier, two purchases, bills over the last weeks ──
  if to_regclass('public.inventory_items') is not null and not exists (select 1 from public.inventory_items where school_id = sid) then
    declare sup uuid; lines jsonb; r record; j jsonb; g3 int; stu uuid; itm uuid[]; pick uuid; mode text;
    begin
      insert into public.inventory_suppliers (school_id, name, phone, gstin) values (sid, 'DEMO Sharma Uniforms', '9811100009', '09ABCDE1234F1Z5') returning id into sup;
      insert into public.inventory_items (school_id, sku, name, category, variant, cost, price, reorder_level)
      select sid, 'DEMO-SH-' || v, 'School shirt', 'Uniform', v::text, 140 + (v - 26) * 5, 220 + (v - 26) * 8, 6 from generate_series(26, 36, 2) v;
      insert into public.inventory_items (school_id, sku, name, category, variant, cost, price, reorder_level)
      select sid, 'DEMO-TR-' || v, 'School trousers', 'Uniform', v::text, 210 + (v - 26) * 6, 320 + (v - 26) * 9, 6 from generate_series(26, 36, 2) v;
      insert into public.inventory_items (school_id, sku, name, category, cost, price, reorder_level) values
        (sid, 'DEMO-TIE', 'School tie', 'Uniform', 45, 80, 10), (sid, 'DEMO-BELT', 'School belt', 'Uniform', 60, 100, 10), (sid, 'DEMO-SOCK', 'Socks (pair)', 'Uniform', 25, 45, 15),
        (sid, 'DEMO-PT', 'PT dress set', 'Uniform', 280, 420, 5), (sid, 'DEMO-NB-S', 'Notebook — single line', 'Stationery', 18, 30, 40), (sid, 'DEMO-NB-D', 'Notebook — double line', 'Stationery', 18, 30, 40),
        (sid, 'DEMO-GEO', 'Geometry box', 'Stationery', 85, 130, 8), (sid, 'DEMO-DIARY', 'School diary', 'Stationery', 40, 70, 20), (sid, 'DEMO-IDH', 'ID card holder', 'Stationery', 12, 25, 20);
      insert into public.inventory_items (school_id, sku, name, category, variant, cost, price, reorder_level)
      select sid, 'DEMO-BK-' || s || '-' || c, s || ' textbook', 'Books', 'Class ' || c, 90 + c * 6, 130 + c * 8, 5
        from (values ('Maths'), ('English'), ('Hindi'), ('Science')) a(s) cross join generate_series(5, 8) c;
      select array_agg(id) into itm from public.inventory_items where school_id = sid and sku like 'DEMO-%';
      -- opening purchase for everything, a smaller top-up for the uniform
      select jsonb_agg(jsonb_build_object('item', id, 'qty', 12 + abs(hashtext(id::text)) % 40, 'unit_cost', cost)) into lines from public.inventory_items where school_id = sid and sku like 'DEMO-%';
      perform public.inventory_purchase(sid, sup, tt - 30, 'DEMO-B-101', lines, 20000, 'bank_transfer', 'DEMO');
      select jsonb_agg(jsonb_build_object('item', id, 'qty', 10, 'unit_cost', cost)) into lines from public.inventory_items where school_id = sid and category = 'Uniform' and sku like 'DEMO-SH-%';
      perform public.inventory_purchase(sid, sup, tt - 12, 'DEMO-B-118', lines, 0, 'cash', 'DEMO');
      -- bills: some paid at the counter, some added to the fee account
      for g3 in 1..28 loop
        select id into stu from (select id, row_number() over (order by admission_no) rn from public.students where school_id = sid and status = 'active') s where s.rn = 1 + (g3 * 7) % n;
        mode := (array['cash', 'upi', 'fee_account', 'cash', 'card', 'fee_account'])[1 + g3 % 6];
        select jsonb_agg(jsonb_build_object('item', x, 'qty', 1 + (g3 % 3))) into lines from (
          select itm[1 + (g3 * 3 + k) % cardinality(itm)] x from generate_series(0, g3 % 3) k) q;
        begin
          j := public.inventory_sell(sid, 'student', stu, null, null, null, lines, 0, mode, 'DEMO');
          update public.inventory_sales set on_date = tt - (g3 % 27), created_at = now() - (g3 % 27) * interval '1 day' where id = (j ->> 'id')::uuid;
          update public.vouchers set date = tt - (g3 % 27) where id = (select voucher_id from public.inventory_sales where id = (j ->> 'id')::uuid);
        exception when others then null;   -- a line that is out of stock is simply skipped in the demo
        end;
      end loop;
      -- two items below their re-order level, one cancelled bill
      update public.inventory_items set reorder_level = on_hand + 2 where school_id = sid and sku in ('DEMO-TIE', 'DEMO-GEO', 'DEMO-SH-30');
      select id into pick from public.inventory_sales where school_id = sid and note = 'DEMO' and status = 'paid' order by created_at limit 1;
      if pick is not null then perform public.inventory_cancel_sale(sid, pick, 'Wrong size — returned (demo)'); end if;
    end;
  end if;

  -- ── Messages: a few outbox rows so the screen is not empty ──
  if to_regclass('public.message_outbox') is not null and not exists (select 1 from public.message_outbox where school_id = sid and created_by_name = 'DEMO') then
    insert into public.message_outbox (school_id, channel, event, to_addr, recipient_name, student_id, subject, body, status, attempts, last_error, provider_ref, account_source, created_by_name, created_at, sent_at, dedupe_key)
    select sid, (array['whatsapp', 'sms', 'email', 'whatsapp'])[1 + g % 4], (array['fee_receipt', 'absent', 'fee_reminder', 'exam_result', 'notice'])[1 + g % 5],
           case when g % 4 = 2 then lower(s.first_name) || '.parent@example.com' else '98' || lpad((10000000 + g * 7919)::text, 8, '0') end,
           coalesce(s.father_name, s.first_name), s.id, case when g % 4 = 2 then 'School message' end,
           case g % 5 when 0 then 'Dear Parent, fee of Rs ' || (1000 + g * 150) || ' received for ' || s.first_name || '. Thank you.'
                      when 1 then 'Dear Parent, ' || s.first_name || ' is absent from school today.'
                      when 2 then 'Dear Parent, fee of Rs ' || (2000 + g * 100) || ' for ' || s.first_name || ' is pending.'
                      when 3 then 'Dear Parent, the result of ' || s.first_name || ' is published.'
                      else 'Notice: Winter uniform from 1 November.' end,
           case when g % 9 = 0 then 'failed' when g % 7 = 0 then 'skipped' when g % 11 = 0 then 'queued' else 'sent' end,
           case when g % 9 = 0 then 3 else 1 end, case when g % 9 = 0 then 'Template not approved' when g % 7 = 0 then 'No valid mobile number or email on record.' end,
           case when g % 9 <> 0 and g % 7 <> 0 and g % 11 <> 0 then 'demo-' || g end, case when g % 9 <> 0 and g % 7 <> 0 and g % 11 <> 0 then 'school' end,
           'DEMO', now() - (g % 20) * interval '1 day' - (g % 7) * interval '1 hour', case when g % 9 <> 0 and g % 7 <> 0 and g % 11 <> 0 then now() - (g % 20) * interval '1 day' end, 'demo:' || g
      from generate_series(1, 36) g
      join (select id, first_name, father_name, row_number() over (order by admission_no) rn from public.students where school_id = sid and status = 'active') s on s.rn = 1 + (g * 5) % n;
  end if;

  raise notice 'MODULE DEMO DATA READY for "%": % library issues, % reservations, % health records, % medical visits, % incidents, % hostel beds allotted.', v_code,
    (select count(*) from public.library_issues where school_id = sid), (select count(*) from public.library_reservations where school_id = sid),
    (select count(*) from public.student_health where school_id = sid), (select count(*) from public.health_visits where school_id = sid),
    (select count(*) from public.discipline_incidents where school_id = sid), (select count(*) from public.hostel_allocations where school_id = sid and status = 'active');
end
$modules$;
