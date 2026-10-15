-- ═══════════════════════════════════════════════════════════════════════════
-- Step 33: Reports & analysis — one set of aggregate functions for the principal's dashboard and the report pages:
--          overview KPIs, enrolment by class / gender / category, attendance trend and by class, fee billed vs collected by month,
--          defaulter ageing, collection by mode, exam performance, UDISE-style strength. Everything is computed in the database.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public._can_report(sid uuid, which text default 'overview') returns boolean
language sql stable security definer set search_path = public as $$
  select case which
    when 'fees' then public.has_perm_school(sid, 'reports.fees.view') or public.has_perm_school(sid, 'reports.overview.view')
    when 'academic' then public.has_perm(sid, 'reports.academic.view')
    else public.has_perm_school(sid, 'reports.overview.view') end;
$$;
revoke execute on function public._can_report(uuid, text) from public, anon, authenticated;

-- Which classes a report may show: the whole school for school-scope holders, only the teacher's own classes for 'assigned' academic reports.
create or replace function public._report_class_ok(sid uuid, cid uuid, which text default 'overview') returns boolean
language sql stable security definer set search_path = public as $$
  select case when which = 'academic'
    then public.has_perm_school(sid, 'reports.academic.view')
         or (public.has_perm(sid, 'reports.academic.view') and exists (select 1 from public.sections x where x.class_id = cid and public.assigned_to_section(sid, x.id, null)))
    else public.has_perm_school(sid, 'reports.overview.view') end;
$$;
revoke execute on function public._report_class_ok(uuid, uuid, text) from public, anon, authenticated;

