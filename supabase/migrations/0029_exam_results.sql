-- ═══════════════════════════════════════════════════════════════════════════
-- Step 27: Exams (offline) refined — date sheet and pass marks per subject, marks-entry progress and lock per class,
--          one-button result declaration (totals, percent, grade, rank, pass / fail, withheld), teacher remarks,
--          marksheet data that is frozen once declared.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.exam_subjects add column if not exists exam_date date;
alter table public.exam_subjects add column if not exists start_time time;
alter table public.exam_subjects add column if not exists end_time time;
alter table public.exam_subjects add column if not exists room text;
alter table public.exam_subjects add column if not exists pass_marks numeric(6,2) check (pass_marks is null or pass_marks >= 0);
alter table public.exams add column if not exists end_date date;
alter table public.exams add column if not exists instructions text;

-- per class: marks entry lock and declaration
create table if not exists public.exam_class_status (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  exam_id          uuid not null references public.exams(id) on delete cascade,
  class_id         uuid not null references public.classes(id) on delete cascade,
  marks_locked     boolean not null default false,
  declared_at      timestamptz,
  declared_by_name text,
  unique (exam_id, class_id)
);

create table if not exists public.exam_results (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  exam_id         uuid not null references public.exams(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  class_id        uuid not null references public.classes(id) on delete cascade,
  total           numeric(8,2) not null default 0,
  max_total       numeric(8,2) not null default 0,
  percent         numeric(5,2) not null default 0,
  grade           text,
  rank            int,
  result          text not null check (result in ('pass', 'fail', 'absent', 'withheld')),
  failed_subjects int not null default 0,
  remark          text,
  withheld_reason text,
  declared_at     timestamptz not null default now(),
  unique (exam_id, student_id)
);
create index if not exists exam_results_class on public.exam_results (exam_id, class_id, rank);

alter table public.exam_class_status enable row level security;
alter table public.exam_results enable row level security;
drop policy if exists "read" on public.exam_class_status;
create policy "read" on public.exam_class_status for select to authenticated using (public.is_member(school_id));
drop policy if exists "read" on public.exam_results;
create policy "read" on public.exam_results for select to authenticated
  using (public.has_perm_school(school_id, 'exams.results.view') or public.can_student(school_id, 'exams.results.view', student_id));
-- written by the functions below only

-- ───────────── Marks entry is closed once the class is locked ─────────────
create or replace function public.marks_lock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare cls uuid; locked boolean;
begin
  if coalesce(current_setting('app.marks_bypass', true), '') = '1' then return coalesce(new, old); end if;
  select class_id into cls from public.students where id = coalesce(new.student_id, old.student_id);
  select marks_locked into locked from public.exam_class_status where exam_id = coalesce(new.exam_id, old.exam_id) and class_id = cls;
  if coalesce(locked, false) then raise exception 'Marks of this class are locked for this exam (result declared or locked). Unlock to change them.'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists marks_lock_guard on public.marks;
create trigger marks_lock_guard before insert or update or delete on public.marks for each row execute function public.marks_lock_guard();

-- ───────────── Progress of marks entry ─────────────
create or replace function public.exam_marks_progress(sid uuid, p_exam uuid)
returns table (class_id uuid, class_name text, class_sort int, students bigint, subjects bigint, expected bigint, entered bigint, absent bigint, missing bigint, locked boolean, declared_at timestamptz, results bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.sort,
         (select count(*) from public.students s where s.class_id = c.id and s.school_id = sid and s.status = 'active'),
         count(es.id),
         count(es.id) * (select count(*) from public.students s where s.class_id = c.id and s.school_id = sid and s.status = 'active'),
         (select count(*) from public.marks m join public.students s on s.id = m.student_id
           where m.exam_id = p_exam and s.class_id = c.id and s.status = 'active' and (m.marks is not null or m.absent)
             and exists (select 1 from public.exam_subjects x where x.exam_id = p_exam and x.class_id = c.id and x.subject_id = m.subject_id)),
         (select count(*) from public.marks m join public.students s on s.id = m.student_id where m.exam_id = p_exam and s.class_id = c.id and s.status = 'active' and m.absent),
         0::bigint,
         coalesce(st.marks_locked, false), st.declared_at,
         (select count(*) from public.exam_results r where r.exam_id = p_exam and r.class_id = c.id)
    from public.exam_subjects es
    join public.classes c on c.id = es.class_id
    left join public.exam_class_status st on st.exam_id = es.exam_id and st.class_id = c.id
   where es.exam_id = p_exam and es.school_id = sid and public.is_member(sid)
   group by c.id, c.name, c.sort, st.marks_locked, st.declared_at
   order by c.sort, c.name;
$$;

create or replace function public.set_marks_lock(sid uuid, p_exam uuid, p_class uuid, p_lock boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_perm_school(sid, 'exams.results.publish') or public.has_perm_school(sid, 'exams.setup.edit')) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.exams where id = p_exam and school_id = sid) then raise exception 'Exam not found.'; end if;
  insert into public.exam_class_status (school_id, exam_id, class_id, marks_locked) values (sid, p_exam, p_class, p_lock)
  on conflict (exam_id, class_id) do update set marks_locked = excluded.marks_locked;
end $$;

-- ───────────── Declaring the result ─────────────
create or replace function public.declare_exam_result(sid uuid, p_exam uuid, p_class uuid default null, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cls record; scale jsonb; me text; st record; missing bigint; n_cls int := 0; n_stu int := 0; n_pass int := 0; n_fail int := 0; ex public.exams;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'exams.results.publish') then raise exception 'not allowed'; end if;
  select * into ex from public.exams where id = p_exam and school_id = sid;
  if ex.id is null then raise exception 'Exam not found.'; end if;
  select grade_scale into scale from public.schools where id = sid;
  select name into me from public.school_members where school_id = sid and user_id = auth.uid();

  for cls in select distinct es.class_id from public.exam_subjects es where es.exam_id = p_exam and (p_class is null or es.class_id = p_class) loop
    -- every active student × subject must have marks or AB
    select count(*) into missing
      from public.students s cross join public.exam_subjects es
     where s.school_id = sid and s.class_id = cls.class_id and s.status = 'active' and es.exam_id = p_exam and es.class_id = cls.class_id
       and not exists (select 1 from public.marks m where m.exam_id = p_exam and m.student_id = s.id and m.subject_id = es.subject_id and (m.marks is not null or m.absent));
    if missing > 0 and not p_force then
      raise exception 'Marks are missing for % entries in a class (e.g. Class %). Enter them, or declare anyway to count them as zero.', missing, (select name from public.classes where id = cls.class_id);
    end if;

    perform set_config('app.marks_bypass', '1', true);
    delete from public.exam_results r where r.exam_id = p_exam and r.class_id = cls.class_id and r.result <> 'withheld';
    with per as (
      select s.id as student_id,
             sum(case when coalesce(m.absent, false) then 0 else coalesce(m.marks, 0) end) as total,
             sum(es.max_marks) as mx,
             count(*) filter (where coalesce(m.absent, false) or coalesce(m.marks, 0) < coalesce(es.pass_marks, round(es.max_marks * 0.33, 2))) as failed,
             count(*) filter (where coalesce(m.absent, false)) as absent_n,
             count(*) as subjects
        from public.students s
        join public.exam_subjects es on es.exam_id = p_exam and es.class_id = s.class_id
        left join public.marks m on m.exam_id = p_exam and m.student_id = s.id and m.subject_id = es.subject_id
       where s.school_id = sid and s.class_id = cls.class_id and s.status = 'active'
       group by s.id
    ), calc as (
      select per.*, case when mx > 0 then round(100.0 * total / mx, 2) else 0 end as pct,
             (select g ->> 'grade' from jsonb_array_elements(scale) g where (g ->> 'min')::numeric <= case when mx > 0 then 100.0 * total / mx else 0 end order by (g ->> 'min')::numeric desc limit 1) as grade
        from per
    )
    insert into public.exam_results (school_id, exam_id, student_id, class_id, total, max_total, percent, grade, rank, result, failed_subjects)
    select sid, p_exam, c.student_id, cls.class_id, c.total, c.mx, c.pct, c.grade,
           rank() over (order by c.total desc), case when c.absent_n = c.subjects then 'absent' when c.failed > 0 then 'fail' else 'pass' end, c.failed
      from calc c
     where not exists (select 1 from public.exam_results w where w.exam_id = p_exam and w.student_id = c.student_id and w.result = 'withheld');
    perform set_config('app.marks_bypass', '', true);

    -- withheld students keep their row but are not ranked with the others
    insert into public.exam_class_status (school_id, exam_id, class_id, marks_locked, declared_at, declared_by_name)
    values (sid, p_exam, cls.class_id, true, now(), coalesce(me, 'User'))
    on conflict (exam_id, class_id) do update set marks_locked = true, declared_at = now(), declared_by_name = coalesce(me, 'User');
    n_cls := n_cls + 1;
  end loop;
  if n_cls = 0 then raise exception 'Add subjects and marks for the class before declaring the result.'; end if;
  select count(*), count(*) filter (where result = 'pass'), count(*) filter (where result in ('fail', 'absent'))
    into n_stu, n_pass, n_fail from public.exam_results where exam_id = p_exam and (p_class is null or class_id = p_class);
  return jsonb_build_object('classes', n_cls, 'students', n_stu, 'passed', n_pass, 'failed', n_fail);
end $$;

create or replace function public.undo_exam_declaration(sid uuid, p_exam uuid, p_class uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'exams.results.publish') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.exams where id = p_exam and school_id = sid) then raise exception 'Exam not found.'; end if;
  delete from public.exam_results where exam_id = p_exam and class_id = p_class and school_id = sid;
  update public.exam_class_status set declared_at = null, declared_by_name = null, marks_locked = false where exam_id = p_exam and class_id = p_class;
