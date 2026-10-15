-- ═══════════════════════════════════════════════════════════════════════════
-- Step 28: Online examinations — question bank per class and subject, scheduled online exams (fixed or randomly drawn paper,
--          timed, shuffled), a secured student side (admission no. + date of birth, one device, server-side clock,
--          answers never sent to the browser, tab-switch / fullscreen monitoring, auto-submit), grading, result declaration
--          and optional push of the score into the offline exam's marks.
-- Students have no database access: the student side talks to the service-role functions below through /api/exam.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Question bank ─────────────
create table if not exists public.question_bank (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  class_id        uuid not null references public.classes(id) on delete cascade,
  subject_id      uuid not null references public.subjects(id) on delete cascade,
  kind            text not null default 'single' check (kind in ('single', 'multi', 'truefalse')),
  text            text not null check (length(btrim(text)) between 1 and 2000),
  options         jsonb not null default '[]',          -- [{"id":"a","text":"…"}]
  answer          jsonb not null default '[]',          -- ["a"] (ids of the correct options)
  marks           numeric(5,2) not null default 1 check (marks > 0),
  negative_marks  numeric(5,2) not null default 0 check (negative_marks >= 0),
  difficulty      text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  chapter         text,
  explanation     text,
  active          boolean not null default true,
  created_by_name text,
  created_at      timestamptz not null default now(),
  check (jsonb_typeof(options) = 'array' and jsonb_typeof(answer) = 'array')
);
create index if not exists question_bank_idx on public.question_bank (school_id, class_id, subject_id, active);