-- ───────────── overview ─────────────
create or replace function public.report_overview(sid uuid, d1 date, d2 date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sess uuid; billed numeric; coll numeric; outst numeric; att_p bigint; att_t bigint; sat_p bigint; sat_t bigint; ex uuid; ex_name text; ex_avg numeric; ex_pass numeric;
begin
  if not public._can_report(sid, 'overview') then raise exception 'not allowed'; end if;
  select id into sess from public.sessions where school_id = sid and is_current;
  select coalesce(sum(greatest(amount - concession + fine, 0)), 0), coalesce(sum(greatest(amount - concession + fine - paid, 0)) filter (where due_date <= public.today_ist()), 0)
    into billed, outst from public.fee_dues where school_id = sid and session_id = sess;
  select coalesce(sum(amount), 0) into coll from public.fee_receipts where school_id = sid and not cancelled and paid_on between d1 and d2;
  select count(*) filter (where status in ('P', 'L', 'H')), count(*) into att_p, att_t from public.attendance where school_id = sid and date between d1 and d2;
  select count(*) filter (where status in ('P', 'L', 'H', 'OD')), count(*) into sat_p, sat_t from public.staff_attendance where school_id = sid and date between d1 and d2;
  select e.id, e.name into ex, ex_name from public.exams e where e.school_id = sid and exists (select 1 from public.exam_results r where r.exam_id = e.id) order by e.sort desc, e.start_date desc nulls last limit 1;
  if ex is not null then
    select round(avg(percent), 1), round(100.0 * count(*) filter (where result = 'pass') / nullif(count(*), 0), 1) into ex_avg, ex_pass from public.exam_results where exam_id = ex;
  end if;
  return jsonb_build_object(
    'students', (select count(*) from public.students where school_id = sid and status = 'active'),
    'boys', (select count(*) from public.students where school_id = sid and status = 'active' and gender = 'M'),
    'girls', (select count(*) from public.students where school_id = sid and status = 'active' and gender = 'F'),
    'admitted', (select count(*) from public.students where school_id = sid and admission_date between d1 and d2),
    'left', (select count(*) from public.students where school_id = sid and left_on between d1 and d2),
    'staff', (select count(*) from public.staff where school_id = sid and status = 'active'),
    'teaching', (select count(*) from public.staff where school_id = sid and status = 'active' and kind = 'teaching'),
    'student_att_pct', case when att_t > 0 then round(100.0 * att_p / att_t, 1) end,
    'staff_att_pct', case when sat_t > 0 then round(100.0 * sat_p / sat_t, 1) end,
    'fee_billed', billed, 'fee_collected', coll, 'fee_outstanding', outst,
    'fee_collection_pct', case when billed > 0 then round(100.0 * (select coalesce(sum(paid), 0) from public.fee_dues where school_id = sid and session_id = sess) / billed, 1) end,
    'defaulters', (select count(distinct student_id) from public.fee_dues where school_id = sid and session_id = sess and due_date <= public.today_ist() and amount - concession + fine - paid > 0),
    'last_exam', ex_name, 'last_exam_avg', ex_avg, 'last_exam_pass', ex_pass,
    'library_issues', (select count(*) from public.library_issues where school_id = sid and issued_on between d1 and d2),
    'library_overdue', (select count(*) from public.library_issues where school_id = sid and returned_on is null and due_on < public.today_ist()),
    'health_visits', (select count(*) from public.health_visits where school_id = sid and (visited_at at time zone 'Asia/Kolkata')::date between d1 and d2),
    'incidents', (select count(*) from public.discipline_incidents where school_id = sid and incident_on between d1 and d2),
    'hostel_beds', (select coalesce(sum(r.beds), 0) from public.hostel_rooms r where r.school_id = sid and r.active),
    'hostel_occupied', (select count(*) from public.hostel_allocations where school_id = sid and status = 'active'),
    'transport_riders', (select count(*) from public.transport_allocations where school_id = sid and (end_date is null or end_date >= public.today_ist())),
    'visitors', (select count(*) from public.visitors where school_id = sid and (in_at at time zone 'Asia/Kolkata')::date between d1 and d2)
  );
end $$;

-- ───────────── enrolment ─────────────
create or replace function public.report_enrolment(sid uuid)
returns table (class_id uuid, class_name text, class_sort int, sections bigint, seats int, boys bigint, girls bigint, other bigint, total bigint,
               general bigint, obc bigint, sc bigint, st bigint, ews bigint, rte bigint, new_this_session bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_report(sid, 'overview') and not public._can_report(sid, 'academic') then raise exception 'not allowed'; end if;
  return query
    select c.id, c.name, c.sort, (select count(*) from public.sections x where x.class_id = c.id), c.seats,
           count(s.id) filter (where s.gender = 'M'), count(s.id) filter (where s.gender = 'F'), count(s.id) filter (where coalesce(s.gender, '') not in ('M', 'F')), count(s.id),
           count(s.id) filter (where lower(s.category) = 'general'), count(s.id) filter (where lower(s.category) = 'obc'), count(s.id) filter (where lower(s.category) = 'sc'),
           count(s.id) filter (where lower(s.category) = 'st'), count(s.id) filter (where lower(s.category) = 'ews'),
           count(s.id) filter (where s.admission_category = 'rte'),
           count(s.id) filter (where s.admission_date >= (select start_date from public.sessions where school_id = sid and is_current))
      from public.classes c left join public.students s on s.class_id = c.id and s.status = 'active'
     where c.school_id = sid and (public._report_class_ok(sid, c.id, 'overview') or public._report_class_ok(sid, c.id, 'academic'))
     group by c.id, c.name, c.sort, c.seats order by c.sort, c.name;
end $$;

-- ───────────── attendance ─────────────
create or replace function public.report_attendance_trend(sid uuid, d1 date, d2 date)
returns table (day date, present bigint, absent bigint, marked bigint, pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_report(sid, 'overview') then raise exception 'not allowed'; end if;
  return query
    select a.date, count(*) filter (where a.status in ('P', 'L', 'H')), count(*) filter (where a.status = 'A'), count(*),
           round(100.0 * count(*) filter (where a.status in ('P', 'L', 'H')) / nullif(count(*), 0), 1)
      from public.attendance a where a.school_id = sid and a.date between d1 and d2 group by a.date order by a.date;
end $$;

create or replace function public.report_attendance_by_class(sid uuid, d1 date, d2 date)
returns table (class_id uuid, class_name text, class_sort int, students bigint, marked bigint, present bigint, absent bigint, pct numeric, low_students bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_report(sid, 'overview') and not public._can_report(sid, 'academic') then raise exception 'not allowed'; end if;
  return query
    with per as (
      select s.class_id as cid, s.id as stu, count(a.id) as m, count(a.id) filter (where a.status in ('P', 'L', 'H')) as p
        from public.students s left join public.attendance a on a.student_id = s.id and a.date between d1 and d2
       where s.school_id = sid and s.status = 'active' group by s.class_id, s.id)
    select c.id, c.name, c.sort, count(per.stu), coalesce(sum(per.m), 0)::bigint, coalesce(sum(per.p), 0)::bigint, (coalesce(sum(per.m), 0) - coalesce(sum(per.p), 0))::bigint,
           round(100.0 * coalesce(sum(per.p), 0) / nullif(sum(per.m), 0), 1), count(per.stu) filter (where per.m > 0 and 100.0 * per.p / per.m < 75)
      from public.classes c left join per on per.cid = c.id
     where c.school_id = sid and (public._report_class_ok(sid, c.id, 'overview') or public._report_class_ok(sid, c.id, 'academic'))
     group by c.id, c.name, c.sort order by c.sort, c.name;
end $$;

-- ───────────── fees ─────────────
create or replace function public.report_fee_monthly(sid uuid, p_months int default 12)
returns table (month date, billed numeric, collected numeric, receipts bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_report(sid, 'fees') then raise exception 'not allowed'; end if;
  return query
    select m::date,
           coalesce((select sum(greatest(d.amount - d.concession + d.fine, 0)) from public.fee_dues d where d.school_id = sid and date_trunc('month', d.due_date) = m), 0),
           coalesce((select sum(r.amount) from public.fee_receipts r where r.school_id = sid and not r.cancelled and date_trunc('month', r.paid_on) = m), 0),
           (select count(*) from public.fee_receipts r where r.school_id = sid and not r.cancelled and date_trunc('month', r.paid_on) = m)
      from generate_series(date_trunc('month', public.today_ist()) - make_interval(months => least(greatest(p_months, 1), 36) - 1), date_trunc('month', public.today_ist()), interval '1 month') m
     order by 1;
end $$;

create or replace function public.report_fee_by_class(sid uuid)
returns table (class_id uuid, class_name text, class_sort int, students bigint, billed numeric, paid numeric, outstanding numeric, overdue numeric, pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare sess uuid;
begin
  if not public._can_report(sid, 'fees') then raise exception 'not allowed'; end if;
  select id into sess from public.sessions where school_id = sid and is_current;
  return query
    select c.id, c.name, c.sort, count(distinct s.id), coalesce(sum(greatest(d.amount - d.concession + d.fine, 0)), 0), coalesce(sum(least(d.paid, greatest(d.amount - d.concession + d.fine, 0))), 0),
           coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), 0),
           coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) filter (where d.due_date < public.today_ist()), 0),
           round(100.0 * coalesce(sum(least(d.paid, greatest(d.amount - d.concession + d.fine, 0))), 0) / nullif(sum(greatest(d.amount - d.concession + d.fine, 0)), 0), 1)
      from public.classes c
      left join public.students s on s.class_id = c.id and s.status = 'active'
      left join public.fee_dues d on d.student_id = s.id and d.session_id = sess
     where c.school_id = sid group by c.id, c.name, c.sort order by c.sort, c.name;
end $$;

create or replace function public.report_defaulter_ageing(sid uuid)
returns table (bucket text, sort int, students bigint, amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_report(sid, 'fees') then raise exception 'not allowed'; end if;
  return query
    select x.bucket, x.sort, count(distinct x.student_id), sum(x.owed) from (
      select d.student_id, greatest(d.amount - d.concession + d.fine - d.paid, 0) as owed, public.today_ist() - d.due_date as age,
             case when public.today_ist() - d.due_date <= 30 then '0–30 days' when public.today_ist() - d.due_date <= 60 then '31–60 days'
                  when public.today_ist() - d.due_date <= 90 then '61–90 days' else 'Over 90 days' end as bucket,
             case when public.today_ist() - d.due_date <= 30 then 1 when public.today_ist() - d.due_date <= 60 then 2 when public.today_ist() - d.due_date <= 90 then 3 else 4 end as sort
        from public.fee_dues d where d.school_id = sid and d.due_date < public.today_ist() and d.amount - d.concession + d.fine - d.paid > 0) x
     group by x.bucket, x.sort order by x.sort;
end $$;

create or replace function public.report_collection_by_mode(sid uuid, d1 date, d2 date)
returns table (mode text, amount numeric, payments bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_report(sid, 'fees') then raise exception 'not allowed'; end if;
  return query
    select p.mode, sum(p.amount), count(*) from public.fee_receipt_payments p join public.fee_receipts r on r.id = p.receipt_id
     where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by p.mode order by sum(p.amount) desc;
end $$;

-- ───────────── exams ─────────────
create or replace function public.report_exam_by_class(sid uuid, p_exam uuid)
returns table (class_id uuid, class_name text, students bigint, avg_percent numeric, pass_percent numeric, topper text, topper_percent numeric, failed bigint, absent bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_report(sid, 'academic') then raise exception 'not allowed'; end if;
  return query
    select c.id, c.name, count(r.id), round(avg(r.percent), 1), round(100.0 * count(*) filter (where r.result = 'pass') / nullif(count(r.id), 0), 1),
           (select btrim(concat_ws(' ', s.first_name, s.last_name)) from public.exam_results t join public.students s on s.id = t.student_id where t.exam_id = p_exam and t.class_id = c.id and t.result <> 'withheld' order by t.percent desc limit 1),
           max(r.percent), count(*) filter (where r.result = 'fail'), count(*) filter (where r.result = 'absent')
      from public.exam_results r join public.classes c on c.id = r.class_id
     where r.exam_id = p_exam and r.school_id = sid and public._report_class_ok(sid, c.id, 'academic')
     group by c.id, c.name, c.sort order by c.sort, c.name;
end $$;

create or replace function public.report_exam_by_subject(sid uuid, p_exam uuid)
returns table (class_name text, subject_name text, students bigint, avg_percent numeric, below_pass bigint, highest numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._can_report(sid, 'academic') then raise exception 'not allowed'; end if;
  return query
    select c.name, sb.name, count(m.id), round(avg(100.0 * m.marks / nullif(es.max_marks, 0)), 1),
           count(*) filter (where m.absent or coalesce(m.marks, 0) < coalesce(es.pass_marks, round(es.max_marks * 0.33, 2))), max(m.marks)
      from public.exam_subjects es
      join public.classes c on c.id = es.class_id join public.subjects sb on sb.id = es.subject_id
      join public.students s on s.class_id = es.class_id and s.status = 'active'
      left join public.marks m on m.exam_id = es.exam_id and m.student_id = s.id and m.subject_id = es.subject_id
     where es.exam_id = p_exam and es.school_id = sid and public._report_class_ok(sid, c.id, 'academic')
     group by c.name, c.sort, sb.name, sb.sort order by c.sort, sb.sort, sb.name;
end $$;

-- ───────────── pickers for library / health / discipline / hostel ─────────────
-- A librarian or warden has no access to the student profile, but must still find a student by name to issue a book or give a bed.
-- Each permission is checked with its own scope (a class teacher only finds own students).
create or replace function public.student_lookup(sid uuid, p_q text)
returns table (id uuid, name text, admission_no text, class_name text, father_name text)
language sql stable security definer set search_path = public as $$
  select s.id, btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)), s.admission_no, c.name || coalesce('-' || sec.name, ''), s.father_name
    from public.students s
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
   where s.school_id = sid and s.status = 'active' and auth.uid() is not null
     and concat_ws(' ', s.first_name, s.last_name, s.admission_no, s.father_name) ilike public.like_escape(btrim(coalesce(p_q, '')))
     and (public.can_student(sid, 'students.profile.view', s.id) or public.can_student(sid, 'library.circulation.view', s.id) or public.can_student(sid, 'wellbeing.medical.view', s.id)
          or public.can_student(sid, 'wellbeing.discipline.view', s.id) or public.can_student(sid, 'hostel.allocation.view', s.id) or public.can_student(sid, 'hostel.rollcall.view', s.id)
          or public.can_student(sid, 'frontdesk.visitors.view', s.id) or public.can_student(sid, 'fees.collection.view', s.id) or public.can_student(sid, 'attendance.students.view', s.id)
          or public.can_student(sid, 'documents.issue.view', s.id) or public.can_student(sid, 'students.board_reg.view', s.id))
   order by s.first_name, s.last_name limit 10;
$$;

-- staff finder: also for the librarian (issuing to staff) and the hostel warden
create or replace function public.staff_lookup(sid uuid, p_q text) returns table (id uuid, name text, designation text, emp_code text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.designation, s.emp_code
    from public.staff s
   where s.school_id = sid and s.status = 'active'
     and (public.has_perm(sid, 'hr.staff.view') or public.has_perm(sid, 'frontdesk.visitors.view') or public.has_perm(sid, 'academics.timetable.view')
          or public.has_perm(sid, 'library.circulation.view') or public.has_perm(sid, 'hostel.allocation.view'))
     and concat_ws(' ', s.name, s.emp_code, s.designation) ilike public.like_escape(btrim(coalesce(p_q, '')))
   order by s.name limit 10;
$$;

-- ───────────── UDISE-style strength (class × gender × category) ─────────────
create or replace function public.report_udise_strength(sid uuid)
returns table (class_name text, class_sort int, category text, boys bigint, girls bigint, total bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public._can_report(sid, 'overview') or public.has_perm_school(sid, 'reports.udise.export')) then raise exception 'not allowed'; end if;
  return query
    select c.name, c.sort, coalesce(nullif(initcap(s.category), ''), 'Not stated'), count(*) filter (where s.gender = 'M'), count(*) filter (where s.gender = 'F'), count(*)
      from public.students s join public.classes c on c.id = s.class_id
     where s.school_id = sid and s.status = 'active' group by c.name, c.sort, coalesce(nullif(initcap(s.category), ''), 'Not stated') order by c.sort, 3;
end $$;