end $$;

create or replace function public.withhold_result(sid uuid, p_exam uuid, p_student uuid, p_reason text, p_release boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'exams.results.publish') then raise exception 'not allowed'; end if;
  if not p_release and coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason for withholding.'; end if;
  if p_release then
    update public.exam_results set result = case when failed_subjects > 0 then 'fail' else 'pass' end, withheld_reason = null where exam_id = p_exam and student_id = p_student and school_id = sid and result = 'withheld';
  else
    update public.exam_results set result = 'withheld', withheld_reason = left(btrim(p_reason), 200) where exam_id = p_exam and student_id = p_student and school_id = sid;
    if not found then raise exception 'Declare the result first.'; end if;
  end if;
end $$;

create or replace function public.set_result_remark(sid uuid, p_exam uuid, p_student uuid, p_remark text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not (public.has_perm_school(sid, 'exams.results.publish') or public.can_student(sid, 'exams.marks.edit', p_student)) then raise exception 'not allowed'; end if;
  update public.exam_results set remark = nullif(left(btrim(coalesce(p_remark, '')), 300), '') where exam_id = p_exam and student_id = p_student and school_id = sid;
end $$;

-- copy the subjects (with dates and pass marks) of one exam into another
create or replace function public.copy_exam_subjects(sid uuid, from_exam uuid, to_exam uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or not public.has_perm_school(sid, 'exams.setup.create') then raise exception 'not allowed'; end if;
  if from_exam = to_exam then raise exception 'Choose two different exams.'; end if;
  if (select count(*) from public.exams where id in (from_exam, to_exam) and school_id = sid) <> 2 then raise exception 'Exam not found.'; end if;
  insert into public.exam_subjects (school_id, exam_id, class_id, subject_id, max_marks, pass_marks)
  select sid, to_exam, class_id, subject_id, max_marks, pass_marks from public.exam_subjects where exam_id = from_exam
  on conflict (exam_id, class_id, subject_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
declare t text;
begin
  foreach t in array array['exam_class_status'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