-- ───────────── Online exams ─────────────
create table if not exists public.online_exams (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  session_id       uuid references public.sessions(id) on delete set null,
  exam_id          uuid references public.exams(id) on delete set null,       -- the offline exam whose marks this feeds (optional)
  class_id         uuid not null references public.classes(id) on delete cascade,
  subject_id       uuid not null references public.subjects(id) on delete cascade,
  title            text not null check (length(btrim(title)) between 1 and 120),
  instructions     text,
  duration_min     int not null default 30 check (duration_min between 1 and 360),
  starts_at        timestamptz,
  ends_at          timestamptz,
  status           text not null default 'draft' check (status in ('draft', 'scheduled', 'closed', 'declared')),
  pool_mode        text not null default 'fixed' check (pool_mode in ('fixed', 'random')),
  random_count     int check (random_count is null or random_count between 1 and 300),
  pool_filter      jsonb not null default '{}',                               -- {"chapter":"…","difficulty":"easy"}
  shuffle_questions boolean not null default true,
  shuffle_options  boolean not null default true,
  negative_marking boolean not null default false,
  pass_percent     numeric(5,2) not null default 33 check (pass_percent between 0 and 100),
  max_tab_switches int not null default 3 check (max_tab_switches between 0 and 20),
  require_fullscreen boolean not null default true,
  access_code      text,
  show_result      text not null default 'after_declare' check (show_result in ('immediately', 'after_declare', 'never')),
  show_answers     boolean not null default false,
  total_marks      numeric(8,2) not null default 0,
  public_token     text not null unique default encode(gen_random_bytes(12), 'hex'),
  created_by_name  text,
  created_at       timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists online_exams_idx on public.online_exams (school_id, class_id, status);

create table if not exists public.online_exam_questions (
  exam_id     uuid not null references public.online_exams(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete restrict,
  marks       numeric(5,2) not null default 1 check (marks > 0),
  sort        int not null default 0,
  primary key (exam_id, question_id)
);

create table if not exists public.online_attempts (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  exam_id      uuid not null references public.online_exams(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  started_at   timestamptz not null default now(),
  deadline_at  timestamptz not null,
  submitted_at timestamptz,
  status       text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'auto_submitted', 'terminated')),
  questions    jsonb not null default '[]',      -- the paper this student got, in order: [{id, kind, text, marks, neg, options:[{id,text}]}]
  key          jsonb not null default '{}',      -- {questionId: [correct option ids]}  (never leaves the database)
  answers      jsonb not null default '{}',      -- {questionId: [chosen option ids]}
  score        numeric(8,2),
  max_score    numeric(8,2),
  correct      int,
  wrong        int,
  skipped      int,
  tab_switches int not null default 0,
  events       jsonb not null default '[]',
  ip           text,
  user_agent   text,
  last_seen_at timestamptz,
  unique (exam_id, student_id)
);
create index if not exists online_attempts_exam on public.online_attempts (exam_id, status);

-- student sessions (token is stored only as a hash)
create table if not exists public.exam_sessions (
  token_hash text primary key,
  school_id  uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip         text
);
create index if not exists exam_sessions_student on public.exam_sessions (student_id);
create table if not exists public.exam_login_failures (
  id        bigint generated always as identity primary key,
  school_id uuid,
  key       text not null,
  at        timestamptz not null default now()
);
create index if not exists exam_login_failures_key on public.exam_login_failures (key, at desc);

alter table public.question_bank enable row level security;
alter table public.online_exams enable row level security;
alter table public.online_exam_questions enable row level security;
alter table public.online_attempts enable row level security;
alter table public.exam_sessions enable row level security;
alter table public.exam_login_failures enable row level security;

-- may this user manage questions of this class + subject?
create or replace function public.can_question(sid uuid, p_class uuid, p_subject uuid, pkey text default 'exams.marks.create') returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.has_perm_school(sid, 'exams.setup.create') or public.can_syllabus(sid, p_class, p_subject, pkey);
end $$;

drop policy if exists "read" on public.question_bank;
create policy "read" on public.question_bank for select to authenticated
  using (public.has_perm_school(school_id, 'exams.setup.view') or public.can_syllabus(school_id, class_id, subject_id, 'exams.marks.view'));
drop policy if exists "create" on public.question_bank;
create policy "create" on public.question_bank for insert to authenticated with check (public.can_question(school_id, class_id, subject_id, 'exams.marks.create'));
drop policy if exists "edit" on public.question_bank;
create policy "edit" on public.question_bank for update to authenticated
  using (public.can_question(school_id, class_id, subject_id, 'exams.marks.edit')) with check (public.can_question(school_id, class_id, subject_id, 'exams.marks.edit'));
drop policy if exists "delete" on public.question_bank;
create policy "delete" on public.question_bank for delete to authenticated using (public.can_question(school_id, class_id, subject_id, 'exams.marks.edit'));

drop policy if exists "read" on public.online_exams;
create policy "read" on public.online_exams for select to authenticated
  using (public.has_perm_school(school_id, 'exams.setup.view') or public.can_syllabus(school_id, class_id, subject_id, 'exams.marks.view'));
drop policy if exists "create" on public.online_exams;
create policy "create" on public.online_exams for insert to authenticated with check (public.can_question(school_id, class_id, subject_id, 'exams.marks.create'));
drop policy if exists "edit" on public.online_exams;
create policy "edit" on public.online_exams for update to authenticated
  using (public.can_question(school_id, class_id, subject_id, 'exams.marks.edit')) with check (public.can_question(school_id, class_id, subject_id, 'exams.marks.edit'));
drop policy if exists "delete" on public.online_exams;
create policy "delete" on public.online_exams for delete to authenticated using (public.has_perm_school(school_id, 'exams.setup.delete'));

drop policy if exists "read" on public.online_exam_questions;
create policy "read" on public.online_exam_questions for select to authenticated
  using (exists (select 1 from public.online_exams e where e.id = online_exam_questions.exam_id));
drop policy if exists "write" on public.online_exam_questions;
create policy "write" on public.online_exam_questions for all to authenticated
  using (exists (select 1 from public.online_exams e where e.id = online_exam_questions.exam_id and public.can_question(e.school_id, e.class_id, e.subject_id, 'exams.marks.edit') and e.status = 'draft'))
  with check (exists (select 1 from public.online_exams e where e.id = online_exam_questions.exam_id and public.can_question(e.school_id, e.class_id, e.subject_id, 'exams.marks.edit') and e.status = 'draft'));

drop policy if exists "read" on public.online_attempts;
create policy "read" on public.online_attempts for select to authenticated
  using (public.has_perm_school(school_id, 'exams.results.view')
         or exists (select 1 from public.online_exams e where e.id = online_attempts.exam_id and public.can_syllabus(e.school_id, e.class_id, e.subject_id, 'exams.marks.view')));
-- attempts are written only by the student-side functions

-- ───────────── Helpers ─────────────
create or replace function public._exam_hash(p_token text) returns text
language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;

-- the student behind a session token (sliding 4 hours); raises when the session is gone
create or replace function public._exam_student(p_token text) returns public.students
language plpgsql security definer set search_path = public as $$
declare es public.exam_sessions; s public.students;
begin
  select * into es from public.exam_sessions where token_hash = public._exam_hash(p_token);
  if es.token_hash is null or es.expires_at < now() then raise exception 'Your session has ended. Please sign in again.'; end if;
  select * into s from public.students where id = es.student_id and status = 'active';
  if s.id is null then raise exception 'Your session has ended. Please sign in again.'; end if;
  update public.exam_sessions set expires_at = now() + interval '4 hours' where token_hash = es.token_hash and expires_at < now() + interval '3 hours';
  return s;
end $$;
revoke execute on function public._exam_hash(text) from public, anon, authenticated;
revoke execute on function public._exam_student(text) from public, anon, authenticated;

-- scores one attempt from its own snapshot (paper, key, answers)
create or replace function public._grade_attempt(aid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.online_attempts; q jsonb; chosen jsonb; correct_ids jsonb; sc numeric := 0; mx numeric := 0; nc int := 0; nw int := 0; ns int := 0; neg boolean; marks numeric; negm numeric;
begin
  select * into a from public.online_attempts where id = aid;
  select negative_marking into neg from public.online_exams where id = a.exam_id;
  for q in select * from jsonb_array_elements(a.questions) loop
    marks := coalesce((q ->> 'marks')::numeric, 0);
    negm := case when neg then coalesce((q ->> 'neg')::numeric, 0) else 0 end;
    mx := mx + marks;
    chosen := coalesce(a.answers -> (q ->> 'id'), '[]'::jsonb);
    correct_ids := coalesce(a.key -> (q ->> 'id'), '[]'::jsonb);
    if jsonb_array_length(chosen) = 0 then ns := ns + 1;
    elsif (select coalesce(jsonb_agg(x order by x), '[]') from jsonb_array_elements_text(chosen) x) = (select coalesce(jsonb_agg(x order by x), '[]') from jsonb_array_elements_text(correct_ids) x) then
      sc := sc + marks; nc := nc + 1;
    else sc := sc - negm; nw := nw + 1; end if;
  end loop;
  update public.online_attempts set score = greatest(sc, 0), max_score = mx, correct = nc, wrong = nw, skipped = ns where id = aid;
end $$;
revoke execute on function public._grade_attempt(uuid) from public, anon, authenticated;

-- finishes an attempt (once)
create or replace function public._finish_attempt(aid uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.online_attempts set status = p_status, submitted_at = least(now(), deadline_at + interval '30 seconds') where id = aid and status = 'in_progress';
  if found then perform public._grade_attempt(aid); end if;
end $$;
revoke execute on function public._finish_attempt(uuid, text) from public, anon, authenticated;

-- ───────────── Teacher side ─────────────
create or replace function public.question_pool_size(sid uuid, p_class uuid, p_subject uuid, p_chapter text default null, p_difficulty text default null) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.question_bank q
   where q.school_id = sid and q.class_id = p_class and q.subject_id = p_subject and q.active
     and (nullif(btrim(coalesce(p_chapter, '')), '') is null or q.chapter = p_chapter)
     and (nullif(p_difficulty, '') is null or q.difficulty = p_difficulty)
     and (public.has_perm_school(sid, 'exams.setup.view') or public.can_syllabus(sid, p_class, p_subject, 'exams.marks.view'));
$$;

create or replace function public.online_exam_schedule(sid uuid, p_exam uuid, p_starts timestamptz, p_ends timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare e public.online_exams; n int; pool int; tm numeric;
begin
  select * into e from public.online_exams where id = p_exam and school_id = sid;
  if e.id is null or auth.uid() is null or not public.can_question(sid, e.class_id, e.subject_id, 'exams.marks.edit') then raise exception 'not allowed'; end if;
  if e.status not in ('draft', 'scheduled') then raise exception 'This exam is already %.', e.status; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then raise exception 'Choose a start and an end time (end after start).'; end if;
  if p_ends < now() then raise exception 'The end time is already over.'; end if;
  if p_ends - p_starts < make_interval(mins => e.duration_min) then raise exception 'The window is shorter than the exam duration (% minutes).', e.duration_min; end if;
  if e.pool_mode = 'fixed' then
    select count(*), coalesce(sum(marks), 0) into n, tm from public.online_exam_questions where exam_id = p_exam;
    if n = 0 then raise exception 'Add at least one question.'; end if;
  else
    if e.random_count is null then raise exception 'Say how many questions to draw at random.'; end if;
    pool := public.question_pool_size(sid, e.class_id, e.subject_id, e.pool_filter ->> 'chapter', e.pool_filter ->> 'difficulty');
    if pool < e.random_count then raise exception 'Only % questions match the pool but % are to be drawn. Add questions or reduce the count.', pool, e.random_count; end if;
    select coalesce(avg(marks), 1) * e.random_count into tm from public.question_bank q
     where q.school_id = sid and q.class_id = e.class_id and q.subject_id = e.subject_id and q.active
       and (nullif(e.pool_filter ->> 'chapter', '') is null or q.chapter = e.pool_filter ->> 'chapter')
       and (nullif(e.pool_filter ->> 'difficulty', '') is null or q.difficulty = e.pool_filter ->> 'difficulty');
  end if;
  update public.online_exams set starts_at = p_starts, ends_at = p_ends, status = 'scheduled', total_marks = round(tm, 2) where id = p_exam;
end $$;

create or replace function public.online_exam_unschedule(sid uuid, p_exam uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.online_exams;
begin
  select * into e from public.online_exams where id = p_exam and school_id = sid;
  if e.id is null or auth.uid() is null or not public.can_question(sid, e.class_id, e.subject_id, 'exams.marks.edit') then raise exception 'not allowed'; end if;
  if e.status <> 'scheduled' then raise exception 'Only a scheduled exam can go back to draft.'; end if;
  if exists (select 1 from public.online_attempts where exam_id = p_exam) then raise exception 'Students have already started this exam.'; end if;
  update public.online_exams set status = 'draft' where id = p_exam;
end $$;

-- ends the exam: whatever is still running is submitted
create or replace function public.online_exam_close(sid uuid, p_exam uuid) returns int
language plpgsql security definer set search_path = public as $$
declare e public.online_exams; a record; n int := 0;
begin
  select * into e from public.online_exams where id = p_exam and school_id = sid;
  if e.id is null or auth.uid() is null or not public.can_question(sid, e.class_id, e.subject_id, 'exams.marks.edit') then raise exception 'not allowed'; end if;
  if e.status not in ('scheduled', 'closed') then raise exception 'This exam is %.', e.status; end if;
  for a in select id from public.online_attempts where exam_id = p_exam and status = 'in_progress' loop
    perform public._finish_attempt(a.id, 'auto_submitted'); n := n + 1;
  end loop;
  update public.online_exams set status = 'closed', ends_at = least(coalesce(ends_at, now()), now()) where id = p_exam;
  return n;
end $$;

-- declares the result: students can see their score; with push, the score becomes the subject mark of the linked offline exam
create or replace function public.online_exam_declare(sid uuid, p_exam uuid, p_push boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.online_exams; a record; es public.exam_subjects; pushed int := 0; absent_n int := 0; sub int;
begin
  select * into e from public.online_exams where id = p_exam and school_id = sid;
  if e.id is null or auth.uid() is null or not public.has_perm_school(sid, 'exams.results.publish') then raise exception 'not allowed'; end if;
  if e.status = 'draft' then raise exception 'Schedule and run the exam first.'; end if;
  if e.status = 'scheduled' and coalesce(e.ends_at, now()) > now() then raise exception 'The exam window is still open. Close the exam first.'; end if;
  for a in select id from public.online_attempts where exam_id = p_exam and status = 'in_progress' loop perform public._finish_attempt(a.id, 'auto_submitted'); end loop;
  update public.online_exams set status = 'declared' where id = p_exam;
  if p_push then
    if e.exam_id is null then raise exception 'Link this online exam to an offline exam to push marks.'; end if;
    select * into es from public.exam_subjects where exam_id = e.exam_id and class_id = e.class_id and subject_id = e.subject_id;
    if es.id is null then raise exception 'The linked exam has no % subject for this class.', 'matching'; end if;
    perform set_config('app.marks_bypass', '1', true);
    for a in select at.student_id, at.score, at.max_score from public.online_attempts at where at.exam_id = p_exam and at.status <> 'in_progress' loop
      insert into public.marks (school_id, exam_id, student_id, subject_id, marks, absent, entered_by, updated_at)
      values (sid, e.exam_id, a.student_id, e.subject_id, round(case when a.max_score > 0 then es.max_marks * a.score / a.max_score else 0 end, 1), false, 'Online exam', now())
      on conflict (exam_id, student_id, subject_id) do update set marks = excluded.marks, absent = false, entered_by = 'Online exam', updated_at = now();
      pushed := pushed + 1;
    end loop;
    insert into public.marks (school_id, exam_id, student_id, subject_id, marks, absent, entered_by, updated_at)
    select sid, e.exam_id, s.id, e.subject_id, null, true, 'Online exam', now()
      from public.students s where s.school_id = sid and s.class_id = e.class_id and s.status = 'active'
       and not exists (select 1 from public.online_attempts at where at.exam_id = p_exam and at.student_id = s.id)
    on conflict (exam_id, student_id, subject_id) do nothing;
    get diagnostics absent_n = row_count;
    perform set_config('app.marks_bypass', '', true);
  end if;
  return jsonb_build_object('graded', (select count(*) from public.online_attempts where exam_id = p_exam), 'pushed', pushed, 'absent', absent_n);
end $$;

-- who is taking the exam, with search / filter / paging
create or replace function public.online_attempt_list(sid uuid, p_exam uuid, p_q text default null, p_status text default null, p_limit int default 25, p_offset int default 0)
returns table (attempt_id uuid, student_id uuid, admission_no text, student_name text, section_name text, status text, started_at timestamptz, submitted_at timestamptz,
               score numeric, max_score numeric, correct int, wrong int, skipped int, tab_switches int, ip text, rank bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select a.id, s.id, s.admission_no, btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)), sec.name, a.status, a.started_at, a.submitted_at,
         a.score, a.max_score, a.correct, a.wrong, a.skipped, a.tab_switches, a.ip,
         case when a.score is not null then rank() over (order by a.score desc nulls last) end, count(*) over ()
    from public.online_attempts a
    join public.students s on s.id = a.student_id
    join public.online_exams oe on oe.id = a.exam_id
    left join public.sections sec on sec.id = s.section_id
   where a.exam_id = p_exam and a.school_id = sid
     and (public.has_perm_school(sid, 'exams.results.view') or public.can_syllabus(sid, oe.class_id, oe.subject_id, 'exams.marks.view'))
     and (p_status is null or a.status = p_status)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', s.first_name, s.last_name, s.admission_no) ilike public.like_escape(btrim(p_q)))
   order by a.score desc nulls last, s.first_name
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── Student side (service role only) ─────────────
create or replace function public.exam_public_info(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select e0.title, e0.status, sc.name as school, sc.code, sc.logo_url into e from public.online_exams e0 join public.schools sc on sc.id = e0.school_id where e0.public_token = p_token;
  if e.title is null then raise exception 'This exam link is not valid.'; end if;
  return jsonb_build_object('title', e.title, 'school', e.school, 'school_code', e.code, 'logo', e.logo_url);
end $$;

create or replace function public.exam_login(p_school_code text, p_adm text, p_dob date, p_ip text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sc public.schools; s public.students; tok text; k text; fails int;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into sc from public.schools where lower(code) = lower(btrim(coalesce(p_school_code, ''))) and status = 'active';
  k := lower(coalesce(sc.code, 'x')) || ':' || lower(btrim(coalesce(p_adm, ''))) ;
  -- locked when this admission number OR this address failed 8 times in 15 minutes
  select max(c) into fails from (select count(*) c from public.exam_login_failures where key in (k, 'ip:' || coalesce(p_ip, '')) and at > now() - interval '15 minutes' group by key) x;
  if coalesce(fails, 0) >= 8 then return jsonb_build_object('error', 'Too many wrong attempts. Please wait 15 minutes and try again.'); end if;
  if sc.id is not null then
    select * into s from public.students where school_id = sc.id and lower(admission_no) = lower(btrim(coalesce(p_adm, ''))) and dob = p_dob and status = 'active';
  end if;
  if s.id is null then
    -- not an exception: the failure must be kept (a raised error would roll the insert back)
    insert into public.exam_login_failures (school_id, key) values (sc.id, k), (sc.id, 'ip:' || coalesce(p_ip, ''));
    return jsonb_build_object('error', 'Admission number or date of birth is not correct.');
  end if;
  delete from public.exam_sessions where student_id = s.id;                                   -- one device at a time
  tok := encode(gen_random_bytes(24), 'hex');
  insert into public.exam_sessions (token_hash, school_id, student_id, expires_at, ip) values (public._exam_hash(tok), sc.id, s.id, now() + interval '4 hours', left(p_ip, 60));
  return jsonb_build_object('token', tok, 'name', btrim(concat_ws(' ', s.first_name, s.last_name)), 'school', sc.name);
end $$;

create or replace function public.exam_logout(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  delete from public.exam_sessions where token_hash = public._exam_hash(p_token);
end $$;

-- the student's exams: upcoming, live, finished
create or replace function public.exam_portal(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.students; sc text; cn text;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  s := public._exam_student(p_token);
  select name into sc from public.schools where id = s.school_id;
  select name into cn from public.classes where id = s.class_id;
  return jsonb_build_object(
    'student', btrim(concat_ws(' ', s.first_name, s.last_name)), 'school', sc, 'class', cn,
    'exams', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', e.id, 'title', e.title, 'subject', sb.name, 'duration_min', e.duration_min, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'total_marks', e.total_marks,
          'needs_code', e.access_code is not null, 'status', e.status,
          'state', case when a.id is not null and a.status = 'in_progress' and a.deadline_at > now() then 'running'
                        when a.id is not null then 'done'
                        when e.status = 'scheduled' and now() < e.starts_at then 'upcoming'
                        when e.status = 'scheduled' and now() <= e.ends_at then 'open'
                        else 'missed' end,
          'score', case when a.status <> 'in_progress' and (e.show_result = 'immediately' or (e.show_result = 'after_declare' and e.status = 'declared')) then a.score end,
          'max_score', case when a.status <> 'in_progress' and (e.show_result = 'immediately' or (e.show_result = 'after_declare' and e.status = 'declared')) then a.max_score end
        ) order by e.starts_at desc)
      from public.online_exams e
      join public.subjects sb on sb.id = e.subject_id
      left join public.online_attempts a on a.exam_id = e.id and a.student_id = s.id
     where e.school_id = s.school_id and e.class_id = s.class_id and e.status in ('scheduled', 'closed', 'declared')
       and (e.starts_at is null or e.starts_at > now() - interval '60 days')), '[]'::jsonb));
end $$;

-- begins (or resumes) the attempt and returns the paper — without answers
create or replace function public.exam_start(p_token text, p_exam uuid, p_code text, p_ip text, p_ua text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.students; e public.online_exams; a public.online_attempts; qs jsonb := '[]'; key jsonb := '{}'; r record; opts jsonb; n int;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  s := public._exam_student(p_token);
  select * into e from public.online_exams where id = p_exam and school_id = s.school_id and class_id = s.class_id;
  if e.id is null then raise exception 'This exam is not available for you.'; end if;
  select * into a from public.online_attempts where exam_id = p_exam and student_id = s.id;
  if a.id is not null then
    if a.status = 'in_progress' and a.deadline_at > now() then
      update public.online_attempts set last_seen_at = now(), ip = coalesce(left(p_ip, 60), ip) where id = a.id;
      return public.exam_state(p_token, p_exam);
    end if;
    if a.status = 'in_progress' then perform public._finish_attempt(a.id, 'auto_submitted'); end if;
    raise exception 'You have already taken this exam.';
  end if;
  if e.status <> 'scheduled' then raise exception 'This exam is not open.'; end if;
  if now() < e.starts_at then raise exception 'The exam has not started yet.'; end if;
  if now() > e.ends_at then raise exception 'The exam window has closed.'; end if;
  if e.access_code is not null and lower(btrim(coalesce(p_code, ''))) <> lower(e.access_code) then raise exception 'The exam code is not correct. Ask your teacher.'; end if;

  if e.pool_mode = 'fixed' then
    for r in select q.*, oq.marks as em from public.online_exam_questions oq join public.question_bank q on q.id = oq.question_id where oq.exam_id = p_exam
             order by case when e.shuffle_questions then random() else oq.sort end, oq.sort loop
      opts := r.options;
      if e.shuffle_options and r.kind <> 'truefalse' then select coalesce(jsonb_agg(o order by random()), '[]') into opts from jsonb_array_elements(r.options) o; end if;
      qs := qs || jsonb_build_array(jsonb_build_object('id', r.id, 'kind', r.kind, 'text', r.text, 'marks', r.em, 'neg', r.negative_marks, 'options', opts));
      key := key || jsonb_build_object(r.id::text, r.answer);
    end loop;
  else
    for r in select q.* from public.question_bank q
              where q.school_id = e.school_id and q.class_id = e.class_id and q.subject_id = e.subject_id and q.active
                and (nullif(e.pool_filter ->> 'chapter', '') is null or q.chapter = e.pool_filter ->> 'chapter')
                and (nullif(e.pool_filter ->> 'difficulty', '') is null or q.difficulty = e.pool_filter ->> 'difficulty')
              order by random() limit e.random_count loop
      opts := r.options;
      if e.shuffle_options and r.kind <> 'truefalse' then select coalesce(jsonb_agg(o order by random()), '[]') into opts from jsonb_array_elements(r.options) o; end if;
      qs := qs || jsonb_build_array(jsonb_build_object('id', r.id, 'kind', r.kind, 'text', r.text, 'marks', r.marks, 'neg', r.negative_marks, 'options', opts));
      key := key || jsonb_build_object(r.id::text, r.answer);
    end loop;
  end if;
  n := jsonb_array_length(qs);
  if n = 0 then raise exception 'This exam has no questions yet. Please tell your teacher.'; end if;

  insert into public.online_attempts (school_id, exam_id, student_id, deadline_at, questions, key, ip, user_agent, last_seen_at)
  values (s.school_id, p_exam, s.id, least(now() + make_interval(mins => e.duration_min), e.ends_at), qs, key, left(p_ip, 60), left(p_ua, 200), now());
  return public.exam_state(p_token, p_exam);
end $$;

-- current paper, answers so far and the seconds left on the server's clock
create or replace function public.exam_state(p_token text, p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.students; a public.online_attempts; e public.online_exams;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  s := public._exam_student(p_token);
  select * into a from public.online_attempts where exam_id = p_exam and student_id = s.id;
  if a.id is null then raise exception 'You have not started this exam.'; end if;
  select * into e from public.online_exams where id = p_exam;
  if a.status = 'in_progress' and a.deadline_at <= now() then
    perform public._finish_attempt(a.id, 'auto_submitted');
    select * into a from public.online_attempts where id = a.id;
  end if;
  return jsonb_build_object(
    'exam', jsonb_build_object('id', e.id, 'title', e.title, 'instructions', e.instructions, 'duration_min', e.duration_min, 'max_tab_switches', e.max_tab_switches,
                               'require_fullscreen', e.require_fullscreen, 'total_marks', e.total_marks, 'negative_marking', e.negative_marking),
    'status', a.status,
    'remaining_s', case when a.status = 'in_progress' then greatest(extract(epoch from a.deadline_at - now()), 0)::int else 0 end,
    'questions', case when a.status = 'in_progress' then a.questions else '[]'::jsonb end,
    'answers', case when a.status = 'in_progress' then a.answers else '{}'::jsonb end,
    'tab_switches', a.tab_switches);
end $$;

create or replace function public.exam_answer(p_token text, p_exam uuid, p_question uuid, p_ans jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.students; a public.online_attempts; q jsonb; valid jsonb;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  s := public._exam_student(p_token);
  select * into a from public.online_attempts where exam_id = p_exam and student_id = s.id for update;
  if a.id is null or a.status <> 'in_progress' then raise exception 'This exam is already submitted.'; end if;
  if a.deadline_at <= now() then perform public._finish_attempt(a.id, 'auto_submitted'); raise exception 'Time is over. Your answers were submitted.'; end if;
  select x into q from jsonb_array_elements(a.questions) x where x ->> 'id' = p_question::text;
  if q is null then raise exception 'Unknown question.'; end if;
  if jsonb_typeof(coalesce(p_ans, '[]'::jsonb)) <> 'array' then raise exception 'Bad answer.'; end if;
  select coalesce(jsonb_agg(v), '[]') into valid from jsonb_array_elements_text(coalesce(p_ans, '[]'::jsonb)) v
   where exists (select 1 from jsonb_array_elements(q -> 'options') o where o ->> 'id' = v);
  if q ->> 'kind' in ('single', 'truefalse') and jsonb_array_length(valid) > 1 then valid := jsonb_build_array(valid -> 0); end if;
  update public.online_attempts set answers = jsonb_set(answers, array[p_question::text], valid, true), last_seen_at = now() where id = a.id;
  return jsonb_build_object('saved', true, 'remaining_s', greatest(extract(epoch from a.deadline_at - now()), 0)::int);
end $$;

create or replace function public.exam_event(p_token text, p_exam uuid, p_kind text, p_detail text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.students; a public.online_attempts; e public.online_exams; sw int; over boolean := false;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  s := public._exam_student(p_token);
  select * into a from public.online_attempts where exam_id = p_exam and student_id = s.id for update;
  if a.id is null or a.status <> 'in_progress' then return jsonb_build_object('status', coalesce(a.status, 'none')); end if;
  select * into e from public.online_exams where id = p_exam;
  p_kind := left(coalesce(p_kind, 'event'), 30);
  sw := a.tab_switches + case when p_kind in ('tab_hidden', 'window_blur', 'fullscreen_exit') then 1 else 0 end;
  update public.online_attempts set tab_switches = sw, last_seen_at = now(),
         events = case when jsonb_array_length(events) < 200 then events || jsonb_build_array(jsonb_build_object('t', now(), 'k', p_kind, 'd', left(p_detail, 80))) else events end
   where id = a.id;
  if e.max_tab_switches > 0 and sw > e.max_tab_switches then
    perform public._finish_attempt(a.id, 'terminated'); over := true;
  end if;
  return jsonb_build_object('tab_switches', sw, 'limit', e.max_tab_switches, 'terminated', over);
end $$;

create or replace function public.exam_submit(p_token text, p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.students; a public.online_attempts;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  s := public._exam_student(p_token);
  select * into a from public.online_attempts where exam_id = p_exam and student_id = s.id;
  if a.id is null then raise exception 'You have not started this exam.'; end if;
  perform public._finish_attempt(a.id, 'submitted');
  return public.exam_result(p_token, p_exam);
end $$;

-- what the student may see after finishing
create or replace function public.exam_result(p_token text, p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.students; a public.online_attempts; e public.online_exams; show boolean; rev jsonb := '[]'::jsonb;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  s := public._exam_student(p_token);
  select * into a from public.online_attempts where exam_id = p_exam and student_id = s.id;
  select * into e from public.online_exams where id = p_exam;
  if a.id is null then raise exception 'You have not taken this exam.'; end if;
  show := a.status <> 'in_progress' and (e.show_result = 'immediately' or (e.show_result = 'after_declare' and e.status = 'declared'));
  if show and e.show_answers then
    select coalesce(jsonb_agg(jsonb_build_object('text', q ->> 'text', 'options', q -> 'options', 'chosen', coalesce(a.answers -> (q ->> 'id'), '[]'::jsonb),
                                                 'correct', a.key -> (q ->> 'id'), 'explanation', (select explanation from public.question_bank b where b.id = (q ->> 'id')::uuid))), '[]')
      into rev from jsonb_array_elements(a.questions) q;
  end if;
  return jsonb_build_object('title', e.title, 'status', a.status, 'submitted', a.status <> 'in_progress', 'shown', show,
    'score', case when show then a.score end, 'max_score', case when show then a.max_score end, 'correct', case when show then a.correct end,
    'wrong', case when show then a.wrong end, 'skipped', case when show then a.skipped end,
    'passed', case when show and a.max_score > 0 then 100.0 * a.score / a.max_score >= e.pass_percent end, 'review', rev,
    'terminated', a.status = 'terminated');
end $$;

do $$
declare f text;
begin
  foreach f in array array['exam_public_info(text)', 'exam_login(text, text, date, text)', 'exam_logout(text)', 'exam_portal(text)', 'exam_start(text, uuid, text, text, text)',
                           'exam_state(text, uuid)', 'exam_answer(text, uuid, uuid, jsonb)', 'exam_event(text, uuid, text, text)', 'exam_submit(text, uuid)', 'exam_result(text, uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['online_exams', 'question_bank'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
