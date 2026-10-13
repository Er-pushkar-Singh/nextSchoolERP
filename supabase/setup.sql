-- School ERP: full database setup (migrations 0001–0020 combined).
-- Paste into Supabase SQL Editor and Run. Safe to run again; existing data and members are kept.
-- Works in its own Supabase project or next to the CodersDuniya website/CRM tables (no name clashes).

-- CodersDuniya School ERP — multi-tenant schema with Row Level Security.
-- Every row belongs to a school; staff only ever see their own school's data.
-- Roles per school: admin, accountant, reception, teacher. Platform admins (CodersDuniya) can onboard schools.

create extension if not exists pgcrypto;

-- ───────────────────────── Platform & schools ─────────────────────────
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.schools (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  name              text not null,
  code              text unique not null check (code ~ '^[a-z0-9-]{3,30}$'),
  board             text not null default 'CBSE' check (board in ('CBSE','ICSE','UP Board','State Board','Other')),
  address           text,
  city              text,
  state             text default 'Uttar Pradesh',
  pincode           text,
  phone             text,
  email             text,
  principal_name    text,
  udise_code        text,
  affiliation_no    text,
  upi_id            text,
  bank_details      text,
  receipt_prefix    text not null default 'R',
  next_receipt_no   int  not null default 1,
  admission_prefix  text not null default '',
  next_admission_no int  not null default 1,
  grade_scale       jsonb not null default '[{"min":91,"grade":"A1"},{"min":81,"grade":"A2"},{"min":71,"grade":"B1"},{"min":61,"grade":"B2"},{"min":51,"grade":"C1"},{"min":41,"grade":"C2"},{"min":33,"grade":"D"},{"min":0,"grade":"E"}]',
  late_fine_per_day numeric(10,2) not null default 0,
  whatsapp_footer   text,
  plan              text not null default 'trial' check (plan in ('trial','standard','premium')),
  student_limit     int  not null default 2000,
  price_per_student numeric(10,2) not null default 99,
  status            text not null default 'active' check (status in ('active','suspended'))
);

create table if not exists public.school_members (
  school_id  uuid not null references public.schools(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','accountant','reception','teacher')),
  name       text,
  email      text,
  phone      text,
  created_at timestamptz not null default now(),
  primary key (school_id, user_id)
);
create index if not exists school_members_user_idx on public.school_members (user_id);

-- ───────────────────────── Access helpers ─────────────────────────
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- (superseded by the permission engine in 0003; plpgsql so re-running this file never fails)
create or replace function public.school_role(sid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return (select null::text);
end $$;

create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (select 1 from public.school_members where school_id = sid and user_id = auth.uid());
$$;

create or replace function public.has_role(sid uuid, roles text[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_platform_admin();
end $$;

-- ───────────────────────── Academic setup ─────────────────────────
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null,                     -- 2026-27
  start_date date not null,
  end_date   date not null,
  is_current boolean not null default false,
  unique (school_id, name)
);

create table if not exists public.classes (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name      text not null,
  sort      int  not null default 0,
  unique (school_id, name)
);

create table if not exists public.sections (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id) on delete cascade,
  class_id           uuid not null references public.classes(id) on delete cascade,
  name               text not null default 'A',
  class_teacher_id   uuid references auth.users(id) on delete set null,
  unique (class_id, name)
);

create table if not exists public.subjects (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name      text not null,
  code      text,
  sort      int  not null default 0,
  unique (school_id, name)
);

-- ───────────────────────── Students & admissions ─────────────────────────
create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  admission_no    text not null,
  first_name      text not null,
  last_name       text,
  gender          text check (gender in ('M','F','O')),
  dob             date,
  class_id        uuid references public.classes(id) on delete set null,
  section_id      uuid references public.sections(id) on delete set null,
  roll_no         int,
  father_name     text,
  mother_name     text,
  guardian_phone  text,               -- WhatsApp number for reminders
  alt_phone       text,
  email           text,
  address         text,
  city            text,
  admission_date  date default (now() at time zone 'Asia/Kolkata')::date,
  category        text check (category in ('General','OBC','SC','ST','EWS','Other')),
  blood_group     text,
  transport_route text,
  status          text not null default 'active' check (status in ('active','left','passed_out')),
  notes           text,
  portal_token    text unique not null default encode(gen_random_bytes(16), 'hex'),
  unique (school_id, admission_no)
);
create index if not exists students_class_idx on public.students (school_id, class_id, section_id, status);
create index if not exists students_name_idx on public.students (school_id, lower(first_name));

create table if not exists public.enquiries (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  student_name   text not null,
  class_sought   text,
  parent_name    text,
  phone          text,
  email          text,
  source         text,
  status         text not null default 'new' check (status in ('new','contacted','visited','test','admitted','lost')),
  follow_up_date date,
  notes          text,
  student_id     uuid references public.students(id) on delete set null
);
create index if not exists enquiries_school_idx on public.enquiries (school_id, status);

-- ───────────────────────── Fees ─────────────────────────
create table if not exists public.fee_heads (
  id        uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name      text not null,
  sort      int  not null default 0,
  unique (school_id, name)
);

-- Fee structure: one row per class × head × instalment
create table if not exists public.fee_plans (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  class_id    uuid not null references public.classes(id) on delete cascade,
  fee_head_id uuid not null references public.fee_heads(id) on delete cascade,
  label       text not null,             -- e.g. "Apr–Jun", "Annual"
  due_date    date not null,
  amount      numeric(10,2) not null check (amount >= 0)
);
create index if not exists fee_plans_idx on public.fee_plans (school_id, session_id, class_id);

create table if not exists public.student_concessions (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  fee_head_id uuid references public.fee_heads(id) on delete cascade,  -- null = all heads
  kind        text not null default 'percent' check (kind in ('percent','amount')),
  value       numeric(10,2) not null check (value >= 0),
  reason      text
);

-- What each student owes, per instalment (generated from fee_plans)
create table if not exists public.fee_dues (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  fee_plan_id uuid references public.fee_plans(id) on delete set null,
  fee_head_id uuid references public.fee_heads(id) on delete set null,
  label       text not null,
  due_date    date not null,
  amount      numeric(10,2) not null check (amount >= 0),
  concession  numeric(10,2) not null default 0,
  fine        numeric(10,2) not null default 0,
  paid        numeric(10,2) not null default 0,
  status      text generated always as (
                case when paid >= amount - concession + fine then 'paid'
                     when paid > 0 then 'partial' else 'due' end) stored,
  unique (student_id, fee_plan_id)
);
create index if not exists fee_dues_student_idx on public.fee_dues (student_id, due_date);
create index if not exists fee_dues_school_idx on public.fee_dues (school_id, status, due_date);

create table if not exists public.fee_receipts (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  receipt_no       text not null,
  student_id       uuid not null references public.students(id) on delete restrict,
  paid_on          date not null default (now() at time zone 'Asia/Kolkata')::date,
  mode             text not null default 'cash' check (mode in ('cash','upi','cheque','bank_transfer','card','online')),
  reference        text,
  amount           numeric(10,2) not null check (amount > 0),
  note             text,
  collected_by     text,
  cancelled        boolean not null default false,
  cancelled_reason text,
  unique (school_id, receipt_no)
);
create index if not exists fee_receipts_day_idx on public.fee_receipts (school_id, paid_on);

create table if not exists public.fee_receipt_lines (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  receipt_id uuid not null references public.fee_receipts(id) on delete cascade,
  due_id     uuid not null references public.fee_dues(id) on delete restrict,
  amount     numeric(10,2) not null check (amount > 0)
);
create index if not exists fee_receipt_lines_due_idx on public.fee_receipt_lines (due_id);

-- Keep fee_dues.paid = sum of non-cancelled receipt lines
create or replace function public.recalc_due(did uuid) returns void
language sql security definer set search_path = public as $$
  update public.fee_dues d set paid = coalesce((
    select sum(l.amount) from public.fee_receipt_lines l join public.fee_receipts r on r.id = l.receipt_id
    where l.due_id = did and not r.cancelled), 0)
  where d.id = did;
$$;

create or replace function public.on_receipt_line() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_due(coalesce(new.due_id, old.due_id));
  return null;
end $$;
drop trigger if exists fee_receipt_lines_sync on public.fee_receipt_lines;
create trigger fee_receipt_lines_sync after insert or update or delete on public.fee_receipt_lines
for each row execute function public.on_receipt_line();

create or replace function public.on_receipt_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if new.cancelled is distinct from old.cancelled then
    for l in select due_id from public.fee_receipt_lines where receipt_id = new.id loop
      perform public.recalc_due(l.due_id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists fee_receipts_cancel on public.fee_receipts;
create trigger fee_receipts_cancel after update on public.fee_receipts
for each row execute function public.on_receipt_cancel();

-- Atomic numbering for receipts and admissions
create or replace function public.next_school_number(sid uuid, kind text) returns text
language plpgsql security definer set search_path = public as $$
declare n int; p text;
begin
  if kind = 'receipt' then
    if not public.has_role(sid, array['admin','accountant']) then raise exception 'not allowed'; end if;
    update public.schools set next_receipt_no = next_receipt_no + 1 where id = sid returning next_receipt_no - 1, receipt_prefix into n, p;
    return p || lpad(n::text, 5, '0');
  elsif kind = 'admission' then
    if not public.has_role(sid, array['admin','reception','accountant']) then raise exception 'not allowed'; end if;
    update public.schools set next_admission_no = next_admission_no + 1 where id = sid returning next_admission_no - 1, admission_prefix into n, p;
    return p || n::text;
  end if;
  raise exception 'unknown kind %', kind;
end $$;

-- Create dues for students from the fee structure (idempotent), applying concessions
create or replace function public.generate_dues(sid uuid, sess uuid, cls uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.has_role(sid, array['admin','accountant']) then raise exception 'not allowed'; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         least(p.amount, coalesce((
           select sum(case when c.kind = 'percent' then round(p.amount * c.value / 100, 2) else c.value end)
           from public.student_concessions c
           where c.student_id = s.id and (c.fee_head_id is null or c.fee_head_id = p.fee_head_id)), 0))
  from public.fee_plans p
  join public.fee_heads h on h.id = p.fee_head_id
  join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.status = 'active'
  where p.school_id = sid and p.session_id = sess and (cls is null or p.class_id = cls)
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ───────────────────────── Attendance ─────────────────────────
create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  class_id   uuid references public.classes(id) on delete set null,
  section_id uuid references public.sections(id) on delete set null,
  date       date not null,
  status     text not null check (status in ('P','A','L','H','LV')),  -- present, absent, late, half day, leave
  marked_by  text,
  marked_at  timestamptz not null default now(),
  unique (student_id, date)
);
create index if not exists attendance_day_idx on public.attendance (school_id, date, class_id, section_id);

-- ───────────────────────── Exams & marks ─────────────────────────
create table if not exists public.exams (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  name       text not null,
  start_date date,
  sort       int not null default 0,
  published  boolean not null default false,   -- visible on the parent link
  unique (school_id, session_id, name)
);

create table if not exists public.exam_subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  exam_id    uuid not null references public.exams(id) on delete cascade,
  class_id   uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  max_marks  numeric(6,2) not null default 100,
  unique (exam_id, class_id, subject_id)
);

create table if not exists public.marks (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  exam_id    uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  marks      numeric(6,2),
  absent     boolean not null default false,
  entered_by text,
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id, subject_id)
);

-- ───────────────────────── Notices ─────────────────────────
create table if not exists public.notices (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  title        text not null,
  body         text,
  class_id     uuid references public.classes(id) on delete cascade,  -- null = whole school
  published_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  created_by   text
);

-- ───────────────────────── updated_at ─────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists students_updated_at on public.students;
create trigger students_updated_at before update on public.students for each row execute function public.touch_updated_at();

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.platform_admins enable row level security;
drop policy if exists "self" on public.platform_admins;
create policy "self" on public.platform_admins for select to authenticated using (user_id = auth.uid());

alter table public.schools enable row level security;
drop policy if exists "members read" on public.schools;
create policy "members read" on public.schools for select to authenticated using (public.is_member(id));
drop policy if exists "admins update" on public.schools;
create policy "admins update" on public.schools for update to authenticated using (public.has_role(id, array['admin'])) with check (public.has_role(id, array['admin']));
drop policy if exists "platform insert" on public.schools;
create policy "platform insert" on public.schools for insert to authenticated with check (public.is_platform_admin());

alter table public.school_members enable row level security;
drop policy if exists "members read" on public.school_members;
create policy "members read" on public.school_members for select to authenticated using (public.is_member(school_id));
drop policy if exists "admins write" on public.school_members;
create policy "admins write" on public.school_members for all to authenticated using (public.has_role(school_id, array['admin'])) with check (public.has_role(school_id, array['admin']));

-- Policy helper: read = any member (or narrower), write = listed roles
do $$
declare
  t record;
begin
  for t in select * from (values
    ('sessions',            'all',                       'admin'),
    ('classes',             'all',                       'admin'),
    ('sections',            'all',                       'admin'),
    ('subjects',            'all',                       'admin'),
    ('students',            'all',                       'admin,reception,accountant'),
    ('enquiries',           'admin,reception,accountant','admin,reception,accountant'),
    ('fee_heads',           'all',                       'admin,accountant'),
    ('fee_plans',           'all',                       'admin,accountant'),
    ('student_concessions', 'admin,accountant,reception','admin,accountant'),
    ('fee_dues',            'admin,accountant,reception','admin,accountant'),
    ('fee_receipts',        'admin,accountant,reception','admin,accountant'),
    ('fee_receipt_lines',   'admin,accountant,reception','admin,accountant'),
    ('attendance',          'all',                       'admin,teacher'),
    ('exams',               'all',                       'admin'),
    ('exam_subjects',       'all',                       'admin,teacher'),
    ('marks',               'all',                       'admin,teacher'),
    ('notices',             'all',                       'admin,teacher,reception')
  ) as x(tbl, readers, writers) loop
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('drop policy if exists "read" on public.%I', t.tbl);
    execute format('drop policy if exists "write" on public.%I', t.tbl);
    if t.readers = 'all' then
      execute format('create policy "read" on public.%I for select to authenticated using (public.is_member(school_id))', t.tbl);
    else
      execute format('create policy "read" on public.%I for select to authenticated using (public.has_role(school_id, string_to_array(%L, '','')))', t.tbl, t.readers);
    end if;
    execute format('create policy "write" on public.%I for all to authenticated using (public.has_role(school_id, string_to_array(%L, '',''))) with check (public.has_role(school_id, string_to_array(%L, '','')))', t.tbl, t.writers, t.writers);
  end loop;
end $$;

-- "for all" policies also cover SELECT for writers; readers get SELECT via "read".

-- ───────────────────────── Onboarding helper (platform admin) ─────────────────────────
-- Creates a school with a current session, classes Nursery–12, section A, common subjects and fee heads.
create or replace function public.create_school(p_name text, p_code text, p_board text default 'CBSE', p_city text default 'Lucknow')
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; cid uuid; c text; i int := 0; yr int; sess uuid;
begin
  if not public.is_platform_admin() then raise exception 'not allowed'; end if;
  insert into public.schools (name, code, board, city) values (p_name, p_code, p_board, p_city) returning id into sid;
  yr := case when extract(month from now()) >= 4 then extract(year from now())::int else extract(year from now())::int - 1 end;
  insert into public.sessions (school_id, name, start_date, end_date, is_current)
    values (sid, yr || '-' || lpad(((yr + 1) % 100)::text, 2, '0'), make_date(yr, 4, 1), make_date(yr + 1, 3, 31), true) returning id into sess;
  foreach c in array array['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'] loop
    insert into public.classes (school_id, name, sort) values (sid, c, i) returning id into cid;
    insert into public.sections (school_id, class_id, name) values (sid, cid, 'A');
    i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['English','Hindi','Mathematics','Science','Social Science','Computer','Sanskrit','EVS','Drawing'] loop
    insert into public.subjects (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['Tuition Fee','Admission Fee','Annual Charges','Exam Fee','Transport Fee'] loop
    insert into public.fee_heads (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  return sid;
end $$;

-- ───────────────────────── Reporting functions (run with caller's RLS) ─────────────────────────
-- Aggregates live in SQL so dashboards stay correct beyond the API's 1,000-row page size.
create or replace function public.fee_summary(sid uuid, sess uuid, on_day date default (now() at time zone 'Asia/Kolkata')::date)
returns json language sql stable as $$
  select json_build_object(
    'billed',      coalesce((select sum(amount - concession + fine) from public.fee_dues where school_id = sid and session_id = sess), 0),
    'collected',   coalesce((select sum(paid) from public.fee_dues where school_id = sid and session_id = sess), 0),
    'concession',  coalesce((select sum(concession) from public.fee_dues where school_id = sid and session_id = sess), 0),
    'overdue',     coalesce((select sum(greatest(amount - concession + fine - paid, 0)) from public.fee_dues where school_id = sid and session_id = sess and due_date <= on_day), 0),
    'overdue_students', (select count(distinct student_id) from public.fee_dues where school_id = sid and session_id = sess and due_date <= on_day and status <> 'paid'),
    'outstanding', coalesce((select sum(greatest(amount - concession + fine - paid, 0)) from public.fee_dues where school_id = sid and session_id = sess), 0),
    'today',       coalesce((select sum(amount) from public.fee_receipts where school_id = sid and not cancelled and paid_on = on_day), 0),
    'today_count', (select count(*) from public.fee_receipts where school_id = sid and not cancelled and paid_on = on_day),
    'month',       coalesce((select sum(amount) from public.fee_receipts where school_id = sid and not cancelled and paid_on >= date_trunc('month', on_day)::date and paid_on <= on_day), 0)
  );
$$;

create or replace function public.class_fee_summary(sid uuid, sess uuid, on_day date default (now() at time zone 'Asia/Kolkata')::date)
returns table (class_id uuid, class_name text, sort int, students bigint, billed numeric, collected numeric, overdue numeric)
language sql stable as $$
  select c.id, c.name, c.sort, count(distinct d.student_id),
         coalesce(sum(d.amount - d.concession + d.fine), 0), coalesce(sum(d.paid), 0),
         coalesce(sum(case when d.due_date <= on_day then greatest(d.amount - d.concession + d.fine - d.paid, 0) else 0 end), 0)
  from public.classes c
  join public.students s on s.class_id = c.id
  join public.fee_dues d on d.student_id = s.id and d.session_id = sess
  where c.school_id = sid
  group by c.id, c.name, c.sort
  order by c.sort;
$$;

create or replace function public.defaulters(sid uuid, sess uuid, on_day date default (now() at time zone 'Asia/Kolkata')::date, cls uuid default null, min_amount numeric default 1)
returns table (student_id uuid, admission_no text, student_name text, father_name text, guardian_phone text, class_name text, section_name text, class_sort int,
               overdue numeric, oldest_due date, instalments bigint, portal_token text)
language sql stable as $$
  select s.id, s.admission_no, trim(s.first_name || ' ' || coalesce(s.last_name, '')), s.father_name, s.guardian_phone, c.name, sec.name, coalesce(c.sort, 999),
         sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), min(d.due_date), count(*), s.portal_token
  from public.fee_dues d
  join public.students s on s.id = d.student_id
  left join public.classes c on c.id = s.class_id
  left join public.sections sec on sec.id = s.section_id
  where d.school_id = sid and d.session_id = sess and d.due_date <= on_day and d.status <> 'paid' and s.status = 'active'
    and (cls is null or s.class_id = cls)
  group by s.id, c.name, sec.name, c.sort
  having sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) >= min_amount
  order by coalesce(c.sort, 999), sec.name, s.first_name;
$$;

create or replace function public.attendance_summary(sid uuid, on_day date)
returns table (class_id uuid, section_id uuid, marked bigint, present bigint, absent bigint)
language sql stable as $$
  select class_id, section_id, count(*), count(*) filter (where status in ('P','L','H')), count(*) filter (where status = 'A')
  from public.attendance where school_id = sid and date = on_day group by class_id, section_id;
$$;

create or replace function public.class_counts(sid uuid)
returns table (class_id uuid, section_id uuid, students bigint)
language sql stable as $$
  select class_id, section_id, count(*) from public.students where school_id = sid and status = 'active' group by class_id, section_id;
$$;

-- Collect a fee: creates the receipt, optional late fine, and allocates oldest-first — atomically.
create or replace function public.collect_fee(sid uuid, stu uuid, amt numeric, p_mode text, p_ref text, p_note text, p_paid_on date, p_fine numeric, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; rno text; left_amt numeric := amt; d record; take numeric; first_due uuid;
begin
  if not public.has_role(sid, array['admin','accountant']) then raise exception 'not allowed'; end if;
  if amt is null or amt <= 0 then raise exception 'Amount must be more than zero'; end if;
  perform 1 from public.students where id = stu and school_id = sid;
  if not found then raise exception 'Student not found'; end if;
  if coalesce(p_fine, 0) > 0 then
    select id into first_due from public.fee_dues where student_id = stu and school_id = sid and status <> 'paid' order by due_date, label limit 1;
    if first_due is null then raise exception 'No unpaid instalment to add the fine to'; end if;
    update public.fee_dues set fine = fine + p_fine where id = first_due;
  end if;
  if amt > (select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) from public.fee_dues where student_id = stu and school_id = sid) then
    raise exception 'Amount is more than the total due';
  end if;
  rno := public.next_school_number(sid, 'receipt');
  insert into public.fee_receipts (school_id, receipt_no, student_id, paid_on, mode, reference, amount, note, collected_by)
    values (sid, rno, stu, coalesce(p_paid_on, (now() at time zone 'Asia/Kolkata')::date), p_mode, p_ref, amt, p_note, p_by) returning id into rid;
  for d in select id, greatest(amount - concession + fine - paid, 0) as bal from public.fee_dues
           where student_id = stu and school_id = sid and status <> 'paid' order by due_date, label for update loop
    exit when left_amt <= 0;
    take := least(d.bal, left_amt);
    if take > 0 then
      insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, d.id, take);
      left_amt := left_amt - take;
    end if;
  end loop;
  return rid;
end $$;

-- ───────────────────────── Guards ─────────────────────────
-- School admins can edit their profile but not their plan, limits, status or code.
create or replace function public.guard_school_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() and auth.role() = 'authenticated' then
    new.plan := old.plan; new.student_limit := old.student_limit; new.price_per_student := old.price_per_student;
    new.status := old.status; new.code := old.code;
  end if;
  return new;
end $$;
drop trigger if exists schools_guard on public.schools;
create trigger schools_guard before update on public.schools for each row execute function public.guard_school_update();

-- Plan limit and suspension
create or replace function public.guard_student_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; st text; n int;
begin
  select student_limit, status into lim, st from public.schools where id = new.school_id;
  if st = 'suspended' then raise exception 'This school account is suspended. Please contact support.'; end if;
  select count(*) into n from public.students where school_id = new.school_id and status = 'active';
  if n >= lim then raise exception 'Student limit (%) reached for your plan. Please contact support to upgrade.', lim; end if;
  return new;
end $$;
drop trigger if exists students_guard on public.students;
create trigger students_guard before insert on public.students for each row execute function public.guard_student_insert();

-- Only one current session per school
create or replace function public.set_current_session(sid uuid, sess uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(sid, array['admin']) then raise exception 'not allowed'; end if;
  update public.sessions set is_current = (id = sess) where school_id = sid;
end $$;

-- Year-end promotion: every active student moves to the next class (by sort); the last class passes out.
create or replace function public.promote_students(sid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare moved int; passed int; top int;
begin
  if not public.has_role(sid, array['admin']) then raise exception 'not allowed'; end if;
  select max(sort) into top from public.classes where school_id = sid;
  update public.students s set status = 'passed_out'
    from public.classes c where c.id = s.class_id and s.school_id = sid and s.status = 'active' and c.sort = top;
  get diagnostics passed = row_count;
  with nxt as (
    select c.id as from_id, (select c2.id from public.classes c2 where c2.school_id = sid and c2.sort > c.sort order by c2.sort limit 1) as to_id
    from public.classes c where c.school_id = sid
  )
  update public.students s set class_id = nxt.to_id,
         section_id = coalesce((select x.id from public.sections x where x.class_id = nxt.to_id and x.name = (select name from public.sections where id = s.section_id)),
                               (select x.id from public.sections x where x.class_id = nxt.to_id order by x.name limit 1)),
         roll_no = null
    from nxt where s.class_id = nxt.from_id and nxt.to_id is not null and s.school_id = sid and s.status = 'active';
  get diagnostics moved = row_count;
  return json_build_object('promoted', moved, 'passed_out', passed);
end $$;

create or replace function public.platform_counts() returns table (school_id uuid, students bigint)
language sql stable security definer set search_path = public as $$
  select school_id, count(*) from public.students where status = 'active' and public.is_platform_admin() group by school_id;
$$;

-- GENERATED by scripts/gen-catalog.mjs from src/lib/catalog.json — do not edit by hand.
-- Module map: modules → sub-modules → permissions (module.submodule.action) + default role templates.

create table if not exists public.erp_modules (
  code text primary key, name text not null, grp text not null, tier text not null, core boolean not null default false, sort int not null default 0
);
create table if not exists public.erp_submodules (
  code text primary key, module_code text not null references public.erp_modules(code) on delete cascade,
  name text not null, built boolean not null default false, sort int not null default 0
);
create table if not exists public.erp_permissions (
  key text primary key, submodule_code text not null references public.erp_submodules(code) on delete cascade,
  module_code text not null references public.erp_modules(code) on delete cascade, action text not null
);
create table if not exists public.role_templates (
  code text primary key, name text not null, kind text not null check (kind in ('staff','family')),
  description text, locked boolean not null default false, sort int not null default 0
);
create table if not exists public.role_template_permissions (
  template_code text not null references public.role_templates(code) on delete cascade,
  perm_key text not null references public.erp_permissions(key) on delete cascade,
  scope text not null check (scope in ('school','assigned','own','child','self')),
  primary key (template_code, perm_key)
);

insert into public.erp_modules (code, name, grp, tier, core, sort) values
  ('dashboard', 'Dashboard', 'Core', 'MVP', true, 0),
  ('frontdesk', 'Front office & admissions', 'Core', 'MVP', false, 1),
  ('students', 'Student information', 'Core', 'MVP', false, 2),
  ('documents', 'Documents & templates', 'Academic', 'MVP', false, 3),
  ('academics', 'Academic setup', 'Academic', 'MVP', false, 4),
  ('homework', 'Homework & study material', 'Academic', 'Phase 2', false, 5),
  ('attendance', 'Attendance', 'Academic', 'MVP', false, 6),
  ('exams', 'Examinations', 'Academic', 'MVP', false, 7),
  ('fees', 'Fees', 'Finance', 'MVP', false, 8),
  ('accounts', 'Accounts', 'Finance', 'Phase 3', false, 9),
  ('hr', 'Staff & payroll', 'Operations', 'Phase 2', false, 10),
  ('comms', 'Communication', 'Communication', 'MVP', false, 11),
  ('transport', 'Transport', 'Operations', 'Phase 2', false, 12),
  ('library', 'Library', 'Operations', 'Phase 3', false, 13),
  ('hostel', 'Hostel', 'Operations', 'Phase 3', false, 14),
  ('inventory', 'Inventory & sales', 'Operations', 'Phase 3', false, 15),
  ('wellbeing', 'Health & discipline', 'Operations', 'Phase 3', false, 16),
  ('reports', 'Reports & analytics', 'Reports', 'MVP', false, 17),
  ('settings', 'Settings & security', 'Core', 'MVP', true, 18),
  ('support', 'Help & support', 'Core', 'MVP', true, 19)
on conflict (code) do update set name = excluded.name, grp = excluded.grp, tier = excluded.tier, core = excluded.core, sort = excluded.sort;

insert into public.erp_submodules (code, module_code, name, built, sort) values
  ('dashboard.overview', 'dashboard', 'Dashboard', true, 0),
  ('frontdesk.enquiries', 'frontdesk', 'Admission enquiries', true, 0),
  ('frontdesk.admissions', 'frontdesk', 'Admission applications, decisions & admit', true, 1),
  ('frontdesk.online_form', 'frontdesk', 'Online admission form (public link)', true, 2),
  ('frontdesk.visitors', 'frontdesk', 'Visitor & call log, gate pass', false, 3),
  ('students.profile', 'students', 'Student profile & guardians', true, 0),
  ('students.sensitive', 'students', 'Identity (PEN, APAAR), health & internal notes', true, 1),
  ('students.import', 'students', 'Bulk import', true, 2),
  ('students.promotion', 'students', 'Promotion & section change', true, 3),
  ('students.certificates', 'students', 'TC, bonafide & ID cards', true, 4),
  ('students.parent_link', 'students', 'Parent page link', true, 5),
  ('students.documents', 'students', 'Student documents', true, 6),
  ('students.board_reg', 'students', 'UP Board registration (Class 9-12)', true, 7),
  ('documents.templates', 'documents', 'Templates (TC, ID card, letters)', true, 0),
  ('documents.issue', 'documents', 'Issue, print & cancel documents', true, 1),
  ('academics.setup', 'academics', 'Sessions, classes, sections, subjects', true, 0),
  ('academics.allocation', 'academics', 'Class teacher & subject allocation', true, 1),
  ('academics.timetable', 'academics', 'Timetable', false, 2),
  ('academics.syllabus', 'academics', 'Syllabus & lesson plans', false, 3),
  ('homework.homework', 'homework', 'Homework & classwork', true, 0),
  ('homework.material', 'homework', 'Study material', true, 1),
  ('attendance.students', 'attendance', 'Student attendance', true, 0),
  ('attendance.leave', 'attendance', 'Student leave requests', false, 1),
  ('attendance.staff', 'attendance', 'Staff attendance', false, 2),
  ('exams.setup', 'exams', 'Exams, subjects & grading', true, 0),
  ('exams.marks', 'exams', 'Marks entry', true, 1),
  ('exams.results', 'exams', 'Report cards & publishing', true, 2),
  ('exams.admit_cards', 'exams', 'Date sheet & admit cards', false, 3),
  ('fees.structure', 'fees', 'Fee heads & structure', true, 0),
  ('fees.dues', 'fees', 'Generate dues', true, 1),
  ('fees.collection', 'fees', 'Fee collection', true, 2),
  ('fees.receipts', 'fees', 'Receipts & cancellation', true, 3),
  ('fees.concessions', 'fees', 'Concessions & scholarships', true, 4),
  ('fees.defaulters', 'fees', 'Defaulters & reminders', true, 5),
  ('fees.online', 'fees', 'Online payment', true, 6),
  ('fees.refunds', 'fees', 'Refunds', true, 7),
  ('accounts.vouchers', 'accounts', 'Income & expense vouchers', false, 0),
  ('accounts.books', 'accounts', 'Cash, bank & day book', false, 1),
  ('hr.staff', 'hr', 'Staff profiles & documents', true, 0),
  ('hr.leave', 'hr', 'Staff leave', true, 1),
  ('hr.payroll', 'hr', 'Salary & payslips', true, 2),
  ('comms.notices', 'comms', 'Notices & circulars', true, 0),
  ('comms.broadcast', 'comms', 'WhatsApp / SMS messages', true, 1),
  ('comms.templates', 'comms', 'Message templates', false, 2),
  ('comms.calendar', 'comms', 'Events calendar', false, 3),
  ('comms.messages', 'comms', 'Parent–teacher messages', false, 4),
  ('transport.routes', 'transport', 'Routes, stops & vehicles', true, 0),
  ('transport.allocation', 'transport', 'Student allocation', true, 1),
  ('transport.tracking', 'transport', 'GPS tracking', true, 2),
  ('library.catalogue', 'library', 'Book catalogue', true, 0),
  ('library.circulation', 'library', 'Issue & return', true, 1),
  ('hostel.rooms', 'hostel', 'Rooms & beds', false, 0),
  ('hostel.allocation', 'hostel', 'Resident allocation', false, 1),
  ('inventory.items', 'inventory', 'Items & stock', false, 0),
  ('inventory.sales', 'inventory', 'Uniform & book sales', false, 1),
  ('wellbeing.medical', 'wellbeing', 'Medical records', false, 0),
  ('wellbeing.discipline', 'wellbeing', 'Incidents & counselling', false, 1),
  ('reports.fees', 'reports', 'Fee reports', true, 0),
  ('reports.academic', 'reports', 'Academic reports', true, 1),
  ('reports.udise', 'reports', 'UDISE+ export', false, 2),
  ('settings.school', 'settings', 'School profile & numbering', true, 0),
  ('settings.billing', 'settings', 'Subscription & billing', true, 1),
  ('settings.users', 'settings', 'Staff logins', true, 2),
  ('settings.roles', 'settings', 'Roles & permissions', true, 3),
  ('settings.integrations', 'settings', 'Payment gateway, Cloudinary, SMS', false, 4),
  ('settings.backups', 'settings', 'Backups & data export', false, 5),
  ('settings.audit', 'settings', 'Audit log', false, 6),
  ('support.tickets', 'support', 'Support tickets to CodersDuniya', true, 0)
on conflict (code) do update set name = excluded.name, built = excluded.built, sort = excluded.sort;

insert into public.erp_permissions (key, submodule_code, module_code, action) values
  ('dashboard.overview.view', 'dashboard.overview', 'dashboard', 'view'),
  ('frontdesk.enquiries.view', 'frontdesk.enquiries', 'frontdesk', 'view'),
  ('frontdesk.enquiries.create', 'frontdesk.enquiries', 'frontdesk', 'create'),
  ('frontdesk.enquiries.edit', 'frontdesk.enquiries', 'frontdesk', 'edit'),
  ('frontdesk.enquiries.delete', 'frontdesk.enquiries', 'frontdesk', 'delete'),
  ('frontdesk.enquiries.export', 'frontdesk.enquiries', 'frontdesk', 'export'),
  ('frontdesk.admissions.view', 'frontdesk.admissions', 'frontdesk', 'view'),
  ('frontdesk.admissions.create', 'frontdesk.admissions', 'frontdesk', 'create'),
  ('frontdesk.admissions.edit', 'frontdesk.admissions', 'frontdesk', 'edit'),
  ('frontdesk.admissions.approve', 'frontdesk.admissions', 'frontdesk', 'approve'),
  ('frontdesk.admissions.export', 'frontdesk.admissions', 'frontdesk', 'export'),
  ('frontdesk.online_form.view', 'frontdesk.online_form', 'frontdesk', 'view'),
  ('frontdesk.online_form.edit', 'frontdesk.online_form', 'frontdesk', 'edit'),
  ('frontdesk.visitors.view', 'frontdesk.visitors', 'frontdesk', 'view'),
  ('frontdesk.visitors.create', 'frontdesk.visitors', 'frontdesk', 'create'),
  ('frontdesk.visitors.edit', 'frontdesk.visitors', 'frontdesk', 'edit'),
  ('frontdesk.visitors.delete', 'frontdesk.visitors', 'frontdesk', 'delete'),
  ('students.profile.view', 'students.profile', 'students', 'view'),
  ('students.profile.create', 'students.profile', 'students', 'create'),
  ('students.profile.edit', 'students.profile', 'students', 'edit'),
  ('students.profile.delete', 'students.profile', 'students', 'delete'),
  ('students.profile.export', 'students.profile', 'students', 'export'),
  ('students.profile.print', 'students.profile', 'students', 'print'),
  ('students.profile.block', 'students.profile', 'students', 'block'),
  ('students.sensitive.view', 'students.sensitive', 'students', 'view'),
  ('students.sensitive.edit', 'students.sensitive', 'students', 'edit'),
  ('students.import.create', 'students.import', 'students', 'create'),
  ('students.promotion.view', 'students.promotion', 'students', 'view'),
  ('students.promotion.create', 'students.promotion', 'students', 'create'),
  ('students.certificates.view', 'students.certificates', 'students', 'view'),
  ('students.certificates.create', 'students.certificates', 'students', 'create'),
  ('students.certificates.print', 'students.certificates', 'students', 'print'),
  ('students.certificates.approve', 'students.certificates', 'students', 'approve'),
  ('students.parent_link.view', 'students.parent_link', 'students', 'view'),
  ('students.parent_link.edit', 'students.parent_link', 'students', 'edit'),
  ('students.documents.view', 'students.documents', 'students', 'view'),
  ('students.documents.create', 'students.documents', 'students', 'create'),
  ('students.documents.edit', 'students.documents', 'students', 'edit'),
  ('students.documents.delete', 'students.documents', 'students', 'delete'),
  ('students.documents.approve', 'students.documents', 'students', 'approve'),
  ('students.board_reg.view', 'students.board_reg', 'students', 'view'),
  ('students.board_reg.create', 'students.board_reg', 'students', 'create'),
  ('students.board_reg.edit', 'students.board_reg', 'students', 'edit'),
  ('students.board_reg.approve', 'students.board_reg', 'students', 'approve'),
  ('students.board_reg.export', 'students.board_reg', 'students', 'export'),
  ('documents.templates.view', 'documents.templates', 'documents', 'view'),
  ('documents.templates.create', 'documents.templates', 'documents', 'create'),
  ('documents.templates.edit', 'documents.templates', 'documents', 'edit'),
  ('documents.templates.delete', 'documents.templates', 'documents', 'delete'),
  ('documents.issue.view', 'documents.issue', 'documents', 'view'),
  ('documents.issue.create', 'documents.issue', 'documents', 'create'),
  ('documents.issue.print', 'documents.issue', 'documents', 'print'),
  ('documents.issue.approve', 'documents.issue', 'documents', 'approve'),
  ('documents.issue.export', 'documents.issue', 'documents', 'export'),
  ('academics.setup.view', 'academics.setup', 'academics', 'view'),
  ('academics.setup.create', 'academics.setup', 'academics', 'create'),
  ('academics.setup.edit', 'academics.setup', 'academics', 'edit'),
  ('academics.setup.delete', 'academics.setup', 'academics', 'delete'),
  ('academics.allocation.view', 'academics.allocation', 'academics', 'view'),
  ('academics.allocation.create', 'academics.allocation', 'academics', 'create'),
  ('academics.allocation.edit', 'academics.allocation', 'academics', 'edit'),
  ('academics.allocation.delete', 'academics.allocation', 'academics', 'delete'),
  ('academics.timetable.view', 'academics.timetable', 'academics', 'view'),
  ('academics.timetable.create', 'academics.timetable', 'academics', 'create'),
  ('academics.timetable.edit', 'academics.timetable', 'academics', 'edit'),
  ('academics.timetable.delete', 'academics.timetable', 'academics', 'delete'),
  ('academics.timetable.print', 'academics.timetable', 'academics', 'print'),
  ('academics.syllabus.view', 'academics.syllabus', 'academics', 'view'),
  ('academics.syllabus.create', 'academics.syllabus', 'academics', 'create'),
  ('academics.syllabus.edit', 'academics.syllabus', 'academics', 'edit'),
  ('academics.syllabus.delete', 'academics.syllabus', 'academics', 'delete'),
  ('academics.syllabus.approve', 'academics.syllabus', 'academics', 'approve'),
  ('homework.homework.view', 'homework.homework', 'homework', 'view'),
  ('homework.homework.create', 'homework.homework', 'homework', 'create'),
  ('homework.homework.edit', 'homework.homework', 'homework', 'edit'),
  ('homework.homework.delete', 'homework.homework', 'homework', 'delete'),
  ('homework.material.view', 'homework.material', 'homework', 'view'),
  ('homework.material.create', 'homework.material', 'homework', 'create'),
  ('homework.material.edit', 'homework.material', 'homework', 'edit'),
  ('homework.material.delete', 'homework.material', 'homework', 'delete'),
  ('attendance.students.view', 'attendance.students', 'attendance', 'view'),
  ('attendance.students.create', 'attendance.students', 'attendance', 'create'),
  ('attendance.students.edit', 'attendance.students', 'attendance', 'edit'),
  ('attendance.students.export', 'attendance.students', 'attendance', 'export'),
  ('attendance.students.print', 'attendance.students', 'attendance', 'print'),
  ('attendance.leave.view', 'attendance.leave', 'attendance', 'view'),
  ('attendance.leave.create', 'attendance.leave', 'attendance', 'create'),
  ('attendance.leave.approve', 'attendance.leave', 'attendance', 'approve'),
  ('attendance.staff.view', 'attendance.staff', 'attendance', 'view'),
  ('attendance.staff.create', 'attendance.staff', 'attendance', 'create'),
  ('attendance.staff.edit', 'attendance.staff', 'attendance', 'edit'),
  ('attendance.staff.export', 'attendance.staff', 'attendance', 'export'),
  ('exams.setup.view', 'exams.setup', 'exams', 'view'),
  ('exams.setup.create', 'exams.setup', 'exams', 'create'),
  ('exams.setup.edit', 'exams.setup', 'exams', 'edit'),
  ('exams.setup.delete', 'exams.setup', 'exams', 'delete'),
  ('exams.marks.view', 'exams.marks', 'exams', 'view'),
  ('exams.marks.create', 'exams.marks', 'exams', 'create'),
  ('exams.marks.edit', 'exams.marks', 'exams', 'edit'),
  ('exams.marks.approve', 'exams.marks', 'exams', 'approve'),
  ('exams.results.view', 'exams.results', 'exams', 'view'),
  ('exams.results.print', 'exams.results', 'exams', 'print'),
  ('exams.results.publish', 'exams.results', 'exams', 'publish'),
  ('exams.admit_cards.view', 'exams.admit_cards', 'exams', 'view'),
  ('exams.admit_cards.create', 'exams.admit_cards', 'exams', 'create'),
  ('exams.admit_cards.print', 'exams.admit_cards', 'exams', 'print'),
  ('fees.structure.view', 'fees.structure', 'fees', 'view'),
  ('fees.structure.create', 'fees.structure', 'fees', 'create'),
  ('fees.structure.edit', 'fees.structure', 'fees', 'edit'),
  ('fees.structure.delete', 'fees.structure', 'fees', 'delete'),
  ('fees.dues.view', 'fees.dues', 'fees', 'view'),
  ('fees.dues.create', 'fees.dues', 'fees', 'create'),
  ('fees.collection.view', 'fees.collection', 'fees', 'view'),
  ('fees.collection.create', 'fees.collection', 'fees', 'create'),
  ('fees.collection.print', 'fees.collection', 'fees', 'print'),
  ('fees.collection.export', 'fees.collection', 'fees', 'export'),
  ('fees.receipts.view', 'fees.receipts', 'fees', 'view'),
  ('fees.receipts.print', 'fees.receipts', 'fees', 'print'),
  ('fees.receipts.export', 'fees.receipts', 'fees', 'export'),
  ('fees.receipts.approve', 'fees.receipts', 'fees', 'approve'),
  ('fees.concessions.view', 'fees.concessions', 'fees', 'view'),
  ('fees.concessions.create', 'fees.concessions', 'fees', 'create'),
  ('fees.concessions.delete', 'fees.concessions', 'fees', 'delete'),
  ('fees.concessions.approve', 'fees.concessions', 'fees', 'approve'),
  ('fees.defaulters.view', 'fees.defaulters', 'fees', 'view'),
  ('fees.defaulters.create', 'fees.defaulters', 'fees', 'create'),
  ('fees.defaulters.export', 'fees.defaulters', 'fees', 'export'),
  ('fees.online.view', 'fees.online', 'fees', 'view'),
  ('fees.online.create', 'fees.online', 'fees', 'create'),
  ('fees.refunds.view', 'fees.refunds', 'fees', 'view'),
  ('fees.refunds.create', 'fees.refunds', 'fees', 'create'),
  ('fees.refunds.approve', 'fees.refunds', 'fees', 'approve'),
  ('accounts.vouchers.view', 'accounts.vouchers', 'accounts', 'view'),
  ('accounts.vouchers.create', 'accounts.vouchers', 'accounts', 'create'),
  ('accounts.vouchers.edit', 'accounts.vouchers', 'accounts', 'edit'),
  ('accounts.vouchers.delete', 'accounts.vouchers', 'accounts', 'delete'),
  ('accounts.vouchers.approve', 'accounts.vouchers', 'accounts', 'approve'),
  ('accounts.vouchers.export', 'accounts.vouchers', 'accounts', 'export'),
  ('accounts.books.view', 'accounts.books', 'accounts', 'view'),
  ('accounts.books.export', 'accounts.books', 'accounts', 'export'),
  ('accounts.books.print', 'accounts.books', 'accounts', 'print'),
  ('hr.staff.view', 'hr.staff', 'hr', 'view'),
  ('hr.staff.create', 'hr.staff', 'hr', 'create'),
  ('hr.staff.edit', 'hr.staff', 'hr', 'edit'),
  ('hr.staff.delete', 'hr.staff', 'hr', 'delete'),
  ('hr.staff.export', 'hr.staff', 'hr', 'export'),
  ('hr.staff.block', 'hr.staff', 'hr', 'block'),
  ('hr.leave.view', 'hr.leave', 'hr', 'view'),
  ('hr.leave.create', 'hr.leave', 'hr', 'create'),
  ('hr.leave.approve', 'hr.leave', 'hr', 'approve'),
  ('hr.payroll.view', 'hr.payroll', 'hr', 'view'),
  ('hr.payroll.create', 'hr.payroll', 'hr', 'create'),
  ('hr.payroll.edit', 'hr.payroll', 'hr', 'edit'),
  ('hr.payroll.approve', 'hr.payroll', 'hr', 'approve'),
  ('hr.payroll.export', 'hr.payroll', 'hr', 'export'),
  ('hr.payroll.print', 'hr.payroll', 'hr', 'print'),
  ('comms.notices.view', 'comms.notices', 'comms', 'view'),
  ('comms.notices.create', 'comms.notices', 'comms', 'create'),
  ('comms.notices.edit', 'comms.notices', 'comms', 'edit'),
  ('comms.notices.delete', 'comms.notices', 'comms', 'delete'),
  ('comms.notices.publish', 'comms.notices', 'comms', 'publish'),
  ('comms.broadcast.create', 'comms.broadcast', 'comms', 'create'),
  ('comms.templates.view', 'comms.templates', 'comms', 'view'),
  ('comms.templates.create', 'comms.templates', 'comms', 'create'),
  ('comms.templates.edit', 'comms.templates', 'comms', 'edit'),
  ('comms.templates.delete', 'comms.templates', 'comms', 'delete'),
  ('comms.calendar.view', 'comms.calendar', 'comms', 'view'),
  ('comms.calendar.create', 'comms.calendar', 'comms', 'create'),
  ('comms.calendar.edit', 'comms.calendar', 'comms', 'edit'),
  ('comms.calendar.delete', 'comms.calendar', 'comms', 'delete'),
  ('comms.messages.view', 'comms.messages', 'comms', 'view'),
  ('comms.messages.create', 'comms.messages', 'comms', 'create'),
  ('transport.routes.view', 'transport.routes', 'transport', 'view'),
  ('transport.routes.create', 'transport.routes', 'transport', 'create'),
  ('transport.routes.edit', 'transport.routes', 'transport', 'edit'),
  ('transport.routes.delete', 'transport.routes', 'transport', 'delete'),
  ('transport.allocation.view', 'transport.allocation', 'transport', 'view'),
  ('transport.allocation.create', 'transport.allocation', 'transport', 'create'),
  ('transport.allocation.edit', 'transport.allocation', 'transport', 'edit'),
  ('transport.allocation.delete', 'transport.allocation', 'transport', 'delete'),
  ('transport.tracking.view', 'transport.tracking', 'transport', 'view'),
  ('library.catalogue.view', 'library.catalogue', 'library', 'view'),
  ('library.catalogue.create', 'library.catalogue', 'library', 'create'),
  ('library.catalogue.edit', 'library.catalogue', 'library', 'edit'),
  ('library.catalogue.delete', 'library.catalogue', 'library', 'delete'),
  ('library.circulation.view', 'library.circulation', 'library', 'view'),
  ('library.circulation.create', 'library.circulation', 'library', 'create'),
  ('library.circulation.edit', 'library.circulation', 'library', 'edit'),
  ('hostel.rooms.view', 'hostel.rooms', 'hostel', 'view'),
  ('hostel.rooms.create', 'hostel.rooms', 'hostel', 'create'),
  ('hostel.rooms.edit', 'hostel.rooms', 'hostel', 'edit'),
  ('hostel.rooms.delete', 'hostel.rooms', 'hostel', 'delete'),
  ('hostel.allocation.view', 'hostel.allocation', 'hostel', 'view'),
  ('hostel.allocation.create', 'hostel.allocation', 'hostel', 'create'),
  ('hostel.allocation.edit', 'hostel.allocation', 'hostel', 'edit'),
  ('hostel.allocation.delete', 'hostel.allocation', 'hostel', 'delete'),
  ('inventory.items.view', 'inventory.items', 'inventory', 'view'),
  ('inventory.items.create', 'inventory.items', 'inventory', 'create'),
  ('inventory.items.edit', 'inventory.items', 'inventory', 'edit'),
  ('inventory.items.delete', 'inventory.items', 'inventory', 'delete'),
  ('inventory.sales.view', 'inventory.sales', 'inventory', 'view'),
  ('inventory.sales.create', 'inventory.sales', 'inventory', 'create'),
  ('inventory.sales.print', 'inventory.sales', 'inventory', 'print'),
  ('wellbeing.medical.view', 'wellbeing.medical', 'wellbeing', 'view'),
  ('wellbeing.medical.create', 'wellbeing.medical', 'wellbeing', 'create'),
  ('wellbeing.medical.edit', 'wellbeing.medical', 'wellbeing', 'edit'),
  ('wellbeing.discipline.view', 'wellbeing.discipline', 'wellbeing', 'view'),
  ('wellbeing.discipline.create', 'wellbeing.discipline', 'wellbeing', 'create'),
  ('wellbeing.discipline.edit', 'wellbeing.discipline', 'wellbeing', 'edit'),
  ('reports.fees.view', 'reports.fees', 'reports', 'view'),
  ('reports.fees.export', 'reports.fees', 'reports', 'export'),
  ('reports.academic.view', 'reports.academic', 'reports', 'view'),
  ('reports.academic.export', 'reports.academic', 'reports', 'export'),
  ('reports.udise.export', 'reports.udise', 'reports', 'export'),
  ('settings.school.view', 'settings.school', 'settings', 'view'),
  ('settings.school.edit', 'settings.school', 'settings', 'edit'),
  ('settings.billing.view', 'settings.billing', 'settings', 'view'),
  ('settings.billing.create', 'settings.billing', 'settings', 'create'),
  ('settings.users.view', 'settings.users', 'settings', 'view'),
  ('settings.users.create', 'settings.users', 'settings', 'create'),
  ('settings.users.edit', 'settings.users', 'settings', 'edit'),
  ('settings.users.delete', 'settings.users', 'settings', 'delete'),
  ('settings.roles.view', 'settings.roles', 'settings', 'view'),
  ('settings.roles.create', 'settings.roles', 'settings', 'create'),
  ('settings.roles.edit', 'settings.roles', 'settings', 'edit'),
  ('settings.roles.delete', 'settings.roles', 'settings', 'delete'),
  ('settings.integrations.view', 'settings.integrations', 'settings', 'view'),
  ('settings.integrations.edit', 'settings.integrations', 'settings', 'edit'),
  ('settings.backups.view', 'settings.backups', 'settings', 'view'),
  ('settings.backups.create', 'settings.backups', 'settings', 'create'),
  ('settings.audit.view', 'settings.audit', 'settings', 'view'),
  ('support.tickets.view', 'support.tickets', 'support', 'view'),
  ('support.tickets.create', 'support.tickets', 'support', 'create')
on conflict (key) do nothing;
delete from public.erp_permissions where key not in ('dashboard.overview.view', 'frontdesk.enquiries.view', 'frontdesk.enquiries.create', 'frontdesk.enquiries.edit', 'frontdesk.enquiries.delete', 'frontdesk.enquiries.export', 'frontdesk.admissions.view', 'frontdesk.admissions.create', 'frontdesk.admissions.edit', 'frontdesk.admissions.approve', 'frontdesk.admissions.export', 'frontdesk.online_form.view', 'frontdesk.online_form.edit', 'frontdesk.visitors.view', 'frontdesk.visitors.create', 'frontdesk.visitors.edit', 'frontdesk.visitors.delete', 'students.profile.view', 'students.profile.create', 'students.profile.edit', 'students.profile.delete', 'students.profile.export', 'students.profile.print', 'students.profile.block', 'students.sensitive.view', 'students.sensitive.edit', 'students.import.create', 'students.promotion.view', 'students.promotion.create', 'students.certificates.view', 'students.certificates.create', 'students.certificates.print', 'students.certificates.approve', 'students.parent_link.view', 'students.parent_link.edit', 'students.documents.view', 'students.documents.create', 'students.documents.edit', 'students.documents.delete', 'students.documents.approve', 'students.board_reg.view', 'students.board_reg.create', 'students.board_reg.edit', 'students.board_reg.approve', 'students.board_reg.export', 'documents.templates.view', 'documents.templates.create', 'documents.templates.edit', 'documents.templates.delete', 'documents.issue.view', 'documents.issue.create', 'documents.issue.print', 'documents.issue.approve', 'documents.issue.export', 'academics.setup.view', 'academics.setup.create', 'academics.setup.edit', 'academics.setup.delete', 'academics.allocation.view', 'academics.allocation.create', 'academics.allocation.edit', 'academics.allocation.delete', 'academics.timetable.view', 'academics.timetable.create', 'academics.timetable.edit', 'academics.timetable.delete', 'academics.timetable.print', 'academics.syllabus.view', 'academics.syllabus.create', 'academics.syllabus.edit', 'academics.syllabus.delete', 'academics.syllabus.approve', 'homework.homework.view', 'homework.homework.create', 'homework.homework.edit', 'homework.homework.delete', 'homework.material.view', 'homework.material.create', 'homework.material.edit', 'homework.material.delete', 'attendance.students.view', 'attendance.students.create', 'attendance.students.edit', 'attendance.students.export', 'attendance.students.print', 'attendance.leave.view', 'attendance.leave.create', 'attendance.leave.approve', 'attendance.staff.view', 'attendance.staff.create', 'attendance.staff.edit', 'attendance.staff.export', 'exams.setup.view', 'exams.setup.create', 'exams.setup.edit', 'exams.setup.delete', 'exams.marks.view', 'exams.marks.create', 'exams.marks.edit', 'exams.marks.approve', 'exams.results.view', 'exams.results.print', 'exams.results.publish', 'exams.admit_cards.view', 'exams.admit_cards.create', 'exams.admit_cards.print', 'fees.structure.view', 'fees.structure.create', 'fees.structure.edit', 'fees.structure.delete', 'fees.dues.view', 'fees.dues.create', 'fees.collection.view', 'fees.collection.create', 'fees.collection.print', 'fees.collection.export', 'fees.receipts.view', 'fees.receipts.print', 'fees.receipts.export', 'fees.receipts.approve', 'fees.concessions.view', 'fees.concessions.create', 'fees.concessions.delete', 'fees.concessions.approve', 'fees.defaulters.view', 'fees.defaulters.create', 'fees.defaulters.export', 'fees.online.view', 'fees.online.create', 'fees.refunds.view', 'fees.refunds.create', 'fees.refunds.approve', 'accounts.vouchers.view', 'accounts.vouchers.create', 'accounts.vouchers.edit', 'accounts.vouchers.delete', 'accounts.vouchers.approve', 'accounts.vouchers.export', 'accounts.books.view', 'accounts.books.export', 'accounts.books.print', 'hr.staff.view', 'hr.staff.create', 'hr.staff.edit', 'hr.staff.delete', 'hr.staff.export', 'hr.staff.block', 'hr.leave.view', 'hr.leave.create', 'hr.leave.approve', 'hr.payroll.view', 'hr.payroll.create', 'hr.payroll.edit', 'hr.payroll.approve', 'hr.payroll.export', 'hr.payroll.print', 'comms.notices.view', 'comms.notices.create', 'comms.notices.edit', 'comms.notices.delete', 'comms.notices.publish', 'comms.broadcast.create', 'comms.templates.view', 'comms.templates.create', 'comms.templates.edit', 'comms.templates.delete', 'comms.calendar.view', 'comms.calendar.create', 'comms.calendar.edit', 'comms.calendar.delete', 'comms.messages.view', 'comms.messages.create', 'transport.routes.view', 'transport.routes.create', 'transport.routes.edit', 'transport.routes.delete', 'transport.allocation.view', 'transport.allocation.create', 'transport.allocation.edit', 'transport.allocation.delete', 'transport.tracking.view', 'library.catalogue.view', 'library.catalogue.create', 'library.catalogue.edit', 'library.catalogue.delete', 'library.circulation.view', 'library.circulation.create', 'library.circulation.edit', 'hostel.rooms.view', 'hostel.rooms.create', 'hostel.rooms.edit', 'hostel.rooms.delete', 'hostel.allocation.view', 'hostel.allocation.create', 'hostel.allocation.edit', 'hostel.allocation.delete', 'inventory.items.view', 'inventory.items.create', 'inventory.items.edit', 'inventory.items.delete', 'inventory.sales.view', 'inventory.sales.create', 'inventory.sales.print', 'wellbeing.medical.view', 'wellbeing.medical.create', 'wellbeing.medical.edit', 'wellbeing.discipline.view', 'wellbeing.discipline.create', 'wellbeing.discipline.edit', 'reports.fees.view', 'reports.fees.export', 'reports.academic.view', 'reports.academic.export', 'reports.udise.export', 'settings.school.view', 'settings.school.edit', 'settings.billing.view', 'settings.billing.create', 'settings.users.view', 'settings.users.create', 'settings.users.edit', 'settings.users.delete', 'settings.roles.view', 'settings.roles.create', 'settings.roles.edit', 'settings.roles.delete', 'settings.integrations.view', 'settings.integrations.edit', 'settings.backups.view', 'settings.backups.create', 'settings.audit.view', 'support.tickets.view', 'support.tickets.create');
delete from public.erp_submodules where code not in ('dashboard.overview', 'frontdesk.enquiries', 'frontdesk.admissions', 'frontdesk.online_form', 'frontdesk.visitors', 'students.profile', 'students.sensitive', 'students.import', 'students.promotion', 'students.certificates', 'students.parent_link', 'students.documents', 'students.board_reg', 'documents.templates', 'documents.issue', 'academics.setup', 'academics.allocation', 'academics.timetable', 'academics.syllabus', 'homework.homework', 'homework.material', 'attendance.students', 'attendance.leave', 'attendance.staff', 'exams.setup', 'exams.marks', 'exams.results', 'exams.admit_cards', 'fees.structure', 'fees.dues', 'fees.collection', 'fees.receipts', 'fees.concessions', 'fees.defaulters', 'fees.online', 'fees.refunds', 'accounts.vouchers', 'accounts.books', 'hr.staff', 'hr.leave', 'hr.payroll', 'comms.notices', 'comms.broadcast', 'comms.templates', 'comms.calendar', 'comms.messages', 'transport.routes', 'transport.allocation', 'transport.tracking', 'library.catalogue', 'library.circulation', 'hostel.rooms', 'hostel.allocation', 'inventory.items', 'inventory.sales', 'wellbeing.medical', 'wellbeing.discipline', 'reports.fees', 'reports.academic', 'reports.udise', 'settings.school', 'settings.billing', 'settings.users', 'settings.roles', 'settings.integrations', 'settings.backups', 'settings.audit', 'support.tickets');

insert into public.role_templates (code, name, kind, description, locked, sort) values
  ('principal', 'Principal / School Admin', 'staff', 'Every permission in this school.', true, 0),
  ('vice_principal', 'Vice Principal / Academic Coordinator', 'staff', 'Academics, attendance and exams for the whole school.', false, 1),
  ('accountant', 'Accountant', 'staff', 'Fees and accounts. Requests concessions, refunds and cancellations; cannot approve them.', false, 2),
  ('front_office', 'Front office', 'staff', 'Enquiries, admissions, visitors and the fee counter.', false, 3),
  ('office_admin', 'Office / HR admin', 'staff', 'Staff records, staff attendance, leave and payroll preparation.', false, 4),
  ('class_teacher', 'Class teacher', 'staff', 'Own section: attendance, student details, marks and report cards.', false, 5),
  ('subject_teacher', 'Subject teacher', 'staff', 'Own subjects and sections: marks, homework, period attendance.', false, 6),
  ('librarian', 'Librarian', 'staff', 'Library only.', false, 7),
  ('transport_manager', 'Transport manager', 'staff', 'Transport only.', false, 8),
  ('hostel_warden', 'Hostel warden', 'staff', 'Hostel only.', false, 9),
  ('parent', 'Parent', 'family', 'Own linked children only.', false, 10),
  ('student', 'Student', 'family', 'Self only.', false, 11)
on conflict (code) do update set name = excluded.name, kind = excluded.kind, description = excluded.description, locked = excluded.locked, sort = excluded.sort;

delete from public.role_template_permissions;
insert into public.role_template_permissions (template_code, perm_key, scope) values
  ('principal', 'dashboard.overview.view', 'school'),
  ('principal', 'frontdesk.enquiries.view', 'school'),
  ('principal', 'frontdesk.enquiries.create', 'school'),
  ('principal', 'frontdesk.enquiries.edit', 'school'),
  ('principal', 'frontdesk.enquiries.delete', 'school'),
  ('principal', 'frontdesk.enquiries.export', 'school'),
  ('principal', 'frontdesk.admissions.view', 'school'),
  ('principal', 'frontdesk.admissions.create', 'school'),
  ('principal', 'frontdesk.admissions.edit', 'school'),
  ('principal', 'frontdesk.admissions.approve', 'school'),
  ('principal', 'frontdesk.admissions.export', 'school'),
  ('principal', 'frontdesk.online_form.view', 'school'),
  ('principal', 'frontdesk.online_form.edit', 'school'),
  ('principal', 'frontdesk.visitors.view', 'school'),
  ('principal', 'frontdesk.visitors.create', 'school'),
  ('principal', 'frontdesk.visitors.edit', 'school'),
  ('principal', 'frontdesk.visitors.delete', 'school'),
  ('principal', 'students.profile.view', 'school'),
  ('principal', 'students.profile.create', 'school'),
  ('principal', 'students.profile.edit', 'school'),
  ('principal', 'students.profile.delete', 'school'),
  ('principal', 'students.profile.export', 'school'),
  ('principal', 'students.profile.print', 'school'),
  ('principal', 'students.profile.block', 'school'),
  ('principal', 'students.sensitive.view', 'school'),
  ('principal', 'students.sensitive.edit', 'school'),
  ('principal', 'students.import.create', 'school'),
  ('principal', 'students.promotion.view', 'school'),
  ('principal', 'students.promotion.create', 'school'),
  ('principal', 'students.certificates.view', 'school'),
  ('principal', 'students.certificates.create', 'school'),
  ('principal', 'students.certificates.print', 'school'),
  ('principal', 'students.certificates.approve', 'school'),
  ('principal', 'students.parent_link.view', 'school'),
  ('principal', 'students.parent_link.edit', 'school'),
  ('principal', 'students.documents.view', 'school'),
  ('principal', 'students.documents.create', 'school'),
  ('principal', 'students.documents.edit', 'school'),
  ('principal', 'students.documents.delete', 'school'),
  ('principal', 'students.documents.approve', 'school'),
  ('principal', 'students.board_reg.view', 'school'),
  ('principal', 'students.board_reg.create', 'school'),
  ('principal', 'students.board_reg.edit', 'school'),
  ('principal', 'students.board_reg.approve', 'school'),
  ('principal', 'students.board_reg.export', 'school'),
  ('principal', 'documents.templates.view', 'school'),
  ('principal', 'documents.templates.create', 'school'),
  ('principal', 'documents.templates.edit', 'school'),
  ('principal', 'documents.templates.delete', 'school'),
  ('principal', 'documents.issue.view', 'school'),
  ('principal', 'documents.issue.create', 'school'),
  ('principal', 'documents.issue.print', 'school'),
  ('principal', 'documents.issue.approve', 'school'),
  ('principal', 'documents.issue.export', 'school'),
  ('principal', 'academics.setup.view', 'school'),
  ('principal', 'academics.setup.create', 'school'),
  ('principal', 'academics.setup.edit', 'school'),
  ('principal', 'academics.setup.delete', 'school'),
  ('principal', 'academics.allocation.view', 'school'),
  ('principal', 'academics.allocation.create', 'school'),
  ('principal', 'academics.allocation.edit', 'school'),
  ('principal', 'academics.allocation.delete', 'school'),
  ('principal', 'academics.timetable.view', 'school'),
  ('principal', 'academics.timetable.create', 'school'),
  ('principal', 'academics.timetable.edit', 'school'),
  ('principal', 'academics.timetable.delete', 'school'),
  ('principal', 'academics.timetable.print', 'school'),
  ('principal', 'academics.syllabus.view', 'school'),
  ('principal', 'academics.syllabus.create', 'school'),
  ('principal', 'academics.syllabus.edit', 'school'),
  ('principal', 'academics.syllabus.delete', 'school'),
  ('principal', 'academics.syllabus.approve', 'school'),
  ('principal', 'homework.homework.view', 'school'),
  ('principal', 'homework.homework.create', 'school'),
  ('principal', 'homework.homework.edit', 'school'),
  ('principal', 'homework.homework.delete', 'school'),
  ('principal', 'homework.material.view', 'school'),
  ('principal', 'homework.material.create', 'school'),
  ('principal', 'homework.material.edit', 'school'),
  ('principal', 'homework.material.delete', 'school'),
  ('principal', 'attendance.students.view', 'school'),
  ('principal', 'attendance.students.create', 'school'),
  ('principal', 'attendance.students.edit', 'school'),
  ('principal', 'attendance.students.export', 'school'),
  ('principal', 'attendance.students.print', 'school'),
  ('principal', 'attendance.leave.view', 'school'),
  ('principal', 'attendance.leave.create', 'school'),
  ('principal', 'attendance.leave.approve', 'school'),
  ('principal', 'attendance.staff.view', 'school'),
  ('principal', 'attendance.staff.create', 'school'),
  ('principal', 'attendance.staff.edit', 'school'),
  ('principal', 'attendance.staff.export', 'school'),
  ('principal', 'exams.setup.view', 'school'),
  ('principal', 'exams.setup.create', 'school'),
  ('principal', 'exams.setup.edit', 'school'),
  ('principal', 'exams.setup.delete', 'school'),
  ('principal', 'exams.marks.view', 'school'),
  ('principal', 'exams.marks.create', 'school'),
  ('principal', 'exams.marks.edit', 'school'),
  ('principal', 'exams.marks.approve', 'school'),
  ('principal', 'exams.results.view', 'school'),
  ('principal', 'exams.results.print', 'school'),
  ('principal', 'exams.results.publish', 'school'),
  ('principal', 'exams.admit_cards.view', 'school'),
  ('principal', 'exams.admit_cards.create', 'school'),
  ('principal', 'exams.admit_cards.print', 'school'),
  ('principal', 'fees.structure.view', 'school'),
  ('principal', 'fees.structure.create', 'school'),
  ('principal', 'fees.structure.edit', 'school'),
  ('principal', 'fees.structure.delete', 'school'),
  ('principal', 'fees.dues.view', 'school'),
  ('principal', 'fees.dues.create', 'school'),
  ('principal', 'fees.collection.view', 'school'),
  ('principal', 'fees.collection.create', 'school'),
  ('principal', 'fees.collection.print', 'school'),
  ('principal', 'fees.collection.export', 'school'),
  ('principal', 'fees.receipts.view', 'school'),
  ('principal', 'fees.receipts.print', 'school'),
  ('principal', 'fees.receipts.export', 'school'),
  ('principal', 'fees.receipts.approve', 'school'),
  ('principal', 'fees.concessions.view', 'school'),
  ('principal', 'fees.concessions.create', 'school'),
  ('principal', 'fees.concessions.delete', 'school'),
  ('principal', 'fees.concessions.approve', 'school'),
  ('principal', 'fees.defaulters.view', 'school'),
  ('principal', 'fees.defaulters.create', 'school'),
  ('principal', 'fees.defaulters.export', 'school'),
  ('principal', 'fees.online.view', 'school'),
  ('principal', 'fees.online.create', 'school'),
  ('principal', 'fees.refunds.view', 'school'),
  ('principal', 'fees.refunds.create', 'school'),
  ('principal', 'fees.refunds.approve', 'school'),
  ('principal', 'accounts.vouchers.view', 'school'),
  ('principal', 'accounts.vouchers.create', 'school'),
  ('principal', 'accounts.vouchers.edit', 'school'),
  ('principal', 'accounts.vouchers.delete', 'school'),
  ('principal', 'accounts.vouchers.approve', 'school'),
  ('principal', 'accounts.vouchers.export', 'school'),
  ('principal', 'accounts.books.view', 'school'),
  ('principal', 'accounts.books.export', 'school'),
  ('principal', 'accounts.books.print', 'school'),
  ('principal', 'hr.staff.view', 'school'),
  ('principal', 'hr.staff.create', 'school'),
  ('principal', 'hr.staff.edit', 'school'),
  ('principal', 'hr.staff.delete', 'school'),
  ('principal', 'hr.staff.export', 'school'),
  ('principal', 'hr.staff.block', 'school'),
  ('principal', 'hr.leave.view', 'school'),
  ('principal', 'hr.leave.create', 'school'),
  ('principal', 'hr.leave.approve', 'school'),
  ('principal', 'hr.payroll.view', 'school'),
  ('principal', 'hr.payroll.create', 'school'),
  ('principal', 'hr.payroll.edit', 'school'),
  ('principal', 'hr.payroll.approve', 'school'),
  ('principal', 'hr.payroll.export', 'school'),
  ('principal', 'hr.payroll.print', 'school'),
  ('principal', 'comms.notices.view', 'school'),
  ('principal', 'comms.notices.create', 'school'),
  ('principal', 'comms.notices.edit', 'school'),
  ('principal', 'comms.notices.delete', 'school'),
  ('principal', 'comms.notices.publish', 'school'),
  ('principal', 'comms.broadcast.create', 'school'),
  ('principal', 'comms.templates.view', 'school'),
  ('principal', 'comms.templates.create', 'school'),
  ('principal', 'comms.templates.edit', 'school'),
  ('principal', 'comms.templates.delete', 'school'),
  ('principal', 'comms.calendar.view', 'school'),
  ('principal', 'comms.calendar.create', 'school'),
  ('principal', 'comms.calendar.edit', 'school'),
  ('principal', 'comms.calendar.delete', 'school'),
  ('principal', 'comms.messages.view', 'school'),
  ('principal', 'comms.messages.create', 'school'),
  ('principal', 'transport.routes.view', 'school'),
  ('principal', 'transport.routes.create', 'school'),
  ('principal', 'transport.routes.edit', 'school'),
  ('principal', 'transport.routes.delete', 'school'),
  ('principal', 'transport.allocation.view', 'school'),
  ('principal', 'transport.allocation.create', 'school'),
  ('principal', 'transport.allocation.edit', 'school'),
  ('principal', 'transport.allocation.delete', 'school'),
  ('principal', 'transport.tracking.view', 'school'),
  ('principal', 'library.catalogue.view', 'school'),
  ('principal', 'library.catalogue.create', 'school'),
  ('principal', 'library.catalogue.edit', 'school'),
  ('principal', 'library.catalogue.delete', 'school'),
  ('principal', 'library.circulation.view', 'school'),
  ('principal', 'library.circulation.create', 'school'),
  ('principal', 'library.circulation.edit', 'school'),
  ('principal', 'hostel.rooms.view', 'school'),
  ('principal', 'hostel.rooms.create', 'school'),
  ('principal', 'hostel.rooms.edit', 'school'),
  ('principal', 'hostel.rooms.delete', 'school'),
  ('principal', 'hostel.allocation.view', 'school'),
  ('principal', 'hostel.allocation.create', 'school'),
  ('principal', 'hostel.allocation.edit', 'school'),
  ('principal', 'hostel.allocation.delete', 'school'),
  ('principal', 'inventory.items.view', 'school'),
  ('principal', 'inventory.items.create', 'school'),
  ('principal', 'inventory.items.edit', 'school'),
  ('principal', 'inventory.items.delete', 'school'),
  ('principal', 'inventory.sales.view', 'school'),
  ('principal', 'inventory.sales.create', 'school'),
  ('principal', 'inventory.sales.print', 'school'),
  ('principal', 'wellbeing.medical.view', 'school'),
  ('principal', 'wellbeing.medical.create', 'school'),
  ('principal', 'wellbeing.medical.edit', 'school'),
  ('principal', 'wellbeing.discipline.view', 'school'),
  ('principal', 'wellbeing.discipline.create', 'school'),
  ('principal', 'wellbeing.discipline.edit', 'school'),
  ('principal', 'reports.fees.view', 'school'),
  ('principal', 'reports.fees.export', 'school'),
  ('principal', 'reports.academic.view', 'school'),
  ('principal', 'reports.academic.export', 'school'),
  ('principal', 'reports.udise.export', 'school'),
  ('principal', 'settings.school.view', 'school'),
  ('principal', 'settings.school.edit', 'school'),
  ('principal', 'settings.billing.view', 'school'),
  ('principal', 'settings.billing.create', 'school'),
  ('principal', 'settings.users.view', 'school'),
  ('principal', 'settings.users.create', 'school'),
  ('principal', 'settings.users.edit', 'school'),
  ('principal', 'settings.users.delete', 'school'),
  ('principal', 'settings.roles.view', 'school'),
  ('principal', 'settings.roles.create', 'school'),
  ('principal', 'settings.roles.edit', 'school'),
  ('principal', 'settings.roles.delete', 'school'),
  ('principal', 'settings.integrations.view', 'school'),
  ('principal', 'settings.integrations.edit', 'school'),
  ('principal', 'settings.backups.view', 'school'),
  ('principal', 'settings.backups.create', 'school'),
  ('principal', 'settings.audit.view', 'school'),
  ('principal', 'support.tickets.view', 'school'),
  ('principal', 'support.tickets.create', 'school'),
  ('vice_principal', 'dashboard.overview.view', 'school'),
  ('vice_principal', 'frontdesk.enquiries.view', 'school'),
  ('vice_principal', 'frontdesk.admissions.view', 'school'),
  ('vice_principal', 'frontdesk.admissions.create', 'school'),
  ('vice_principal', 'frontdesk.admissions.edit', 'school'),
  ('vice_principal', 'frontdesk.admissions.approve', 'school'),
  ('vice_principal', 'frontdesk.admissions.export', 'school'),
  ('vice_principal', 'students.profile.view', 'school'),
  ('vice_principal', 'students.profile.edit', 'school'),
  ('vice_principal', 'students.profile.export', 'school'),
  ('vice_principal', 'students.profile.print', 'school'),
  ('vice_principal', 'students.profile.block', 'school'),
  ('vice_principal', 'students.sensitive.view', 'school'),
  ('vice_principal', 'students.sensitive.edit', 'school'),
  ('vice_principal', 'students.promotion.view', 'school'),
  ('vice_principal', 'students.promotion.create', 'school'),
  ('vice_principal', 'students.certificates.view', 'school'),
  ('vice_principal', 'students.certificates.create', 'school'),
  ('vice_principal', 'students.certificates.print', 'school'),
  ('vice_principal', 'academics.setup.view', 'school'),
  ('vice_principal', 'academics.setup.create', 'school'),
  ('vice_principal', 'academics.setup.edit', 'school'),
  ('vice_principal', 'academics.setup.delete', 'school'),
  ('vice_principal', 'academics.allocation.view', 'school'),
  ('vice_principal', 'academics.allocation.create', 'school'),
  ('vice_principal', 'academics.allocation.edit', 'school'),
  ('vice_principal', 'academics.allocation.delete', 'school'),
  ('vice_principal', 'academics.timetable.view', 'school'),
  ('vice_principal', 'academics.timetable.create', 'school'),
  ('vice_principal', 'academics.timetable.edit', 'school'),
  ('vice_principal', 'academics.timetable.delete', 'school'),
  ('vice_principal', 'academics.timetable.print', 'school'),
  ('vice_principal', 'academics.syllabus.view', 'school'),
  ('vice_principal', 'academics.syllabus.create', 'school'),
  ('vice_principal', 'academics.syllabus.edit', 'school'),
  ('vice_principal', 'academics.syllabus.delete', 'school'),
  ('vice_principal', 'academics.syllabus.approve', 'school'),
  ('vice_principal', 'homework.homework.view', 'school'),
  ('vice_principal', 'homework.material.view', 'school'),
  ('vice_principal', 'attendance.students.view', 'school'),
  ('vice_principal', 'attendance.students.create', 'school'),
  ('vice_principal', 'attendance.students.edit', 'school'),
  ('vice_principal', 'attendance.students.export', 'school'),
  ('vice_principal', 'attendance.students.print', 'school'),
  ('vice_principal', 'attendance.leave.view', 'school'),
  ('vice_principal', 'attendance.leave.approve', 'school'),
  ('vice_principal', 'attendance.staff.view', 'school'),
  ('vice_principal', 'exams.setup.view', 'school'),
  ('vice_principal', 'exams.setup.create', 'school'),
  ('vice_principal', 'exams.setup.edit', 'school'),
  ('vice_principal', 'exams.setup.delete', 'school'),
  ('vice_principal', 'exams.marks.view', 'school'),
  ('vice_principal', 'exams.marks.create', 'school'),
  ('vice_principal', 'exams.marks.edit', 'school'),
  ('vice_principal', 'exams.marks.approve', 'school'),
  ('vice_principal', 'exams.results.view', 'school'),
  ('vice_principal', 'exams.results.print', 'school'),
  ('vice_principal', 'exams.results.publish', 'school'),
  ('vice_principal', 'exams.admit_cards.view', 'school'),
  ('vice_principal', 'exams.admit_cards.create', 'school'),
  ('vice_principal', 'exams.admit_cards.print', 'school'),
  ('vice_principal', 'comms.notices.view', 'school'),
  ('vice_principal', 'comms.notices.create', 'school'),
  ('vice_principal', 'comms.notices.edit', 'school'),
  ('vice_principal', 'comms.notices.delete', 'school'),
  ('vice_principal', 'comms.notices.publish', 'school'),
  ('vice_principal', 'comms.broadcast.create', 'school'),
  ('vice_principal', 'comms.calendar.view', 'school'),
  ('vice_principal', 'comms.calendar.create', 'school'),
  ('vice_principal', 'comms.calendar.edit', 'school'),
  ('vice_principal', 'comms.calendar.delete', 'school'),
  ('vice_principal', 'transport.routes.view', 'school'),
  ('vice_principal', 'library.catalogue.view', 'school'),
  ('vice_principal', 'hostel.rooms.view', 'school'),
  ('vice_principal', 'reports.academic.view', 'school'),
  ('vice_principal', 'reports.academic.export', 'school'),
  ('vice_principal', 'support.tickets.view', 'own'),
  ('vice_principal', 'support.tickets.create', 'own'),
  ('vice_principal', 'students.documents.view', 'school'),
  ('vice_principal', 'students.documents.create', 'school'),
  ('vice_principal', 'students.documents.edit', 'school'),
  ('vice_principal', 'students.documents.approve', 'school'),
  ('vice_principal', 'students.board_reg.view', 'school'),
  ('vice_principal', 'students.board_reg.create', 'school'),
  ('vice_principal', 'students.board_reg.edit', 'school'),
  ('vice_principal', 'students.board_reg.export', 'school'),
  ('vice_principal', 'documents.templates.view', 'school'),
  ('vice_principal', 'documents.templates.create', 'school'),
  ('vice_principal', 'documents.templates.edit', 'school'),
  ('vice_principal', 'documents.issue.view', 'school'),
  ('vice_principal', 'documents.issue.create', 'school'),
  ('vice_principal', 'documents.issue.print', 'school'),
  ('vice_principal', 'documents.issue.export', 'school'),
  ('vice_principal', 'frontdesk.online_form.view', 'school'),
  ('vice_principal', 'frontdesk.online_form.edit', 'school'),
  ('accountant', 'dashboard.overview.view', 'school'),
  ('accountant', 'frontdesk.enquiries.view', 'school'),
  ('accountant', 'students.profile.view', 'school'),
  ('accountant', 'students.profile.export', 'school'),
  ('accountant', 'students.profile.print', 'school'),
  ('accountant', 'academics.setup.view', 'school'),
  ('accountant', 'attendance.students.view', 'school'),
  ('accountant', 'fees.structure.view', 'school'),
  ('accountant', 'fees.structure.create', 'school'),
  ('accountant', 'fees.structure.edit', 'school'),
  ('accountant', 'fees.structure.delete', 'school'),
  ('accountant', 'fees.dues.view', 'school'),
  ('accountant', 'fees.dues.create', 'school'),
  ('accountant', 'fees.collection.view', 'school'),
  ('accountant', 'fees.collection.create', 'school'),
  ('accountant', 'fees.collection.print', 'school'),
  ('accountant', 'fees.collection.export', 'school'),
  ('accountant', 'fees.receipts.view', 'school'),
  ('accountant', 'fees.receipts.print', 'school'),
  ('accountant', 'fees.receipts.export', 'school'),
  ('accountant', 'fees.concessions.view', 'school'),
  ('accountant', 'fees.concessions.create', 'school'),
  ('accountant', 'fees.defaulters.view', 'school'),
  ('accountant', 'fees.defaulters.create', 'school'),
  ('accountant', 'fees.defaulters.export', 'school'),
  ('accountant', 'fees.online.view', 'school'),
  ('accountant', 'fees.online.create', 'school'),
  ('accountant', 'fees.refunds.view', 'school'),
  ('accountant', 'fees.refunds.create', 'school'),
  ('accountant', 'accounts.vouchers.view', 'school'),
  ('accountant', 'accounts.vouchers.create', 'school'),
  ('accountant', 'accounts.vouchers.edit', 'school'),
  ('accountant', 'accounts.vouchers.export', 'school'),
  ('accountant', 'accounts.books.view', 'school'),
  ('accountant', 'accounts.books.export', 'school'),
  ('accountant', 'accounts.books.print', 'school'),
  ('accountant', 'hr.payroll.view', 'school'),
  ('accountant', 'hr.payroll.create', 'school'),
  ('accountant', 'comms.notices.view', 'school'),
  ('accountant', 'comms.notices.create', 'school'),
  ('accountant', 'comms.broadcast.create', 'school'),
  ('accountant', 'transport.allocation.view', 'school'),
  ('accountant', 'reports.fees.view', 'school'),
  ('accountant', 'reports.fees.export', 'school'),
  ('accountant', 'settings.school.view', 'school'),
  ('accountant', 'support.tickets.view', 'own'),
  ('accountant', 'support.tickets.create', 'own'),
  ('front_office', 'dashboard.overview.view', 'school'),
  ('front_office', 'frontdesk.enquiries.view', 'school'),
  ('front_office', 'frontdesk.enquiries.create', 'school'),
  ('front_office', 'frontdesk.enquiries.edit', 'school'),
  ('front_office', 'frontdesk.enquiries.delete', 'school'),
  ('front_office', 'frontdesk.enquiries.export', 'school'),
  ('front_office', 'frontdesk.admissions.view', 'school'),
  ('front_office', 'frontdesk.admissions.create', 'school'),
  ('front_office', 'frontdesk.admissions.edit', 'school'),
  ('front_office', 'frontdesk.admissions.export', 'school'),
  ('front_office', 'frontdesk.online_form.view', 'school'),
  ('front_office', 'frontdesk.visitors.view', 'school'),
  ('front_office', 'frontdesk.visitors.create', 'school'),
  ('front_office', 'frontdesk.visitors.edit', 'school'),
  ('front_office', 'frontdesk.visitors.delete', 'school'),
  ('front_office', 'students.profile.view', 'school'),
  ('front_office', 'students.profile.create', 'school'),
  ('front_office', 'students.profile.edit', 'school'),
  ('front_office', 'students.profile.print', 'school'),
  ('front_office', 'students.import.create', 'school'),
  ('front_office', 'students.certificates.view', 'school'),
  ('front_office', 'students.certificates.create', 'school'),
  ('front_office', 'students.certificates.print', 'school'),
  ('front_office', 'students.parent_link.view', 'school'),
  ('front_office', 'academics.setup.view', 'school'),
  ('front_office', 'academics.timetable.view', 'school'),
  ('front_office', 'attendance.students.view', 'school'),
  ('front_office', 'fees.collection.view', 'school'),
  ('front_office', 'fees.collection.create', 'school'),
  ('front_office', 'fees.collection.print', 'school'),
  ('front_office', 'fees.receipts.view', 'school'),
  ('front_office', 'fees.receipts.print', 'school'),
  ('front_office', 'fees.defaulters.view', 'school'),
  ('front_office', 'fees.defaulters.create', 'school'),
  ('front_office', 'comms.notices.view', 'school'),
  ('front_office', 'comms.notices.create', 'school'),
  ('front_office', 'comms.broadcast.create', 'school'),
  ('front_office', 'comms.calendar.view', 'school'),
  ('front_office', 'transport.routes.view', 'school'),
  ('front_office', 'support.tickets.view', 'own'),
  ('front_office', 'support.tickets.create', 'own'),
  ('front_office', 'students.sensitive.view', 'school'),
  ('front_office', 'students.sensitive.edit', 'school'),
  ('front_office', 'students.documents.view', 'school'),
  ('front_office', 'students.documents.create', 'school'),
  ('front_office', 'students.documents.edit', 'school'),
  ('front_office', 'students.board_reg.view', 'school'),
  ('front_office', 'students.board_reg.create', 'school'),
  ('front_office', 'students.board_reg.edit', 'school'),
  ('front_office', 'documents.templates.view', 'school'),
  ('front_office', 'documents.issue.view', 'school'),
  ('front_office', 'documents.issue.create', 'school'),
  ('front_office', 'documents.issue.print', 'school'),
  ('office_admin', 'dashboard.overview.view', 'school'),
  ('office_admin', 'students.profile.view', 'school'),
  ('office_admin', 'academics.setup.view', 'school'),
  ('office_admin', 'attendance.staff.view', 'school'),
  ('office_admin', 'attendance.staff.create', 'school'),
  ('office_admin', 'attendance.staff.edit', 'school'),
  ('office_admin', 'attendance.staff.export', 'school'),
  ('office_admin', 'hr.staff.view', 'school'),
  ('office_admin', 'hr.staff.create', 'school'),
  ('office_admin', 'hr.staff.edit', 'school'),
  ('office_admin', 'hr.staff.delete', 'school'),
  ('office_admin', 'hr.staff.export', 'school'),
  ('office_admin', 'hr.staff.block', 'school'),
  ('office_admin', 'hr.leave.view', 'school'),
  ('office_admin', 'hr.leave.create', 'school'),
  ('office_admin', 'hr.payroll.view', 'school'),
  ('office_admin', 'hr.payroll.create', 'school'),
  ('office_admin', 'hr.payroll.edit', 'school'),
  ('office_admin', 'hr.payroll.export', 'school'),
  ('office_admin', 'hr.payroll.print', 'school'),
  ('office_admin', 'comms.notices.view', 'school'),
  ('office_admin', 'comms.notices.create', 'school'),
  ('office_admin', 'comms.calendar.view', 'school'),
  ('office_admin', 'comms.calendar.create', 'school'),
  ('office_admin', 'comms.calendar.edit', 'school'),
  ('office_admin', 'comms.calendar.delete', 'school'),
  ('office_admin', 'support.tickets.view', 'own'),
  ('office_admin', 'support.tickets.create', 'own'),
  ('office_admin', 'documents.templates.view', 'school'),
  ('office_admin', 'documents.issue.view', 'school'),
  ('office_admin', 'documents.issue.create', 'school'),
  ('office_admin', 'documents.issue.print', 'school'),
  ('class_teacher', 'dashboard.overview.view', 'school'),
  ('class_teacher', 'students.profile.view', 'assigned'),
  ('class_teacher', 'students.profile.edit', 'assigned'),
  ('class_teacher', 'students.profile.print', 'assigned'),
  ('class_teacher', 'academics.setup.view', 'school'),
  ('class_teacher', 'academics.allocation.view', 'school'),
  ('class_teacher', 'academics.timetable.view', 'assigned'),
  ('class_teacher', 'academics.syllabus.view', 'assigned'),
  ('class_teacher', 'academics.syllabus.create', 'assigned'),
  ('class_teacher', 'academics.syllabus.edit', 'assigned'),
  ('class_teacher', 'homework.homework.view', 'assigned'),
  ('class_teacher', 'homework.homework.create', 'assigned'),
  ('class_teacher', 'homework.homework.edit', 'assigned'),
  ('class_teacher', 'homework.homework.delete', 'assigned'),
  ('class_teacher', 'homework.material.view', 'assigned'),
  ('class_teacher', 'homework.material.create', 'assigned'),
  ('class_teacher', 'homework.material.edit', 'assigned'),
  ('class_teacher', 'homework.material.delete', 'assigned'),
  ('class_teacher', 'attendance.students.view', 'assigned'),
  ('class_teacher', 'attendance.students.create', 'assigned'),
  ('class_teacher', 'attendance.students.edit', 'assigned'),
  ('class_teacher', 'attendance.students.print', 'assigned'),
  ('class_teacher', 'attendance.leave.view', 'assigned'),
  ('class_teacher', 'attendance.leave.approve', 'assigned'),
  ('class_teacher', 'exams.setup.view', 'school'),
  ('class_teacher', 'exams.marks.view', 'assigned'),
  ('class_teacher', 'exams.marks.create', 'assigned'),
  ('class_teacher', 'exams.marks.edit', 'assigned'),
  ('class_teacher', 'exams.results.view', 'assigned'),
  ('class_teacher', 'exams.results.print', 'assigned'),
  ('class_teacher', 'comms.notices.view', 'school'),
  ('class_teacher', 'comms.notices.create', 'school'),
  ('class_teacher', 'comms.broadcast.create', 'assigned'),
  ('class_teacher', 'comms.calendar.view', 'school'),
  ('class_teacher', 'comms.messages.view', 'assigned'),
  ('class_teacher', 'comms.messages.create', 'assigned'),
  ('class_teacher', 'hr.leave.view', 'own'),
  ('class_teacher', 'hr.leave.create', 'own'),
  ('class_teacher', 'reports.academic.view', 'assigned'),
  ('class_teacher', 'support.tickets.view', 'own'),
  ('class_teacher', 'support.tickets.create', 'own'),
  ('class_teacher', 'students.sensitive.view', 'assigned'),
  ('subject_teacher', 'dashboard.overview.view', 'school'),
  ('subject_teacher', 'students.profile.view', 'assigned'),
  ('subject_teacher', 'academics.setup.view', 'school'),
  ('subject_teacher', 'academics.timetable.view', 'assigned'),
  ('subject_teacher', 'academics.syllabus.view', 'assigned'),
  ('subject_teacher', 'academics.syllabus.create', 'assigned'),
  ('subject_teacher', 'academics.syllabus.edit', 'assigned'),
  ('subject_teacher', 'homework.homework.view', 'assigned'),
  ('subject_teacher', 'homework.homework.create', 'assigned'),
  ('subject_teacher', 'homework.homework.edit', 'assigned'),
  ('subject_teacher', 'homework.homework.delete', 'assigned'),
  ('subject_teacher', 'homework.material.view', 'assigned'),
  ('subject_teacher', 'homework.material.create', 'assigned'),
  ('subject_teacher', 'homework.material.edit', 'assigned'),
  ('subject_teacher', 'homework.material.delete', 'assigned'),
  ('subject_teacher', 'attendance.students.view', 'assigned'),
  ('subject_teacher', 'attendance.students.create', 'assigned'),
  ('subject_teacher', 'exams.setup.view', 'school'),
  ('subject_teacher', 'exams.marks.view', 'assigned'),
  ('subject_teacher', 'exams.marks.create', 'assigned'),
  ('subject_teacher', 'exams.marks.edit', 'assigned'),
  ('subject_teacher', 'comms.notices.view', 'school'),
  ('subject_teacher', 'comms.notices.create', 'school'),
  ('subject_teacher', 'comms.calendar.view', 'school'),
  ('subject_teacher', 'comms.messages.view', 'assigned'),
  ('subject_teacher', 'comms.messages.create', 'assigned'),
  ('subject_teacher', 'hr.leave.view', 'own'),
  ('subject_teacher', 'hr.leave.create', 'own'),
  ('subject_teacher', 'reports.academic.view', 'assigned'),
  ('subject_teacher', 'support.tickets.view', 'own'),
  ('subject_teacher', 'support.tickets.create', 'own'),
  ('librarian', 'dashboard.overview.view', 'school'),
  ('librarian', 'students.profile.view', 'school'),
  ('librarian', 'library.catalogue.view', 'school'),
  ('librarian', 'library.catalogue.create', 'school'),
  ('librarian', 'library.catalogue.edit', 'school'),
  ('librarian', 'library.catalogue.delete', 'school'),
  ('librarian', 'library.circulation.view', 'school'),
  ('librarian', 'library.circulation.create', 'school'),
  ('librarian', 'library.circulation.edit', 'school'),
  ('librarian', 'comms.notices.view', 'school'),
  ('librarian', 'comms.notices.create', 'school'),
  ('librarian', 'hr.leave.view', 'own'),
  ('librarian', 'hr.leave.create', 'own'),
  ('librarian', 'support.tickets.view', 'own'),
  ('librarian', 'support.tickets.create', 'own'),
  ('transport_manager', 'dashboard.overview.view', 'school'),
  ('transport_manager', 'students.profile.view', 'school'),
  ('transport_manager', 'transport.routes.view', 'school'),
  ('transport_manager', 'transport.routes.create', 'school'),
  ('transport_manager', 'transport.routes.edit', 'school'),
  ('transport_manager', 'transport.routes.delete', 'school'),
  ('transport_manager', 'transport.allocation.view', 'school'),
  ('transport_manager', 'transport.allocation.create', 'school'),
  ('transport_manager', 'transport.allocation.edit', 'school'),
  ('transport_manager', 'transport.allocation.delete', 'school'),
  ('transport_manager', 'transport.tracking.view', 'school'),
  ('transport_manager', 'comms.notices.view', 'school'),
  ('transport_manager', 'comms.notices.create', 'school'),
  ('transport_manager', 'hr.leave.view', 'own'),
  ('transport_manager', 'hr.leave.create', 'own'),
  ('transport_manager', 'support.tickets.view', 'own'),
  ('transport_manager', 'support.tickets.create', 'own'),
  ('hostel_warden', 'dashboard.overview.view', 'school'),
  ('hostel_warden', 'students.profile.view', 'school'),
  ('hostel_warden', 'hostel.rooms.view', 'school'),
  ('hostel_warden', 'hostel.rooms.create', 'school'),
  ('hostel_warden', 'hostel.rooms.edit', 'school'),
  ('hostel_warden', 'hostel.rooms.delete', 'school'),
  ('hostel_warden', 'hostel.allocation.view', 'school'),
  ('hostel_warden', 'hostel.allocation.create', 'school'),
  ('hostel_warden', 'hostel.allocation.edit', 'school'),
  ('hostel_warden', 'hostel.allocation.delete', 'school'),
  ('hostel_warden', 'comms.notices.view', 'school'),
  ('hostel_warden', 'comms.notices.create', 'school'),
  ('hostel_warden', 'hr.leave.view', 'own'),
  ('hostel_warden', 'hr.leave.create', 'own'),
  ('hostel_warden', 'support.tickets.view', 'own'),
  ('hostel_warden', 'support.tickets.create', 'own'),
  ('parent', 'dashboard.overview.view', 'child'),
  ('parent', 'students.profile.view', 'child'),
  ('parent', 'attendance.students.view', 'child'),
  ('parent', 'attendance.leave.view', 'child'),
  ('parent', 'attendance.leave.create', 'child'),
  ('parent', 'exams.results.view', 'child'),
  ('parent', 'homework.homework.view', 'child'),
  ('parent', 'homework.material.view', 'child'),
  ('parent', 'fees.collection.view', 'child'),
  ('parent', 'fees.receipts.view', 'child'),
  ('parent', 'fees.receipts.print', 'child'),
  ('parent', 'fees.online.create', 'child'),
  ('parent', 'comms.notices.view', 'school'),
  ('parent', 'comms.calendar.view', 'school'),
  ('parent', 'comms.messages.view', 'child'),
  ('parent', 'comms.messages.create', 'child'),
  ('parent', 'library.circulation.view', 'child'),
  ('parent', 'transport.allocation.view', 'child'),
  ('parent', 'transport.tracking.view', 'child'),
  ('student', 'dashboard.overview.view', 'self'),
  ('student', 'students.profile.view', 'self'),
  ('student', 'attendance.students.view', 'self'),
  ('student', 'exams.results.view', 'self'),
  ('student', 'homework.homework.view', 'self'),
  ('student', 'homework.material.view', 'self'),
  ('student', 'comms.notices.view', 'school'),
  ('student', 'comms.calendar.view', 'school'),
  ('student', 'library.circulation.view', 'self'),
  ('student', 'transport.allocation.view', 'self');

-- ═══════════════════════════════════════════════════════════════════════════
-- Permission engine: roles → permissions (module.submodule.action) with scope.
-- A user can act only when: the module is licensed + switched on for the school,
-- one of their roles (or a per-user grant) gives the permission, no per-user deny
-- exists, and the record is inside the grant's scope.
-- Scopes: school > assigned (own classes/subjects) > own > child (parent) > self (student)
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── School groups (trusts with branches) — tables now, screens later ─────────────
create table if not exists public.school_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.schools add column if not exists group_id uuid references public.school_groups(id) on delete set null;

-- ───────────── Which modules each school may use ─────────────
create table if not exists public.school_modules (
  school_id   uuid not null references public.schools(id) on delete cascade,
  module_code text not null references public.erp_modules(code) on delete cascade,
  licensed    boolean not null default true,   -- set by the platform (plan)
  enabled     boolean not null default true,   -- switched on by the school
  primary key (school_id, module_code)
);

-- ───────────── Roles inside a school ─────────────
create table if not exists public.roles (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  code          text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  name          text not null,
  description   text,
  kind          text not null default 'staff' check (kind in ('staff','family')),
  template_code text references public.role_templates(code) on delete set null,
  locked        boolean not null default false,       -- principal: permissions can't be edited
  created_at    timestamptz not null default now(),
  unique (school_id, code)
);
create table if not exists public.role_permissions (
  role_id  uuid not null references public.roles(id) on delete cascade,
  perm_key text not null references public.erp_permissions(key) on delete cascade,
  scope    text not null check (scope in ('school','assigned','own','child','self')),
  primary key (role_id, perm_key)
);
create table if not exists public.member_roles (
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role_id   uuid not null references public.roles(id) on delete cascade,
  primary key (school_id, user_id, role_id)
);
create index if not exists member_roles_user_idx on public.member_roles (user_id, school_id);
create table if not exists public.member_overrides (
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  perm_key  text not null references public.erp_permissions(key) on delete cascade,
  effect    text not null check (effect in ('grant','deny')),
  scope     text not null default 'school' check (scope in ('school','assigned','own','child','self')),
  primary key (school_id, user_id, perm_key)
);
-- Which classes / sections / subjects a staff member is assigned to (scope "assigned").
-- subject_id null = all subjects of that section (class teacher).
create table if not exists public.staff_assignments (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  is_class_teacher boolean not null default false
);
create unique index if not exists staff_assignments_uniq on public.staff_assignments (user_id, section_id, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists staff_assignments_school_idx on public.staff_assignments (school_id, user_id);

-- Family logins (used from the parent/student login step; scope "child" / "self")
create table if not exists public.guardians (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null,
  relation   text,
  phone      text,
  email      text,
  created_at timestamptz not null default now()
);
create table if not exists public.student_guardians (
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  primary key (student_id, guardian_id)
);
alter table public.students add column if not exists user_id uuid references auth.users(id) on delete set null;

-- ───────────── Core permission functions ─────────────
create or replace function public.module_on(sid uuid, m text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.erp_modules where code = m and core)
      or exists (select 1 from public.school_modules where school_id = sid and module_code = m and licensed and enabled);
$$;

-- Writes are blocked when the school is suspended (later: subscription expired).
create or replace function public.school_writable(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'active' from public.schools where id = sid), false);
$$;

-- The widest scope the current user holds for a permission in a school, or null.
create or replace function public.perm_scope(sid uuid, pkey text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text;
begin
  if sid is null or auth.uid() is null then return null; end if;
  if public.is_platform_admin() then return 'school'; end if;
  if not public.module_on(sid, split_part(pkey, '.', 1)) then return null; end if;
  if split_part(pkey, '.', 3) <> 'view' and not public.school_writable(sid) then return null; end if;
  if exists (select 1 from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = pkey and o.effect = 'deny') then return null; end if;
  select x.scope into s from (
    select rp.scope from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid() and rp.perm_key = pkey
    union all
    select o.scope from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = pkey and o.effect = 'grant'
  ) x order by array_position(array['school','assigned','own','child','self'], x.scope) limit 1;
  return s;
end $$;

create or replace function public.has_perm(sid uuid, pkey text) returns boolean
language sql stable security definer set search_path = public as $$ select public.perm_scope(sid, pkey) is not null; $$;

create or replace function public.has_perm_school(sid uuid, pkey text) returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.perm_scope(sid, pkey) = 'school', false); $$;

-- Any permission at all in a module (for shared lookup tables such as fee heads).
create or replace function public.has_module_perm(sid uuid, m text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or (public.module_on(sid, m) and exists (
    select 1 from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid() and rp.perm_key like m || '.%'));
$$;

-- Member of the school in any way (staff, parent, student) or platform admin.
create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.school_members where school_id = sid and user_id = auth.uid())
      or exists (select 1 from public.member_roles where school_id = sid and user_id = auth.uid());
$$;

create or replace function public.assigned_to_section(sid uuid, sec uuid, subj uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_assignments a where a.school_id = sid and a.user_id = auth.uid() and a.section_id = sec
                 and (subj is null or a.subject_id is null or a.subject_id = subj));
$$;

-- Can the user use permission pkey on rows of this section?
create or replace function public.can_section(sid uuid, pkey text, sec uuid, subj uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s text := public.perm_scope(sid, pkey);
begin
  return s = 'school' or (s = 'assigned' and sec is not null and public.assigned_to_section(sid, sec, subj));
end $$;

-- Can the user use permission pkey on this student's records?
create or replace function public.can_student(sid uuid, pkey text, stu uuid, subj uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s text := public.perm_scope(sid, pkey);
begin
  if s is null then return false; end if;
  if s = 'school' then return true; end if;
  if s = 'assigned' then
    return exists (select 1 from public.students st where st.id = stu and public.assigned_to_section(sid, st.section_id, subj));
  elsif s = 'child' then
    return exists (select 1 from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id
                   where sg.student_id = stu and g.user_id = auth.uid());
  elsif s = 'self' then
    return exists (select 1 from public.students st where st.id = stu and st.user_id = auth.uid());
  end if;
  return false;
end $$;

-- Everything the current user may do in a school (the app loads this once per request).
create or replace function public.my_permissions(sid uuid) returns table (perm_key text, scope text)
language plpgsql stable security definer set search_path = public as $$
declare pa boolean := public.is_platform_admin(); w boolean := public.school_writable(sid);
begin
  if auth.uid() is null or sid is null then return; end if;
  if pa then return query select p.key, 'school'::text from public.erp_permissions p; return; end if;
  return query
  with g as (
    select rp.perm_key k, rp.scope sc from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid()
    union all
    select o.perm_key, o.scope from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.effect = 'grant'
  ), best as (
    select distinct on (k) k, sc from g order by k, array_position(array['school','assigned','own','child','self'], sc)
  )
  select b.k, b.sc from best b join public.erp_permissions p on p.key = b.k
   where public.module_on(sid, p.module_code) and (p.action = 'view' or w)
     and not exists (select 1 from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = b.k and o.effect = 'deny');
end $$;

-- Copy the platform role templates into a school (missing ones only).
create or replace function public.sync_role_templates(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; t record; rid uuid;
begin
  for t in select * from public.role_templates order by sort loop
    select id into rid from public.roles where school_id = sid and code = t.code;
    if rid is null then
      insert into public.roles (school_id, code, name, description, kind, template_code, locked)
        values (sid, t.code, t.name, t.description, t.kind, t.code, t.locked) returning id into rid;
      insert into public.role_permissions (role_id, perm_key, scope)
        select rid, perm_key, scope from public.role_template_permissions where template_code = t.code;
      n := n + 1;
    elsif t.locked then
      -- locked roles (principal) always carry every permission, including new ones
      insert into public.role_permissions (role_id, perm_key, scope)
        select rid, perm_key, scope from public.role_template_permissions where template_code = t.code
        on conflict (role_id, perm_key) do nothing;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.reset_role_to_template(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.roles where id = rid;
  if r.id is null or r.template_code is null then raise exception 'Role has no template'; end if;
  if not public.has_perm_school(r.school_id, 'settings.roles.edit') then raise exception 'not allowed'; end if;
  delete from public.role_permissions where role_id = rid;
  insert into public.role_permissions (role_id, perm_key, scope)
    select rid, perm_key, scope from public.role_template_permissions where template_code = r.template_code;
end $$;

create or replace function public.seed_school_modules(sid uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.school_modules (school_id, module_code, licensed, enabled)
  select sid, code, true, true from public.erp_modules on conflict do nothing;
$$;

-- ───────────── Guards against privilege escalation ─────────────
create or replace function public.guard_role_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; k text; sc text;
begin
  if public.is_platform_admin() or auth.uid() is null then return coalesce(new, old); end if;
  select * into r from public.roles where id = coalesce(new.role_id, old.role_id);
  if r.locked then raise exception 'The % role always has every permission and cannot be edited.', r.name; end if;
  if exists (select 1 from public.member_roles where role_id = r.id and user_id = auth.uid()) then
    raise exception 'You cannot change the permissions of a role you hold yourself.';
  end if;
  if tg_op <> 'DELETE' then
    k := new.perm_key; sc := public.perm_scope(r.school_id, k);
    if sc is null then raise exception 'You cannot grant % because you do not have it yourself.', k; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists role_permissions_guard on public.role_permissions;
create trigger role_permissions_guard before insert or update or delete on public.role_permissions
for each row execute function public.guard_role_permissions();

create or replace function public.guard_member_roles() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; missing text;
begin
  select * into r from public.roles where id = coalesce(new.role_id, old.role_id);
  -- role already gone: this row is being removed by a cascade (role or whole school deleted)
  if tg_op = 'DELETE' and r.id is null then return old; end if;
  if r.school_id is distinct from coalesce(new.school_id, old.school_id) then raise exception 'Role belongs to another school.'; end if;
  if tg_op = 'DELETE' and r.code = 'principal' and not exists (
       select 1 from public.member_roles where role_id = r.id and user_id <> old.user_id) then
    if exists (select 1 from public.schools where id = old.school_id) then
      raise exception 'A school must always have at least one Principal / School Admin.';
    end if;
  end if;
  if public.is_platform_admin() or auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.user_id, old.user_id) = auth.uid() then raise exception 'You cannot change your own roles.'; end if;
  if tg_op = 'INSERT' then
    select rp.perm_key into missing from public.role_permissions rp where rp.role_id = r.id and public.perm_scope(r.school_id, rp.perm_key) is null limit 1;
    if missing is not null then raise exception 'You cannot assign this role: it includes % which you do not have.', missing; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists member_roles_guard on public.member_roles;
create trigger member_roles_guard before insert or delete on public.member_roles
for each row execute function public.guard_member_roles();

create or replace function public.guard_overrides() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_platform_admin() or auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.user_id, old.user_id) = auth.uid() then raise exception 'You cannot change your own permissions.'; end if;
  if tg_op <> 'DELETE' and new.effect = 'grant' and public.perm_scope(new.school_id, new.perm_key) is null then
    raise exception 'You cannot grant % because you do not have it yourself.', new.perm_key;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists member_overrides_guard on public.member_overrides;
create trigger member_overrides_guard before insert or update or delete on public.member_overrides
for each row execute function public.guard_overrides();

-- ───────────── Move existing schools and members onto roles ─────────────
do $$
declare s record;
begin
  for s in select id from public.schools loop
    perform public.seed_school_modules(s.id);
    perform public.sync_role_templates(s.id);
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'school_members' and column_name = 'role') then
    insert into public.member_roles (school_id, user_id, role_id)
    select m.school_id, m.user_id, r.id from public.school_members m
      join public.roles r on r.school_id = m.school_id and r.code = case m.role
        when 'admin' then 'principal' when 'accountant' then 'accountant' when 'reception' then 'front_office' else 'class_teacher' end
    on conflict do nothing;
  end if;
end $$;

-- ───────────── Drop every old policy, then rebuild on permissions ─────────────
do $$
declare p record;
begin
  -- ERP tables only: other apps may share this Supabase project (e.g. the CodersDuniya website / CRM)
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and tablename = any (array[
      'platform_admins','schools','school_members','sessions','classes','sections','subjects','students','enquiries',
      'fee_heads','fee_plans','student_concessions','fee_dues','fee_receipts','fee_receipt_lines','attendance','exams',
      'exam_subjects','marks','notices','erp_modules','erp_submodules','erp_permissions','role_templates',
      'role_template_permissions','school_groups','school_modules','roles','role_permissions','member_roles',
      'member_overrides','staff_assignments','guardians','student_guardians']) loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.school_members drop column if exists role;
drop function if exists public.has_role(uuid, text[]);
drop function if exists public.school_role(uuid);

-- Catalogue: readable by any signed-in user
do $$
declare t text;
begin
  foreach t in array array['erp_modules','erp_submodules','erp_permissions','role_templates','role_template_permissions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

alter table public.platform_admins enable row level security;
create policy "self" on public.platform_admins for select to authenticated using (user_id = auth.uid());

alter table public.school_groups enable row level security;
create policy "read" on public.school_groups for select to authenticated using (public.is_platform_admin() or exists (select 1 from public.schools s where s.group_id = id and public.is_member(s.id)));
create policy "platform" on public.school_groups for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.schools enable row level security;
create policy "read" on public.schools for select to authenticated using (public.is_member(id));
create policy "edit" on public.schools for update to authenticated using (public.has_perm_school(id, 'settings.school.edit')) with check (public.has_perm_school(id, 'settings.school.edit'));
create policy "platform insert" on public.schools for insert to authenticated with check (public.is_platform_admin());
create policy "platform delete" on public.schools for delete to authenticated using (public.is_platform_admin());

alter table public.school_modules enable row level security;
create policy "read" on public.school_modules for select to authenticated using (public.is_member(school_id));
create policy "platform licence" on public.school_modules for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
-- Schools switch licensed modules on/off through set_module_enabled()

alter table public.school_members enable row level security;
create policy "read" on public.school_members for select to authenticated using (user_id = auth.uid() or public.has_perm(school_id, 'settings.users.view'));
create policy "create" on public.school_members for insert to authenticated with check (public.has_perm_school(school_id, 'settings.users.create'));
create policy "edit" on public.school_members for update to authenticated using (public.has_perm_school(school_id, 'settings.users.edit'));
create policy "delete" on public.school_members for delete to authenticated using (public.has_perm_school(school_id, 'settings.users.delete') and user_id <> auth.uid());

alter table public.roles enable row level security;
create policy "read" on public.roles for select to authenticated using (public.has_perm(school_id, 'settings.roles.view') or public.has_perm(school_id, 'settings.users.view') or exists (select 1 from public.member_roles mr where mr.role_id = id and mr.user_id = auth.uid()));
create policy "create" on public.roles for insert to authenticated with check (public.has_perm_school(school_id, 'settings.roles.create') and not locked);
create policy "edit" on public.roles for update to authenticated using (public.has_perm_school(school_id, 'settings.roles.edit')) with check (public.has_perm_school(school_id, 'settings.roles.edit'));
create policy "delete" on public.roles for delete to authenticated using (public.has_perm_school(school_id, 'settings.roles.delete') and not locked and template_code is null);

alter table public.role_permissions enable row level security;
create policy "read" on public.role_permissions for select to authenticated using (exists (select 1 from public.roles r where r.id = role_id));
create policy "write" on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and public.has_perm_school(r.school_id, 'settings.roles.edit')))
  with check (exists (select 1 from public.roles r where r.id = role_id and public.has_perm_school(r.school_id, 'settings.roles.edit')));

alter table public.member_roles enable row level security;
create policy "read" on public.member_roles for select to authenticated using (user_id = auth.uid() or public.has_perm(school_id, 'settings.users.view'));
create policy "write" on public.member_roles for all to authenticated using (public.has_perm_school(school_id, 'settings.users.edit')) with check (public.has_perm_school(school_id, 'settings.users.edit'));

alter table public.member_overrides enable row level security;
create policy "read" on public.member_overrides for select to authenticated using (user_id = auth.uid() or public.has_perm(school_id, 'settings.users.view'));
create policy "write" on public.member_overrides for all to authenticated using (public.has_perm_school(school_id, 'settings.roles.edit')) with check (public.has_perm_school(school_id, 'settings.roles.edit'));

alter table public.staff_assignments enable row level security;
create policy "read" on public.staff_assignments for select to authenticated using (public.is_member(school_id));
create policy "write" on public.staff_assignments for all to authenticated using (public.has_perm_school(school_id, 'academics.allocation.edit')) with check (public.has_perm_school(school_id, 'academics.allocation.edit'));

alter table public.guardians enable row level security;
create policy "read" on public.guardians for select to authenticated using (user_id = auth.uid() or public.has_perm(school_id, 'students.profile.view'));
create policy "write" on public.guardians for all to authenticated using (public.has_perm_school(school_id, 'students.profile.edit')) with check (public.has_perm_school(school_id, 'students.profile.edit'));
alter table public.student_guardians enable row level security;
create policy "read" on public.student_guardians for select to authenticated using (public.can_student(school_id, 'students.profile.view', student_id));
create policy "write" on public.student_guardians for all to authenticated using (public.has_perm_school(school_id, 'students.profile.edit')) with check (public.has_perm_school(school_id, 'students.profile.edit'));

-- Academic setup: everyone in the school reads it; settings perms write it
do $$
declare t text;
begin
  foreach t in array array['sessions','classes','sections','subjects'] loop
    execute format('create policy "read" on public.%I for select to authenticated using (public.is_member(school_id))', t);
    execute format('create policy "create" on public.%I for insert to authenticated with check (public.has_perm_school(school_id, ''academics.setup.create''))', t);
    execute format('create policy "edit" on public.%I for update to authenticated using (public.has_perm_school(school_id, ''academics.setup.edit''))', t);
    execute format('create policy "delete" on public.%I for delete to authenticated using (public.has_perm_school(school_id, ''academics.setup.delete''))', t);
  end loop;
end $$;

-- Students (scope-aware)
create policy "read" on public.students for select to authenticated using (public.can_student(school_id, 'students.profile.view', id));
create policy "create" on public.students for insert to authenticated with check (public.has_perm_school(school_id, 'students.profile.create'));
create policy "edit" on public.students for update to authenticated using (public.can_student(school_id, 'students.profile.edit', id) or public.has_perm_school(school_id, 'students.parent_link.edit') or public.has_perm_school(school_id, 'students.promotion.create'));
create policy "delete" on public.students for delete to authenticated using (public.has_perm_school(school_id, 'students.profile.delete'));

-- Enquiries
create policy "read" on public.enquiries for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.enquiries.view'));
create policy "create" on public.enquiries for insert to authenticated with check (public.has_perm_school(school_id, 'frontdesk.enquiries.create'));
create policy "edit" on public.enquiries for update to authenticated using (public.has_perm_school(school_id, 'frontdesk.enquiries.edit') or public.has_perm_school(school_id, 'students.profile.create'));
create policy "delete" on public.enquiries for delete to authenticated using (public.has_perm_school(school_id, 'frontdesk.enquiries.delete'));

-- Fee setup: anyone with a fee permission reads heads / plans; structure perms write
create policy "read" on public.fee_heads for select to authenticated using (public.has_module_perm(school_id, 'fees'));
create policy "create" on public.fee_heads for insert to authenticated with check (public.has_perm_school(school_id, 'fees.structure.create'));
create policy "edit" on public.fee_heads for update to authenticated using (public.has_perm_school(school_id, 'fees.structure.edit'));
create policy "delete" on public.fee_heads for delete to authenticated using (public.has_perm_school(school_id, 'fees.structure.delete'));
create policy "read" on public.fee_plans for select to authenticated using (public.has_module_perm(school_id, 'fees'));
create policy "create" on public.fee_plans for insert to authenticated with check (public.has_perm_school(school_id, 'fees.structure.create'));
create policy "edit" on public.fee_plans for update to authenticated using (public.has_perm_school(school_id, 'fees.structure.edit'));
create policy "delete" on public.fee_plans for delete to authenticated using (public.has_perm_school(school_id, 'fees.structure.delete'));

create policy "read" on public.student_concessions for select to authenticated using (public.can_student(school_id, 'fees.concessions.view', student_id));
create policy "create" on public.student_concessions for insert to authenticated with check (public.has_perm_school(school_id, 'fees.concessions.create'));
create policy "delete" on public.student_concessions for delete to authenticated using (public.has_perm_school(school_id, 'fees.concessions.delete'));

create policy "read" on public.fee_dues for select to authenticated using (public.can_student(school_id, 'fees.collection.view', student_id) or public.can_student(school_id, 'fees.defaulters.view', student_id));
create policy "edit" on public.fee_dues for update to authenticated using (public.has_perm_school(school_id, 'fees.concessions.create') or public.has_perm_school(school_id, 'fees.dues.create'));
create policy "delete" on public.fee_dues for delete to authenticated using (public.has_perm_school(school_id, 'fees.structure.delete') and paid = 0);
-- inserts happen only through generate_dues()

create policy "read" on public.fee_receipts for select to authenticated using (public.can_student(school_id, 'fees.collection.view', student_id) or public.can_student(school_id, 'fees.receipts.view', student_id));
create policy "cancel" on public.fee_receipts for update to authenticated using (public.has_perm_school(school_id, 'fees.receipts.approve'));
-- inserts happen only through collect_fee()
create policy "read" on public.fee_receipt_lines for select to authenticated using (exists (select 1 from public.fee_receipts r where r.id = receipt_id));

-- Attendance (section scope)
create policy "read" on public.attendance for select to authenticated using (public.can_student(school_id, 'attendance.students.view', student_id));
create policy "create" on public.attendance for insert to authenticated with check (public.can_section(school_id, 'attendance.students.create', section_id));
create policy "edit" on public.attendance for update to authenticated using (public.can_section(school_id, 'attendance.students.edit', section_id) or public.can_section(school_id, 'attendance.students.create', section_id));

-- Exams
create policy "read" on public.exams for select to authenticated using (public.is_member(school_id));
create policy "create" on public.exams for insert to authenticated with check (public.has_perm_school(school_id, 'exams.setup.create'));
create policy "edit" on public.exams for update to authenticated using (public.has_perm_school(school_id, 'exams.setup.edit') or public.has_perm_school(school_id, 'exams.results.publish'));
create policy "delete" on public.exams for delete to authenticated using (public.has_perm_school(school_id, 'exams.setup.delete'));
create policy "read" on public.exam_subjects for select to authenticated using (public.is_member(school_id));
create policy "create" on public.exam_subjects for insert to authenticated with check (public.has_perm_school(school_id, 'exams.setup.create'));
create policy "edit" on public.exam_subjects for update to authenticated using (public.has_perm_school(school_id, 'exams.setup.edit'));
create policy "delete" on public.exam_subjects for delete to authenticated using (public.has_perm_school(school_id, 'exams.setup.delete'));

-- Marks: subject teachers only for their subject in their sections; locked after publish unless approve
create or replace function public.marks_writable(sid uuid, ex uuid, stu uuid, subj uuid, act text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_student(sid, 'exams.marks.' || act, stu, subj) then return false; end if;
  if exists (select 1 from public.exams where id = ex and published) then
    return public.has_perm_school(sid, 'exams.marks.approve');
  end if;
  return true;
end $$;
create policy "read" on public.marks for select to authenticated using (public.can_student(school_id, 'exams.marks.view', student_id) or (public.can_student(school_id, 'exams.results.view', student_id) and exists (select 1 from public.exams e where e.id = exam_id and (e.published or public.perm_scope(school_id, 'exams.results.view') in ('school','assigned')))));
create policy "create" on public.marks for insert to authenticated with check (public.marks_writable(school_id, exam_id, student_id, subject_id, 'create'));
create policy "edit" on public.marks for update to authenticated using (public.marks_writable(school_id, exam_id, student_id, subject_id, 'edit'));

-- Notices
create policy "read" on public.notices for select to authenticated using (public.has_perm(school_id, 'comms.notices.view'));
create policy "create" on public.notices for insert to authenticated with check (public.has_perm_school(school_id, 'comms.notices.create'));
create policy "edit" on public.notices for update to authenticated using (public.has_perm_school(school_id, 'comms.notices.edit'));
create policy "delete" on public.notices for delete to authenticated using (public.has_perm_school(school_id, 'comms.notices.delete'));

-- ───────────── Server functions now check permissions ─────────────
create or replace function public.next_school_number(sid uuid, kind text) returns text
language plpgsql security definer set search_path = public as $$
declare n int; p text;
begin
  if kind = 'receipt' then
    if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
    update public.schools set next_receipt_no = next_receipt_no + 1 where id = sid returning next_receipt_no - 1, receipt_prefix into n, p;
    return p || lpad(n::text, 5, '0');
  elsif kind = 'admission' then
    if not public.has_perm_school(sid, 'students.profile.create') then raise exception 'not allowed'; end if;
    update public.schools set next_admission_no = next_admission_no + 1 where id = sid returning next_admission_no - 1, admission_prefix into n, p;
    return p || n::text;
  end if;
  raise exception 'unknown kind %', kind;
end $$;

create or replace function public.generate_dues(sid uuid, sess uuid, cls uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         least(p.amount, coalesce((select sum(case when c.kind = 'percent' then p.amount * c.value / 100 else c.value end)
                                    from public.student_concessions c
                                    where c.student_id = s.id and (c.fee_head_id is null or c.fee_head_id = p.fee_head_id)), 0))
  from public.fee_plans p
  join public.fee_heads h on h.id = p.fee_head_id
  join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.status = 'active'
  where p.school_id = sid and p.session_id = sess and (cls is null or p.class_id = cls)
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

create or replace function public.collect_fee(sid uuid, stu uuid, amt numeric, p_mode text, p_ref text, p_note text, p_paid_on date, p_fine numeric, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; rno text; left_amt numeric := amt; d record; take numeric; first_due uuid;
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  if amt is null or amt <= 0 then raise exception 'Amount must be more than zero'; end if;
  perform 1 from public.students where id = stu and school_id = sid;
  if not found then raise exception 'Student not found'; end if;
  if coalesce(p_fine, 0) > 0 then
    select id into first_due from public.fee_dues where student_id = stu and school_id = sid and status <> 'paid' order by due_date, label limit 1;
    if first_due is null then raise exception 'No unpaid instalment to add the fine to'; end if;
    update public.fee_dues set fine = fine + p_fine where id = first_due;
  end if;
  if amt > (select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) from public.fee_dues where student_id = stu and school_id = sid) then
    raise exception 'Amount is more than the total due';
  end if;
  rno := public.next_school_number(sid, 'receipt');
  insert into public.fee_receipts (school_id, receipt_no, student_id, paid_on, mode, reference, amount, note, collected_by)
    values (sid, rno, stu, coalesce(p_paid_on, (now() at time zone 'Asia/Kolkata')::date), p_mode, p_ref, amt, p_note, p_by) returning id into rid;
  for d in select id, greatest(amount - concession + fine - paid, 0) as bal from public.fee_dues
           where student_id = stu and school_id = sid and status <> 'paid' order by due_date, label for update loop
    exit when left_amt <= 0;
    take := least(d.bal, left_amt);
    if take > 0 then
      insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, d.id, take);
      left_amt := left_amt - take;
    end if;
  end loop;
  return rid;
end $$;

create or replace function public.set_current_session(sid uuid, sess uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'academics.setup.edit') then raise exception 'not allowed'; end if;
  update public.sessions set is_current = (id = sess) where school_id = sid;
end $$;

create or replace function public.promote_students(sid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare moved int; passed int; top int;
begin
  if not public.has_perm_school(sid, 'students.promotion.create') then raise exception 'not allowed'; end if;
  select max(sort) into top from public.classes where school_id = sid;
  update public.students s set status = 'passed_out'
    from public.classes c where c.id = s.class_id and s.school_id = sid and s.status = 'active' and c.sort = top;
  get diagnostics passed = row_count;
  with nxt as (
    select c.id as from_id, (select c2.id from public.classes c2 where c2.school_id = sid and c2.sort > c.sort order by c2.sort limit 1) as to_id
    from public.classes c where c.school_id = sid
  )
  update public.students s set class_id = nxt.to_id,
         section_id = coalesce((select x.id from public.sections x where x.class_id = nxt.to_id and x.name = (select name from public.sections where id = s.section_id)),
                               (select x.id from public.sections x where x.class_id = nxt.to_id order by x.name limit 1)),
         roll_no = null
    from nxt where s.class_id = nxt.from_id and nxt.to_id is not null and s.school_id = sid and s.status = 'active';
  get diagnostics moved = row_count;
  return json_build_object('promoted', moved, 'passed_out', passed);
end $$;

-- A school can switch its licensed modules on or off.
create or replace function public.set_module_enabled(sid uuid, m text, on_off boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'settings.school.edit') then raise exception 'not allowed'; end if;
  if exists (select 1 from public.erp_modules where code = m and core) then raise exception 'Core modules cannot be switched off.'; end if;
  update public.school_modules set enabled = on_off where school_id = sid and module_code = m and licensed;
  if not found then raise exception 'Module not licensed for this school.'; end if;
end $$;

-- Onboarding now also seeds modules and roles.
create or replace function public.create_school(p_name text, p_code text, p_board text default 'CBSE', p_city text default 'Lucknow')
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; cid uuid; c text; i int := 0; yr int; sess uuid;
begin
  if not public.is_platform_admin() then raise exception 'not allowed'; end if;
  insert into public.schools (name, code, board, city) values (p_name, p_code, p_board, p_city) returning id into sid;
  yr := case when extract(month from now()) >= 4 then extract(year from now())::int else extract(year from now())::int - 1 end;
  insert into public.sessions (school_id, name, start_date, end_date, is_current)
    values (sid, yr || '-' || lpad(((yr + 1) % 100)::text, 2, '0'), make_date(yr, 4, 1), make_date(yr + 1, 3, 31), true) returning id into sess;
  foreach c in array array['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'] loop
    insert into public.classes (school_id, name, sort) values (sid, c, i) returning id into cid;
    insert into public.sections (school_id, class_id, name) values (sid, cid, 'A');
    i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['English','Hindi','Mathematics','Science','Social Science','Computer','Sanskrit','EVS','Drawing'] loop
    insert into public.subjects (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['Tuition Fee','Admission Fee','Annual Charges','Exam Fee','Transport Fee'] loop
    insert into public.fee_heads (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  perform public.seed_school_modules(sid);
  perform public.sync_role_templates(sid);
  return sid;
end $$;

-- Reporting functions keep running with the caller's rights (RLS applies).

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 3: school registration, subscription plans (monthly / yearly), invoices,
-- trial → grace → read-only. Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- Schools can now wait for approval after self-registration
alter table public.schools drop constraint if exists schools_status_check;
alter table public.schools add constraint schools_status_check check (status in ('pending','active','suspended'));
alter table public.schools add column if not exists principal_phone text;
alter table public.schools add column if not exists source text not null default 'platform';  -- platform | self_signup

-- Key/value settings owned by the platform (more arrive in the settings-centre step)
create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value) values
  ('signup',  '{"enabled": true, "require_approval": true, "trial_plan": "trial"}'),
  ('billing', '{"gst_rate": 18, "invoice_prefix": "CDS", "grace_days": 7, "renew_days_before": 7, "seller_name": "CodersDuniya", "seller_gstin": "", "seller_state": "09"}')
on conflict (key) do nothing;

-- ───────────── Plans ─────────────
create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null check (code ~ '^[a-z0-9_]{2,30}$'),
  name          text not null,
  description   text,
  price_type    text not null default 'per_student' check (price_type in ('per_student','flat')),
  price_monthly numeric(10,2) not null default 0,   -- per student per month, or flat per month
  price_yearly  numeric(10,2) not null default 0,   -- per student per year, or flat per year
  min_students  int not null default 0,             -- bill at least this many students
  student_limit int not null default 2000,
  storage_mb    int not null default 1024,
  trial_days    int not null default 0,             -- > 0 = a trial plan
  modules       text[] not null default '{}',       -- licensed module codes (core modules are always on)
  is_public     boolean not null default true,      -- shown on the school's billing page
  active        boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
insert into public.plans (code, name, description, price_type, price_monthly, price_yearly, min_students, student_limit, storage_mb, trial_days, modules, sort) values
  ('trial', 'Free trial', 'Every module for 30 days, then pick a plan.', 'per_student', 0, 0, 0, 300, 512, 30,
    array['frontdesk','students','academics','homework','attendance','exams','fees','accounts','hr','comms','transport','library','hostel','inventory','wellbeing','reports'], 0),
  ('starter', 'Starter', 'Admissions, students, attendance, exams, fees, notices.', 'per_student', 10, 99, 100, 500, 2048, 0,
    array['frontdesk','students','academics','attendance','exams','fees','comms','reports'], 1),
  ('standard', 'Standard', 'Starter + homework, staff & payroll, transport, library.', 'per_student', 15, 149, 200, 2000, 10240, 0,
    array['frontdesk','students','academics','homework','attendance','exams','fees','hr','comms','transport','library','reports'], 2),
  ('premium', 'Premium', 'Every module, multi-branch ready, priority support.', 'per_student', 20, 199, 300, 10000, 51200, 0,
    array['frontdesk','students','academics','homework','attendance','exams','fees','accounts','hr','comms','transport','library','hostel','inventory','wellbeing','reports'], 3)
on conflict (code) do nothing;

-- ───────────── Subscriptions (one per school) — named school_subscriptions so it never clashes with a CRM "subscriptions" table in the same project ─────────────
create table if not exists public.school_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid unique not null references public.schools(id) on delete cascade,
  plan_id              uuid not null references public.plans(id),
  billing_cycle        text not null default 'yearly' check (billing_cycle in ('monthly','yearly')),
  status               text not null default 'trialing' check (status in ('trialing','active','cancelled')),
  current_period_start date not null,
  current_period_end   date not null,
  grace_days           int not null default 7,
  auto_renew           boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.invoice_counters (fy text primary key, n int not null default 0);

create table if not exists public.subscription_invoices (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  subscription_id  uuid not null references public.school_subscriptions(id) on delete cascade,
  number           text unique not null,
  plan_code        text not null,
  billing_cycle    text not null,
  period_start     date not null,
  period_end       date not null,
  students         int not null default 0,
  rate             numeric(10,2) not null default 0,
  amount           numeric(12,2) not null,
  gst_rate         numeric(5,2) not null default 18,
  gst_amount       numeric(12,2) not null default 0,
  total            numeric(12,2) not null,
  status           text not null default 'due' check (status in ('due','paid','void')),
  due_date         date not null,
  paid_at          timestamptz,
  payment_ref      text,
  razorpay_link_id text,
  razorpay_link_url text,
  created_at       timestamptz not null default now(),
  unique (subscription_id, period_start)
);
create index if not exists subscription_invoices_school_idx on public.subscription_invoices (school_id, created_at desc);

-- ───────────── Helpers ─────────────
create or replace function public.today_ist() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function public.cycle_end(start date, cycle text) returns date
language sql immutable as $$
  select (start + case when cycle = 'yearly' then interval '1 year' else interval '1 month' end - interval '1 day')::date;
$$;

create or replace function public.is_service() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'role', '') = 'service_role'; $$;

-- trial | ok | grace | expired | pending | suspended
create or replace function public.subscription_state(sid uuid, on_day date default null) returns text
language sql stable security definer set search_path = public as $$
  select case
    when s.status = 'suspended' then 'suspended'
    when s.status = 'pending' then 'pending'
    when sub.id is null then 'ok'
    when sub.status = 'cancelled' and coalesce(on_day, public.today_ist()) > sub.current_period_end then 'expired'
    when coalesce(on_day, public.today_ist()) <= sub.current_period_end then case when sub.status = 'trialing' then 'trial' else 'ok' end
    when sub.status <> 'trialing' and coalesce(on_day, public.today_ist()) <= sub.current_period_end + sub.grace_days then 'grace'
    else 'expired' end
  from public.schools s left join public.school_subscriptions sub on sub.school_id = s.id
  where s.id = sid;
$$;

-- Writes are allowed only while the subscription is live (trial / paid / grace).
create or replace function public.school_writable(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.subscription_state(sid) in ('ok','trial','grace'), false);
$$;

create or replace function public.guard_student_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if not public.school_writable(new.school_id) then
    raise exception 'This school is read-only (%). Renew the subscription to add students.', public.subscription_state(new.school_id);
  end if;
  select student_limit into lim from public.schools where id = new.school_id;
  select count(*) into n from public.students where school_id = new.school_id and status = 'active';
  if n >= lim then raise exception 'Student limit (%) reached for your plan. Please upgrade.', lim; end if;
  return new;
end $$;

-- schools.plan check allowed only trial/standard/premium; widen it to any plan code
alter table public.schools drop constraint if exists schools_plan_check;
-- Licence modules + limits from a plan and start / change the subscription.
create or replace function public.apply_plan(sid uuid, p_plan text, p_cycle text default 'yearly', p_start date default null, p_period_end date default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl record; st date := coalesce(p_start, public.today_ist()); en date; is_trial boolean;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  select * into pl from public.plans where code = p_plan;
  if pl.id is null then raise exception 'Unknown plan %', p_plan; end if;
  if p_cycle not in ('monthly','yearly') then raise exception 'Cycle must be monthly or yearly'; end if;
  is_trial := pl.trial_days > 0;
  en := coalesce(p_period_end, case when is_trial then st + pl.trial_days - 1 else public.cycle_end(st, p_cycle) end);
  update public.schools set plan = pl.code, student_limit = pl.student_limit, price_per_student = pl.price_yearly where id = sid;
  insert into public.school_modules (school_id, module_code, licensed, enabled)
    select sid, m.code, (m.core or m.code = any(pl.modules)), true from public.erp_modules m
  on conflict (school_id, module_code) do update set licensed = excluded.licensed;
  insert into public.school_subscriptions (school_id, plan_id, billing_cycle, status, current_period_start, current_period_end, grace_days)
    values (sid, pl.id, p_cycle, case when is_trial then 'trialing' else 'active' end, st, en,
            coalesce((select (value ->> 'grace_days')::int from public.platform_settings where key = 'billing'), 7))
  on conflict (school_id) do update set plan_id = excluded.plan_id, billing_cycle = excluded.billing_cycle, status = excluded.status,
     current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, updated_at = now();
end $$;

-- Invoice for the NEXT period of a school's subscription (or for a plan change starting today).
create or replace function public.create_subscription_invoice(sid uuid, p_start date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sub record; pl record; st date; en date; v_n int; stu int; rate numeric; amt numeric; gst numeric; v_fy text; num text; cfg jsonb; inv uuid;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  select * into sub from public.school_subscriptions where school_id = sid;
  if sub.id is null then raise exception 'School has no subscription'; end if;
  select * into pl from public.plans where id = sub.plan_id;
  if pl.trial_days > 0 then raise exception 'Move the school to a paid plan before invoicing.'; end if;
  -- default: expired → from today; current paid period not yet invoiced → that period; else the next period
  st := coalesce(p_start, case
          when sub.current_period_end < public.today_ist() then public.today_ist()
          when not exists (select 1 from public.subscription_invoices i where i.subscription_id = sub.id and i.status <> 'void'
                             and i.period_start <= sub.current_period_start and i.period_end >= sub.current_period_start) then sub.current_period_start
          else sub.current_period_end + 1 end);
  select id into inv from public.subscription_invoices where subscription_id = sub.id and period_start = st and status <> 'void';
  if inv is not null then return inv; end if;
  en := public.cycle_end(st, sub.billing_cycle);
  select count(*) into v_n from public.students where school_id = sid and status = 'active';
  stu := greatest(v_n, pl.min_students);
  rate := case when sub.billing_cycle = 'yearly' then pl.price_yearly else pl.price_monthly end;
  amt := case when pl.price_type = 'per_student' then round(rate * stu, 2) else rate end;
  select value into cfg from public.platform_settings where key = 'billing';
  gst := round(amt * coalesce((cfg ->> 'gst_rate')::numeric, 18) / 100, 2);
  v_fy := case when extract(month from public.today_ist()) >= 4 then extract(year from public.today_ist())::int else extract(year from public.today_ist())::int - 1 end
        || '-' || lpad(((case when extract(month from public.today_ist()) >= 4 then extract(year from public.today_ist())::int else extract(year from public.today_ist())::int - 1 end + 1) % 100)::text, 2, '0');
  insert into public.invoice_counters as c (fy, n) values (v_fy, 1) on conflict (fy) do update set n = c.n + 1 returning c.n into v_n;
  num := coalesce(cfg ->> 'invoice_prefix', 'CDS') || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
  insert into public.subscription_invoices (school_id, subscription_id, number, plan_code, billing_cycle, period_start, period_end, students, rate, amount, gst_rate, gst_amount, total, due_date)
    values (sid, sub.id, num, pl.code, sub.billing_cycle, st, en, case when pl.price_type = 'per_student' then stu else 0 end, rate, amt,
            coalesce((cfg ->> 'gst_rate')::numeric, 18), gst, amt + gst, greatest(st - 1, public.today_ist() + 3))
  returning id into inv;
  return inv;
end $$;

-- Payment received → the subscription runs until the invoice's period end.
create or replace function public.mark_subscription_invoice_paid(inv_id uuid, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  select * into inv from public.subscription_invoices where id = inv_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.status = 'paid' then return; end if;
  if inv.status = 'void' then raise exception 'Invoice is void'; end if;
  update public.subscription_invoices set status = 'paid', paid_at = now(), payment_ref = coalesce(p_ref, payment_ref) where id = inv_id;
  update public.school_subscriptions s set status = 'active',
         current_period_start = case when s.status = 'trialing' or inv.period_start > s.current_period_end then inv.period_start else s.current_period_start end,
         current_period_end = greatest(s.current_period_end, inv.period_end),
         updated_at = now()
   where s.id = inv.subscription_id;
end $$;

-- Daily job: create renewal invoices that fall due within N days. Returns the new invoice ids.
create or replace function public.billing_run(on_day date default null) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(on_day, public.today_ist()); sub record; days int; inv uuid;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  select coalesce((value ->> 'renew_days_before')::int, 7) into days from public.platform_settings where key = 'billing';
  for sub in select s.* from public.school_subscriptions s join public.plans p on p.id = s.plan_id join public.schools sc on sc.id = s.school_id
             where s.status = 'active' and s.auto_renew and p.trial_days = 0 and sc.status = 'active'
               and s.current_period_end - d <= days
               and not exists (select 1 from public.subscription_invoices i where i.subscription_id = s.id and i.period_start > s.current_period_end and i.status <> 'void') loop
    inv := public.create_subscription_invoice(sub.school_id, sub.current_period_end + 1);
    return next inv;
  end loop;
end $$;

-- ───────────── School creation (shared by platform onboarding and self-registration) ─────────────
create or replace function public._create_school_core(p_name text, p_code text, p_board text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; cid uuid; c text; i int := 0; yr int;
begin
  if not (public.is_platform_admin() or public.is_service()) then raise exception 'not allowed'; end if;
  insert into public.schools (name, code, board, city) values (p_name, p_code, p_board, p_city) returning id into sid;
  yr := case when extract(month from now()) >= 4 then extract(year from now())::int else extract(year from now())::int - 1 end;
  insert into public.sessions (school_id, name, start_date, end_date, is_current)
    values (sid, yr || '-' || lpad(((yr + 1) % 100)::text, 2, '0'), make_date(yr, 4, 1), make_date(yr + 1, 3, 31), true);
  foreach c in array array['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'] loop
    insert into public.classes (school_id, name, sort) values (sid, c, i) returning id into cid;
    insert into public.sections (school_id, class_id, name) values (sid, cid, 'A');
    i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['English','Hindi','Mathematics','Science','Social Science','Computer','Sanskrit','EVS','Drawing'] loop
    insert into public.subjects (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['Tuition Fee','Admission Fee','Annual Charges','Exam Fee','Transport Fee'] loop
    insert into public.fee_heads (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  perform public.seed_school_modules(sid);
  perform public.sync_role_templates(sid);
  return sid;
end $$;

drop function if exists public.create_school(text, text, text, text);
create or replace function public.create_school(p_name text, p_code text, p_board text default 'CBSE', p_city text default 'Lucknow',
                                                p_plan text default 'trial', p_cycle text default 'yearly')
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.is_platform_admin() then raise exception 'not allowed'; end if;
  sid := public._create_school_core(p_name, p_code, p_board, p_city);
  perform public.apply_plan(sid, p_plan, p_cycle);
  return sid;
end $$;

-- Self-registration (called only by the server with the secret key, after it created the login).
create or replace function public.register_school(p_name text, p_board text, p_city text, p_user uuid, p_principal text, p_email text, p_phone text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; cfg jsonb; v_code text; rid uuid;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select value into cfg from public.platform_settings where key = 'signup';
  if not coalesce((cfg ->> 'enabled')::boolean, false) then raise exception 'Registration is closed. Please contact us.'; end if;
  if exists (select 1 from public.school_members where user_id = p_user) then raise exception 'This email already belongs to a school. Sign in instead.'; end if;
  v_code := left(trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g')), 22) || '-' || substr(md5(random()::text), 1, 5);
  if length(v_code) < 9 then v_code := 'school-' || substr(md5(random()::text), 1, 8); end if;
  sid := public._create_school_core(p_name, v_code, p_board, p_city);
  update public.schools set status = case when coalesce((cfg ->> 'require_approval')::boolean, true) then 'pending' else 'active' end,
         principal_name = p_principal, principal_phone = p_phone, phone = p_phone, email = p_email, source = 'self_signup' where id = sid;
  perform public.apply_plan(sid, coalesce(cfg ->> 'trial_plan', 'trial'), 'yearly');
  insert into public.school_members (school_id, user_id, name, email, phone) values (sid, p_user, p_principal, p_email, p_phone);
  select id into rid from public.roles where school_id = sid and roles.code = 'principal';
  insert into public.member_roles (school_id, user_id, role_id) values (sid, p_user, rid);
  return sid;
end $$;

-- Only the server (service role) may call these directly
revoke execute on function public._create_school_core(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.register_school(text, text, text, uuid, text, text, text) from public, anon, authenticated;

-- Approving a pending school (platform) restarts its trial from today.
create or replace function public.approve_school(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl text;
begin
  if not public.is_platform_admin() then raise exception 'not allowed'; end if;
  update public.schools set status = 'active' where id = sid and status = 'pending';
  select p.code into pl from public.school_subscriptions s join public.plans p on p.id = s.plan_id where s.school_id = sid and s.status = 'trialing';
  if pl is not null then perform public.apply_plan(sid, pl, 'yearly'); end if;
end $$;

-- ───────────── RLS ─────────────
alter table public.platform_settings enable row level security;
drop policy if exists "platform" on public.platform_settings;
create policy "platform" on public.platform_settings for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.plans enable row level security;
drop policy if exists "read" on public.plans;
drop policy if exists "platform" on public.plans;
create policy "read" on public.plans for select to authenticated using (active or public.is_platform_admin());
create policy "platform" on public.plans for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.school_subscriptions enable row level security;
drop policy if exists "read" on public.school_subscriptions;
drop policy if exists "platform" on public.school_subscriptions;
create policy "read" on public.school_subscriptions for select to authenticated using (public.is_platform_admin() or public.is_member(school_id));
create policy "platform" on public.school_subscriptions for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.subscription_invoices enable row level security;
drop policy if exists "read" on public.subscription_invoices;
drop policy if exists "platform" on public.subscription_invoices;
create policy "read" on public.subscription_invoices for select to authenticated using (public.is_platform_admin() or public.has_perm(school_id, 'settings.billing.view'));
create policy "platform" on public.subscription_invoices for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table public.invoice_counters enable row level security;

-- ───────────── Existing schools: new permissions + a 30-day trial if they have no subscription ─────────────
do $$
declare s record;
begin
  for s in select id from public.schools loop
    perform public.sync_role_templates(s.id);
    if not exists (select 1 from public.school_subscriptions where school_id = s.id) then
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      perform public.apply_plan(s.id, 'trial', 'yearly');
      perform set_config('request.jwt.claims', '{}', true);
    end if;
  end loop;
end $$;

-- Seller details for subscription invoices (readable by schools that can see billing)
create or replace function public.billing_seller() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('seller_name', value ->> 'seller_name', 'seller_gstin', value ->> 'seller_gstin',
                            'seller_address', value ->> 'seller_address', 'seller_state', value ->> 'seller_state')
  from public.platform_settings where key = 'billing';
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Super Admin platform + multi-tenancy:
--   platform team roles, support sessions (reason + expiry, enforced here),
--   audit log, tenant branding / subdomain / custom domain, school groups with
--   owners, announcements, support tickets, dashboard & usage stats, archive.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Platform team roles ─────────────
alter table public.platform_admins add column if not exists role text not null default 'owner';
alter table public.platform_admins drop constraint if exists platform_admins_role_check;
alter table public.platform_admins add constraint platform_admins_role_check check (role in ('owner','admin','support','billing','sales','viewer'));
alter table public.platform_admins add column if not exists name text;
alter table public.platform_admins add column if not exists email text;
alter table public.platform_admins add column if not exists active boolean not null default true;

create or replace function public.platform_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.platform_admins where user_id = auth.uid() and active;
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid() and active);
$$;

-- What each platform role may do. Areas: tenants, billing, plans, support, team, settings, audit, announcements, impersonate
create or replace function public.platform_can(area text, w boolean default false) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.platform_role();
begin
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;
  if r = 'admin' then return area <> 'team' or not w; end if;
  if r = 'viewer' then return not w and area <> 'impersonate'; end if;
  if r = 'support' then
    return area in ('support','impersonate') or (not w and area in ('tenants','plans','audit','announcements','settings'));
  elsif r = 'billing' then
    return area = 'billing' or (not w and area in ('tenants','plans','audit','support','settings'));
  elsif r = 'sales' then
    return area = 'tenants' or (not w and area in ('plans','support','billing','settings'));
  end if;
  return false;
end $$;

-- Server-side calls (secret key) count as the platform for these checks
create or replace function public.platform_or_service(area text, w boolean default true) returns boolean
language sql stable as $$ select public.is_service() or public.platform_can(area, w); $$;

-- ───────────── Support sessions: platform staff may change a school's data only inside one ─────────────
create table if not exists public.support_sessions (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  reason     text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at   timestamptz
);
create index if not exists support_sessions_user_idx on public.support_sessions (user_id, school_id, expires_at desc);

create or replace function public.active_support_session(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.support_sessions
   where school_id = sid and user_id = auth.uid() and ended_at is null and expires_at > now()
   order by started_at desc limit 1;
$$;

-- ───────────── Groups (trusts with several branches) ─────────────
alter table public.school_groups add column if not exists city text;
alter table public.school_groups add column if not exists contact_name text;
alter table public.school_groups add column if not exists contact_phone text;
alter table public.school_groups add column if not exists contact_email text;
create table if not exists public.group_members (
  group_id uuid not null references public.school_groups(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  name     text,
  email    text,
  role     text not null default 'owner' check (role in ('owner','viewer')),
  primary key (group_id, user_id)
);

create or replace function public.in_school_group(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.schools s join public.group_members g on g.group_id = s.group_id
                 where s.id = sid and g.user_id = auth.uid());
$$;

-- ───────────── Tenant profile: branding, subdomain, custom domain, archive ─────────────
alter table public.schools add column if not exists logo_url text;
alter table public.schools add column if not exists brand_color text;
alter table public.schools add column if not exists subdomain text;
alter table public.schools add column if not exists custom_domain text;
alter table public.schools add column if not exists notes text;
alter table public.schools add column if not exists archived_at timestamptz;
update public.schools set subdomain = code where subdomain is null;
create unique index if not exists schools_subdomain_uniq on public.schools (lower(subdomain));
create unique index if not exists schools_custom_domain_uniq on public.schools (lower(custom_domain)) where custom_domain is not null;
alter table public.schools drop constraint if exists schools_subdomain_check;
alter table public.schools add constraint schools_subdomain_check check (subdomain is null or subdomain ~ '^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])?$');
alter table public.schools drop constraint if exists schools_brand_color_check;
alter table public.schools add constraint schools_brand_color_check check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$');

create or replace function public.default_subdomain() returns trigger
language plpgsql as $$ begin if new.subdomain is null then new.subdomain := new.code; end if; return new; end $$;
drop trigger if exists schools_default_subdomain on public.schools;
create trigger schools_default_subdomain before insert on public.schools for each row execute function public.default_subdomain();

insert into public.platform_settings (key, value) values
  ('tenancy', '{"root_domain": "", "app_host": ""}'),
  ('branding', '{"product_name": "CodersDuniya School ERP", "support_whatsapp": "", "support_email": "", "support_phone": ""}')
on conflict (key) do nothing;

-- Which school does this host name belong to? (used before login, so callable by anyone; returns public branding only)
create or replace function public.tenant_by_host(h text) returns table (id uuid, name text, code text, logo_url text, brand_color text, status text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.code, s.logo_url, s.brand_color, s.status
  from public.schools s, (select coalesce(value ->> 'root_domain', '') as root from public.platform_settings where key = 'tenancy') t
  where s.archived_at is null
    and (lower(s.custom_domain) = lower(split_part(h, ':', 1))
         or (t.root <> '' and lower(split_part(h, ':', 1)) = lower(s.subdomain || '.' || t.root)))
  limit 1;
$$;
grant execute on function public.tenant_by_host(text) to anon, authenticated;

-- ───────────── Membership & permissions now know about groups and support sessions ─────────────
create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists (select 1 from public.school_members where school_id = sid and user_id = auth.uid())
      or exists (select 1 from public.member_roles where school_id = sid and user_id = auth.uid())
      or public.in_school_group(sid);
$$;

create or replace function public.perm_scope(sid uuid, pkey text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text; is_view boolean := split_part(pkey, '.', 3) = 'view';
begin
  if sid is null or auth.uid() is null then return null; end if;
  -- Platform team: may read every school; may change a school only inside an active support session
  if public.is_platform_admin() then
    if is_view then return 'school'; end if;
    if public.platform_can('impersonate', true) and public.active_support_session(sid) is not null and public.school_writable(sid) then return 'school'; end if;
    return null;
  end if;
  if not public.module_on(sid, split_part(pkey, '.', 1)) then return null; end if;
  if not is_view and not public.school_writable(sid) then return null; end if;
  if exists (select 1 from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = pkey and o.effect = 'deny') then return null; end if;
  select x.scope into s from (
    select rp.scope from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid() and rp.perm_key = pkey
    union all
    select o.scope from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = pkey and o.effect = 'grant'
  ) x order by array_position(array['school','assigned','own','child','self'], x.scope) limit 1;
  -- Group owners / viewers read every branch of their group
  if s is null and is_view and public.in_school_group(sid) then return 'school'; end if;
  return s;
end $$;

create or replace function public.my_permissions(sid uuid) returns table (perm_key text, scope text)
language plpgsql stable security definer set search_path = public as $$
declare w boolean := public.school_writable(sid);
begin
  if auth.uid() is null or sid is null then return; end if;
  if public.is_platform_admin() then
    return query select p.key, 'school'::text from public.erp_permissions p
      where p.action = 'view' or (public.platform_can('impersonate', true) and public.active_support_session(sid) is not null and w);
    return;
  end if;
  return query
  with g as (
    select rp.perm_key k, rp.scope sc from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid()
    union all
    select o.perm_key, o.scope from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.effect = 'grant'
    union all
    select p.key, 'school' from public.erp_permissions p where p.action = 'view' and public.in_school_group(sid)
  ), best as (
    select distinct on (k) k, sc from g order by k, array_position(array['school','assigned','own','child','self'], sc)
  )
  select b.k, b.sc from best b join public.erp_permissions p on p.key = b.k
   where public.module_on(sid, p.module_code) and (p.action = 'view' or w)
     and not exists (select 1 from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = b.k and o.effect = 'deny');
end $$;

-- Platform RPCs now follow the platform role
create or replace function public.apply_plan(sid uuid, p_plan text, p_cycle text default 'yearly', p_start date default null, p_period_end date default null)
returns void language plpgsql security definer set search_path = public as $$
declare pl record; st date := coalesce(p_start, public.today_ist()); en date; is_trial boolean;
begin
  if not (public.is_service() or public.platform_can('billing', true) or public.platform_can('tenants', true)) then raise exception 'not allowed'; end if;
  select * into pl from public.plans where code = p_plan;
  if pl.id is null then raise exception 'Unknown plan %', p_plan; end if;
  if p_cycle not in ('monthly','yearly') then raise exception 'Cycle must be monthly or yearly'; end if;
  is_trial := pl.trial_days > 0;
  en := coalesce(p_period_end, case when is_trial then st + pl.trial_days - 1 else public.cycle_end(st, p_cycle) end);
  update public.schools set plan = pl.code, student_limit = pl.student_limit, price_per_student = pl.price_yearly where id = sid;
  insert into public.school_modules (school_id, module_code, licensed, enabled)
    select sid, m.code, (m.core or m.code = any(pl.modules)), true from public.erp_modules m
  on conflict (school_id, module_code) do update set licensed = excluded.licensed;
  insert into public.school_subscriptions (school_id, plan_id, billing_cycle, status, current_period_start, current_period_end, grace_days)
    values (sid, pl.id, p_cycle, case when is_trial then 'trialing' else 'active' end, st, en,
            coalesce((select (value ->> 'grace_days')::int from public.platform_settings where key = 'billing'), 7))
  on conflict (school_id) do update set plan_id = excluded.plan_id, billing_cycle = excluded.billing_cycle, status = excluded.status,
     current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, updated_at = now();
  perform public.log_event('plan.applied', sid, 'school_subscriptions', sid::text, jsonb_build_object('plan', p_plan, 'cycle', p_cycle, 'start', st, 'end', en));
end $$;

-- ───────────── Audit log ─────────────
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_email text,
  actor_kind  text not null default 'user' check (actor_kind in ('user','platform','service','system')),
  support_session uuid,
  school_id   uuid,                        -- no FK: the log outlives deleted rows
  action      text not null,               -- e.g. insert / update / delete / plan.applied / support.start
  entity      text,                        -- table or area
  entity_id   text,
  details     jsonb not null default '{}'
);
create index if not exists audit_log_school_idx on public.audit_log (school_id, at desc);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

create or replace function public.actor_kind() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_service() then 'service' when auth.uid() is null then 'system' when public.is_platform_admin() then 'platform' else 'user' end;
$$;

create or replace function public.log_event(p_action text, p_school uuid, p_entity text, p_entity_id text, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor, actor_email, actor_kind, support_session, school_id, action, entity, entity_id, details)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''), public.actor_kind(),
          case when p_school is not null and auth.uid() is not null then public.active_support_session(p_school) end,
          p_school, p_action, p_entity, p_entity_id, coalesce(p_details, '{}'));
end $$;

-- Row-level audit: inserts, deletes and changed columns of updates
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        diff jsonb := '{}'; k text; sid uuid;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','marked_at') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  end if;
  sid := coalesce((coalesce(n, o) ->> 'school_id')::uuid, case when tg_table_name = 'schools' then (coalesce(n, o) ->> 'id')::uuid end);
  perform public.log_event(lower(tg_op), sid, tg_table_name, coalesce(n, o) ->> 'id',
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', diff)
         when tg_op = 'DELETE' then jsonb_build_object('row', o - 'portal_token')
         else jsonb_build_object('row', n - 'portal_token') end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['schools','school_subscriptions','subscription_invoices','school_modules','roles','member_roles','member_overrides',
                           'school_members','students','fee_receipts','fee_plans','fee_heads','student_concessions','exams','sessions',
                           'staff_assignments','plans','platform_settings','platform_admins','school_groups','group_members'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;
-- role_permissions has no id/school_id of its own: audit through its role
create or replace function public.audit_role_permission() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select id, school_id, name into r from public.roles where id = coalesce(new.role_id, old.role_id);
  if r.id is not null then
    perform public.log_event(case when tg_op = 'DELETE' then 'permission.removed' else 'permission.granted' end, r.school_id, 'roles', r.id::text,
      jsonb_build_object('role', r.name, 'permission', coalesce(new.perm_key, old.perm_key), 'scope', coalesce(new.scope, old.scope)));
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists audit_role_permissions on public.role_permissions;
create trigger audit_role_permissions after insert or delete on public.role_permissions for each row execute function public.audit_role_permission();

-- ───────────── Support sessions: start / end (logged) ─────────────
create or replace function public.start_support_session(sid uuid, p_reason text, p_minutes int default 120) returns uuid
language plpgsql security definer set search_path = public as $$
declare sess uuid;
begin
  if not public.platform_can('impersonate', true) then raise exception 'Your platform role cannot open schools for changes.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Write a short reason (at least 5 characters).'; end if;
  update public.support_sessions set ended_at = now() where user_id = auth.uid() and school_id = sid and ended_at is null;
  insert into public.support_sessions (school_id, user_id, reason, expires_at)
    values (sid, auth.uid(), trim(p_reason), now() + make_interval(mins => least(greatest(coalesce(p_minutes, 120), 10), 240)))
  returning id into sess;
  perform public.log_event('support.start', sid, 'support_sessions', sess::text, jsonb_build_object('reason', trim(p_reason), 'minutes', p_minutes));
  return sess;
end $$;

create or replace function public.end_support_session(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.support_sessions set ended_at = now() where user_id = auth.uid() and school_id = sid and ended_at is null;
  perform public.log_event('support.end', sid, 'support_sessions', null, '{}');
end $$;

-- ───────────── Announcements (platform → schools) ─────────────
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text,
  level      text not null default 'info' check (level in ('info','warning','critical')),
  audience   text not null default 'all' check (audience in ('all','plan','schools')),
  plan_codes text[] not null default '{}',
  school_ids uuid[] not null default '{}',
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create or replace function public.my_announcements(sid uuid) returns setof public.announcements
language sql stable security definer set search_path = public as $$
  select a.* from public.announcements a, public.schools s
   where s.id = sid and public.is_member(sid) and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
     and (a.audience = 'all' or (a.audience = 'plan' and s.plan = any(a.plan_codes)) or (a.audience = 'schools' and sid = any(a.school_ids)))
   order by case a.level when 'critical' then 0 when 'warning' then 1 else 2 end, a.starts_at desc
   limit 5;
$$;

-- ───────────── Support tickets (school ↔ platform) ─────────────
create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  number      bigint generated always as identity,
  school_id   uuid not null references public.schools(id) on delete cascade,
  created_by  uuid references auth.users(id) on delete set null,
  created_by_name text,
  subject     text not null,
  category    text not null default 'question' check (category in ('question','bug','billing','feature','data','other')),
  priority    text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status      text not null default 'open' check (status in ('open','pending','resolved','closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tickets_school_idx on public.tickets (school_id, created_at desc);
create table if not exists public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  author      uuid references auth.users(id) on delete set null,
  author_name text,
  from_platform boolean not null default false,
  internal    boolean not null default false,       -- platform-only note
  body        text not null,
  created_at  timestamptz not null default now()
);
create or replace function public.touch_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tickets set updated_at = now(),
         status = case when new.from_platform and not new.internal and status = 'open' then 'pending'
                       when not new.from_platform and status in ('pending','resolved') then 'open' else status end
   where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists ticket_messages_touch on public.ticket_messages;
create trigger ticket_messages_touch after insert on public.ticket_messages for each row execute function public.touch_ticket();

-- ───────────── Stats for the platform dashboard and tenant pages ─────────────
create or replace function public.platform_tenant_stats() returns table (
  school_id uuid, students bigint, staff bigint, parents bigint, collected_month numeric, receipts_month bigint, last_activity timestamptz, open_tickets bigint)
language sql stable security definer set search_path = public as $$
  select s.id,
    (select count(*) from public.students x where x.school_id = s.id and x.status = 'active'),
    (select count(distinct mr.user_id) from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.school_id = s.id and r.kind = 'staff'),
    (select count(*) from public.guardians g where g.school_id = s.id and g.user_id is not null),
    (select coalesce(sum(amount), 0) from public.fee_receipts f where f.school_id = s.id and not f.cancelled and f.paid_on >= date_trunc('month', public.today_ist())::date),
    (select count(*) from public.fee_receipts f where f.school_id = s.id and not f.cancelled and f.paid_on >= date_trunc('month', public.today_ist())::date),
    greatest((select max(at) from public.audit_log a where a.school_id = s.id and a.actor_kind = 'user'),
             (select max(marked_at) from public.attendance a where a.school_id = s.id),
             (select max(created_at) from public.fee_receipts f where f.school_id = s.id)),
    (select count(*) from public.tickets t where t.school_id = s.id and t.status in ('open','pending'))
  from public.schools s
  where public.platform_can('tenants', false);
$$;

create or replace function public.platform_dashboard() returns json
language plpgsql stable security definer set search_path = public as $$
declare res json;
begin
  if not public.platform_can('tenants', false) then raise exception 'not allowed'; end if;
  select json_build_object(
    'schools', (select count(*) from public.schools where archived_at is null),
    'states', (select coalesce(json_object_agg(st, n), '{}') from (select public.subscription_state(id) st, count(*) n from public.schools where archived_at is null group by 1) x),
    'students', (select count(*) from public.students where status = 'active'),
    'trials_ending', (select count(*) from public.school_subscriptions s where s.status = 'trialing' and s.current_period_end between public.today_ist() and public.today_ist() + 7),
    'renewals_due', (select count(*) from public.school_subscriptions s where s.status = 'active' and s.current_period_end between public.today_ist() and public.today_ist() + 30),
    'overdue_amount', (select coalesce(sum(total), 0) from public.subscription_invoices where status = 'due' and due_date < public.today_ist()),
    'due_amount', (select coalesce(sum(total), 0) from public.subscription_invoices where status = 'due'),
    'open_tickets', (select count(*) from public.tickets where status in ('open','pending')),
    'urgent_tickets', (select count(*) from public.tickets where status in ('open','pending') and priority in ('high','urgent')),
    'pending_approval', (select count(*) from public.schools where status = 'pending' and archived_at is null),
    'signups', (select coalesce(json_agg(json_build_object('week', w, 'n', n) order by w), '[]') from (
        select to_char(date_trunc('week', g), 'YYYY-MM-DD') w, (select count(*) from public.schools s where date_trunc('week', s.created_at) = date_trunc('week', g)) n
        from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') g) x),
    'revenue', (select coalesce(json_agg(json_build_object('month', m, 'amount', a) order by m), '[]') from (
        select to_char(g, 'YYYY-MM') m, (select coalesce(sum(amount), 0) from public.subscription_invoices i where i.status = 'paid' and date_trunc('month', i.paid_at) = g) a
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') g) x)
  ) into res;
  return res;
end $$;

-- Group dashboard for trust owners
create or replace function public.group_overview() returns table (group_id uuid, group_name text, school_id uuid, school_name text, students bigint, collected_month numeric, overdue numeric, attendance_today numeric)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, s.id, s.name,
    (select count(*) from public.students x where x.school_id = s.id and x.status = 'active'),
    (select coalesce(sum(amount), 0) from public.fee_receipts f where f.school_id = s.id and not f.cancelled and f.paid_on >= date_trunc('month', public.today_ist())::date),
    (select coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), 0) from public.fee_dues d where d.school_id = s.id and d.due_date <= public.today_ist()),
    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where status in ('P','L','H')) / count(*), 1) end from public.attendance a where a.school_id = s.id and a.date = public.today_ist())
  from public.school_groups g join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  join public.schools s on s.group_id = g.id and s.archived_at is null
  order by g.name, s.name;
$$;

-- Archive / restore a school (soft delete; data kept, logins stop working)
create or replace function public.archive_school(sid uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_can('tenants', true) then raise exception 'not allowed'; end if;
  update public.schools set archived_at = now(), status = 'suspended', notes = concat_ws(E'\n', notes, 'Archived: ' || coalesce(p_reason, '')) where id = sid;
end $$;
create or replace function public.restore_school(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_can('tenants', true) then raise exception 'not allowed'; end if;
  update public.schools set archived_at = null, status = 'active' where id = sid;
end $$;

-- ───────────── RLS ─────────────
alter table public.support_sessions enable row level security;
drop policy if exists "read" on public.support_sessions;
create policy "read" on public.support_sessions for select to authenticated using (user_id = auth.uid() or public.platform_can('audit') or public.has_perm(school_id, 'settings.audit.view'));

alter table public.group_members enable row level security;
drop policy if exists "read" on public.group_members;
drop policy if exists "platform" on public.group_members;
create policy "read" on public.group_members for select to authenticated using (user_id = auth.uid() or public.platform_can('tenants'));
create policy "platform" on public.group_members for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));

drop policy if exists "read" on public.school_groups;
drop policy if exists "platform" on public.school_groups;
create policy "read" on public.school_groups for select to authenticated using (public.platform_can('tenants') or exists (select 1 from public.group_members m where m.group_id = id and m.user_id = auth.uid()) or exists (select 1 from public.schools s where s.group_id = id and public.is_member(s.id)));
create policy "platform" on public.school_groups for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));

drop policy if exists "self" on public.platform_admins;
drop policy if exists "read" on public.platform_admins;
drop policy if exists "team" on public.platform_admins;
create policy "read" on public.platform_admins for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());
create policy "team" on public.platform_admins for all to authenticated using (public.platform_can('team', true)) with check (public.platform_can('team', true));

alter table public.audit_log enable row level security;
drop policy if exists "read" on public.audit_log;
create policy "read" on public.audit_log for select to authenticated using (public.platform_can('audit') or (school_id is not null and public.has_perm_school(school_id, 'settings.audit.view')));

alter table public.announcements enable row level security;
drop policy if exists "read" on public.announcements;
drop policy if exists "platform" on public.announcements;
create policy "read" on public.announcements for select to authenticated using (public.platform_can('announcements'));
create policy "platform" on public.announcements for all to authenticated using (public.platform_can('announcements', true)) with check (public.platform_can('announcements', true));

alter table public.tickets enable row level security;
drop policy if exists "read" on public.tickets;
drop policy if exists "create" on public.tickets;
drop policy if exists "platform" on public.tickets;
create policy "read" on public.tickets for select to authenticated using (
  public.platform_can('support') or created_by = auth.uid() or public.perm_scope(school_id, 'support.tickets.view') = 'school');
create policy "create" on public.tickets for insert to authenticated with check (public.has_perm(school_id, 'support.tickets.create') and created_by = auth.uid());
create policy "platform" on public.tickets for update to authenticated using (public.platform_can('support', true)) with check (public.platform_can('support', true));

alter table public.ticket_messages enable row level security;
drop policy if exists "read" on public.ticket_messages;
drop policy if exists "create" on public.ticket_messages;
create policy "read" on public.ticket_messages for select to authenticated using (
  exists (select 1 from public.tickets t where t.id = ticket_id) and (not internal or public.platform_can('support')));
create policy "create" on public.ticket_messages for insert to authenticated with check (
  author = auth.uid() and exists (select 1 from public.tickets t where t.id = ticket_id)
  and ((from_platform and public.platform_can('support', true)) or (not from_platform and not internal)));

-- Platform-owned tables: writes follow the platform role
drop policy if exists "platform" on public.plans;
create policy "platform" on public.plans for all to authenticated using (public.platform_can('plans', true)) with check (public.platform_can('plans', true));
drop policy if exists "platform" on public.platform_settings;
drop policy if exists "read" on public.platform_settings;
create policy "read" on public.platform_settings for select to authenticated using (public.platform_can('settings'));
create policy "platform" on public.platform_settings for all to authenticated using (public.platform_can('settings', true)) with check (public.platform_can('settings', true));
drop policy if exists "platform" on public.school_subscriptions;
create policy "platform" on public.school_subscriptions for all to authenticated using (public.platform_can('billing', true) or public.platform_can('tenants', true)) with check (public.platform_can('billing', true) or public.platform_can('tenants', true));
drop policy if exists "platform" on public.subscription_invoices;
create policy "platform" on public.subscription_invoices for all to authenticated using (public.platform_can('billing', true)) with check (public.platform_can('billing', true));
drop policy if exists "platform licence" on public.school_modules;
create policy "platform licence" on public.school_modules for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));
drop policy if exists "platform insert" on public.schools;
drop policy if exists "platform delete" on public.schools;
drop policy if exists "platform edit" on public.schools;
create policy "platform insert" on public.schools for insert to authenticated with check (public.platform_can('tenants', true));
create policy "platform edit" on public.schools for update to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));
create policy "platform delete" on public.schools for delete to authenticated using (public.platform_role() = 'owner');

-- Invoices / plan changes check the platform role too
create or replace function public.create_subscription_invoice(sid uuid, p_start date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare sub record; pl record; st date; en date; v_n int; stu int; rate numeric; amt numeric; gst numeric; v_fy text; num text; cfg jsonb; inv uuid;
begin
  if not (public.is_service() or public.platform_can('billing', true)) then raise exception 'not allowed'; end if;
  select * into sub from public.school_subscriptions where school_id = sid;
  if sub.id is null then raise exception 'School has no subscription'; end if;
  select * into pl from public.plans where id = sub.plan_id;
  if pl.trial_days > 0 then raise exception 'Move the school to a paid plan before invoicing.'; end if;
  st := coalesce(p_start, case
          when sub.current_period_end < public.today_ist() then public.today_ist()
          when not exists (select 1 from public.subscription_invoices i where i.subscription_id = sub.id and i.status <> 'void'
                             and i.period_start <= sub.current_period_start and i.period_end >= sub.current_period_start) then sub.current_period_start
          else sub.current_period_end + 1 end);
  select id into inv from public.subscription_invoices where subscription_id = sub.id and period_start = st and status <> 'void';
  if inv is not null then return inv; end if;
  en := public.cycle_end(st, sub.billing_cycle);
  select count(*) into v_n from public.students where school_id = sid and status = 'active';
  stu := greatest(v_n, pl.min_students);
  rate := case when sub.billing_cycle = 'yearly' then pl.price_yearly else pl.price_monthly end;
  amt := case when pl.price_type = 'per_student' then round(rate * stu, 2) else rate end;
  select value into cfg from public.platform_settings where key = 'billing';
  gst := round(amt * coalesce((cfg ->> 'gst_rate')::numeric, 18) / 100, 2);
  v_fy := case when extract(month from public.today_ist()) >= 4 then extract(year from public.today_ist())::int else extract(year from public.today_ist())::int - 1 end
        || '-' || lpad(((case when extract(month from public.today_ist()) >= 4 then extract(year from public.today_ist())::int else extract(year from public.today_ist())::int - 1 end + 1) % 100)::text, 2, '0');
  insert into public.invoice_counters as c (fy, n) values (v_fy, 1) on conflict (fy) do update set n = c.n + 1 returning c.n into v_n;
  num := coalesce(cfg ->> 'invoice_prefix', 'CDS') || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
  insert into public.subscription_invoices (school_id, subscription_id, number, plan_code, billing_cycle, period_start, period_end, students, rate, amount, gst_rate, gst_amount, total, due_date)
    values (sid, sub.id, num, pl.code, sub.billing_cycle, st, en, case when pl.price_type = 'per_student' then stu else 0 end, rate, amt,
            coalesce((cfg ->> 'gst_rate')::numeric, 18), gst, amt + gst, greatest(st - 1, public.today_ist() + 3))
  returning id into inv;
  return inv;
end $$;

create or replace function public.mark_subscription_invoice_paid(inv_id uuid, p_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  if not (public.is_service() or public.platform_can('billing', true)) then raise exception 'not allowed'; end if;
  select * into inv from public.subscription_invoices where id = inv_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.status = 'paid' then return; end if;
  if inv.status = 'void' then raise exception 'Invoice is void'; end if;
  update public.subscription_invoices set status = 'paid', paid_at = now(), payment_ref = coalesce(p_ref, payment_ref) where id = inv_id;
  update public.school_subscriptions s set status = 'active',
         current_period_start = case when s.status = 'trialing' or inv.period_start > s.current_period_end then inv.period_start else s.current_period_start end,
         current_period_end = greatest(s.current_period_end, inv.period_end),
         updated_at = now()
   where s.id = inv.subscription_id;
end $$;

create or replace function public.approve_school(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl text;
begin
  if not public.platform_can('tenants', true) then raise exception 'not allowed'; end if;
  update public.schools set status = 'active' where id = sid and status = 'pending';
  select p.code into pl from public.school_subscriptions s join public.plans p on p.id = s.plan_id where s.school_id = sid and s.status = 'trialing';
  if pl is not null then perform public.apply_plan(sid, pl, 'yearly'); end if;
end $$;

create or replace function public.create_school(p_name text, p_code text, p_board text default 'CBSE', p_city text default 'Lucknow',
                                                p_plan text default 'trial', p_cycle text default 'yearly')
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if not public.platform_can('tenants', true) then raise exception 'not allowed'; end if;
  sid := public._create_school_core(p_name, p_code, p_board, p_city);
  perform public.apply_plan(sid, p_plan, p_cycle);
  return sid;
end $$;

create or replace function public._create_school_core(p_name text, p_code text, p_board text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare sid uuid; cid uuid; c text; i int := 0; yr int;
begin
  if not (public.is_service() or public.platform_can('tenants', true)) then raise exception 'not allowed'; end if;
  insert into public.schools (name, code, board, city) values (p_name, p_code, p_board, p_city) returning id into sid;
  yr := case when extract(month from now()) >= 4 then extract(year from now())::int else extract(year from now())::int - 1 end;
  insert into public.sessions (school_id, name, start_date, end_date, is_current)
    values (sid, yr || '-' || lpad(((yr + 1) % 100)::text, 2, '0'), make_date(yr, 4, 1), make_date(yr + 1, 3, 31), true);
  foreach c in array array['Nursery','LKG','UKG','1','2','3','4','5','6','7','8','9','10','11','12'] loop
    insert into public.classes (school_id, name, sort) values (sid, c, i) returning id into cid;
    insert into public.sections (school_id, class_id, name) values (sid, cid, 'A');
    i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['English','Hindi','Mathematics','Science','Social Science','Computer','Sanskrit','EVS','Drawing'] loop
    insert into public.subjects (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  i := 0;
  foreach c in array array['Tuition Fee','Admission Fee','Annual Charges','Exam Fee','Transport Fee'] loop
    insert into public.fee_heads (school_id, name, sort) values (sid, c, i); i := i + 1;
  end loop;
  perform public.seed_school_modules(sid);
  perform public.sync_role_templates(sid);
  return sid;
end $$;
revoke execute on function public._create_school_core(text, text, text, text) from public, anon, authenticated;

create or replace function public.billing_run(on_day date default null) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(on_day, public.today_ist()); sub record; days int; inv uuid;
begin
  if not (public.is_service() or public.platform_can('billing', true)) then raise exception 'not allowed'; end if;
  select coalesce((value ->> 'renew_days_before')::int, 7) into days from public.platform_settings where key = 'billing';
  for sub in select s.* from public.school_subscriptions s join public.plans p on p.id = s.plan_id join public.schools sc on sc.id = s.school_id
             where s.status = 'active' and s.auto_renew and p.trial_days = 0 and sc.status = 'active' and sc.archived_at is null
               and s.current_period_end - d <= days
               and not exists (select 1 from public.subscription_invoices i where i.subscription_id = s.id and i.period_start > s.current_period_end and i.status <> 'void') loop
    inv := public.create_subscription_invoice(sub.school_id, sub.current_period_end + 1);
    return next inv;
  end loop;
end $$;

-- Existing schools: new permissions (support tickets) for every role template
do $$
declare s record;
begin
  for s in select id from public.schools loop
    perform public.sync_role_templates(s.id);
    insert into public.role_permissions (role_id, perm_key, scope)
      select r.id, tp.perm_key, tp.scope from public.roles r join public.role_template_permissions tp on tp.template_code = r.template_code
      where r.school_id = s.id and tp.perm_key like 'support.%'
      on conflict do nothing;
  end loop;
end $$;

-- Platform staff (tenants write) may manage a school's users without a support session
drop policy if exists "platform" on public.school_members;
create policy "platform" on public.school_members for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));
drop policy if exists "platform" on public.member_roles;
create policy "platform" on public.member_roles for all to authenticated using (public.platform_can('tenants', true)) with check (public.platform_can('tenants', true));


-- ═══════════════════════════════════════════════════════════════════════════
-- Step 4: Settings centre — integrations (payment gateway, Cloudinary, email,
-- SMS, WhatsApp) per school and for the platform, with secrets kept encrypted;
-- school preferences (locale, working days, notification channels); message log.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- School preferences: { timezone, date_format, week_start, working_days[], notify: { event: { sms, email, whatsapp } } }
alter table public.schools add column if not exists prefs jsonb not null default '{}';

-- One row per (school, provider); school_id null = the platform's own account.
-- `config` holds only non-secret values (key id, cloud name, SMTP host, sender id …).
create table if not exists public.integration_settings (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid references public.schools(id) on delete cascade,
  provider       text not null check (provider in ('razorpay','cloudinary','email','sms','whatsapp')),
  enabled        boolean not null default false,
  config         jsonb not null default '{}',
  secret_hints   jsonb not null default '{}',   -- { "key_secret": "••••a1b2" } — never the secret itself
  status         text not null default 'untested' check (status in ('untested','ok','failed')),
  status_message text,
  tested_at      timestamptz,
  updated_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists integration_settings_school_provider on public.integration_settings (school_id, provider) where school_id is not null;
create unique index if not exists integration_settings_platform_provider on public.integration_settings (provider) where school_id is null;

-- Secrets: AES-256-GCM ciphertext made by the app server (key in SETTINGS_ENCRYPTION_KEY, never in the database).
-- No policies: only the server's secret key can read or write this table.
create table if not exists public.integration_secrets (
  setting_id  uuid primary key references public.integration_settings(id) on delete cascade,
  ciphertext  text not null,
  key_version smallint not null default 1,
  updated_at  timestamptz not null default now()
);

-- Every SMS / email / WhatsApp the system sends (and test sends), for delivery tracking.
create table if not exists public.message_log (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references public.schools(id) on delete cascade,
  channel      text not null check (channel in ('sms','email','whatsapp')),
  event        text not null default 'test',
  recipient    text not null,
  subject      text,
  status       text not null default 'queued' check (status in ('queued','sent','failed')),
  provider_ref text,
  error        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists message_log_school on public.message_log (school_id, created_at desc);

alter table public.integration_settings enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.message_log enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

drop policy if exists "read" on public.integration_settings;
create policy "read" on public.integration_settings for select to authenticated using (
  case when school_id is null then public.platform_can('settings') else public.has_perm(school_id, 'settings.integrations.view') end);
drop policy if exists "write" on public.integration_settings;
create policy "write" on public.integration_settings for all to authenticated
  using (case when school_id is null then public.platform_can('settings', true) else public.has_perm(school_id, 'settings.integrations.edit') end)
  with check (case when school_id is null then public.platform_can('settings', true) else public.has_perm(school_id, 'settings.integrations.edit') end);

drop policy if exists "read" on public.message_log;
create policy "read" on public.message_log for select to authenticated using (
  case when school_id is null then public.platform_can('settings') else public.has_perm(school_id, 'settings.integrations.view') end);

-- Keep updated_at / updated_by honest
create or replace function public.touch_integration() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists integration_settings_touch on public.integration_settings;
create trigger integration_settings_touch before insert or update on public.integration_settings for each row execute function public.touch_integration();

-- Audit (config and hints only — secrets live in the other table)
drop trigger if exists audit_integration_settings on public.integration_settings;
create trigger audit_integration_settings after insert or update or delete on public.integration_settings for each row execute function public.audit_row();

-- Which integrations a school can use right now: its own, else the platform's shared account (when the platform allows sharing).
create or replace function public.effective_integrations(sid uuid) returns table (provider text, source text, enabled boolean, status text)
language sql stable security definer set search_path = public as $$
  select p.provider,
         case when s.enabled then 'school' when pl.enabled and coalesce((pl.config ->> 'share_with_schools')::boolean, false) then 'platform' else 'none' end,
         coalesce(s.enabled, false) or (coalesce(pl.enabled, false) and coalesce((pl.config ->> 'share_with_schools')::boolean, false)),
         coalesce(case when s.enabled then s.status end, case when pl.enabled then pl.status end, 'untested')
    from unnest(array['razorpay','cloudinary','email','sms','whatsapp']) p(provider)
    left join public.integration_settings s on s.school_id = sid and s.provider = p.provider
    left join public.integration_settings pl on pl.school_id is null and pl.provider = p.provider
   where public.is_member(sid) or public.platform_can('tenants');
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 5: the Standard-plan modules — Homework & study material, Transport,
-- Staff & payroll (HR) and Library. Permissions come from the catalogue
-- (homework.*, transport.*, hr.*, library.*); every table is scope-aware.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- Fix: has_perm_school() returned NULL (not false) when the user had no grant at all, so guards written as
-- `if not has_perm_school(...) then raise` let anyone through (collect_fee, generate_dues, promote_students …).
create or replace function public.has_perm_school(sid uuid, pkey text) returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.perm_scope(sid, pkey) = 'school', false); $$;

-- Fix: deleting a school (or a role) failed with "Role belongs to another school" because this guard ran
-- on member_roles rows removed by the cascade after their role was already gone.
create or replace function public.guard_member_roles() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; missing text;
begin
  select * into r from public.roles where id = coalesce(new.role_id, old.role_id);
  -- role already gone: this row is being removed by a cascade (role or whole school deleted)
  if tg_op = 'DELETE' and r.id is null then return old; end if;
  if r.school_id is distinct from coalesce(new.school_id, old.school_id) then raise exception 'Role belongs to another school.'; end if;
  if tg_op = 'DELETE' and r.code = 'principal' and not exists (
       select 1 from public.member_roles where role_id = r.id and user_id <> old.user_id) then
    if exists (select 1 from public.schools where id = old.school_id) then
      raise exception 'A school must always have at least one Principal / School Admin.';
    end if;
  end if;
  if public.is_platform_admin() or auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.user_id, old.user_id) = auth.uid() then raise exception 'You cannot change your own roles.'; end if;
  if tg_op = 'INSERT' then
    select rp.perm_key into missing from public.role_permissions rp where rp.role_id = r.id and public.perm_scope(r.school_id, rp.perm_key) is null limit 1;
    if missing is not null then raise exception 'You cannot assign this role: it includes % which you do not have.', missing; end if;
  end if;
  return coalesce(new, old);
end $$;

-- Can the user use permission pkey on something that belongs to a class (and optionally one section / subject)?
--   school   → yes
--   assigned → teaches that section (sec null: for view any section of the class, for changes every section of it)
--   child    → one of their children is in that class / section
--   self     → the student is in that class / section
create or replace function public.can_class_item(sid uuid, pkey text, cls uuid, sec uuid, subj uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s text := public.perm_scope(sid, pkey); is_view boolean := split_part(pkey, '.', 3) = 'view';
begin
  if s is null or cls is null then return false; end if;
  if s = 'school' then return true; end if;
  if s = 'assigned' then
    if sec is not null then return public.assigned_to_section(sid, sec, subj); end if;
    if is_view then
      return exists (select 1 from public.sections x where x.class_id = cls and public.assigned_to_section(sid, x.id, subj));
    end if;
    return exists (select 1 from public.sections x where x.class_id = cls)
       and not exists (select 1 from public.sections x where x.class_id = cls and not public.assigned_to_section(sid, x.id, subj));
  end if;
  if s in ('child', 'self') then
    return exists (
      select 1 from public.students st
       where st.school_id = sid and st.status = 'active' and st.class_id = cls and (sec is null or st.section_id = sec)
         and case when s = 'self' then st.user_id = auth.uid()
                  else exists (select 1 from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id
                                where sg.student_id = st.id and g.user_id = auth.uid()) end);
  end if;
  return false;
end $$;

create or replace function public.touch_row() returns trigger
language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;

-- ═════════════════════════ Homework & study material ═════════════════════════
-- kind 'homework' uses homework.homework.*, kind 'material' uses homework.material.*
create table if not exists public.homework (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  session_id      uuid references public.sessions(id) on delete cascade,
  kind            text not null default 'homework' check (kind in ('homework','material')),
  class_id        uuid not null references public.classes(id) on delete cascade,
  section_id      uuid references public.sections(id) on delete cascade,   -- null = every section of the class
  subject_id      uuid references public.subjects(id) on delete set null,
  title           text not null check (length(title) between 1 and 200),
  details         text,
  link_url        text check (link_url is null or link_url ~* '^https?://'),
  assigned_on     date not null default (now() at time zone 'Asia/Kolkata')::date,
  due_on          date,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (due_on is null or due_on >= assigned_on)
);
create index if not exists homework_class_idx on public.homework (school_id, class_id, assigned_on desc);
drop trigger if exists homework_touch on public.homework;
create trigger homework_touch before update on public.homework for each row execute function public.touch_row();

-- a section must belong to the class
create or replace function public.guard_class_section() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.section_id is not null and not exists (select 1 from public.sections where id = new.section_id and class_id = new.class_id) then
    raise exception 'The section does not belong to this class.';
  end if;
  return new;
end $$;
drop trigger if exists homework_section_guard on public.homework;
create trigger homework_section_guard before insert or update on public.homework for each row execute function public.guard_class_section();

alter table public.homework enable row level security;
drop policy if exists "read" on public.homework;
create policy "read" on public.homework for select to authenticated using (public.can_class_item(school_id, 'homework.' || kind || '.view', class_id, section_id));
drop policy if exists "create" on public.homework;
create policy "create" on public.homework for insert to authenticated with check (public.can_class_item(school_id, 'homework.' || kind || '.create', class_id, section_id, subject_id));
drop policy if exists "edit" on public.homework;
create policy "edit" on public.homework for update to authenticated
  using (public.can_class_item(school_id, 'homework.' || kind || '.edit', class_id, section_id, subject_id))
  with check (public.can_class_item(school_id, 'homework.' || kind || '.edit', class_id, section_id, subject_id));
drop policy if exists "delete" on public.homework;
create policy "delete" on public.homework for delete to authenticated using (public.can_class_item(school_id, 'homework.' || kind || '.delete', class_id, section_id, subject_id));

-- ═════════════════════════ Transport ═════════════════════════
create table if not exists public.transport_vehicles (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  reg_no          text not null,
  kind            text not null default 'bus' check (kind in ('bus','van','auto','other')),
  capacity        int check (capacity is null or capacity > 0),
  driver_name     text,
  driver_phone    text,
  driver_licence  text,
  attendant_name  text,
  attendant_phone text,
  insurance_upto  date,
  fitness_upto    date,
  permit_upto     date,
  puc_upto        date,
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (school_id, reg_no)
);

create table if not exists public.transport_routes (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null,
  vehicle_id uuid references public.transport_vehicles(id) on delete set null,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.transport_stops (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  route_id    uuid not null references public.transport_routes(id) on delete cascade,
  name        text not null,
  sort        int not null default 0,
  pickup_time time,
  drop_time   time,
  monthly_fee numeric(10,2) not null default 0 check (monthly_fee >= 0),
  unique (route_id, name)
);
create index if not exists transport_stops_route_idx on public.transport_stops (route_id, sort);

-- One allocation per student per session; changing the stop updates the row.
create table if not exists public.transport_allocations (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  route_id    uuid not null references public.transport_routes(id),
  stop_id     uuid not null references public.transport_stops(id),
  trip        text not null default 'both' check (trip in ('both','pickup','drop')),
  monthly_fee numeric(10,2) check (monthly_fee is null or monthly_fee >= 0),   -- null = the stop's fee
  start_date  date not null default (now() at time zone 'Asia/Kolkata')::date,
  end_date    date,
  created_at  timestamptz not null default now(),
  unique (session_id, student_id),
  check (end_date is null or end_date >= start_date)
);
create index if not exists transport_allocations_route_idx on public.transport_allocations (route_id, stop_id);

create or replace function public.guard_transport_allocation() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; n int;
begin
  if not exists (select 1 from public.transport_stops where id = new.stop_id and route_id = new.route_id) then
    raise exception 'The stop is not on this route.';
  end if;
  if not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then
    raise exception 'Student not found.';
  end if;
  -- the vehicle's seats are a hard limit for students currently on the route
  if new.end_date is null and (tg_op = 'INSERT' or old.route_id is distinct from new.route_id or old.end_date is not null) then
    select v.capacity into cap from public.transport_routes r join public.transport_vehicles v on v.id = r.vehicle_id where r.id = new.route_id;
    select count(*) into n from public.transport_allocations a where a.route_id = new.route_id and a.session_id = new.session_id and a.end_date is null and a.id <> new.id;
    if cap is not null and n >= cap then raise exception 'The vehicle on this route is full (% seats).', cap; end if;
  end if;
  return new;
end $$;
drop trigger if exists transport_allocations_guard on public.transport_allocations;
create trigger transport_allocations_guard before insert or update on public.transport_allocations for each row execute function public.guard_transport_allocation();

alter table public.transport_vehicles enable row level security;
alter table public.transport_routes enable row level security;
alter table public.transport_stops enable row level security;
alter table public.transport_allocations enable row level security;
do $$
declare t text;
begin
  foreach t in array array['transport_vehicles','transport_routes','transport_stops'] loop
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('drop policy if exists "create" on public.%I', t);
    execute format('drop policy if exists "edit" on public.%I', t);
    execute format('drop policy if exists "delete" on public.%I', t);
    -- families with transport.allocation.view see the route / bus their child uses
    execute format('create policy "read" on public.%I for select to authenticated using (public.has_perm(school_id, ''transport.routes.view'') or public.has_perm(school_id, ''transport.allocation.view''))', t);
    execute format('create policy "create" on public.%I for insert to authenticated with check (public.has_perm_school(school_id, ''transport.routes.create''))', t);
    execute format('create policy "edit" on public.%I for update to authenticated using (public.has_perm_school(school_id, ''transport.routes.edit'')) with check (public.has_perm_school(school_id, ''transport.routes.edit''))', t);
    execute format('create policy "delete" on public.%I for delete to authenticated using (public.has_perm_school(school_id, ''transport.routes.delete''))', t);
  end loop;
end $$;
drop policy if exists "read" on public.transport_allocations;
create policy "read" on public.transport_allocations for select to authenticated using (public.can_student(school_id, 'transport.allocation.view', student_id));
drop policy if exists "create" on public.transport_allocations;
create policy "create" on public.transport_allocations for insert to authenticated with check (public.has_perm_school(school_id, 'transport.allocation.create'));
drop policy if exists "edit" on public.transport_allocations;
create policy "edit" on public.transport_allocations for update to authenticated using (public.has_perm_school(school_id, 'transport.allocation.edit')) with check (public.has_perm_school(school_id, 'transport.allocation.edit'));
drop policy if exists "delete" on public.transport_allocations;
create policy "delete" on public.transport_allocations for delete to authenticated using (public.has_perm_school(school_id, 'transport.allocation.delete'));

-- Transport fees become ordinary fee dues (head "Transport Fee"), so collection, receipts,
-- concessions, defaulters and the parent page work unchanged. source_key makes each run idempotent.
alter table public.fee_dues add column if not exists source_key text;
create unique index if not exists fee_dues_source_key on public.fee_dues (student_id, source_key) where source_key is not null;

create or replace function public.generate_transport_dues(sid uuid, sess uuid, p_label text, p_due date, p_months numeric default 1) returns int
language plpgsql security definer set search_path = public as $$
declare head uuid; cnt int; k text;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_label), '') = '' or p_due is null then raise exception 'Label and due date are required.'; end if;
  if p_months is null or p_months <= 0 or p_months > 12 then raise exception 'Months must be between 1 and 12.'; end if;
  if not exists (select 1 from public.sessions where id = sess and school_id = sid) then raise exception 'Session not found.'; end if;
  select id into head from public.fee_heads where school_id = sid and name = 'Transport Fee';
  if head is null then
    insert into public.fee_heads (school_id, name, sort) values (sid, 'Transport Fee', 50) returning id into head;
  end if;
  k := 'transport:' || sess || ':' || lower(trim(p_label));
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, source_key)
  select sid, sess, x.student_id, head, 'Transport Fee · ' || trim(p_label), p_due, x.amt,
         least(x.amt, coalesce((select sum(case when c.kind = 'percent' then x.amt * c.value / 100 else c.value end)
                                  from public.student_concessions c
                                 where c.student_id = x.student_id and (c.fee_head_id is null or c.fee_head_id = head)), 0)),
         k
    from (select a.student_id, round(coalesce(a.monthly_fee, st.monthly_fee) * p_months, 2) as amt
            from public.transport_allocations a
            join public.transport_stops st on st.id = a.stop_id
            join public.students s on s.id = a.student_id and s.status = 'active'
           where a.school_id = sid and a.session_id = sess and a.start_date <= p_due
             and (a.end_date is null or a.end_date >= p_due)) x
   where x.amt > 0
  on conflict (student_id, source_key) where source_key is not null do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ═════════════════════════ Staff & payroll (HR) ═════════════════════════
-- Every employee, with or without a login (drivers, helpers, guards …).
create table if not exists public.staff (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,       -- their ERP login, if any
  emp_code      text,
  name          text not null,
  designation   text,
  department    text,
  kind          text not null default 'teaching' check (kind in ('teaching','non_teaching','support')),
  gender        text check (gender in ('M','F','O')),
  dob           date,
  phone         text,
  email         text,
  address       text,
  qualification text,
  joining_date  date,
  leaving_date  date,
  status        text not null default 'active' check (status in ('active','left')),
  pan           text,
  uan           text,
  bank_name     text,
  bank_account  text,
  ifsc          text,
  -- monthly salary structure: [{ "name": "Basic", "amount": 25000 }, …]
  earnings      jsonb not null default '[]' check (jsonb_typeof(earnings) = 'array'),
  deductions    jsonb not null default '[]' check (jsonb_typeof(deductions) = 'array'),
  leave_quota   jsonb not null default '{"CL": 12, "SL": 7, "EL": 0}' check (jsonb_typeof(leave_quota) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (school_id, emp_code),
  unique (school_id, user_id)
);
drop trigger if exists staff_touch on public.staff;
create trigger staff_touch before update on public.staff for each row execute function public.touch_row();

-- The staff record of the signed-in user in a school
create or replace function public.my_staff_id(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where school_id = sid and user_id = auth.uid() limit 1;
$$;

create table if not exists public.staff_leaves (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  kind            text not null default 'CL' check (kind in ('CL','SL','EL','LWP','OD','other')),
  from_date       date not null,
  to_date         date not null,
  half_day        boolean not null default false,
  days            numeric(5,1) generated always as (case when half_day then 0.5 else (to_date - from_date + 1) end) stored,
  reason          text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by      uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  check (to_date >= from_date),
  check (not half_day or to_date = from_date)
);
create index if not exists staff_leaves_staff_idx on public.staff_leaves (staff_id, from_date desc);
create index if not exists staff_leaves_school_idx on public.staff_leaves (school_id, status, from_date);

create or replace function public.guard_staff_leave() returns trigger
language plpgsql security definer set search_path = public as $$
declare deciding boolean;
begin
  if not exists (select 1 from public.staff where id = new.staff_id and school_id = new.school_id) then raise exception 'Staff member not found.'; end if;
  if tg_op = 'UPDATE' and old.status in ('rejected','cancelled') and new.status <> old.status then
    raise exception 'This request is closed. Apply again instead.';
  end if;
  deciding := new.status in ('approved','rejected') and (tg_op = 'INSERT' or old.status is distinct from new.status);
  if deciding then
    if auth.uid() is not null and not public.is_service() then
      if not public.has_perm_school(new.school_id, 'hr.leave.approve') then raise exception 'You cannot approve or reject leave.'; end if;
      if not public.is_platform_admin() and exists (select 1 from public.staff where id = new.staff_id and user_id = auth.uid()) then
        raise exception 'You cannot approve your own leave.';
      end if;
    end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  end if;
  -- overlapping requests for the same person
  if new.status in ('pending','approved') and exists (
       select 1 from public.staff_leaves l where l.staff_id = new.staff_id and l.id <> new.id and l.status in ('pending','approved')
          and daterange(l.from_date, l.to_date, '[]') && daterange(new.from_date, new.to_date, '[]')) then
    raise exception 'There is already a leave request for these dates.';
  end if;
  return new;
end $$;
drop trigger if exists staff_leaves_guard on public.staff_leaves;
create trigger staff_leaves_guard before insert or update on public.staff_leaves for each row execute function public.guard_staff_leave();

-- Payroll: one run per month; payslips keep the unprorated structure and are recomputed by a trigger.
create table if not exists public.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  status       text not null default 'draft' check (status in ('draft','approved')),
  approved_by  uuid references auth.users(id) on delete set null,
  approved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (school_id, month)
);

create table if not exists public.payslips (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  run_id           uuid not null references public.payroll_runs(id) on delete cascade,
  staff_id         uuid not null references public.staff(id),
  working_days     int not null check (working_days between 1 and 31),
  lop_days         numeric(5,1) not null default 0 check (lop_days >= 0),
  base_earnings    jsonb not null default '[]',
  earnings         jsonb not null default '[]',      -- prorated (computed)
  deductions       jsonb not null default '[]',
  gross            numeric(12,2) not null default 0,  -- computed
  total_deductions numeric(12,2) not null default 0,  -- computed
  adjustment       numeric(12,2) not null default 0,  -- bonus (+) / recovery (−)
  adjustment_note  text,
  net              numeric(12,2) generated always as (gross - total_deductions + adjustment) stored,
  paid_on          date,
  pay_mode         text check (pay_mode in ('bank_transfer','cash','cheque','upi')),
  pay_ref          text,
  unique (run_id, staff_id),
  check (lop_days <= working_days)
);
create index if not exists payslips_staff_idx on public.payslips (staff_id);

create or replace function public.payslip_compute() returns trigger
language plpgsql security definer set search_path = public as $$
declare f numeric; st text;
begin
  select status into st from public.payroll_runs where id = new.run_id;
  if tg_op = 'UPDATE' and st = 'approved' and (
       new.lop_days is distinct from old.lop_days or new.base_earnings is distinct from old.base_earnings
    or new.deductions is distinct from old.deductions or new.adjustment is distinct from old.adjustment
    or new.working_days is distinct from old.working_days) then
    raise exception 'Payroll for this month is approved and locked. Reopen it to make changes.';
  end if;
  if tg_op = 'UPDATE' and st = 'draft' and new.paid_on is not null and old.paid_on is null then
    raise exception 'Approve the payroll before marking salaries paid.';
  end if;
  f := greatest(new.working_days - new.lop_days, 0) / new.working_days;
  select coalesce(jsonb_agg(jsonb_build_object('name', e ->> 'name', 'amount', round(coalesce((e ->> 'amount')::numeric, 0) * f))), '[]'::jsonb)
    into new.earnings from jsonb_array_elements(new.base_earnings) e;
  select coalesce(sum((e ->> 'amount')::numeric), 0) into new.gross from jsonb_array_elements(new.earnings) e;
  select coalesce(sum(coalesce((e ->> 'amount')::numeric, 0)), 0) into new.total_deductions from jsonb_array_elements(new.deductions) e;
  return new;
end $$;
drop trigger if exists payslips_compute on public.payslips;
create trigger payslips_compute before insert or update on public.payslips for each row execute function public.payslip_compute();

create or replace function public.guard_payroll_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and exists (select 1 from public.schools where id = old.school_id) then  -- (whole school being deleted: allow)
      raise exception 'An approved payroll cannot be deleted. Reopen it first.';
    end if;
    return old;
  end if;
  if new.status = 'approved' and old.status = 'draft' then
    if not exists (select 1 from public.payslips where run_id = new.id) then raise exception 'There are no payslips to approve.'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif new.status = 'draft' and old.status = 'approved' then
    if exists (select 1 from public.payslips where run_id = new.id and paid_on is not null) then
      raise exception 'Some salaries are already marked paid; this month cannot be reopened.';
    end if;
    new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;
drop trigger if exists payroll_runs_guard on public.payroll_runs;
create trigger payroll_runs_guard before update or delete on public.payroll_runs for each row execute function public.guard_payroll_run();

-- Days of approved leave without pay (LWP) a staff member has inside [d1, d2]
create or replace function public.lwp_days(stf uuid, d1 date, d2 date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when l.half_day then 0.5 else (least(l.to_date, d2) - greatest(l.from_date, d1) + 1) end), 0)
    from public.staff_leaves l
   where l.staff_id = stf and l.status = 'approved' and l.kind = 'LWP' and l.from_date <= d2 and l.to_date >= d1;
$$;

-- Create (or refresh) the month's payroll: one payslip per active employee; unpaid draft payslips are recalculated.
create or replace function public.generate_payroll(sid uuid, p_month date, p_days int default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m1 date := date_trunc('month', p_month)::date; m2 date; d int; rid uuid; st text;
begin
  if not public.has_perm_school(sid, 'hr.payroll.create') then raise exception 'not allowed'; end if;
  m2 := (m1 + interval '1 month - 1 day')::date;
  d := coalesce(p_days, extract(day from m2)::int);
  if d < 1 or d > 31 then raise exception 'Working days must be between 1 and 31.'; end if;
  insert into public.payroll_runs (school_id, month) values (sid, m1) on conflict (school_id, month) do nothing;
  select id, status into rid, st from public.payroll_runs where school_id = sid and month = m1;
  if st <> 'draft' then raise exception 'Payroll for this month is already approved.'; end if;
  delete from public.payslips where run_id = rid and paid_on is null;
  insert into public.payslips (school_id, run_id, staff_id, working_days, lop_days, base_earnings, deductions)
  select sid, rid, s.id, d,
         least(d, public.lwp_days(s.id, m1, m2)
                  + case when s.joining_date > m1 then least(d, s.joining_date - m1) else 0 end
                  + case when s.leaving_date < m2 then least(d, m2 - s.leaving_date) else 0 end),
         s.earnings, s.deductions
    from public.staff s
   where s.school_id = sid and jsonb_array_length(s.earnings) > 0
     and (s.joining_date is null or s.joining_date <= m2)
     and (s.status = 'active' or s.leaving_date >= m1)
  on conflict (run_id, staff_id) do nothing;
  return rid;
end $$;

alter table public.staff enable row level security;
alter table public.staff_leaves enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;

drop policy if exists "read" on public.staff;
create policy "read" on public.staff for select to authenticated using (
  user_id = auth.uid() or public.has_perm_school(school_id, 'hr.staff.view') or public.has_perm_school(school_id, 'hr.payroll.view')
  or public.has_perm_school(school_id, 'hr.leave.view') or public.has_perm_school(school_id, 'hr.leave.approve')
  or public.has_perm_school(school_id, 'library.circulation.view'));
drop policy if exists "create" on public.staff;
create policy "create" on public.staff for insert to authenticated with check (public.has_perm_school(school_id, 'hr.staff.create'));
drop policy if exists "edit" on public.staff;
create policy "edit" on public.staff for update to authenticated using (public.has_perm_school(school_id, 'hr.staff.edit')) with check (public.has_perm_school(school_id, 'hr.staff.edit'));
drop policy if exists "delete" on public.staff;
create policy "delete" on public.staff for delete to authenticated using (public.has_perm_school(school_id, 'hr.staff.delete'));

drop policy if exists "read" on public.staff_leaves;
create policy "read" on public.staff_leaves for select to authenticated using (
  public.has_perm_school(school_id, 'hr.leave.view') or public.has_perm_school(school_id, 'hr.leave.approve')
  or (staff_id = public.my_staff_id(school_id) and public.has_perm(school_id, 'hr.leave.view')));
drop policy if exists "create" on public.staff_leaves;
create policy "create" on public.staff_leaves for insert to authenticated with check (
  public.has_perm_school(school_id, 'hr.leave.create')
  or (staff_id = public.my_staff_id(school_id) and public.has_perm(school_id, 'hr.leave.create')));
drop policy if exists "edit" on public.staff_leaves;
create policy "edit" on public.staff_leaves for update to authenticated
  using (public.has_perm_school(school_id, 'hr.leave.approve') or public.has_perm_school(school_id, 'hr.leave.create')
         or (staff_id = public.my_staff_id(school_id) and status = 'pending' and public.has_perm(school_id, 'hr.leave.create')))
  with check (public.has_perm_school(school_id, 'hr.leave.approve') or public.has_perm_school(school_id, 'hr.leave.create')
         or (staff_id = public.my_staff_id(school_id) and status in ('pending','cancelled') and public.has_perm(school_id, 'hr.leave.create')));

-- (security definer helpers: the two tables' policies would otherwise query each other forever)
create or replace function public.payroll_run_approved(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.payroll_runs where id = rid and status = 'approved'); $$;
create or replace function public.has_my_payslip(rid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$ select exists (select 1 from public.payslips where run_id = rid and staff_id = public.my_staff_id(sid)); $$;

drop policy if exists "read" on public.payroll_runs;
create policy "read" on public.payroll_runs for select to authenticated using (
  public.has_perm_school(school_id, 'hr.payroll.view')
  or (status = 'approved' and public.has_my_payslip(id, school_id)));
drop policy if exists "approve" on public.payroll_runs;
create policy "approve" on public.payroll_runs for update to authenticated using (public.has_perm_school(school_id, 'hr.payroll.approve')) with check (public.has_perm_school(school_id, 'hr.payroll.approve'));
drop policy if exists "delete" on public.payroll_runs;
create policy "delete" on public.payroll_runs for delete to authenticated using (public.has_perm_school(school_id, 'hr.payroll.edit'));
-- runs are created only through generate_payroll()

drop policy if exists "read" on public.payslips;
create policy "read" on public.payslips for select to authenticated using (
  public.has_perm_school(school_id, 'hr.payroll.view')
  or (staff_id = public.my_staff_id(school_id) and public.payroll_run_approved(run_id)));
drop policy if exists "edit" on public.payslips;
create policy "edit" on public.payslips for update to authenticated using (public.has_perm_school(school_id, 'hr.payroll.edit')) with check (public.has_perm_school(school_id, 'hr.payroll.edit'));
-- payslips are created / removed only through generate_payroll()

-- Leave taken this session per kind (approved), for balances
create or replace function public.leave_summary(sid uuid, d1 date, d2 date) returns table (staff_id uuid, kind text, days numeric)
language sql stable set search_path = public as $$
  select l.staff_id, l.kind, sum(case when l.half_day then 0.5 else (least(l.to_date, d2) - greatest(l.from_date, d1) + 1) end)
    from public.staff_leaves l
   where l.school_id = sid and l.status = 'approved' and l.from_date <= d2 and l.to_date >= d1
   group by l.staff_id, l.kind;
$$;

-- ═════════════════════════ Library ═════════════════════════
create table if not exists public.library_books (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  accession_no text,
  title        text not null,
  author       text,
  publisher    text,
  isbn         text,
  category     text,
  language     text,
  shelf        text,
  copies       int not null default 1 check (copies >= 0),
  price        numeric(10,2) check (price is null or price >= 0),
  created_at   timestamptz not null default now(),
  unique (school_id, accession_no)
);
create index if not exists library_books_title_idx on public.library_books (school_id, title);

create table if not exists public.library_issues (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  book_id        uuid not null references public.library_books(id),
  student_id     uuid references public.students(id) on delete cascade,
  staff_id       uuid references public.staff(id) on delete cascade,
  issued_on      date not null default (now() at time zone 'Asia/Kolkata')::date,
  due_on         date not null,
  returned_on    date,
  fine           numeric(10,2) not null default 0 check (fine >= 0),
  issued_by_name text,
  note           text,
  created_at     timestamptz not null default now(),
  check (num_nonnulls(student_id, staff_id) = 1),
  check (due_on >= issued_on),
  check (returned_on is null or returned_on >= issued_on)
);
create index if not exists library_issues_open_idx on public.library_issues (school_id, book_id) where returned_on is null;
create index if not exists library_issues_student_idx on public.library_issues (student_id);

create or replace function public.guard_library_issue() returns trigger
language plpgsql security definer set search_path = public as $$
declare c int; n int;
begin
  if tg_op = 'INSERT' or (old.returned_on is not null and new.returned_on is null) then
    select copies into c from public.library_books where id = new.book_id and school_id = new.school_id for update;
    if c is null then raise exception 'Book not found.'; end if;
    select count(*) into n from public.library_issues where book_id = new.book_id and returned_on is null and id <> new.id;
    if n >= c then raise exception 'All % copies of this book are issued.', c; end if;
  end if;
  if new.student_id is not null and not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then
    raise exception 'Student not found.';
  end if;
  if new.staff_id is not null and not exists (select 1 from public.staff where id = new.staff_id and school_id = new.school_id) then
    raise exception 'Staff member not found.';
  end if;
  return new;
end $$;
drop trigger if exists library_issues_guard on public.library_issues;
create trigger library_issues_guard before insert or update on public.library_issues for each row execute function public.guard_library_issue();

alter table public.library_books enable row level security;
alter table public.library_issues enable row level security;
drop policy if exists "read" on public.library_books;
create policy "read" on public.library_books for select to authenticated using (public.has_perm(school_id, 'library.catalogue.view') or public.has_perm(school_id, 'library.circulation.view'));
drop policy if exists "create" on public.library_books;
create policy "create" on public.library_books for insert to authenticated with check (public.has_perm_school(school_id, 'library.catalogue.create'));
drop policy if exists "edit" on public.library_books;
create policy "edit" on public.library_books for update to authenticated using (public.has_perm_school(school_id, 'library.catalogue.edit')) with check (public.has_perm_school(school_id, 'library.catalogue.edit'));
drop policy if exists "delete" on public.library_books;
create policy "delete" on public.library_books for delete to authenticated using (public.has_perm_school(school_id, 'library.catalogue.delete'));

drop policy if exists "read" on public.library_issues;
create policy "read" on public.library_issues for select to authenticated using (
  public.has_perm_school(school_id, 'library.circulation.view')
  or (student_id is not null and public.can_student(school_id, 'library.circulation.view', student_id))
  or (staff_id is not null and staff_id = public.my_staff_id(school_id)));
drop policy if exists "create" on public.library_issues;
create policy "create" on public.library_issues for insert to authenticated with check (public.has_perm_school(school_id, 'library.circulation.create'));
drop policy if exists "edit" on public.library_issues;
create policy "edit" on public.library_issues for update to authenticated using (public.has_perm_school(school_id, 'library.circulation.edit')) with check (public.has_perm_school(school_id, 'library.circulation.edit'));

-- ═════════════════════════ Audit ═════════════════════════
do $$
declare t text;
begin
  foreach t in array array['homework','transport_vehicles','transport_routes','transport_stops','transport_allocations',
                           'staff','staff_leaves','payroll_runs','payslips','library_books','library_issues'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 6: student-data compliance (from the 12 Oct 2026 audit).
--   P0  student edit rights narrowed · parent-link only via function · DOB sanity ·
--       enrolment history (promotion no longer erases class membership) · class /
--       section delete guard · audit coverage + masking
--   P1  protected identity & health tier (PEN, APAAR + consent) · student documents
--       (private storage) · guardians / emergency / pickup contacts · structured
--       address & previous school · UP Board registration (Class 9-12) workflow
-- Needs 0002_catalog.sql (new permission keys) — run the whole setup.sql.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Student columns ─────────────
alter table public.students
  add column if not exists middle_name        text,
  add column if not exists application_no     text,
  add column if not exists admission_category text check (admission_category is null or admission_category in ('general','rte','staff_ward','sibling','other')),
  add column if not exists admission_class_id uuid,   -- plain column on purpose: a second foreign key to classes makes every students → classes embed ambiguous
  add column if not exists previous_school    text,
  add column if not exists previous_board     text,
  add column if not exists previous_class     text,
  add column if not exists permanent_address  text,
  add column if not exists district           text,
  add column if not exists block_tehsil       text,
  add column if not exists pincode            text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  add column if not exists state              text,
  add column if not exists locality_type      text check (locality_type is null or locality_type in ('rural','urban')),
  add column if not exists mother_tongue      text,
  add column if not exists nationality        text,
  add column if not exists distance_km        numeric(5,1) check (distance_km is null or distance_km >= 0),
  add column if not exists left_on            date,
  add column if not exists left_reason        text,
  add column if not exists tc_no              text,
  add column if not exists tc_issued_on       date;

alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check
  check (status in ('active','left','passed_out','transferred','withdrawn'));

-- ───────────── Row guard: DOB sanity, parent link only through reset_portal_token() ─────────────
create or replace function public.guard_student_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare t date := public.today_ist();
begin
  if new.dob is not null and (tg_op = 'INSERT' or new.dob is distinct from old.dob) then
    if new.dob > t then raise exception 'Date of birth cannot be in the future.'; end if;
    if new.dob > t - interval '2 years' or new.dob < t - interval '30 years' then
      raise exception 'Date of birth does not look right: the student''s age must be between 2 and 30 years.';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.portal_token is distinct from old.portal_token
     and coalesce(current_setting('app.portal_reset', true), '') <> '1' then
    raise exception 'The parent link can only be changed with "Reset link".';
  end if;
  return new;
end $$;
drop trigger if exists students_guard on public.students;
create trigger students_guard before insert or update on public.students for each row execute function public.guard_student_row();

create or replace function public.reset_portal_token(sid uuid, stu uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'students.parent_link.edit') then raise exception 'not allowed'; end if;
  perform set_config('app.portal_reset', '1', true);
  update public.students set portal_token = replace(gen_random_uuid()::text, '-', '') where id = stu and school_id = sid;
  perform set_config('app.portal_reset', '', true);
  if not found then raise exception 'Student not found.'; end if;
end $$;

-- Editing a student needs the profile-edit permission for that student. (Before, holding
-- parent_link.edit or promotion.create let a user change EVERY column of every student.)
drop policy if exists "edit" on public.students;
create policy "edit" on public.students for update to authenticated
  using (public.can_student(school_id, 'students.profile.edit', id))
  with check (public.can_student(school_id, 'students.profile.edit', id));

-- A class / section that still has students cannot be deleted (the FK used to null them out silently)
create or replace function public.guard_class_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.schools where id = old.school_id) and exists (
       select 1 from public.students s where case when tg_table_name = 'classes' then s.class_id else s.section_id end = old.id) then
    raise exception 'This % still has students. Move them first.', case when tg_table_name = 'classes' then 'class' else 'section' end;
  end if;
  return old;
end $$;
drop trigger if exists classes_delete_guard on public.classes;
create trigger classes_delete_guard before delete on public.classes for each row execute function public.guard_class_delete();
drop trigger if exists sections_delete_guard on public.sections;
create trigger sections_delete_guard before delete on public.sections for each row execute function public.guard_class_delete();

-- ═════════════════════════ Enrolment history ═════════════════════════
-- One row per spell a student spends in a class. The open row (ended_on is null) is the current one.
-- Maintained by a trigger on students, so every way of changing class / status is recorded.
create table if not exists public.student_enrolments (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  session_id   uuid references public.sessions(id) on delete set null,
  class_id     uuid references public.classes(id) on delete set null,
  section_id   uuid references public.sections(id) on delete set null,
  class_name   text,              -- snapshots: stay correct if a class is renamed or removed
  section_name text,
  roll_no      int,
  started_on   date not null default public.today_ist(),
  ended_on     date,
  outcome      text not null default 'continuing'
               check (outcome in ('continuing','promoted','detained','passed_out','left','transferred','withdrawn','changed')),
  created_at   timestamptz not null default now()
);
create unique index if not exists student_enrolments_open on public.student_enrolments (student_id) where ended_on is null;
create index if not exists student_enrolments_class_idx on public.student_enrolments (school_id, session_id, class_id);

create or replace function public.open_enrolment(stu public.students) returns void
language plpgsql security definer set search_path = public as $$
declare sess uuid; cn text; sn text;
begin
  select id into sess from public.sessions where school_id = stu.school_id and is_current limit 1;
  select name into cn from public.classes where id = stu.class_id;
  select name into sn from public.sections where id = stu.section_id;
  insert into public.student_enrolments (school_id, student_id, session_id, class_id, section_id, class_name, section_name, roll_no)
  values (stu.school_id, stu.id, sess, stu.class_id, stu.section_id, cn, sn, stu.roll_no)
  on conflict (student_id) where ended_on is null do nothing;
end $$;

create or replace function public.track_enrolment() returns trigger
language plpgsql security definer set search_path = public as $$
declare outc text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then perform public.open_enrolment(new); end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'active' then
      perform public.open_enrolment(new);
    else
      update public.student_enrolments set ended_on = public.today_ist(), outcome = new.status
       where student_id = new.id and ended_on is null;
    end if;
  elsif new.status = 'active' and (new.class_id is distinct from old.class_id or new.section_id is distinct from old.section_id) then
    outc := coalesce(nullif(current_setting('app.enrol_outcome', true), ''), 'changed');
    update public.student_enrolments set ended_on = public.today_ist(), outcome = outc where student_id = new.id and ended_on is null;
    perform public.open_enrolment(new);
  elsif new.status = 'active' and new.roll_no is distinct from old.roll_no then
    update public.student_enrolments set roll_no = new.roll_no where student_id = new.id and ended_on is null;
  end if;
  return null;
end $$;
drop trigger if exists students_enrolment on public.students;
create trigger students_enrolment after insert or update on public.students for each row execute function public.track_enrolment();

-- Backfill: current students get an open row; students who already left get one closed row
insert into public.student_enrolments (school_id, student_id, session_id, class_id, section_id, class_name, section_name, roll_no, started_on, ended_on, outcome)
select s.school_id, s.id,
       (select id from public.sessions x where x.school_id = s.school_id and x.is_current limit 1),
       s.class_id, s.section_id, c.name, sec.name, s.roll_no,
       coalesce(s.admission_date, s.created_at::date),
       case when s.status = 'active' then null else public.today_ist() end,
       case s.status when 'active' then 'continuing' else s.status end
  from public.students s
  left join public.classes c on c.id = s.class_id
  left join public.sections sec on sec.id = s.section_id
 where not exists (select 1 from public.student_enrolments e where e.student_id = s.id);

alter table public.student_enrolments enable row level security;
drop policy if exists "read" on public.student_enrolments;
create policy "read" on public.student_enrolments for select to authenticated
  using (public.can_student(school_id, 'students.profile.view', student_id));
-- no write policies: only the trigger and promote_students() change this table

-- Promotion now keeps history, lets the school hold students back, and refuses to run twice
drop function if exists public.promote_students(uuid);
create or replace function public.promote_students(sid uuid, detain uuid[] default '{}') returns json
language plpgsql security definer set search_path = public as $$
declare moved int; passed int; kept int := 0; top int; cur uuid; today date := public.today_ist(); keep uuid[] := coalesce(detain, '{}');
begin
  if not public.has_perm_school(sid, 'students.promotion.create') then raise exception 'not allowed'; end if;
  select id into cur from public.sessions where school_id = sid and is_current;
  if cur is null then raise exception 'Set the current session first.'; end if;
  if not exists (select 1 from public.student_enrolments e join public.students s on s.id = e.student_id
                  where s.school_id = sid and s.status = 'active' and e.ended_on is null and e.session_id is distinct from cur) then
    raise exception 'Start the new session first (Settings → Classes & sessions → make it current), then promote. Promoting inside the same session would overwrite last year''s class records.';
  end if;
  select max(sort) into top from public.classes where school_id = sid;

  if cardinality(keep) > 0 then
    update public.student_enrolments e set ended_on = today, outcome = 'detained'
      from public.students s where e.student_id = s.id and s.school_id = sid and s.status = 'active' and s.id = any(keep) and e.ended_on is null;
    insert into public.student_enrolments (school_id, student_id, session_id, class_id, section_id, class_name, section_name, started_on)
      select sid, s.id, cur, s.class_id, s.section_id, c.name, sec.name, today
        from public.students s left join public.classes c on c.id = s.class_id left join public.sections sec on sec.id = s.section_id
       where s.school_id = sid and s.status = 'active' and s.id = any(keep);
    get diagnostics kept = row_count;
    update public.students set roll_no = null where school_id = sid and id = any(keep);
  end if;

  update public.students s set status = 'passed_out', left_on = today
    from public.classes c where c.id = s.class_id and s.school_id = sid and s.status = 'active' and c.sort = top and not (s.id = any(keep));
  get diagnostics passed = row_count;

  perform set_config('app.enrol_outcome', 'promoted', true);
  with nxt as (
    select c.id as from_id, (select c2.id from public.classes c2 where c2.school_id = sid and c2.sort > c.sort order by c2.sort limit 1) as to_id
    from public.classes c where c.school_id = sid
  )
  update public.students s set class_id = nxt.to_id,
         section_id = coalesce((select x.id from public.sections x where x.class_id = nxt.to_id and x.name = (select name from public.sections where id = s.section_id)),
                               (select x.id from public.sections x where x.class_id = nxt.to_id order by x.name limit 1)),
         roll_no = null
    from nxt where s.class_id = nxt.from_id and nxt.to_id is not null and s.school_id = sid and s.status = 'active' and not (s.id = any(keep));
  get diagnostics moved = row_count;
  perform set_config('app.enrol_outcome', '', true);
  return json_build_object('promoted', moved, 'passed_out', passed, 'detained', kept);
end $$;

-- ═════════════════════════ Identity, health & internal notes (sensitive tier) ═════════════════════════
-- Needs students.sensitive.view / .edit. Aadhaar is deliberately NOT stored: the school never needs the
-- number itself (APAAR generation authenticates it on the government portal).
create table if not exists public.student_sensitive (
  student_id          uuid primary key references public.students(id) on delete cascade,
  school_id           uuid not null references public.schools(id) on delete cascade,
  pen                 text check (pen is null or pen ~ '^[A-Za-z0-9]{6,20}$'),
  apaar_id            text check (apaar_id is null or apaar_id ~ '^[0-9]{12}$'),
  apaar_status        text not null default 'not_created' check (apaar_status in ('not_created','requested','generated','verified','mismatch')),
  apaar_consent       boolean not null default false,       -- parent / guardian consent for creating the APAAR ID
  apaar_consent_by    text,
  apaar_consent_on    date,
  identity_verified_on date,
  identity_note       text,
  allergies           text,
  medical_conditions  text,
  medication          text,
  disability          text,
  accommodations      text,
  doctor_name         text,
  doctor_phone        text,
  internal_notes      text,
  updated_by          uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now(),
  check (apaar_status <> 'requested' or apaar_consent),
  check (apaar_consent_on is null or apaar_consent)
);
create unique index if not exists student_sensitive_apaar on public.student_sensitive (school_id, apaar_id) where apaar_id is not null;
create unique index if not exists student_sensitive_pen on public.student_sensitive (school_id, upper(pen)) where pen is not null;
drop trigger if exists student_sensitive_touch on public.student_sensitive;
create trigger student_sensitive_touch before update on public.student_sensitive for each row execute function public.touch_row();

-- internal notes used to live in students.notes where every profile viewer could read them
insert into public.student_sensitive (student_id, school_id, internal_notes)
select id, school_id, notes from public.students where notes is not null and btrim(notes) <> ''
on conflict (student_id) do update set internal_notes = coalesce(public.student_sensitive.internal_notes, excluded.internal_notes);
update public.students set notes = null where notes is not null;

-- anything still written to students.notes (old forms, imports, API) is moved into the protected tier
create or replace function public.move_student_notes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.notes is not null and btrim(new.notes) <> '' then
    insert into public.student_sensitive (student_id, school_id, internal_notes) values (new.id, new.school_id, new.notes)
    on conflict (student_id) do update set internal_notes = excluded.internal_notes;
  end if;
  if new.notes is not null then update public.students set notes = null where id = new.id; end if;
  return null;
end $$;
drop trigger if exists students_move_notes on public.students;
create trigger students_move_notes after insert or update of notes on public.students
  for each row when (new.notes is not null) execute function public.move_student_notes();

alter table public.student_sensitive enable row level security;
drop policy if exists "read" on public.student_sensitive;
create policy "read" on public.student_sensitive for select to authenticated using (public.can_student(school_id, 'students.sensitive.view', student_id));
drop policy if exists "create" on public.student_sensitive;
create policy "create" on public.student_sensitive for insert to authenticated with check (public.can_student(school_id, 'students.sensitive.edit', student_id));
drop policy if exists "edit" on public.student_sensitive;
create policy "edit" on public.student_sensitive for update to authenticated
  using (public.can_student(school_id, 'students.sensitive.edit', student_id)) with check (public.can_student(school_id, 'students.sensitive.edit', student_id));

-- ═════════════════════════ Documents ═════════════════════════
-- A row can exist without a file (status pending = "to be submitted by <due_by>"), so a missing document
-- never blocks an admission. Files live in the private storage bucket 'student-docs'.
create table if not exists public.student_documents (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  doc_type         text not null check (doc_type in ('birth_certificate','photo','previous_marksheet','transfer_certificate','migration_certificate',
                     'address_proof','caste_certificate','income_certificate','disability_certificate','apaar_consent','medical_declaration','transport_declaration','other')),
  title            text,
  status           text not null default 'pending' check (status in ('pending','uploaded','verified','rejected','not_applicable')),
  file_path        text,
  file_name        text,
  mime_type        text,
  size_bytes       int check (size_bytes is null or size_bytes > 0),
  due_by           date,
  uploaded_by      uuid references auth.users(id) on delete set null,
  uploaded_by_name text,
  uploaded_at      timestamptz,
  verified_by      uuid references auth.users(id) on delete set null,
  verified_by_name text,
  verified_at      timestamptz,
  reject_reason    text,
  remark           text,
  created_at       timestamptz not null default now(),
  check (status in ('pending','not_applicable') or file_path is not null)
);
create unique index if not exists student_documents_one on public.student_documents (student_id, doc_type) where doc_type <> 'other';
create index if not exists student_documents_student_idx on public.student_documents (school_id, student_id);

create or replace function public.guard_student_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_checked boolean := auth.uid() is not null and not public.is_service();
begin
  if not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then raise exception 'Student not found.'; end if;
  if tg_op = 'UPDATE' and new.file_path is distinct from old.file_path and new.file_path is not null then
    new.status := 'uploaded'; new.verified_by := null; new.verified_by_name := null; new.verified_at := null; new.reject_reason := null;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('verified','rejected') then
    if actor_checked and not public.has_perm_school(new.school_id, 'students.documents.approve') then
      raise exception 'You cannot verify documents.';
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.reject_reason), '') = '' then raise exception 'Write the reason for rejecting the document.'; end if;
    new.verified_by := auth.uid(); new.verified_at := now();
    if new.status = 'verified' then new.reject_reason := null; end if;
  elsif tg_op = 'INSERT' and new.status in ('verified','rejected') and actor_checked
        and not public.has_perm_school(new.school_id, 'students.documents.approve') then
    new.status := 'uploaded';
  end if;
  return new;
end $$;
drop trigger if exists student_documents_guard on public.student_documents;
create trigger student_documents_guard before insert or update on public.student_documents for each row execute function public.guard_student_document();

alter table public.student_documents enable row level security;
drop policy if exists "read" on public.student_documents;
create policy "read" on public.student_documents for select to authenticated using (public.can_student(school_id, 'students.documents.view', student_id));
drop policy if exists "create" on public.student_documents;
create policy "create" on public.student_documents for insert to authenticated with check (public.has_perm_school(school_id, 'students.documents.create'));
drop policy if exists "edit" on public.student_documents;
create policy "edit" on public.student_documents for update to authenticated
  using (public.has_perm_school(school_id, 'students.documents.edit') or public.has_perm_school(school_id, 'students.documents.approve') or public.has_perm_school(school_id, 'students.documents.create'))
  with check (public.has_perm_school(school_id, 'students.documents.edit') or public.has_perm_school(school_id, 'students.documents.approve') or public.has_perm_school(school_id, 'students.documents.create'));
drop policy if exists "delete" on public.student_documents;
create policy "delete" on public.student_documents for delete to authenticated using (public.has_perm_school(school_id, 'students.documents.delete'));

-- Private bucket (no public URLs; the app hands out 60-second signed links after a permission check)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('student-docs', 'student-docs', false) on conflict (id) do update set public = false;
  end if;
end $$;

-- ═════════════════════════ Guardians, emergency & pickup contacts ═════════════════════════
alter table public.guardians
  add column if not exists occupation   text,
  add column if not exists is_emergency boolean not null default false,
  add column if not exists can_pickup   boolean not null default false;
alter table public.student_guardians add column if not exists is_primary boolean not null default false;
create unique index if not exists student_guardians_primary on public.student_guardians (student_id) where is_primary;

-- guardians were readable by anyone with ANY profile-view scope; now only through a child they may see
drop policy if exists "read" on public.guardians;
create policy "read" on public.guardians for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.student_guardians sg where sg.guardian_id = guardians.id
              and public.can_student(sg.school_id, 'students.profile.view', sg.student_id)));

create or replace function public.add_student_contact(sid uuid, stu uuid, p_name text, p_relation text, p_phone text,
                                                      p_occupation text, p_primary boolean, p_emergency boolean, p_pickup boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; ph text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  if not public.can_student(sid, 'students.profile.edit', stu) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found.'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Name is required.'; end if;
  if ph is not null then
    if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
    if ph !~ '^[6-9][0-9]{9}$' then raise exception 'Phone must be a 10-digit Indian mobile number.'; end if;
  end if;
  if (p_emergency or p_pickup) and ph is null then raise exception 'Emergency and pickup contacts need a phone number.'; end if;
  insert into public.guardians (school_id, name, relation, phone, occupation, is_emergency, can_pickup)
    values (sid, btrim(p_name), nullif(btrim(coalesce(p_relation, '')), ''), ph, nullif(btrim(coalesce(p_occupation, '')), ''), coalesce(p_emergency, false), coalesce(p_pickup, false))
    returning id into gid;
  if coalesce(p_primary, false) then
    update public.student_guardians set is_primary = false where student_id = stu;
    if ph is not null then update public.students set guardian_phone = ph where id = stu; end if;
  end if;
  insert into public.student_guardians (school_id, student_id, guardian_id, is_primary) values (sid, stu, gid, coalesce(p_primary, false));
  return gid;
end $$;

create or replace function public.remove_student_contact(sid uuid, stu uuid, gid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_student(sid, 'students.profile.edit', stu) then raise exception 'not allowed'; end if;
  delete from public.student_guardians where student_id = stu and guardian_id = gid and school_id = sid;
  if not found then raise exception 'Contact not found.'; end if;
  delete from public.guardians g where g.id = gid and g.user_id is null
     and not exists (select 1 from public.student_guardians sg where sg.guardian_id = g.id);
end $$;

-- ═════════════════════════ UP Board registration (Class 9-12) ═════════════════════════
-- Subjects a student takes in a session (compulsory + elective). Official board subject codes
-- are entered by the school on subjects.code — nothing is hard-coded.
create table if not exists public.student_subjects (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  is_elective boolean not null default false,
  unique (student_id, session_id, subject_id)
);
create index if not exists student_subjects_student_idx on public.student_subjects (school_id, student_id);

create table if not exists public.board_registrations (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete cascade,
  student_id        uuid not null references public.students(id) on delete cascade,
  session_id        uuid not null references public.sessions(id) on delete cascade,
  kind              text not null check (kind in ('advance_registration','exam_application')),
  class_level       int  not null check (class_level between 9 and 12),
  exam_year         int,
  status            text not null default 'draft' check (status in ('draft','checked','submitted','correction','accepted')),
  snapshot          jsonb not null default '{}',     -- frozen when the principal checks the record
  fee_total         numeric(8,2) not null default 50 check (fee_total >= 0),
  fee_to_treasury   numeric(8,2) not null default 40 check (fee_to_treasury >= 0),
  fee_paid_on       date,
  challan_no        text,
  challan_date      date,
  checked_by        uuid references auth.users(id) on delete set null,
  checked_by_name   text,
  checked_at        timestamptz,
  submitted_on      date,
  board_ref         text,
  correction_note   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (student_id, session_id, kind),
  check (fee_to_treasury <= fee_total)
);
create index if not exists board_registrations_idx on public.board_registrations (school_id, session_id, kind, class_level, status);
drop trigger if exists board_registrations_touch on public.board_registrations;
create trigger board_registrations_touch before update on public.board_registrations for each row execute function public.touch_row();

create table if not exists public.board_registration_events (
  id              bigint generated always as identity primary key,
  school_id       uuid not null references public.schools(id) on delete cascade,
  registration_id uuid not null references public.board_registrations(id) on delete cascade,
  at              timestamptz not null default now(),
  actor           uuid,
  actor_name      text,
  event           text not null,
  details         jsonb not null default '{}'
);
create index if not exists board_registration_events_idx on public.board_registration_events (registration_id, at);

-- What the board form will carry, as of now
create or replace function public.build_board_snapshot(stu uuid, sess uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)),
    'admission_no', s.admission_no, 'father_name', s.father_name, 'mother_name', s.mother_name,
    'dob', s.dob, 'gender', s.gender, 'category', s.category,
    'class', c.name, 'section', sec.name,
    'apaar_id', ss.apaar_id, 'pen', ss.pen,
    'photo', exists (select 1 from public.student_documents d where d.student_id = s.id and d.doc_type = 'photo' and d.file_path is not null and d.status <> 'rejected'),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('name', sb.name, 'code', sb.code, 'elective', x.is_elective) order by sb.sort, sb.name)
                            from public.student_subjects x join public.subjects sb on sb.id = x.subject_id
                           where x.student_id = s.id and x.session_id = sess), '[]'::jsonb))
    from public.students s
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
    left join public.student_sensitive ss on ss.student_id = s.id
   where s.id = stu;
$$;

create or replace function public.guard_board_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare snap jsonb; missing text[] := '{}'; actor_checked boolean := auth.uid() is not null and not public.is_service();
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then raise exception 'Student not found.'; end if;
    new.status := 'draft'; new.snapshot := '{}';
    return new;
  end if;
  if new.student_id is distinct from old.student_id or new.session_id is distinct from old.session_id or new.kind is distinct from old.kind then
    raise exception 'A registration cannot be moved to another student, session or form type.';
  end if;
  if new.snapshot is distinct from old.snapshot and new.status = old.status then
    raise exception 'The snapshot is set automatically when the principal checks the record.';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'checked') or (old.status = 'checked' and new.status in ('draft','submitted'))
         or (old.status = 'submitted' and new.status in ('accepted','correction')) or (old.status = 'correction' and new.status = 'checked')) then
      raise exception 'A registration cannot go from % to %.', old.status, new.status;
    end if;
    if actor_checked and not public.has_perm_school(new.school_id, 'students.board_reg.approve') then
      raise exception 'Only the principal can check, submit or accept a board registration.';
    end if;
    if new.status = 'checked' then
      snap := public.build_board_snapshot(new.student_id, new.session_id);
      if coalesce(snap ->> 'name', '') = '' then missing := missing || 'student name'::text; end if;
      if coalesce(snap ->> 'father_name', '') = '' and coalesce(snap ->> 'mother_name', '') = '' then missing := missing || 'father''s or mother''s name'::text; end if;
      if snap ->> 'dob' is null then missing := missing || 'date of birth'::text; end if;
      if snap ->> 'gender' is null then missing := missing || 'gender'::text; end if;
      if (snap ->> 'photo')::boolean is not true then missing := missing || 'photograph'::text; end if;
      if jsonb_array_length(snap -> 'subjects') = 0 then missing := missing || 'subjects'::text; end if;
      if cardinality(missing) > 0 then raise exception 'Cannot check this record. Missing: %.', array_to_string(missing, ', '); end if;
      new.snapshot := snap; new.checked_by := auth.uid(); new.checked_at := now();
      new.correction_note := null;
    elsif new.status = 'submitted' then
      new.submitted_on := coalesce(new.submitted_on, public.today_ist());
    elsif new.status = 'correction' and coalesce(btrim(new.correction_note), '') = '' then
      raise exception 'Write what the board asked to correct.';
    elsif new.status = 'draft' then
      new.snapshot := '{}'; new.checked_by := null; new.checked_at := null; new.checked_by_name := null;
    end if;
  elsif old.status in ('checked','submitted','accepted') and (new.fee_total is distinct from old.fee_total or new.exam_year is distinct from old.exam_year
        or new.class_level is distinct from old.class_level) then
    raise exception 'This registration is locked. Send it back to draft first.';
  end if;
  return new;
end $$;
drop trigger if exists board_registrations_guard on public.board_registrations;
create trigger board_registrations_guard before insert or update on public.board_registrations for each row execute function public.guard_board_registration();

create or replace function public.log_board_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; det jsonb := '{}';
begin
  if tg_op = 'INSERT' then ev := 'created'; det := jsonb_build_object('kind', new.kind, 'class_level', new.class_level);
  elsif new.status is distinct from old.status then ev := 'status ' || old.status || ' → ' || new.status;
    det := jsonb_build_object('note', new.correction_note, 'board_ref', new.board_ref);
  elsif new.challan_no is distinct from old.challan_no or new.fee_paid_on is distinct from old.fee_paid_on or new.fee_total is distinct from old.fee_total then
    ev := 'fee / challan updated'; det := jsonb_build_object('challan_no', new.challan_no, 'fee_paid_on', new.fee_paid_on, 'fee_total', new.fee_total);
  elsif new.board_ref is distinct from old.board_ref then ev := 'board reference'; det := jsonb_build_object('board_ref', new.board_ref);
  else return null; end if;
  insert into public.board_registration_events (school_id, registration_id, actor, actor_name, event, details)
  values (new.school_id, new.id, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), ev, det);
  return null;
end $$;
drop trigger if exists board_registrations_log on public.board_registrations;
create trigger board_registrations_log after insert or update on public.board_registrations for each row execute function public.log_board_registration();

alter table public.student_subjects enable row level security;
alter table public.board_registrations enable row level security;
alter table public.board_registration_events enable row level security;
drop policy if exists "read" on public.student_subjects;
create policy "read" on public.student_subjects for select to authenticated
  using (public.can_student(school_id, 'students.profile.view', student_id) or public.has_perm_school(school_id, 'students.board_reg.view'));
drop policy if exists "write" on public.student_subjects;
create policy "write" on public.student_subjects for all to authenticated
  using (public.has_perm_school(school_id, 'students.board_reg.edit')) with check (public.has_perm_school(school_id, 'students.board_reg.edit'));
drop policy if exists "read" on public.board_registrations;
create policy "read" on public.board_registrations for select to authenticated using (public.has_perm_school(school_id, 'students.board_reg.view'));
drop policy if exists "create" on public.board_registrations;
create policy "create" on public.board_registrations for insert to authenticated with check (public.has_perm_school(school_id, 'students.board_reg.create'));
drop policy if exists "edit" on public.board_registrations;
create policy "edit" on public.board_registrations for update to authenticated
  using (public.has_perm_school(school_id, 'students.board_reg.edit') or public.has_perm_school(school_id, 'students.board_reg.approve'))
  with check (public.has_perm_school(school_id, 'students.board_reg.edit') or public.has_perm_school(school_id, 'students.board_reg.approve'));
drop policy if exists "read" on public.board_registration_events;
create policy "read" on public.board_registration_events for select to authenticated using (public.has_perm_school(school_id, 'students.board_reg.view'));
-- registrations are never deleted (the audit trail must stay); events are written only by the trigger

-- ═════════════════════════ Audit: wider coverage, personal data masked ═════════════════════════
-- Same log as before, but contact / address / health values are written as "changed" instead of the value,
-- and the parent-link token is never stored. Names, DOB and identifiers stay visible so identity
-- corrections can be traced.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        diff jsonb := '{}'; k text; sid uuid;
        masked text[] := case tg_table_name
          when 'students' then array['portal_token','notes','address','permanent_address','email','alt_phone','guardian_phone','blood_group']
          when 'guardians' then array['phone','occupation']
          when 'student_sensitive' then array['allergies','medical_conditions','medication','disability','accommodations','doctor_name','doctor_phone','internal_notes','identity_note']
          when 'student_documents' then array['file_path','file_name']
          when 'staff' then array['pan','uan','bank_account','ifsc','bank_name','address','phone','email']
          else array[]::text[] end;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','marked_at') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, case when k = any(masked) then jsonb_build_array('•', '•') else jsonb_build_array(o -> k, n -> k) end);
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  end if;
  sid := coalesce((coalesce(n, o) ->> 'school_id')::uuid, case when tg_table_name = 'schools' then (coalesce(n, o) ->> 'id')::uuid end);
  perform public.log_event(lower(tg_op), sid, tg_table_name, coalesce(coalesce(n, o) ->> 'id', coalesce(n, o) ->> 'student_id'),
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', diff)
         when tg_op = 'DELETE' then jsonb_build_object('row', o - masked)
         else jsonb_build_object('row', n - masked) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['marks','fee_dues','enquiries','guardians','student_guardians','student_enrolments','student_sensitive',
                           'student_documents','student_subjects','board_registrations','staff','payslips'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ═════════════════════════ New permissions for schools that already exist ═════════════════════════
-- Adds only keys the role does not have yet (never removes or changes what a school customised).
insert into public.role_permissions (role_id, perm_key, scope)
select r.id, t.perm_key, t.scope
  from public.roles r
  join public.role_template_permissions t on t.template_code = r.template_code
 where (t.perm_key like 'students.documents.%' or t.perm_key like 'students.board_reg.%' or t.perm_key like 'students.sensitive.%')
on conflict (role_id, perm_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 7: student certificates — Transfer (TC), Bonafide, Character, Study.
-- Numbered per school / kind / session, snapshot of the student's data at issue,
-- duplicate copies controlled, cancellation needs the principal.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.certificate_counters (
  school_id    uuid not null references public.schools(id) on delete cascade,
  kind         text not null,
  session_name text not null,
  next_no      int  not null default 1,
  primary key (school_id, kind, session_name)
);

create table if not exists public.student_certificates (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  kind             text not null check (kind in ('transfer','bonafide','character','study')),
  cert_no          text not null,
  issued_on        date not null default public.today_ist(),
  is_duplicate     boolean not null default false,
  details          jsonb not null default '{}',     -- snapshot of the student's data + what the school wrote
  status           text not null default 'issued' check (status in ('issued','cancelled')),
  cancelled_reason text,
  cancelled_at     timestamptz,
  cancelled_by     uuid references auth.users(id) on delete set null,
  issued_by        uuid default auth.uid() references auth.users(id) on delete set null,
  issued_by_name   text,
  created_at       timestamptz not null default now(),
  unique (school_id, cert_no)
);
create index if not exists student_certificates_student_idx on public.student_certificates (school_id, student_id);

alter table public.certificate_counters enable row level security;   -- no policies: only the functions touch it
alter table public.student_certificates enable row level security;
drop policy if exists "read" on public.student_certificates;
create policy "read" on public.student_certificates for select to authenticated
  using (public.can_student(school_id, 'students.certificates.view', student_id));
-- issued only through issue_certificate(), cancelled only through cancel_certificate()

create or replace function public.issue_certificate(sid uuid, stu uuid, p_kind text, p_issued_on date, p_extra jsonb default '{}',
                                                    p_mark_left boolean default false, p_by text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s record; sname text; n int; num text; prev text; dup boolean := coalesce((p_extra ->> 'duplicate')::boolean, false);
        owed numeric; cid uuid; d jsonb; pre text; on_day date := coalesce(p_issued_on, public.today_ist());
begin
  if not public.has_perm_school(sid, 'students.certificates.create') then raise exception 'not allowed'; end if;
  if p_kind not in ('transfer','bonafide','character','study') then raise exception 'Unknown certificate type.'; end if;
  if on_day > public.today_ist() then raise exception 'The issue date cannot be in the future.'; end if;
  select st.*, c.name as class_name, sec.name as section_name, ac.name as admission_class_name into s
    from public.students st
    left join public.classes c on c.id = st.class_id
    left join public.sections sec on sec.id = st.section_id
    left join public.classes ac on ac.id = st.admission_class_id
   where st.id = stu and st.school_id = sid;
  if s.id is null then raise exception 'Student not found.'; end if;

  select cert_no into prev from public.student_certificates where student_id = stu and kind = p_kind and status = 'issued' and not is_duplicate order by created_at limit 1;
  if p_kind = 'transfer' and prev is not null and not dup then
    raise exception 'A transfer certificate was already issued (no. %). Tick "Duplicate copy" to issue another.', prev;
  end if;
  if p_kind = 'transfer' and dup and prev is null then dup := false; end if;

  select coalesce((select name from public.sessions where school_id = sid and is_current limit 1), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, p_kind, sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1
  returning next_no - 1 into n;
  pre := case p_kind when 'transfer' then 'TC' when 'bonafide' then 'BC' when 'character' then 'CC' else 'SC' end;
  num := pre || '/' || sname || '/' || lpad(n::text, 4, '0') || case when dup then '-D' else '' end;

  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into owed from public.fee_dues where student_id = stu and school_id = sid;

  d := jsonb_build_object(
    'name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)),
    'admission_no', s.admission_no, 'father_name', s.father_name, 'mother_name', s.mother_name,
    'dob', s.dob, 'gender', s.gender, 'category', s.category, 'nationality', coalesce(s.nationality, 'Indian'),
    'class', s.class_name, 'section', s.section_name, 'roll_no', s.roll_no,
    'admission_date', s.admission_date, 'admission_class', s.admission_class_name,
    'address', s.address, 'session', sname, 'dues_outstanding', owed,
    'apaar_id', (select apaar_id from public.student_sensitive where student_id = stu and apaar_status in ('generated','verified')),
    'last_exam', nullif(btrim(coalesce(p_extra ->> 'last_exam', '')), ''),
    'result', nullif(btrim(coalesce(p_extra ->> 'result', '')), ''),
    'promotion', nullif(btrim(coalesce(p_extra ->> 'promotion', '')), ''),
    'conduct', coalesce(nullif(btrim(coalesce(p_extra ->> 'conduct', '')), ''), 'Good'),
    'reason', nullif(btrim(coalesce(p_extra ->> 'reason', '')), ''),
    'working_days', nullif(btrim(coalesce(p_extra ->> 'working_days', '')), ''),
    'days_present', nullif(btrim(coalesce(p_extra ->> 'days_present', '')), ''),
    'remarks', nullif(btrim(coalesce(p_extra ->> 'remarks', '')), ''),
    'left_on', case when p_kind = 'transfer' then coalesce(nullif(p_extra ->> 'left_on', '')::date, on_day) end);

  insert into public.student_certificates (school_id, student_id, kind, cert_no, issued_on, is_duplicate, details, issued_by_name)
  values (sid, stu, p_kind, num, on_day, dup, d, p_by) returning id into cid;

  if p_kind = 'transfer' and p_mark_left and s.status = 'active' then
    update public.students set status = 'transferred', left_on = (d ->> 'left_on')::date,
           left_reason = coalesce(d ->> 'reason', 'Transfer certificate issued'), tc_no = num, tc_issued_on = on_day
     where id = stu;
  elsif p_kind = 'transfer' and not dup then
    update public.students set tc_no = num, tc_issued_on = on_day where id = stu;
  end if;
  return cid;
end $$;

create or replace function public.cancel_certificate(cid uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.student_certificates where id = cid;
  if c.id is null then raise exception 'Certificate not found.'; end if;
  if not public.has_perm_school(c.school_id, 'students.certificates.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason for cancelling.'; end if;
  if c.status = 'cancelled' then raise exception 'Already cancelled.'; end if;
  update public.student_certificates set status = 'cancelled', cancelled_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid() where id = cid;
end $$;

drop trigger if exists audit_student_certificates on public.student_certificates;
create trigger audit_student_certificates after insert or update or delete on public.student_certificates for each row execute function public.audit_row();

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 8: end-to-end admissions + the data the UP Board 2027 exam forms ask for.
--   · applications (number, documents, test / interview, decision, waitlist, RTE, fee) → admit
--   · fuller student profile (Hindi names, mobile, street / post office, religion …)
--   · Aadhaar (encrypted by the app, consent required), disability type, prior exams
--   · official UPMSP subject codes (HS 2027 + Intermediate 2027) and per-student board subjects
--   · seats and age limits per class, UPMSP centre IDs on the school
-- Source of the board data: UPMSP Exam Form HS 2027 / Intermediate 2027 (subject codes and combination rules).
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Student profile additions ─────────────
alter table public.students
  add column if not exists name_hi              text,
  add column if not exists father_name_hi       text,
  add column if not exists mother_name_hi       text,
  add column if not exists mobile               text check (mobile is null or mobile ~ '^[6-9][0-9]{9}$'),
  add column if not exists street               text,
  add column if not exists post_office          text,
  add column if not exists religion             text,
  add column if not exists caste                text,
  add column if not exists medium               text check (medium is null or medium in ('hindi','english')),
  add column if not exists bpl                  boolean,
  add column if not exists sibling_student_id   uuid references public.students(id) on delete set null,
  add column if not exists previous_year_percent numeric(5,2) check (previous_year_percent is null or previous_year_percent between 0 and 100),
  add column if not exists previous_year_days   int check (previous_year_days is null or previous_year_days between 0 and 400),
  add column if not exists application_id       uuid;

alter table public.classes
  add column if not exists seats         int check (seats is null or seats >= 0),
  add column if not exists min_age_years numeric(3,1) check (min_age_years is null or min_age_years >= 0),
  add column if not exists max_age_years numeric(3,1) check (max_age_years is null or max_age_years >= 0);

-- UPMSP: the user id and centre number the board allots to the school (fields 1 and 2 of every exam form)
alter table public.schools
  add column if not exists upmsp_user_id   text check (upmsp_user_id is null or upmsp_user_id ~ '^[0-9]{6}$'),
  add column if not exists upmsp_center_no text check (upmsp_center_no is null or upmsp_center_no ~ '^[0-9]{4}$');

-- ───────────── Sensitive tier: Aadhaar (ciphertext only), disability ─────────────
alter table public.student_sensitive
  add column if not exists aadhaar_enc     text,     -- AES-256-GCM made by the app; the database never sees the number
  add column if not exists aadhaar_last4   text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),
  add column if not exists aadhaar_consent boolean not null default false,
  add column if not exists disability_type text check (disability_type is null or disability_type in ('visual','hearing','speech','locomotor','hand','multiple','other')),
  add column if not exists disability_percent numeric(5,2) check (disability_percent is null or disability_percent between 0 and 100);
alter table public.student_sensitive drop constraint if exists student_sensitive_aadhaar_consent;
alter table public.student_sensitive add constraint student_sensitive_aadhaar_consent check (aadhaar_enc is null or aadhaar_consent);

-- ───────────── Earlier examinations / schools (UPMSP form items 29-38) ─────────────
create table if not exists public.student_prior_exams (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  level         text not null check (level in ('class8','class9_registration','class9','high_school','class11_registration','intermediate','iti','other')),
  board_name    text,
  exam_year     int check (exam_year is null or exam_year between 1980 and 2100),
  roll_no       text,                 -- अनुक्रमांक
  registration_no text,
  school_name   text,
  district_code text,
  school_code   text,
  result        text,
  marks_obtained numeric(7,2),
  max_marks     numeric(7,2),
  percentage    numeric(5,2) check (percentage is null or percentage between 0 and 100),
  note          text,
  created_at    timestamptz not null default now(),
  unique (student_id, level)
);
alter table public.student_prior_exams enable row level security;
drop policy if exists "read" on public.student_prior_exams;
create policy "read" on public.student_prior_exams for select to authenticated using (public.can_student(school_id, 'students.profile.view', student_id));
drop policy if exists "write" on public.student_prior_exams;
create policy "write" on public.student_prior_exams for all to authenticated
  using (public.can_student(school_id, 'students.profile.edit', student_id)) with check (public.can_student(school_id, 'students.profile.edit', student_id));

-- ───────────── Official UPMSP subject codes (HS 2027 and Intermediate 2027) ─────────────
create table if not exists public.board_subject_codes (
  level   text not null check (level in ('hs','inter')),
  code    text not null,
  name_en text not null,
  name_hi text,
  sort    int  not null default 0,
  primary key (level, code)
);
alter table public.board_subject_codes enable row level security;
drop policy if exists "read" on public.board_subject_codes;
create policy "read" on public.board_subject_codes for select to authenticated using (true);

insert into public.board_subject_codes (level, code, name_en, name_hi) values
  ('hs','901','Hindi','हिन्दी'), ('hs','902','Elementary Hindi','प्रारम्भिक हिन्दी'), ('hs','903','Gujarati','गुजराती'), ('hs','904','Urdu','उर्दू'),
  ('hs','905','Punjabi','पंजाबी'), ('hs','906','Bengali','बंगला'), ('hs','907','Marathi','मराठी'), ('hs','908','Assamese','आसामी'), ('hs','909','Oriya','उड़िया'),
  ('hs','910','Kannada','कन्नड़'), ('hs','911','Kashmiri','कश्मीरी'), ('hs','912','Sindhi','सिन्धी'), ('hs','913','Tamil','तमिल'), ('hs','914','Telugu','तेलुगू'),
  ('hs','915','Malayalam','मलयालम'), ('hs','916','Nepali','नेपाली'), ('hs','917','English','अंग्रेजी'), ('hs','923','Sanskrit','संस्कृत'), ('hs','924','Pali','पालि'),
  ('hs','925','Arabic','अरबी'), ('hs','926','Persian','फारसी'), ('hs','928','Mathematics','गणित'), ('hs','930','Home Science (female candidates)','गृह विज्ञान'),
  ('hs','931','Science','विज्ञान'), ('hs','932','Social Science','सामाजिक विज्ञान'), ('hs','933','Music Vocal','संगीत गायन'), ('hs','934','Music Instrumental','संगीत वादन'),
  ('hs','935','Commerce','वाणिज्य'), ('hs','936','Drawing','चित्रकला'), ('hs','937','Agriculture','कृषि'), ('hs','938','Home Science (optional)','गृह विज्ञान'),
  ('hs','939','Tailoring','सिलाई'), ('hs','940','Painting','रंजनकला'), ('hs','941','Computer','कम्प्यूटर'), ('hs','942','Anthropology','मानव विज्ञान'),
  ('hs','944','Moral, Yoga, Sports & Physical Education','नैतिक, योग, खेल एवं शारीरिक शिक्षा'),
  ('hs','971','Retail Trading','खुदरा व्यापार'), ('hs','972','Security','सुरक्षा'), ('hs','973','Automobile','ऑटोमोबाइल'), ('hs','974','IT / ITES','आई0टी0/आई0टी0ई0एस'), ('hs','975','Health Care','हेल्थ केयर'),
  ('hs','945','Textile Design (pre-vocational)','टेक्सटाइल डिजाइन'), ('hs','946','Library Science (pre-vocational)','पुस्तकालय विज्ञान'), ('hs','947','Cookery (pre-vocational)','पाक शास्त्र'),
  ('hs','948','Photography (pre-vocational)','फोटोग्राफी'), ('hs','949','Baking & Confectionery (pre-vocational)','बेकिंग तथा कन्फेक्शनरी'), ('hs','950','Bee Keeping (pre-vocational)','मधुमक्खी पालन'),
  ('hs','951','Plant Nursery (pre-vocational)','पौधशाला'), ('hs','952','Automobile (pre-vocational)','ऑटोमोबाइल'), ('hs','953','Laundry & Dyeing (pre-vocational)','धुलाई तथा रंगाई'),
  ('hs','954','Dress Making & Decoration (pre-vocational)','परिधान रचना एवं सज्जा'), ('hs','955','Food Preservation (pre-vocational)','खाद्य संरक्षण'),
  ('hs','956','Accountancy & Auditing (pre-vocational)','एकाउन्टेन्सी एवं अंकेक्षण'), ('hs','957','Shorthand & Typing (pre-vocational)','आशुलिपि एवं टंकण'),
  ('hs','958','Banking (pre-vocational)','बैंकिंग'), ('hs','959','Typing (pre-vocational)','टाइपिंग'), ('hs','960','Fruit Preservation Technology (pre-vocational)','फल संरक्षण तकनीक'),
  ('hs','961','Crop Protection Technology (pre-vocational)','फसल सुरक्षा तकनीक'), ('hs','962','Printing (pre-vocational)','मुद्रण'),
  ('hs','963','Radio & Television Technique (pre-vocational)','रेडियो एवं टेलीविजन तकनीक'), ('hs','964','Weaving Technology (pre-vocational)','बुनाई तकनीक'),
  ('hs','965','Retail Trading (pre-vocational)','खुदरा व्यापार'), ('hs','966','Security (pre-vocational)','सुरक्षा'), ('hs','967','Mobile Repairing (pre-vocational)','मोबाइल रिपेयरिंग'),
  ('hs','968','Tourism & Hospitality (pre-vocational)','पर्यटन एवं आतिथ्य'), ('hs','969','IT / ITES (pre-vocational)','आई0टी0/आई0टी0ई0एस0'),
  ('hs','701','Retail Trading (revised vocational)','खुदरा व्यापार'), ('hs','702','Security (revised vocational)','सुरक्षा'),
  ('hs','703','Automobile (revised vocational)','ऑटोमोबाइल'), ('hs','704','IT / ITES (revised vocational)','आई0टी0/आई0टी0ई0एस0'),

  ('inter','101','Hindi','हिन्दी'), ('inter','102','General Hindi','सामान्य हिन्दी'), ('inter','103','Sanskrit','संस्कृत'), ('inter','104','Urdu','उर्दू'),
  ('inter','105','Gujarati','गुजराती'), ('inter','106','Punjabi','पंजाबी'), ('inter','107','Bengali','बंगाली'), ('inter','108','Marathi','मराठी'), ('inter','109','Assamese','आसामी'),
  ('inter','110','Oriya','उड़िया'), ('inter','111','Kannada','कन्नड़'), ('inter','113','Sindhi','सिन्धी'), ('inter','114','Tamil','तमिल'), ('inter','115','Telugu','तेलुगू'),
  ('inter','116','Malayalam','मलयालम'), ('inter','117','English','अंग्रेजी'), ('inter','121','Nepali','नेपाली'), ('inter','124','Pali','पाली'), ('inter','125','Arabic','अरबी'),
  ('inter','126','Persian','फारसी'), ('inter','128','History','इतिहास'), ('inter','129','Geography','भूगोल'), ('inter','130','Civics','नागरिकशास्त्र'), ('inter','131','Mathematics','गणित'),
  ('inter','132','Military Science','सैन्यविज्ञान'), ('inter','133','Psychology','मनोविज्ञान'), ('inter','134','Education','शिक्षाशास्त्र'), ('inter','135','Home Science','गृहविज्ञान'),
  ('inter','136','Economics','अर्थशास्त्र'), ('inter','137','Logic','तर्कशास्त्र'), ('inter','138','Music Vocal','संगीत (गायन)'), ('inter','139','Music Instrumental','संगीत (वादन)'),
  ('inter','140','Drawing (Design)','चित्रकला (आलेखन)'), ('inter','141','Drawing (Technical)','चित्रकला (प्रावैधिक)'), ('inter','142','Sociology','समाजशास्त्र'),
  ('inter','144','Computer','कम्प्यूटर'), ('inter','145','Wood Craft','काष्ठशिल्प'), ('inter','146','Book Craft','ग्रन्थशिल्प'), ('inter','147','Tailoring','सिलाई'),
  ('inter','149','Painting','रंजनकला'), ('inter','150','Dancing','नृत्यकला'), ('inter','151','Physics','भौतिक विज्ञान'), ('inter','152','Chemistry','रसायन विज्ञान'),
  ('inter','153','Biology','जीव विज्ञान'), ('inter','156','Accountancy','लेखाशास्त्र'), ('inter','157','Business Studies','व्यवसाय अध्ययन'),
  ('inter','163','Agronomy (Ag. Part 1)','शस्यविज्ञान'), ('inter','164','Ag. Botany','कृषि वनस्पतिविज्ञान'), ('inter','165','Ag. Physics & Climatology','कृषि भौतिकविज्ञान एवं जलवायुविज्ञान'),
  ('inter','166','Ag. Engineering','कृषि अभियंत्रण'), ('inter','167','Ag. Mathematics & Elementary Statistics','कृषि गणित तथा प्रारम्भिक सांख्यिकी'),
  ('inter','168','Agronomy (Ag. Part 2)','शस्यविज्ञान'), ('inter','169','Ag. Economics','कृषि अर्थशास्त्र'), ('inter','170','Ag. Zoology','कृषि जन्तुविज्ञान'),
  ('inter','171','Animal Husbandry & Veterinary Science','कृषि पशुपालन एवं पशु चिकित्साविज्ञान'), ('inter','172','Ag. Chemistry','कृषि रसायन विज्ञान'),
  ('inter','173','Moral, Yoga, Sports & Physical Education','नैतिक, योग, खेल एवं शारीरिक शिक्षा'), ('inter','174','Anthropology','मानव विज्ञान'), ('inter','175','NCC','एन0सी0सी0'),
  ('inter','200','Optional Agronomy','वैकल्पिक शस्य विज्ञान'), ('inter','201','Vocational General Foundation','सामान्य आधारिक विषय'),
  ('inter','202','Fruit & Food Preservation','फल एवं खाद्य संरक्षण'), ('inter','203','Cookery','पाकशास्त्र'), ('inter','204','Dress Making & Decoration','परिधान रचना एवं सज्जा'),
  ('inter','205','Laundry & Dyeing','धुलाई तथा रंगाई'), ('inter','206','Baking & Confectionery','बेकिंग तथा कन्फेक्शनरी'), ('inter','207','Textile Design','टेक्सटाइल डिजाइन'),
  ('inter','208','Weaving Technique','बुनाई तकनीक'), ('inter','209','Nursery Teacher Training & Child Management','नर्सरी शिक्षक प्रशिक्षण एवं शिशु प्रबन्ध'),
  ('inter','210','Library Science','पुस्तकालय विज्ञान'), ('inter','211','Multipurpose Health Worker (incl. Laboratory Technique)','बहुउद्देशीय स्वास्थ्य कर्मिक (लेबोरेटरी तकनीक सहित)'),
  ('inter','212','Colour Photography','रंगीन फोटोग्राफी'), ('inter','213','Radio & Colour Television','रेडियो एवं रंगीन टेलीविजन'), ('inter','214','Automobiles','आटोमोबाइल्स'),
  ('inter','215','Bee Keeping','मधुमक्खी पालन'), ('inter','216','Dairy Technology','डेरी प्रौद्योगिकी'), ('inter','217','Sericulture','रेशमकीट पालन'),
  ('inter','218','Seed Production Technology','बीजोत्पादन प्रौद्योगिकी'), ('inter','219','Crop Protection Technology','फसल सुरक्षा प्रौद्योगिकी'), ('inter','220','Plant Nursery','पौधशाला'),
  ('inter','221','Land Conservation & Reclamation','भूमि संरक्षण एवं भूमि सुधार'), ('inter','222','Accountancy & Auditing','एकाउन्टेन्सी एवं अंकेक्षण'), ('inter','223','Banking','बैंकिंग'),
  ('inter','224','Shorthand & Typing (Hindi)','आशुलिपि एवं टंकण (हिन्दी)'), ('inter','225','Shorthand & Typing (English)','आशुलिपि एवं टंकण (अंग्रेजी)'),
  ('inter','226','Marketing & Salesmanship','विपणन एवं विक्रयकला'), ('inter','227','Secretarial Practice','सचिवीय पद्धति'), ('inter','228','Insurance','बीमा'),
  ('inter','229','Co-operation','सहकारिता'), ('inter','230','Typing Hindi & English','टंकण हिन्दी तथा अंग्रेजी'), ('inter','231','Printing','मुद्रण'), ('inter','232','Pottery','कुलालविज्ञान'),
  ('inter','233','Artificial Limbs & Organ Technique','कृत्रिम अंग एवं अवयव तकनीक'), ('inter','234','Embroidery','इम्ब्राइडरी'), ('inter','235','Hand Block Printing','हैण्ड ब्लाक प्रिंटिंग'),
  ('inter','236','Metal Craft (Moulding)','मेटलक्राफ्ट (मोल्डिंग)'), ('inter','237','Metal Craft (Engraving)','मेटलक्राफ्ट (इनग्रेविंग)'),
  ('inter','238','Computer Technique & Maintenance (Data Entry Process)','कम्प्यूटर तकनीक एवं मेन्टेनेन्स (डाटा इन्ट्री प्रोसेस)'),
  ('inter','239','Repair & Maintenance of Domestic Electrical Appliances','घरेलू विद्युत उपकरणों की मरम्मत एवं रख रखाव'), ('inter','240','Retail Trading','रिटेल ट्रेडिंग'),
  ('inter','241','Security','सेक्योरिटी'), ('inter','242','Mobile Repairing','मोबाइल रिपेयरिंग'), ('inter','243','Tourism & Hospitality','टूरिज्म एण्ड हॉस्पिटैलिटी'),
  ('inter','244','IT / ITES','आई0टी0/आई0टी0ई0एस0'), ('inter','245','Health Care','हेल्थ केयर')
on conflict (level, code) do update set name_en = excluded.name_en, name_hi = excluded.name_hi;

-- Subjects chosen for the board form, in the order of the form's boxes (slot '1'…'7'; HS also 'trade')
create table if not exists public.student_board_subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  level      text not null check (level in ('hs','inter')),
  slot       text not null check (slot in ('1','2','3','4','5','6','7','trade')),
  code       text not null,
  unique (student_id, session_id, level, slot),
  foreign key (level, code) references public.board_subject_codes(level, code)
);
alter table public.student_board_subjects enable row level security;
drop policy if exists "read" on public.student_board_subjects;
create policy "read" on public.student_board_subjects for select to authenticated
  using (public.can_student(school_id, 'students.profile.view', student_id) or public.has_perm_school(school_id, 'students.board_reg.view'));
drop policy if exists "write" on public.student_board_subjects;
create policy "write" on public.student_board_subjects for all to authenticated
  using (public.has_perm_school(school_id, 'students.board_reg.edit')) with check (public.has_perm_school(school_id, 'students.board_reg.edit'));

alter table public.board_registrations
  add column if not exists subject_group   text check (subject_group is null or subject_group in ('A','B','C','F1','F2','I')),
  add column if not exists exam_type       text not null default 'full' check (exam_type in ('full','part')),
  add column if not exists board_roll_no   text,
  add column if not exists board_reg_no    text;

-- ───────────── Snapshot: everything the board form carries ─────────────
create or replace function public.build_board_snapshot(stu uuid, sess uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)),
    'name_hi', s.name_hi, 'father_name', s.father_name, 'father_name_hi', s.father_name_hi,
    'mother_name', s.mother_name, 'mother_name_hi', s.mother_name_hi,
    'admission_no', s.admission_no, 'dob', s.dob, 'gender', s.gender, 'category', s.category, 'medium', s.medium,
    'mobile', s.mobile, 'email', s.email, 'nationality', coalesce(s.nationality, 'Indian'),
    'street', coalesce(s.street, s.address), 'village_town_city', s.city, 'post_office', s.post_office, 'tehsil_block', s.block_tehsil,
    'district', s.district, 'state', s.state, 'pincode', s.pincode,
    'class', c.name, 'section', sec.name,
    'apaar_id', ss.apaar_id, 'pen', ss.pen, 'aadhaar_last4', ss.aadhaar_last4, 'aadhaar_present', ss.aadhaar_enc is not null,
    'disability_type', ss.disability_type,
    'photo', exists (select 1 from public.student_documents d where d.student_id = s.id and d.doc_type = 'photo' and d.file_path is not null and d.status <> 'rejected'),
    'subject_group', (select r.subject_group from public.board_registrations r where r.student_id = s.id and r.session_id = sess limit 1),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('slot', b.slot, 'code', b.code, 'name_en', k.name_en, 'name_hi', k.name_hi)
                                          order by case when b.slot = 'trade' then 99 else b.slot::int end)
                            from public.student_board_subjects b join public.board_subject_codes k on k.level = b.level and k.code = b.code
                           where b.student_id = s.id and b.session_id = sess), '[]'::jsonb),
    'prior', coalesce((select jsonb_agg(jsonb_build_object('level', p.level, 'board_name', p.board_name, 'exam_year', p.exam_year, 'roll_no', p.roll_no,
                                          'registration_no', p.registration_no, 'school_name', p.school_name, 'district_code', p.district_code, 'school_code', p.school_code))
                         from public.student_prior_exams p where p.student_id = s.id), '[]'::jsonb))
    from public.students s
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
    left join public.student_sensitive ss on ss.student_id = s.id
   where s.id = stu;
$$;

-- readiness rules for the principal's check (presence only; combination rules are checked by the app)
create or replace function public.guard_board_registration() returns trigger
language plpgsql security definer set search_path = public as $$
declare snap jsonb; missing text[] := '{}'; actor_checked boolean := auth.uid() is not null and not public.is_service();
        n_sub int; need int; grp text; hs boolean;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then raise exception 'Student not found.'; end if;
    new.status := 'draft'; new.snapshot := '{}';
    return new;
  end if;
  if new.student_id is distinct from old.student_id or new.session_id is distinct from old.session_id or new.kind is distinct from old.kind then
    raise exception 'A registration cannot be moved to another student, session or form type.';
  end if;
  if new.snapshot is distinct from old.snapshot and new.status = old.status then
    raise exception 'The snapshot is set automatically when the principal checks the record.';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'checked') or (old.status = 'checked' and new.status in ('draft','submitted'))
         or (old.status = 'submitted' and new.status in ('accepted','correction')) or (old.status = 'correction' and new.status = 'checked')) then
      raise exception 'A registration cannot go from % to %.', old.status, new.status;
    end if;
    if actor_checked and not public.has_perm_school(new.school_id, 'students.board_reg.approve') then
      raise exception 'Only the principal can check, submit or accept a board registration.';
    end if;
    if new.status = 'checked' then
      snap := public.build_board_snapshot(new.student_id, new.session_id);
      hs := new.class_level in (9, 10);
      grp := coalesce(new.subject_group, snap ->> 'subject_group');
      if coalesce(snap ->> 'name', '') = '' then missing := missing || 'student name'::text; end if;
      if coalesce(snap ->> 'name_hi', '') = '' then missing := missing || 'student name in Hindi'::text; end if;
      if coalesce(snap ->> 'father_name', '') = '' and coalesce(snap ->> 'mother_name', '') = '' then missing := missing || 'father''s or mother''s name'::text; end if;
      if coalesce(snap ->> 'father_name', '') <> '' and coalesce(snap ->> 'father_name_hi', '') = '' then missing := missing || 'father''s name in Hindi'::text; end if;
      if coalesce(snap ->> 'mother_name', '') <> '' and coalesce(snap ->> 'mother_name_hi', '') = '' then missing := missing || 'mother''s name in Hindi'::text; end if;
      if snap ->> 'dob' is null then missing := missing || 'date of birth'::text; end if;
      if snap ->> 'gender' is null then missing := missing || 'gender'::text; end if;
      if snap ->> 'category' is null then missing := missing || 'category'::text; end if;
      if snap ->> 'medium' is null then missing := missing || 'medium (Hindi / English)'::text; end if;
      if coalesce(snap ->> 'district', '') = '' or coalesce(snap ->> 'state', '') = '' or coalesce(snap ->> 'pincode', '') = '' then missing := missing || 'address (district, state, PIN)'::text; end if;
      if coalesce(snap ->> 'mobile', '') = '' then missing := missing || 'mobile number'::text; end if;
      if (snap ->> 'photo')::boolean is not true then missing := missing || 'photograph'::text; end if;
      select count(*) into n_sub from jsonb_array_elements(snap -> 'subjects') x where x ->> 'slot' <> '7';
      if hs then
        if not (select bool_and(exists (select 1 from jsonb_array_elements(snap -> 'subjects') x where x ->> 'slot' = s)) from unnest(array['1','2','3','4','5']) s) then
          missing := missing || 'subjects 1 to 5'::text;
        end if;
        if not exists (select 1 from jsonb_array_elements(snap -> 'subjects') x where x ->> 'slot' in ('6','trade')) then
          missing := missing || '6th subject (optional / trade)'::text;
        end if;
      else
        if grp is null then missing := missing || 'subject group (A, B, C, F1, F2, I)'::text;
        else
          need := case grp when 'F1' then 6 when 'F2' then 6 when 'I' then 4 else 5 end;
          if n_sub < need then missing := missing || ('subjects (group ' || grp || ' needs ' || need || ')')::text; end if;
        end if;
      end if;
      if cardinality(missing) > 0 then raise exception 'Cannot check this record. Missing: %.', array_to_string(missing, ', '); end if;
      new.snapshot := snap; new.checked_by := auth.uid(); new.checked_at := now();
      new.correction_note := null;
    elsif new.status = 'submitted' then
      new.submitted_on := coalesce(new.submitted_on, public.today_ist());
    elsif new.status = 'correction' and coalesce(btrim(new.correction_note), '') = '' then
      raise exception 'Write what the board asked to correct.';
    elsif new.status = 'draft' then
      new.snapshot := '{}'; new.checked_by := null; new.checked_at := null; new.checked_by_name := null;
    end if;
  elsif old.status in ('checked','submitted','accepted') and (new.fee_total is distinct from old.fee_total or new.exam_year is distinct from old.exam_year
        or new.class_level is distinct from old.class_level or new.subject_group is distinct from old.subject_group) then
    raise exception 'This registration is locked. Send it back to draft first.';
  end if;
  return new;
end $$;

-- ═════════════════════════ Admission applications ═════════════════════════
create table if not exists public.admission_applications (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  application_no  text not null,
  session_id      uuid references public.sessions(id) on delete set null,
  class_id        uuid references public.classes(id) on delete set null,       -- class applied for
  enquiry_id      uuid references public.enquiries(id) on delete set null,
  status          text not null default 'submitted'
                  check (status in ('submitted','under_review','test_scheduled','approved','waitlisted','rejected','admitted','cancelled')),
  applicant_name  text not null check (length(btrim(applicant_name)) > 0),
  father_name     text,
  phone           text,
  form            jsonb not null default '{}',     -- the full student profile (same keys as students) + contacts[] + prior[]
  rte_applicant   boolean not null default false,
  rte_reference   text,
  source          text,
  applied_on      date not null default public.today_ist(),
  test_on         date, test_marks numeric(6,2), test_max numeric(6,2),
  interview_on    date, interview_note text,
  waitlist_no     int,
  decision_note   text,
  decided_by      uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at      timestamptz,
  fee_amount      numeric(10,2) check (fee_amount is null or fee_amount >= 0),
  fee_paid_on     date, fee_mode text, fee_ref text,
  student_id      uuid references public.students(id) on delete set null,
  admitted_on     date,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (school_id, application_no),
  check (test_marks is null or test_max is null or test_marks <= test_max)
);
create index if not exists admission_applications_idx on public.admission_applications (school_id, session_id, status);
create index if not exists admission_applications_class_idx on public.admission_applications (school_id, class_id, status);
drop trigger if exists admission_applications_touch on public.admission_applications;
create trigger admission_applications_touch before update on public.admission_applications for each row execute function public.touch_row();
alter table public.students drop constraint if exists students_application_fk;
alter table public.students add constraint students_application_fk foreign key (application_id) references public.admission_applications(id) on delete set null;

create table if not exists public.admission_application_events (
  id             bigint generated always as identity primary key,
  school_id      uuid not null references public.schools(id) on delete cascade,
  application_id uuid not null references public.admission_applications(id) on delete cascade,
  at             timestamptz not null default now(),
  actor          uuid,
  actor_name     text,
  event          text not null,
  details        jsonb not null default '{}'
);
create index if not exists admission_application_events_idx on public.admission_application_events (application_id, at);

create table if not exists public.application_documents (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  application_id   uuid not null references public.admission_applications(id) on delete cascade,
  doc_type         text not null check (doc_type in ('birth_certificate','photo','previous_marksheet','transfer_certificate','migration_certificate',
                     'address_proof','caste_certificate','income_certificate','disability_certificate','apaar_consent','medical_declaration','transport_declaration','other')),
  title            text,
  status           text not null default 'pending' check (status in ('pending','uploaded','verified','rejected','not_applicable')),
  file_path        text, file_name text, mime_type text, size_bytes int,
  due_by           date,
  uploaded_by      uuid references auth.users(id) on delete set null, uploaded_by_name text, uploaded_at timestamptz,
  verified_by      uuid references auth.users(id) on delete set null, verified_by_name text, verified_at timestamptz,
  reject_reason    text, remark text,
  created_at       timestamptz not null default now(),
  check (status in ('pending','not_applicable') or file_path is not null)
);
create unique index if not exists application_documents_one on public.application_documents (application_id, doc_type) where doc_type <> 'other';

create or replace function public.guard_application_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_checked boolean := auth.uid() is not null and not public.is_service();
begin
  if not exists (select 1 from public.admission_applications where id = new.application_id and school_id = new.school_id) then raise exception 'Application not found.'; end if;
  if tg_op = 'UPDATE' and new.file_path is distinct from old.file_path and new.file_path is not null then
    new.status := 'uploaded'; new.verified_by := null; new.verified_by_name := null; new.verified_at := null; new.reject_reason := null;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('verified','rejected') then
    if actor_checked and not public.has_perm_school(new.school_id, 'frontdesk.admissions.edit') then raise exception 'You cannot verify documents.'; end if;
    if new.status = 'rejected' and coalesce(btrim(new.reject_reason), '') = '' then raise exception 'Write the reason for rejecting the document.'; end if;
    new.verified_by := auth.uid(); new.verified_at := now();
    if new.status = 'verified' then new.reject_reason := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists application_documents_guard on public.application_documents;
create trigger application_documents_guard before insert or update on public.application_documents for each row execute function public.guard_application_document();

-- numbering uses certificate_counters (kind 'application')
create or replace function public.create_application(sid uuid, p_class uuid, p_enquiry uuid, p_form jsonb, p_rte boolean default false,
                                                     p_rte_ref text default null, p_source text default null, p_session uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare sess uuid := coalesce(p_session, (select id from public.sessions where school_id = sid and is_current limit 1));
        sname text; n int; num text; nm text; dup text; aid uuid; f jsonb := coalesce(p_form, '{}'::jsonb);
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(f ->> 'first_name'), '') = '' then raise exception 'The student''s first name is required.'; end if;
  if p_class is not null and not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Class not found.'; end if;
  if p_enquiry is not null and not exists (select 1 from public.enquiries where id = p_enquiry and school_id = sid) then raise exception 'Enquiry not found.'; end if;
  nm := btrim(concat_ws(' ', f ->> 'first_name', f ->> 'middle_name', f ->> 'last_name'));
  select application_no into dup from public.admission_applications
   where school_id = sid and session_id is not distinct from sess and status not in ('cancelled','rejected')
     and lower(applicant_name) = lower(nm) and coalesce(form ->> 'dob', '') = coalesce(f ->> 'dob', '') and coalesce(lower(father_name), '') = coalesce(lower(f ->> 'father_name'), '')
   limit 1;
  if dup is not null and coalesce((f ->> 'allow_duplicate')::boolean, false) is not true then
    raise exception 'An application for the same student already exists (no. %).', dup;
  end if;
  select coalesce((select name from public.sessions where id = sess), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, 'application', sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1 returning next_no - 1 into n;
  num := 'APP/' || sname || '/' || lpad(n::text, 4, '0');
  insert into public.admission_applications (school_id, application_no, session_id, class_id, enquiry_id, applicant_name, father_name, phone, form, rte_applicant, rte_reference, source)
  values (sid, num, sess, p_class, p_enquiry, nm, nullif(btrim(f ->> 'father_name'), ''), nullif(btrim(f ->> 'guardian_phone'), ''), f - 'allow_duplicate', coalesce(p_rte, false), nullif(btrim(coalesce(p_rte_ref, '')), ''), nullif(btrim(coalesce(p_source, '')), ''))
  returning id into aid;
  if p_enquiry is not null then update public.enquiries set status = case when status in ('new','contacted','visited') then 'test' else status end where id = p_enquiry and school_id = sid; end if;
  return aid;
end $$;

-- status workflow
create or replace function public.guard_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_checked boolean := auth.uid() is not null and not public.is_service(); ok boolean; need_approve boolean;
begin
  if tg_op = 'INSERT' then new.status := 'submitted'; return new; end if;
  if new.school_id is distinct from old.school_id or new.application_no is distinct from old.application_no then raise exception 'Application numbers cannot be changed.'; end if;
  if old.status in ('admitted','cancelled') and (new.status is distinct from old.status or new.form is distinct from old.form or new.class_id is distinct from old.class_id) then
    raise exception 'This application is closed (%).', old.status;
  end if;
  if new.status is distinct from old.status then
    ok := case old.status
      when 'submitted'      then new.status in ('under_review','test_scheduled','approved','waitlisted','rejected','cancelled')
      when 'under_review'   then new.status in ('test_scheduled','approved','waitlisted','rejected','cancelled')
      when 'test_scheduled' then new.status in ('under_review','approved','waitlisted','rejected','cancelled')
      when 'approved'       then new.status in ('waitlisted','cancelled','admitted','under_review')
      when 'waitlisted'     then new.status in ('approved','rejected','cancelled','under_review')
      when 'rejected'       then new.status in ('under_review')
      else false end;
    if not ok then raise exception 'An application cannot go from % to %.', old.status, new.status; end if;
    if new.status = 'admitted' and coalesce(current_setting('app.admitting', true), '') <> '1' then
      raise exception 'An application becomes admitted only through "Admit".';
    end if;
    need_approve := new.status in ('approved','waitlisted','rejected') or (old.status = 'rejected');
    if actor_checked and need_approve and not public.has_perm_school(new.school_id, 'frontdesk.admissions.approve') then
      raise exception 'Only the principal (admission approver) can approve, waitlist or reject.';
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.decision_note), '') = '' then raise exception 'Write the reason for rejecting.'; end if;
    if new.status in ('approved','waitlisted','rejected') then new.decided_by := auth.uid(); new.decided_at := now(); end if;
    if new.status = 'waitlisted' then
      select coalesce(max(waitlist_no), 0) + 1 into new.waitlist_no from public.admission_applications
       where school_id = new.school_id and class_id is not distinct from new.class_id and session_id is not distinct from new.session_id and status = 'waitlisted';
    elsif old.status = 'waitlisted' then new.waitlist_no := null;
    end if;
    if new.status = 'test_scheduled' and new.test_on is null and new.interview_on is null then raise exception 'Set the test or interview date first.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists admission_applications_guard on public.admission_applications;
create trigger admission_applications_guard before insert or update on public.admission_applications for each row execute function public.guard_application();

create or replace function public.log_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; det jsonb := '{}';
begin
  if tg_op = 'INSERT' then ev := 'application received'; det := jsonb_build_object('no', new.application_no);
  elsif new.status is distinct from old.status then ev := 'status ' || old.status || ' → ' || new.status; det := jsonb_build_object('note', new.decision_note, 'waitlist_no', new.waitlist_no);
  elsif new.fee_paid_on is distinct from old.fee_paid_on or new.fee_amount is distinct from old.fee_amount then ev := 'application fee recorded'; det := jsonb_build_object('amount', new.fee_amount, 'mode', new.fee_mode);
  elsif new.test_marks is distinct from old.test_marks or new.test_on is distinct from old.test_on or new.interview_on is distinct from old.interview_on then ev := 'test / interview updated'; det := jsonb_build_object('test_on', new.test_on, 'marks', new.test_marks, 'interview_on', new.interview_on);
  else return null; end if;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (new.school_id, new.id, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), ev, det);
  return null;
end $$;
drop trigger if exists admission_applications_log on public.admission_applications;
create trigger admission_applications_log after insert or update on public.admission_applications for each row execute function public.log_application();

alter table public.admission_applications enable row level security;
alter table public.admission_application_events enable row level security;
alter table public.application_documents enable row level security;
drop policy if exists "read" on public.admission_applications;
create policy "read" on public.admission_applications for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.view'));
drop policy if exists "edit" on public.admission_applications;
create policy "edit" on public.admission_applications for update to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.admissions.edit') or public.has_perm_school(school_id, 'frontdesk.admissions.approve'))
  with check (public.has_perm_school(school_id, 'frontdesk.admissions.edit') or public.has_perm_school(school_id, 'frontdesk.admissions.approve'));
-- created only through create_application(); never deleted (cancel instead)
drop policy if exists "read" on public.admission_application_events;
create policy "read" on public.admission_application_events for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.view'));
drop policy if exists "read" on public.application_documents;
create policy "read" on public.application_documents for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.view'));
drop policy if exists "create" on public.application_documents;
create policy "create" on public.application_documents for insert to authenticated with check (public.has_perm_school(school_id, 'frontdesk.admissions.create'));
drop policy if exists "edit" on public.application_documents;
create policy "edit" on public.application_documents for update to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.admissions.edit')) with check (public.has_perm_school(school_id, 'frontdesk.admissions.edit'));
drop policy if exists "delete" on public.application_documents;
create policy "delete" on public.application_documents for delete to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.edit'));

-- ───────────── Admit: application → student ─────────────
-- helper (not callable by users): create one student's dues from the class fee plans
create or replace function public.bill_student_dues(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int; sess uuid;
begin
  select id into sess from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then return 0; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         least(p.amount, coalesce((select sum(case when c.kind = 'percent' then p.amount * c.value / 100 else c.value end)
                                    from public.student_concessions c where c.student_id = s.id and (c.fee_head_id is null or c.fee_head_id = p.fee_head_id)), 0))
    from public.fee_plans p
    join public.fee_heads h on h.id = p.fee_head_id
    join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.id = stu and s.status = 'active'
   where p.school_id = sid and p.session_id = sess
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.bill_student_dues(uuid, uuid) from public, anon, authenticated;

create or replace function public.admit_application(app uuid, p_class uuid, p_section uuid, p_admission_no text default null,
                                                    p_admission_date date default null, p_roll int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a record; f jsonb; sid uuid; stu uuid; adm text; c jsonb; pr jsonb; d record; today date := public.today_ist(); billed int;
begin
  select * into a from public.admission_applications where id = app for update;
  if a.id is null then raise exception 'Application not found.'; end if;
  sid := a.school_id;
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if a.status <> 'approved' then raise exception 'Only an approved application can be admitted (this one is %).', a.status; end if;
  if p_class is null or not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Choose the class.'; end if;
  if p_section is not null and not exists (select 1 from public.sections where id = p_section and class_id = p_class) then raise exception 'The section does not belong to that class.'; end if;
  f := a.form;
  adm := nullif(btrim(coalesce(p_admission_no, '')), '');
  if adm is null then adm := public.next_school_number(sid, 'admission'); end if;
  insert into public.students (school_id, admission_no, first_name, middle_name, last_name, gender, dob, class_id, section_id, roll_no,
      father_name, mother_name, guardian_phone, alt_phone, email, address, city, district, block_tehsil, pincode, state, locality_type, mother_tongue, nationality,
      category, blood_group, permanent_address, previous_school, previous_board, previous_class, name_hi, father_name_hi, mother_name_hi, mobile, street, post_office,
      religion, caste, medium, bpl, admission_date, admission_class_id, application_no, application_id,
      admission_category, previous_year_percent, previous_year_days, distance_km)
  values (sid, adm, btrim(f ->> 'first_name'), nullif(f ->> 'middle_name', ''), nullif(f ->> 'last_name', ''), nullif(f ->> 'gender', ''), nullif(f ->> 'dob', '')::date, p_class, p_section, p_roll,
      nullif(f ->> 'father_name', ''), nullif(f ->> 'mother_name', ''), nullif(f ->> 'guardian_phone', ''), nullif(f ->> 'alt_phone', ''), nullif(f ->> 'email', ''),
      nullif(f ->> 'address', ''), nullif(f ->> 'city', ''), nullif(f ->> 'district', ''), nullif(f ->> 'block_tehsil', ''), nullif(f ->> 'pincode', ''), nullif(f ->> 'state', ''),
      nullif(f ->> 'locality_type', ''), nullif(f ->> 'mother_tongue', ''), coalesce(nullif(f ->> 'nationality', ''), 'Indian'),
      nullif(f ->> 'category', ''), nullif(f ->> 'blood_group', ''), nullif(f ->> 'permanent_address', ''), nullif(f ->> 'previous_school', ''), nullif(f ->> 'previous_board', ''),
      nullif(f ->> 'previous_class', ''), nullif(f ->> 'name_hi', ''), nullif(f ->> 'father_name_hi', ''), nullif(f ->> 'mother_name_hi', ''), nullif(f ->> 'mobile', ''),
      nullif(f ->> 'street', ''), nullif(f ->> 'post_office', ''), nullif(f ->> 'religion', ''), nullif(f ->> 'caste', ''), nullif(f ->> 'medium', ''),
      nullif(f ->> 'bpl', '')::boolean, coalesce(p_admission_date, today), p_class, a.application_no, a.id,
      case when a.rte_applicant then 'rte' else nullif(f ->> 'admission_category', '') end,
      nullif(f ->> 'previous_year_percent', '')::numeric, nullif(f ->> 'previous_year_days', '')::int, nullif(f ->> 'distance_km', '')::numeric)
  returning id into stu;

  -- restricted tier
  if f ?| array['pen','apaar_id','aadhaar_enc','allergies','medical_conditions','medication','disability','disability_type','accommodations'] then
    insert into public.student_sensitive (student_id, school_id, pen, apaar_id, apaar_status, apaar_consent, aadhaar_enc, aadhaar_last4, aadhaar_consent,
        allergies, medical_conditions, medication, disability, disability_type, disability_percent, accommodations)
    values (stu, sid, nullif(f ->> 'pen', ''), nullif(f ->> 'apaar_id', ''), coalesce(nullif(f ->> 'apaar_status', ''), 'not_created'),
        coalesce((f ->> 'apaar_consent')::boolean, false), nullif(f ->> 'aadhaar_enc', ''), nullif(f ->> 'aadhaar_last4', ''),
        coalesce((f ->> 'aadhaar_consent')::boolean, false), nullif(f ->> 'allergies', ''), nullif(f ->> 'medical_conditions', ''), nullif(f ->> 'medication', ''),
        nullif(f ->> 'disability', ''), nullif(f ->> 'disability_type', ''), nullif(f ->> 'disability_percent', '')::numeric, nullif(f ->> 'accommodations', ''))
    on conflict (student_id) do nothing;
  end if;

  -- guardians / emergency / pickup
  for c in select * from jsonb_array_elements(coalesce(f -> 'contacts', '[]'::jsonb)) loop
    declare gid uuid; ph text := nullif(regexp_replace(coalesce(c ->> 'phone', ''), '\D', '', 'g'), '');
    begin
      if coalesce(btrim(c ->> 'name'), '') = '' then continue; end if;
      if ph is not null and length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
      if ph is not null and ph !~ '^[6-9][0-9]{9}$' then ph := null; end if;
      insert into public.guardians (school_id, name, relation, phone, occupation, is_emergency, can_pickup)
      values (sid, btrim(c ->> 'name'), nullif(c ->> 'relation', ''), ph, nullif(c ->> 'occupation', ''),
              coalesce((c ->> 'is_emergency')::boolean, false) and ph is not null, coalesce((c ->> 'can_pickup')::boolean, false) and ph is not null)
      returning id into gid;
      insert into public.student_guardians (school_id, student_id, guardian_id, is_primary)
      values (sid, stu, gid, coalesce((c ->> 'is_primary')::boolean, false) and not exists (select 1 from public.student_guardians where student_id = stu and is_primary));
    end;
  end loop;

  -- earlier examinations
  for pr in select * from jsonb_array_elements(coalesce(f -> 'prior', '[]'::jsonb)) loop
    if (pr ->> 'level') in ('class8','class9_registration','class9','high_school','class11_registration','intermediate','iti','other') then
      insert into public.student_prior_exams (school_id, student_id, level, board_name, exam_year, roll_no, registration_no, school_name, district_code, school_code, result, percentage)
      values (sid, stu, pr ->> 'level', nullif(pr ->> 'board_name', ''), nullif(pr ->> 'exam_year', '')::int, nullif(pr ->> 'roll_no', ''), nullif(pr ->> 'registration_no', ''),
              nullif(pr ->> 'school_name', ''), nullif(pr ->> 'district_code', ''), nullif(pr ->> 'school_code', ''), nullif(pr ->> 'result', ''), nullif(pr ->> 'percentage', '')::numeric)
      on conflict (student_id, level) do nothing;
    end if;
  end loop;

  -- documents (same private files, now attached to the student)
  for d in select * from public.application_documents where application_id = app loop
    insert into public.student_documents (school_id, student_id, doc_type, title, status, file_path, file_name, mime_type, size_bytes, due_by, uploaded_by, uploaded_by_name,
                                          uploaded_at, verified_by, verified_by_name, verified_at, reject_reason, remark)
    values (sid, stu, d.doc_type, d.title, d.status, d.file_path, d.file_name, d.mime_type, d.size_bytes, d.due_by, d.uploaded_by, d.uploaded_by_name,
            d.uploaded_at, d.verified_by, d.verified_by_name, d.verified_at, d.reject_reason, d.remark)
    on conflict (student_id, doc_type) where doc_type <> 'other' do nothing;
  end loop;

  billed := public.bill_student_dues(sid, stu);
  if a.enquiry_id is not null then update public.enquiries set status = 'admitted', student_id = stu where id = a.enquiry_id and school_id = sid; end if;
  perform set_config('app.admitting', '1', true);
  update public.admission_applications set status = 'admitted', student_id = stu, admitted_on = coalesce(p_admission_date, today), class_id = p_class where id = app;
  perform set_config('app.admitting', '', true);
  return stu;
end $$;

-- seats and demand per class
create or replace function public.admission_seats(sid uuid, sess uuid) returns table (class_id uuid, seats int, active_students bigint, approved bigint, waitlisted bigint, applications bigint)
language sql stable set search_path = public as $$
  select c.id, c.seats,
         (select count(*) from public.students s where s.class_id = c.id and s.status = 'active'),
         (select count(*) from public.admission_applications a where a.class_id = c.id and a.session_id = sess and a.status = 'approved'),
         (select count(*) from public.admission_applications a where a.class_id = c.id and a.session_id = sess and a.status = 'waitlisted'),
         (select count(*) from public.admission_applications a where a.class_id = c.id and a.session_id = sess and a.status not in ('cancelled'))
    from public.classes c where c.school_id = sid order by c.sort;
$$;

-- ═════════════════════════ Audit coverage and masking (extends 0008) ═════════════════════════
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
        n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
        diff jsonb := '{}'; k text; sid uuid;
        masked text[] := case tg_table_name
          when 'students' then array['portal_token','notes','address','permanent_address','street','email','alt_phone','guardian_phone','mobile','blood_group']
          when 'guardians' then array['phone','occupation']
          when 'student_sensitive' then array['allergies','medical_conditions','medication','disability','accommodations','doctor_name','doctor_phone','internal_notes','identity_note','aadhaar_enc','aadhaar_last4']
          when 'student_documents' then array['file_path','file_name']
          when 'application_documents' then array['file_path','file_name']
          when 'admission_applications' then array['form','phone']
          when 'staff' then array['pan','uan','bank_account','ifsc','bank_name','address','phone','email']
          else array[]::text[] end;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','marked_at') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, case when k = any(masked) then jsonb_build_array('•', '•') else jsonb_build_array(o -> k, n -> k) end);
      end if;
    end loop;
    if diff = '{}' then return new; end if;
  end if;
  sid := coalesce((coalesce(n, o) ->> 'school_id')::uuid, case when tg_table_name = 'schools' then (coalesce(n, o) ->> 'id')::uuid end);
  perform public.log_event(lower(tg_op), sid, tg_table_name, coalesce(coalesce(n, o) ->> 'id', coalesce(n, o) ->> 'student_id'),
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', diff)
         when tg_op = 'DELETE' then jsonb_build_object('row', o - masked)
         else jsonb_build_object('row', n - masked) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['admission_applications','application_documents','student_prior_exams','student_board_subjects','classes'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- new permission keys for schools that already exist (only adds what is missing)
insert into public.role_permissions (role_id, perm_key, scope)
select r.id, t.perm_key, t.scope
  from public.roles r
  join public.role_template_permissions t on t.template_code = r.template_code
 where t.perm_key like 'frontdesk.admissions.%'
on conflict (role_id, perm_key) do nothing;

-- Helpers that only other (security definer) functions and triggers call: not exposed to the API.
-- (A security-definer function with no permission check is callable by anyone with the API key.)
revoke execute on function public.build_board_snapshot(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.open_enrolment(public.students) from public, anon, authenticated;
revoke execute on function public.lwp_days(uuid, date, date) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 9: (a) public online admission form for parents, (b) Documents & templates:
--         school-editable templates (TC, bonafide, character, study, ID cards, letters …),
--         versioned, rendered in the database and issued with numbers; bulk ID cards.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═════════════════════════ (a) Online admission ═════════════════════════
create table if not exists public.online_admission_settings (
  school_id      uuid primary key references public.schools(id) on delete cascade,
  enabled        boolean not null default false,
  class_ids      uuid[] not null default '{}',          -- classes open for online applications (empty = all)
  intro          text,
  instructions   text,
  fee_note       text,
  closes_on      date,
  ask_documents  boolean not null default true,
  updated_by     uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);
drop trigger if exists online_admission_settings_touch on public.online_admission_settings;
create trigger online_admission_settings_touch before update on public.online_admission_settings for each row execute function public.touch_row();

-- abuse control for the public form / status lookup (no policies: only the functions touch it)
create table if not exists public.online_submissions (
  id         bigint generated always as identity primary key,
  school_id  uuid not null references public.schools(id) on delete cascade,
  kind       text not null default 'apply' check (kind in ('apply','status')),
  ip_hash    text,
  phone      text,
  application_id uuid references public.admission_applications(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists online_submissions_idx on public.online_submissions (school_id, kind, created_at desc);

alter table public.online_admission_settings enable row level security;
alter table public.online_submissions enable row level security;
drop policy if exists "read" on public.online_admission_settings;
create policy "read" on public.online_admission_settings for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.online_form.view'));
drop policy if exists "write" on public.online_admission_settings;
create policy "write" on public.online_admission_settings for all to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.online_form.edit')) with check (public.has_perm_school(school_id, 'frontdesk.online_form.edit'));

-- the numbering / duplicate / enquiry logic of 0010 as an internal function, so staff and the public form share it
create or replace function public.create_application_core(sid uuid, p_class uuid, p_enquiry uuid, p_form jsonb, p_rte boolean, p_rte_ref text, p_source text, p_session uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare sess uuid := coalesce(p_session, (select id from public.sessions where school_id = sid and is_current limit 1));
        sname text; n int; num text; nm text; dup text; aid uuid; f jsonb := coalesce(p_form, '{}'::jsonb);
begin
  if coalesce(btrim(f ->> 'first_name'), '') = '' then raise exception 'The student''s first name is required.'; end if;
  if p_class is not null and not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Class not found.'; end if;
  if p_enquiry is not null and not exists (select 1 from public.enquiries where id = p_enquiry and school_id = sid) then raise exception 'Enquiry not found.'; end if;
  nm := btrim(concat_ws(' ', f ->> 'first_name', f ->> 'middle_name', f ->> 'last_name'));
  select application_no into dup from public.admission_applications
   where school_id = sid and session_id is not distinct from sess and status not in ('cancelled','rejected')
     and lower(applicant_name) = lower(nm) and coalesce(form ->> 'dob', '') = coalesce(f ->> 'dob', '') and coalesce(lower(father_name), '') = coalesce(lower(f ->> 'father_name'), '')
   limit 1;
  if dup is not null and coalesce((f ->> 'allow_duplicate')::boolean, false) is not true then
    raise exception 'An application for the same student already exists (no. %).', dup;
  end if;
  select coalesce((select name from public.sessions where id = sess), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, 'application', sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1 returning next_no - 1 into n;
  num := 'APP/' || sname || '/' || lpad(n::text, 4, '0');
  insert into public.admission_applications (school_id, application_no, session_id, class_id, enquiry_id, applicant_name, father_name, phone, form, rte_applicant, rte_reference, source)
  values (sid, num, sess, p_class, p_enquiry, nm, nullif(btrim(f ->> 'father_name'), ''), nullif(btrim(f ->> 'guardian_phone'), ''), f - 'allow_duplicate', coalesce(p_rte, false),
          nullif(btrim(coalesce(p_rte_ref, '')), ''), nullif(btrim(coalesce(p_source, '')), ''))
  returning id into aid;
  if p_enquiry is not null then update public.enquiries set status = case when status in ('new','contacted','visited') then 'test' else status end where id = p_enquiry and school_id = sid; end if;
  return aid;
end $$;
revoke execute on function public.create_application_core(uuid, uuid, uuid, jsonb, boolean, text, text, uuid) from public, anon, authenticated;

create or replace function public.create_application(sid uuid, p_class uuid, p_enquiry uuid, p_form jsonb, p_rte boolean default false,
                                                     p_rte_ref text default null, p_source text default null, p_session uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.create') then raise exception 'not allowed'; end if;
  return public.create_application_core(sid, p_class, p_enquiry, p_form, p_rte, p_rte_ref, p_source, p_session);
end $$;

-- called only by the app server with the secret key
create or replace function public.public_create_application(p_code text, p_class uuid, p_form jsonb, p_rte boolean, p_ip_hash text)
returns json language plpgsql security definer set search_path = public as $$
declare sid uuid; st record; aid uuid; no text; ph text := nullif(regexp_replace(coalesce(p_form ->> 'guardian_phone', ''), '\D', '', 'g'), '');
begin
  select id into sid from public.schools where code = lower(btrim(p_code)) and archived_at is null;
  if sid is null then raise exception 'School not found.'; end if;
  select * into st from public.online_admission_settings where school_id = sid;
  if st.school_id is null or not st.enabled then raise exception 'Online admission is not open for this school.'; end if;
  if st.closes_on is not null and st.closes_on < public.today_ist() then raise exception 'Online admission closed on %.', to_char(st.closes_on, 'DD Mon YYYY'); end if;
  if cardinality(st.class_ids) > 0 and not (p_class = any(st.class_ids)) then raise exception 'That class is not open for online admission.'; end if;
  if not public.school_writable(sid) then raise exception 'This school is not accepting applications right now.'; end if;
  if ph is null or ph !~ '^(91)?[6-9][0-9]{9}$' then raise exception 'A valid 10-digit parent mobile number is required.'; end if;
  if (select count(*) from public.online_submissions where school_id = sid and kind = 'apply' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many forms from this network. Please try again in an hour.';
  end if;
  if (select count(*) from public.online_submissions where school_id = sid and kind = 'apply' and phone = right(ph, 10) and created_at > now() - interval '1 day') >= 4 then
    raise exception 'This mobile number has already submitted several forms today.';
  end if;
  aid := public.create_application_core(sid, p_class, null, p_form, p_rte, null, 'Online', null);
  insert into public.online_submissions (school_id, kind, ip_hash, phone, application_id) values (sid, 'apply', p_ip_hash, right(ph, 10), aid);
  select application_no into no from public.admission_applications where id = aid;
  return json_build_object('id', aid, 'application_no', no, 'school_id', sid);
end $$;
revoke execute on function public.public_create_application(text, uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.public_create_application(text, uuid, jsonb, boolean, text) to service_role;

-- parents track their application with the application number + the mobile number they gave
create or replace function public.public_application_status(p_code text, p_no text, p_phone text, p_ip_hash text)
returns json language plpgsql security definer set search_path = public as $$
declare sid uuid; a record; ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); docs json;
begin
  select id into sid from public.schools where code = lower(btrim(p_code));
  if sid is null then return null; end if;
  if (select count(*) from public.online_submissions where school_id = sid and kind = 'status' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many lookups. Please try again later.';
  end if;
  insert into public.online_submissions (school_id, kind, ip_hash) values (sid, 'status', p_ip_hash);
  select * into a from public.admission_applications where school_id = sid and upper(application_no) = upper(btrim(p_no));
  if a.id is null or ph !~ '^[6-9][0-9]{9}$' or right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) <> ph then return null; end if;
  select coalesce(json_agg(json_build_object('doc_type', doc_type, 'status', status, 'due_by', due_by, 'reason', reject_reason)), '[]'::json) into docs
    from public.application_documents where application_id = a.id;
  return json_build_object('application_no', a.application_no, 'name', a.applicant_name, 'status', a.status, 'applied_on', a.applied_on,
    'class', (select name from public.classes where id = a.class_id), 'test_on', a.test_on, 'interview_on', a.interview_on, 'waitlist_no', a.waitlist_no,
    'decision_note', case when a.status = 'rejected' then null else a.decision_note end, 'documents', docs, 'school', (select name from public.schools where id = sid));
end $$;
revoke execute on function public.public_application_status(text, text, text, text) from public, anon, authenticated;
grant execute on function public.public_application_status(text, text, text, text) to service_role;

-- ═════════════════════════ (b) Documents & templates ═════════════════════════
create or replace function public.sanitize_template_html(h text) returns text
language plpgsql immutable as $$
begin
  h := coalesce(h, '');
  h := regexp_replace(h, '<\s*(script|iframe|object|embed|style|link|meta|base|form|input|button|textarea|svg|math)\y[^>]*>.*?<\s*/\s*\1\s*>', '', 'gis');
  h := regexp_replace(h, '<\s*/?\s*(script|iframe|object|embed|style|link|meta|base|form|input|button|textarea|svg|math)\y[^>]*>', '', 'gi');
  h := regexp_replace(h, '\son[a-z]+\s*=\s*("[^"]*"|''[^'']*''|[^\s>]+)', '', 'gi');
  h := regexp_replace(h, 'javascript\s*:', '', 'gi');
  h := regexp_replace(h, 'vbscript\s*:', '', 'gi');
  h := regexp_replace(h, 'expression\s*\(', '', 'gi');
  h := regexp_replace(h, '@import', '', 'gi');
  return h;
end $$;

create table if not exists public.document_templates (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  code            text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  name            text not null check (length(btrim(name)) > 0),
  category        text not null default 'certificate' check (category in ('certificate','id_card','letter','other')),
  audience        text not null default 'student' check (audience in ('student','staff')),
  body_html       text not null default '',
  page_size       text not null default 'A4' check (page_size in ('A4','A5','card')),
  orientation     text not null default 'portrait' check (orientation in ('portrait','landscape')),
  card_width_mm   int check (card_width_mm is null or card_width_mm between 30 and 300),
  card_height_mm  int check (card_height_mm is null or card_height_mm between 30 and 300),
  numbering_prefix text not null default 'DOC' check (numbering_prefix ~ '^[A-Za-z0-9]{1,8}$'),
  on_issue        text not null default 'none' check (on_issue in ('none','mark_transferred')),
  one_per_student boolean not null default false,
  valid_days      int check (valid_days is null or valid_days between 1 and 3650),
  fields          jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),   -- [{key,label,type text|date|number,required}]
  active          boolean not null default true,
  is_system       boolean not null default false,
  version         int not null default 1,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (school_id, code)
);

create table if not exists public.document_template_versions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.document_templates(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  version     int not null,
  name        text,
  body_html   text not null,
  fields      jsonb not null default '[]',
  changed_by  uuid default auth.uid() references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now(),
  unique (template_id, version)
);

create or replace function public.template_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body_html := public.sanitize_template_html(new.body_html);
  if tg_op = 'UPDATE' then
    if new.body_html is distinct from old.body_html or new.fields is distinct from old.fields then new.version := old.version + 1; else new.version := old.version; end if;
    new.updated_at := now();
    new.code := old.code; new.school_id := old.school_id;
  end if;
  return new;
end $$;
drop trigger if exists document_templates_guard on public.document_templates;
create trigger document_templates_guard before insert or update on public.document_templates for each row execute function public.template_guard();

create or replace function public.template_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    insert into public.document_template_versions (template_id, school_id, version, name, body_html, fields, changed_by)
    values (new.id, new.school_id, new.version, new.name, new.body_html, new.fields, auth.uid()) on conflict (template_id, version) do nothing;
  end if;
  return null;
end $$;
drop trigger if exists document_templates_version on public.document_templates;
create trigger document_templates_version after insert or update on public.document_templates for each row execute function public.template_version_log();

create table if not exists public.issued_documents (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  template_id      uuid references public.document_templates(id) on delete set null,
  template_code    text not null,
  template_name    text not null,
  template_version int not null,
  category         text not null,
  audience         text not null,
  student_id       uuid references public.students(id) on delete cascade,
  staff_id         uuid references public.staff(id) on delete cascade,
  doc_no           text not null,
  issued_on        date not null default public.today_ist(),
  valid_until      date,
  is_duplicate     boolean not null default false,
  data             jsonb not null default '{}',
  html             text not null,
  page_size        text not null default 'A4',
  orientation      text not null default 'portrait',
  card_width_mm    int,
  card_height_mm   int,
  status           text not null default 'issued' check (status in ('issued','cancelled')),
  cancelled_reason text,
  cancelled_at     timestamptz,
  cancelled_by     uuid references auth.users(id) on delete set null,
  issued_by        uuid default auth.uid() references auth.users(id) on delete set null,
  issued_by_name   text,
  created_at       timestamptz not null default now(),
  unique (school_id, doc_no),
  check (num_nonnulls(student_id, staff_id) = 1)
);
create index if not exists issued_documents_student_idx on public.issued_documents (school_id, student_id);
create index if not exists issued_documents_template_idx on public.issued_documents (school_id, template_code, created_at desc);

-- small SQL helpers for rendering
create or replace function public.number_words(n int) returns text
language plpgsql immutable as $$
declare o text[] := array['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
        t text[] := array['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
begin
  if n < 20 then return o[n + 1]; end if;
  if n < 100 then return t[n / 10 + 1] || case when n % 10 > 0 then '-' || o[n % 10 + 1] else '' end; end if;
  if n < 1000 then return o[n / 100 + 1] || ' Hundred' || case when n % 100 > 0 then ' ' || public.number_words(n % 100) else '' end; end if;
  return public.number_words(n / 1000) || ' Thousand' || case when n % 1000 > 0 then ' ' || public.number_words(n % 1000) else '' end;
end $$;

create or replace function public.date_words(d date) returns text
language sql immutable as $$
  select case when d is null then '' else
    to_char(d, 'DD/MM/YYYY') || ' (' ||
    (array['First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth','Eleventh','Twelfth','Thirteenth','Fourteenth','Fifteenth','Sixteenth','Seventeenth','Eighteenth','Nineteenth','Twentieth',
           'Twenty-first','Twenty-second','Twenty-third','Twenty-fourth','Twenty-fifth','Twenty-sixth','Twenty-seventh','Twenty-eighth','Twenty-ninth','Thirtieth','Thirty-first'])[extract(day from d)::int]
    || ' ' || trim(to_char(d, 'Month')) || ', ' || public.number_words(extract(year from d)::int) || ')' end;
$$;

create or replace function public.html_escape(t text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

-- {{a.b}} → value (HTML-escaped). Special: {{student.photo}} and {{school.logo}} become <img> tags.
create or replace function public.render_document(body text, data jsonb) returns text
language plpgsql immutable as $$
declare out text := regexp_replace(coalesce(body, ''), '\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}', '{{\1}}', 'g'); k text; v text;
begin
  for k in select distinct t.m[1] from regexp_matches(out, '\{\{([a-zA-Z0-9_.]+)\}\}', 'g') as t(m) loop
    v := data #>> string_to_array(k, '.');
    if k = 'student.photo' then
      out := replace(out, '{{' || k || '}}', '<img class="doc-photo" data-photo="1" src="" alt="Photograph" style="width:100%;height:100%;object-fit:cover">');
    elsif k = 'school.logo' then
      out := replace(out, '{{' || k || '}}', case when v ~* '^https://' then '<img class="doc-logo" src="' || public.html_escape(v) || '" alt="Logo" style="width:100%;height:100%;object-fit:contain">' else '' end);
    else
      out := replace(out, '{{' || k || '}}', public.html_escape(v));
    end if;
  end loop;
  return out;
end $$;

-- the data a template can use (built on the server from the records, never from the browser)
create or replace function public.document_data(sid uuid, stu uuid, stf uuid, doc_no text, on_day date, valid_until date, p_extra jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; w record; sc record; sess record; owed numeric; d jsonb;
begin
  select * into sc from public.schools where id = sid;
  select name, start_date, end_date into sess from public.sessions where school_id = sid and is_current limit 1;
  d := jsonb_build_object(
    'school', jsonb_build_object('name', sc.name, 'address', sc.address, 'city', sc.city, 'state', sc.state, 'pincode', sc.pincode, 'phone', sc.phone, 'email', sc.email,
      'board', sc.board, 'affiliation_no', sc.affiliation_no, 'udise_code', sc.udise_code, 'principal_name', sc.principal_name, 'logo', sc.logo_url),
    'doc', jsonb_build_object('no', doc_no, 'date', to_char(on_day, 'DD/MM/YYYY'), 'session', sess.name, 'valid_until', case when valid_until is null then '' else to_char(valid_until, 'DD/MM/YYYY') end),
    'extra', coalesce(p_extra, '{}'::jsonb));
  if stu is not null then
    select st.*, c.name as cname, sec.name as sname, ac.name as acname,
           ss.apaar_id as apaar, ss.apaar_status as apaar_status
      into s from public.students st
      left join public.classes c on c.id = st.class_id left join public.sections sec on sec.id = st.section_id
      left join public.classes ac on ac.id = st.admission_class_id left join public.student_sensitive ss on ss.student_id = st.id
     where st.id = stu and st.school_id = sid;
    if s.id is null then raise exception 'Student not found.'; end if;
    select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into owed from public.fee_dues where student_id = stu and school_id = sid;
    d := d || jsonb_build_object(
      'student', jsonb_build_object(
        'name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)), 'first_name', s.first_name, 'last_name', s.last_name, 'name_hi', s.name_hi,
        'admission_no', s.admission_no, 'roll_no', s.roll_no, 'class', s.cname, 'section', s.sname, 'class_section', s.cname || coalesce('-' || s.sname, ''),
        'father_name', s.father_name, 'father_name_hi', s.father_name_hi, 'mother_name', s.mother_name, 'mother_name_hi', s.mother_name_hi,
        'dob', to_char(s.dob, 'DD/MM/YYYY'), 'dob_words', public.date_words(s.dob),
        'gender', case s.gender when 'M' then 'Male' when 'F' then 'Female' when 'O' then 'Other' else '' end,
        'son_daughter', case s.gender when 'F' then 'daughter' when 'M' then 'son' else 'ward' end,
        'he_she', case s.gender when 'F' then 'she' when 'M' then 'he' else 'the student' end,
        'his_her', case s.gender when 'F' then 'her' when 'M' then 'his' else 'the' end,
        'category', s.category, 'religion', s.religion, 'caste', s.caste, 'nationality', coalesce(s.nationality, 'Indian'), 'blood_group', s.blood_group,
        'address', btrim(concat_ws(', ', s.street, s.address, s.city, s.post_office, s.block_tehsil, s.district, s.state, s.pincode)), 'permanent_address', s.permanent_address,
        'phone', s.guardian_phone, 'guardian_phone', s.guardian_phone, 'mobile', s.mobile, 'email', s.email,
        'admission_date', to_char(s.admission_date, 'DD/MM/YYYY'), 'admission_class', s.acname,
        'apaar_id', case when s.apaar_status in ('generated','verified') then s.apaar else null end,
        'tc_no', s.tc_no,
        'transport_route', (select r.name from public.transport_allocations a join public.transport_routes r on r.id = a.route_id where a.student_id = stu and a.end_date is null limit 1),
        'transport_stop', (select p.name from public.transport_allocations a join public.transport_stops p on p.id = a.stop_id where a.student_id = stu and a.end_date is null limit 1)),
      'dues', jsonb_build_object('outstanding', owed, 'text', case when owed > 0 then 'Rs. ' || owed::text || ' outstanding' else 'All dues cleared' end));
  end if;
  if stf is not null then
    select * into w from public.staff where id = stf and school_id = sid;
    if w.id is null then raise exception 'Staff member not found.'; end if;
    d := d || jsonb_build_object('staff', jsonb_build_object('name', w.name, 'designation', w.designation, 'department', w.department, 'emp_code', w.emp_code,
        'phone', w.phone, 'email', w.email, 'joining_date', to_char(w.joining_date, 'DD/MM/YYYY'), 'leaving_date', to_char(w.leaving_date, 'DD/MM/YYYY'),
        'qualification', w.qualification, 'dob', to_char(w.dob, 'DD/MM/YYYY')));
  end if;
  return d;
end $$;
revoke execute on function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;

-- issue one document
create or replace function public.issue_document(sid uuid, tpl uuid, stu uuid, stf uuid, p_issued_on date, p_extra jsonb default '{}', p_mark_left boolean default false, p_by text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t record; sname text; n int; num text; on_day date := coalesce(p_issued_on, public.today_ist()); valid date; dup boolean := coalesce((p_extra ->> 'duplicate')::boolean, false);
        prev text; d jsonb; html text; allowed text[]; k text; ex jsonb := '{}'; cid uuid; st record;
begin
  if not public.has_perm_school(sid, 'documents.issue.create') then raise exception 'not allowed'; end if;
  select * into t from public.document_templates where id = tpl and school_id = sid;
  if t.id is null then raise exception 'Template not found.'; end if;
  if not t.active then raise exception 'This template is switched off.'; end if;
  if (t.audience = 'student' and (stu is null or stf is not null)) or (t.audience = 'staff' and (stf is null or stu is not null)) then
    raise exception 'This template is for % only.', t.audience;
  end if;
  if on_day > public.today_ist() then raise exception 'The issue date cannot be in the future.'; end if;
  -- only the fields the template declares (plus a few standard ones) are accepted from the form
  allowed := array['reason','remarks','last_exam','result','promotion','conduct','working_days','days_present','left_on']
             || coalesce((select array_agg(f ->> 'key') from jsonb_array_elements(t.fields) f), '{}');
  for k in select jsonb_object_keys(coalesce(p_extra, '{}'::jsonb)) loop
    if k = any(allowed) then ex := ex || jsonb_build_object(k, left(coalesce(p_extra ->> k, ''), 300)); end if;
  end loop;
  -- required custom fields
  for k in select f ->> 'key' from jsonb_array_elements(t.fields) f where coalesce((f ->> 'required')::boolean, false) loop
    if coalesce(btrim(ex ->> k), '') = '' then raise exception 'Fill in: %.', coalesce((select f ->> 'label' from jsonb_array_elements(t.fields) f where f ->> 'key' = k limit 1), k); end if;
  end loop;

  if t.one_per_student then
    select doc_no into prev from public.issued_documents
     where school_id = sid and template_code = t.code and status = 'issued' and not is_duplicate and student_id is not distinct from stu and staff_id is not distinct from stf order by created_at limit 1;
    if prev is not null and not dup then raise exception 'Already issued (no. %). Tick "Duplicate copy" to issue another.', prev; end if;
    if prev is null then dup := false; end if;
  else
    dup := false;
  end if;

  select coalesce((select name from public.sessions where school_id = sid and is_current limit 1), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, 'doc:' || t.code, sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1 returning next_no - 1 into n;
  num := t.numbering_prefix || '/' || sname || '/' || lpad(n::text, 4, '0') || case when dup then '-D' else '' end;
  valid := case when t.valid_days is not null then on_day + t.valid_days else null end;
  if valid is null and t.category = 'id_card' then valid := (select end_date from public.sessions where school_id = sid and is_current limit 1); end if;

  d := public.document_data(sid, stu, stf, num, on_day, valid, ex);
  html := public.render_document(t.body_html, d);

  insert into public.issued_documents (school_id, template_id, template_code, template_name, template_version, category, audience, student_id, staff_id, doc_no, issued_on, valid_until,
      is_duplicate, data, html, page_size, orientation, card_width_mm, card_height_mm, issued_by_name)
  values (sid, t.id, t.code, t.name, t.version, t.category, t.audience, stu, stf, num, on_day, valid, dup, d, html, t.page_size, t.orientation, t.card_width_mm, t.card_height_mm, p_by)
  returning id into cid;

  if t.on_issue = 'mark_transferred' and stu is not null then
    select status into st from public.students where id = stu;
    if p_mark_left and st.status = 'active' then
      update public.students set status = 'transferred', left_on = coalesce(nullif(ex ->> 'left_on', '')::date, on_day),
             left_reason = coalesce(nullif(ex ->> 'reason', ''), 'Transfer certificate issued'), tc_no = num, tc_issued_on = on_day where id = stu;
    elsif not dup then
      update public.students set tc_no = num, tc_issued_on = on_day where id = stu;
    end if;
  end if;
  return cid;
end $$;

-- ID cards etc. for a whole class / section / all staff in one go (skips people who already have a live one)
create or replace function public.issue_documents_bulk(sid uuid, tpl uuid, p_class uuid, p_section uuid, p_by text default null)
returns int language plpgsql security definer set search_path = public as $$
declare t record; r record; cnt int := 0;
begin
  if not public.has_perm_school(sid, 'documents.issue.create') then raise exception 'not allowed'; end if;
  select * into t from public.document_templates where id = tpl and school_id = sid and active;
  if t.id is null then raise exception 'Template not found.'; end if;
  if t.one_per_student then raise exception 'Documents of this type are issued one by one (they need a reason or details).'; end if;
  if t.audience = 'student' then
    if p_class is null then raise exception 'Choose the class.'; end if;
    for r in select s.id from public.students s where s.school_id = sid and s.status = 'active' and s.class_id = p_class and (p_section is null or s.section_id = p_section)
              and not exists (select 1 from public.issued_documents i where i.template_code = t.code and i.student_id = s.id and i.status = 'issued')
              order by s.roll_no nulls last, s.first_name limit 3000 loop
      perform public.issue_document(sid, tpl, r.id, null, null, '{}', false, p_by); cnt := cnt + 1;
    end loop;
  else
    for r in select w.id from public.staff w where w.school_id = sid and w.status = 'active'
              and not exists (select 1 from public.issued_documents i where i.template_code = t.code and i.staff_id = w.id and i.status = 'issued')
              order by w.name limit 3000 loop
      perform public.issue_document(sid, tpl, null, r.id, null, '{}', false, p_by); cnt := cnt + 1;
    end loop;
  end if;
  return cnt;
end $$;

create or replace function public.preview_document(tpl uuid, stu uuid, stf uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.document_templates where id = tpl;
  if t.id is null or not (public.has_perm_school(t.school_id, 'documents.templates.view') or public.has_perm_school(t.school_id, 'documents.issue.create')) then raise exception 'not allowed'; end if;
  return public.render_document(t.body_html, public.document_data(t.school_id, stu, stf, 'PREVIEW', public.today_ist(), null,
         (select coalesce(jsonb_object_agg(f ->> 'key', '[' || (f ->> 'label') || ']'), '{}'::jsonb) from jsonb_array_elements(t.fields) f)
         || jsonb_build_object('reason', '[reason]', 'remarks', '[remarks]', 'last_exam', '[last exam]', 'result', '[result]', 'promotion', '[promotion]', 'conduct', 'Good',
                               'working_days', '[days]', 'days_present', '[days]', 'left_on', to_char(public.today_ist(), 'DD/MM/YYYY'))));
end $$;

create or replace function public.cancel_issued_document(did uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.issued_documents where id = did;
  if d.id is null then raise exception 'Document not found.'; end if;
  if not public.has_perm_school(d.school_id, 'documents.issue.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason for cancelling.'; end if;
  if d.status = 'cancelled' then raise exception 'Already cancelled.'; end if;
  update public.issued_documents set status = 'cancelled', cancelled_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid() where id = did;
end $$;

alter table public.document_templates enable row level security;
alter table public.document_template_versions enable row level security;
alter table public.issued_documents enable row level security;
drop policy if exists "read" on public.document_templates;
create policy "read" on public.document_templates for select to authenticated
  using (public.has_perm_school(school_id, 'documents.templates.view') or public.has_perm_school(school_id, 'documents.issue.view') or public.has_perm_school(school_id, 'documents.issue.create'));
drop policy if exists "create" on public.document_templates;
create policy "create" on public.document_templates for insert to authenticated with check (public.has_perm_school(school_id, 'documents.templates.create'));
drop policy if exists "edit" on public.document_templates;
create policy "edit" on public.document_templates for update to authenticated
  using (public.has_perm_school(school_id, 'documents.templates.edit')) with check (public.has_perm_school(school_id, 'documents.templates.edit'));
drop policy if exists "delete" on public.document_templates;
create policy "delete" on public.document_templates for delete to authenticated using (public.has_perm_school(school_id, 'documents.templates.delete') and not is_system);
drop policy if exists "read" on public.document_template_versions;
create policy "read" on public.document_template_versions for select to authenticated using (public.has_perm_school(school_id, 'documents.templates.view'));
drop policy if exists "read" on public.issued_documents;
create policy "read" on public.issued_documents for select to authenticated using (public.has_perm_school(school_id, 'documents.issue.view'));
-- issued only through issue_document() / issue_documents_bulk(); cancelled only through cancel_issued_document()

-- ───────────── default templates ─────────────
create or replace function public.seed_templates_internal(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; hdr text := $h$<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px"><div style="width:60px;height:60px;margin:0 auto 4px">{{school.logo}}</div><div style="font-size:22px;font-weight:800;text-transform:uppercase">{{school.name}}</div><div style="font-size:12px">{{school.address}}, {{school.city}} {{school.pincode}}</div><div style="font-size:12px">{{school.board}} · Aff. No. {{school.affiliation_no}} · UDISE {{school.udise_code}} · {{school.phone}}</div></div>$h$;
        ftr text := $f$<div style="display:flex;justify-content:space-between;margin-top:70px;font-size:13px"><span>Prepared by</span><span style="text-align:center">Principal<br><small>(signature &amp; school seal)</small></span></div>$f$;
begin
  insert into public.document_templates (school_id, code, name, category, audience, body_html, numbering_prefix, on_issue, one_per_student, fields, is_system) values
  (sid, 'transfer_certificate', 'Transfer certificate (TC)', 'certificate', 'student',
   '<div style="font-size:14px;line-height:1.7">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:14px 0">Transfer Certificate</h2>
<table style="width:100%;border-collapse:collapse;font-size:13.5px">
<tr><td style="border:1px solid #000;padding:4px 8px;width:40px">1</td><td style="border:1px solid #000;padding:4px 8px;width:42%">Name of the student</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.name}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">2</td><td style="border:1px solid #000;padding:4px 8px">Admission no.</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.admission_no}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">3</td><td style="border:1px solid #000;padding:4px 8px">Father's / guardian's name</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.father_name}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">4</td><td style="border:1px solid #000;padding:4px 8px">Mother's name</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.mother_name}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">5</td><td style="border:1px solid #000;padding:4px 8px">Nationality / category</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.nationality}} / {{student.category}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">6</td><td style="border:1px solid #000;padding:4px 8px">Date of birth (as per school record)</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.dob_words}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">7</td><td style="border:1px solid #000;padding:4px 8px">Date of admission / class at admission</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.admission_date}} / {{student.admission_class}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">8</td><td style="border:1px solid #000;padding:4px 8px">Class in which last studied</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.class_section}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">9</td><td style="border:1px solid #000;padding:4px 8px">Last examination passed / result</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.last_exam}} {{extra.result}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">10</td><td style="border:1px solid #000;padding:4px 8px">Whether qualified for promotion</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.promotion}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">11</td><td style="border:1px solid #000;padding:4px 8px">Fee dues</td><td style="border:1px solid #000;padding:4px 8px"><b>{{dues.text}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">12</td><td style="border:1px solid #000;padding:4px 8px">Date of leaving / reason</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.left_on}} — {{extra.reason}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">13</td><td style="border:1px solid #000;padding:4px 8px">Working days / days present</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.working_days}} / {{extra.days_present}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">14</td><td style="border:1px solid #000;padding:4px 8px">General conduct</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.conduct}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">15</td><td style="border:1px solid #000;padding:4px 8px">APAAR ID / remarks</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.apaar_id}} {{extra.remarks}}</b></td></tr>
</table>$b$ || ftr || '</div>', 'TC', 'mark_transferred', true,
   '[{"key":"last_exam","label":"Last examination passed","type":"text"},{"key":"result","label":"Result","type":"text"},{"key":"promotion","label":"Promotion","type":"text"},{"key":"reason","label":"Reason for leaving","type":"text","required":true},{"key":"left_on","label":"Date of leaving","type":"date"},{"key":"working_days","label":"Working days","type":"number"},{"key":"days_present","label":"Days present","type":"number"},{"key":"conduct","label":"Conduct","type":"text"},{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true),
  (sid, 'bonafide_certificate', 'Bonafide certificate', 'certificate', 'student',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">Bonafide Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b>, is a bonafide student of this school, studying in Class <b>{{student.class_section}}</b> in the session <b>{{doc.session}}</b> (Admission no. {{student.admission_no}}). As per the school record {{student.his_her}} date of birth is <b>{{student.dob_words}}</b>. {{extra.remarks}}</p>$b$ || ftr || '</div>', 'BC', 'none', false,
   '[{"key":"remarks","label":"Purpose / remarks","type":"text"}]'::jsonb, true),
  (sid, 'character_certificate', 'Character certificate', 'certificate', 'student',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">Character Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b> (Admission no. {{student.admission_no}}) has been a student of this school since {{student.admission_date}} and is studying in Class <b>{{student.class_section}}</b>. To the best of my knowledge {{student.he_she}} bears a <b>{{extra.conduct}}</b> moral character and {{student.his_her}} conduct has been <b>{{extra.conduct}}</b>. {{extra.remarks}}</p>$b$ || ftr || '</div>', 'CC', 'none', false,
   '[{"key":"conduct","label":"Conduct","type":"text"},{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true),
  (sid, 'study_certificate', 'Study certificate', 'certificate', 'student',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">Study Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b> (Admission no. {{student.admission_no}}) is studying in Class <b>{{student.class_section}}</b> of this school in the session <b>{{doc.session}}</b>. {{extra.remarks}}</p>$b$ || ftr || '</div>', 'SC', 'none', false,
   '[{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true),
  (sid, 'no_dues_certificate', 'No-dues certificate', 'certificate', 'student',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">No Dues Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b> (Admission no. {{student.admission_no}}, Class {{student.class_section}}) — school fee status on {{doc.date}}: <b>{{dues.text}}</b>. {{extra.remarks}}</p>$b$ || ftr || '</div>', 'ND', 'none', false,
   '[{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true),
  (sid, 'admission_letter', 'Admission confirmation letter', 'letter', 'student',
   '<div style="font-size:15px;line-height:1.9">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>Ref.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<p>To,<br>{{student.father_name}}<br>{{student.address}}</p>
<p><b>Subject: Confirmation of admission</b></p>
<p style="text-align:justify">Dear Parent, we are pleased to confirm the admission of <b>{{student.name}}</b> to Class <b>{{student.class_section}}</b> for the session <b>{{doc.session}}</b>. Admission no.: <b>{{student.admission_no}}</b>. Please complete the formalities and fee payment as advised by the school office.</p>$b$ || ftr || '</div>', 'AL', 'none', false, '[]'::jsonb, true),
  (sid, 'student_id_card', 'Student ID card', 'id_card', 'student',
   $c$<div style="width:86mm;height:54mm;box-sizing:border-box;border:1px solid #1e3a8a;border-radius:6px;overflow:hidden;font-family:Arial,sans-serif;font-size:9px;line-height:1.35;color:#111;background:#fff">
<div style="background:#1e3a8a;color:#fff;padding:3px 6px;display:flex;align-items:center;gap:6px"><div style="width:9mm;height:9mm;background:#fff;border-radius:3px">{{school.logo}}</div><div><div style="font-size:11px;font-weight:700">{{school.name}}</div><div style="font-size:7.5px">{{school.city}} · {{school.phone}}</div></div></div>
<div style="display:flex;gap:6px;padding:5px 6px"><div style="width:20mm;height:25mm;border:1px solid #999;flex:none">{{student.photo}}</div>
<div style="flex:1"><div style="font-size:11px;font-weight:700">{{student.name}}</div>
<div>Class: <b>{{student.class_section}}</b> · Roll: <b>{{student.roll_no}}</b></div><div>Adm. no.: <b>{{student.admission_no}}</b></div><div>S/D of: {{student.father_name}}</div><div>DOB: {{student.dob}} · Blood: {{student.blood_group}}</div><div>Ph: {{student.phone}}</div></div></div>
<div style="display:flex;justify-content:space-between;padding:0 6px;font-size:7.5px"><span>Valid upto: {{doc.valid_until}}</span><span>Principal</span></div></div>$c$,
   'ID', 'none', false, '[]'::jsonb, true),
  (sid, 'staff_id_card', 'Staff ID card', 'id_card', 'staff',
   $c$<div style="width:86mm;height:54mm;box-sizing:border-box;border:1px solid #14532d;border-radius:6px;overflow:hidden;font-family:Arial,sans-serif;font-size:9px;line-height:1.4;color:#111;background:#fff">
<div style="background:#14532d;color:#fff;padding:3px 6px;display:flex;align-items:center;gap:6px"><div style="width:9mm;height:9mm;background:#fff;border-radius:3px">{{school.logo}}</div><div><div style="font-size:11px;font-weight:700">{{school.name}}</div><div style="font-size:7.5px">{{school.city}} · {{school.phone}}</div></div></div>
<div style="padding:8px 8px"><div style="font-size:12px;font-weight:700">{{staff.name}}</div><div>{{staff.designation}} · {{staff.department}}</div><div>Emp. code: <b>{{staff.emp_code}}</b></div><div>Phone: {{staff.phone}}</div><div>Joined: {{staff.joining_date}}</div></div>
<div style="display:flex;justify-content:space-between;padding:0 8px;font-size:7.5px"><span>Valid upto: {{doc.valid_until}}</span><span>Principal</span></div></div>$c$,
   'SID', 'none', false, '[]'::jsonb, true),
  (sid, 'experience_certificate', 'Experience certificate (staff)', 'certificate', 'staff',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">Experience Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{staff.name}}</b> worked in this school as <b>{{staff.designation}}</b> ({{staff.department}}) from <b>{{staff.joining_date}}</b> to <b>{{staff.leaving_date}}</b>. {{extra.remarks}} We wish {{staff.name}} all the best.</p>$b$ || ftr || '</div>', 'EXP', 'none', true,
   '[{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true)
  on conflict (school_id, code) do nothing;
  get diagnostics cnt = row_count;
  update public.document_templates set page_size = 'card', card_width_mm = 86, card_height_mm = 54, valid_days = null
   where school_id = sid and code in ('student_id_card', 'staff_id_card') and card_width_mm is null;
  return cnt;
end $$;
revoke execute on function public.seed_templates_internal(uuid) from public, anon, authenticated;

create or replace function public.seed_document_templates(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'documents.templates.create') then raise exception 'not allowed'; end if;
  return public.seed_templates_internal(sid);
end $$;

create or replace function public.seed_templates_on_school() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.seed_templates_internal(new.id); return null; end $$;
drop trigger if exists schools_seed_templates on public.schools;
create trigger schools_seed_templates after insert on public.schools for each row execute function public.seed_templates_on_school();

select public.seed_templates_internal(id) from public.schools;

-- every plan includes the new module
update public.plans set modules = array_append(modules, 'documents') where not ('documents' = any(modules));
insert into public.school_modules (school_id, module_code, licensed, enabled)
select s.id, 'documents', true, true from public.schools s on conflict do nothing;

-- audit
do $$
declare t text;
begin
  foreach t in array array['online_admission_settings','document_templates','issued_documents'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- new permission keys for schools that already exist
insert into public.role_permissions (role_id, perm_key, scope)
select r.id, t.perm_key, t.scope
  from public.roles r
  join public.role_template_permissions t on t.template_code = r.template_code
 where t.perm_key like 'documents.%' or t.perm_key like 'frontdesk.online_form.%'
on conflict (role_id, perm_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 10: Fees 2.0 — every way a school manages fees.
--   billing   : deposit heads, ad-hoc charges, due-date extension, waiver, amount change, arrears carry-forward
--   concession: categories, approval workflow, validity window
--   late fine : school rule (per day / per month / flat, grace, cap), automatic, waivable
--   collection: choose instalments, split modes, cheques, advance / wallet, day-end closing
--   cheques   : register with deposit / clear / bounce
--   refunds   : request → approve → pay (wallet, deposits, withdrawal)
--   online    : orders + automatic receipt on payment (Razorpay, school's own account)
--   reports   : collection by day / head / class / mode / collector, ageing
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Settings ─────────────
create table if not exists public.fee_settings (
  school_id            uuid primary key references public.schools(id) on delete cascade,
  fine_enabled         boolean not null default false,
  fine_mode            text not null default 'per_day' check (fine_mode in ('per_day','per_month','flat')),
  fine_amount          numeric(10,2) not null default 0 check (fine_amount >= 0),
  fine_grace_days      int not null default 0 check (fine_grace_days >= 0),
  fine_cap             numeric(10,2) not null default 0 check (fine_cap >= 0),     -- 0 = no cap
  concession_approval  boolean not null default false,    -- requests by staff wait for the principal
  advance_allowed      boolean not null default true,     -- take more than is due (kept as a wallet balance)
  bounce_charge        numeric(10,2) not null default 0 check (bounce_charge >= 0),
  online_enabled       boolean not null default false,
  online_min_amount    numeric(10,2) not null default 1 check (online_min_amount >= 0),
  online_allow_partial boolean not null default true,
  receipt_footer       text,
  updated_by           uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at           timestamptz not null default now()
);
drop trigger if exists fee_settings_touch on public.fee_settings;
create trigger fee_settings_touch before update on public.fee_settings for each row execute function public.touch_row();

-- ───────────── Column additions ─────────────
alter table public.fee_heads add column if not exists kind text not null default 'regular' check (kind in ('regular','deposit','other'));
alter table public.fee_heads add column if not exists active boolean not null default true;

alter table public.fee_dues add column if not exists fine_auto numeric(10,2) not null default 0 check (fine_auto >= 0);
alter table public.fee_dues add column if not exists fine_waived numeric(10,2) not null default 0 check (fine_waived >= 0);
alter table public.fee_dues add column if not exists kind text not null default 'plan' check (kind in ('plan','charge','arrears','bounce'));
alter table public.fee_dues add column if not exists note text;
alter table public.fee_dues add column if not exists original_due_date date;

alter table public.student_concessions
  add column if not exists category text not null default 'other' check (category in ('rte','staff_ward','sibling','merit','sports','hardship','other')),
  add column if not exists status text not null default 'approved' check (status in ('pending','approved','rejected')),
  add column if not exists requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  add column if not exists decided_by uuid references auth.users(id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists created_at timestamptz not null default now();

alter table public.fee_receipts drop constraint if exists fee_receipts_mode_check;
alter table public.fee_receipts add constraint fee_receipts_mode_check check (mode in ('cash','upi','cheque','bank_transfer','card','online','mixed','wallet'));
alter table public.fee_receipts add column if not exists advance_amount numeric(10,2) not null default 0 check (advance_amount >= 0);
alter table public.fee_receipts add column if not exists wallet_used numeric(10,2) not null default 0 check (wallet_used >= 0);
alter table public.fee_receipts drop constraint if exists fee_receipts_amount_check;
alter table public.fee_receipts add constraint fee_receipts_amount_check check (amount >= 0);

-- ───────────── Money trail tables ─────────────
create table if not exists public.fee_receipt_payments (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  receipt_id uuid not null references public.fee_receipts(id) on delete cascade,
  mode       text not null check (mode in ('cash','upi','cheque','bank_transfer','card','online')),
  amount     numeric(10,2) not null check (amount > 0),
  reference  text
);
create index if not exists fee_receipt_payments_receipt_idx on public.fee_receipt_payments (receipt_id);
-- receipts made before this step get one payment row each
insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount, reference)
select r.school_id, r.id, r.mode, r.amount, r.reference from public.fee_receipts r
 where r.mode in ('cash','upi','cheque','bank_transfer','card','online') and r.amount > 0
   and not exists (select 1 from public.fee_receipt_payments p where p.receipt_id = r.id);

create table if not exists public.fee_wallet_entries (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind       text not null check (kind in ('advance','applied','reversal','refund','adjust')),
  amount     numeric(10,2) not null check (amount <> 0),     -- + credit / − debit
  receipt_id uuid references public.fee_receipts(id) on delete set null,
  note       text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists fee_wallet_student_idx on public.fee_wallet_entries (student_id);

create table if not exists public.fee_cheques (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  receipt_id   uuid not null references public.fee_receipts(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  cheque_no    text not null,
  bank         text,
  cheque_date  date,
  amount       numeric(10,2) not null check (amount > 0),
  status       text not null default 'received' check (status in ('received','deposited','cleared','bounced')),
  deposited_on date, cleared_on date, bounced_on date,
  bounce_reason text,
  bounce_charge numeric(10,2) not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists fee_cheques_status_idx on public.fee_cheques (school_id, status);

create table if not exists public.fee_adjustments (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  due_id     uuid references public.fee_dues(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind       text not null check (kind in ('reversal','waiver','carried','extension','amount_change','fine_waiver')),
  amount     numeric(10,2) not null default 0,
  old_value  text, new_value text,
  reason     text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists fee_adjustments_due_idx on public.fee_adjustments (due_id);

create table if not exists public.fee_refunds (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  amount       numeric(10,2) not null check (amount > 0),
  reason       text not null,
  status       text not null default 'requested' check (status in ('requested','approved','paid','rejected')),
  mode         text check (mode in ('cash','upi','cheque','bank_transfer')),
  reference    text,
  requested_by uuid default auth.uid() references auth.users(id) on delete set null,
  requested_by_name text,
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  decision_note text,
  paid_on      date,
  created_at   timestamptz not null default now()
);
create index if not exists fee_refunds_idx on public.fee_refunds (school_id, status);

create table if not exists public.fee_day_close (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  day           date not null,
  collector     text not null,
  expected_cash numeric(12,2) not null,
  counted_cash  numeric(12,2) not null,
  difference    numeric(12,2) generated always as (counted_cash - expected_cash) stored,
  note          text,
  closed_by     uuid default auth.uid() references auth.users(id) on delete set null,
  closed_at     timestamptz not null default now(),
  unique (school_id, day, collector)
);

create table if not exists public.fee_online_orders (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  amount      numeric(10,2) not null check (amount > 0),
  status      text not null default 'created' check (status in ('created','paid','failed','expired','cancelled')),
  provider    text not null default 'razorpay',
  link_id     text,
  link_url    text,
  payment_id  text,
  due_ids     uuid[],
  receipt_id  uuid references public.fee_receipts(id) on delete set null,
  error       text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create unique index if not exists fee_online_orders_payment on public.fee_online_orders (school_id, payment_id) where payment_id is not null;
create unique index if not exists fee_online_orders_link on public.fee_online_orders (link_id) where link_id is not null;
create index if not exists fee_online_orders_idx on public.fee_online_orders (school_id, status, created_at desc);

-- ───────────── recalc: reversals reduce what was paid ─────────────
create or replace function public.recalc_due(did uuid) returns void
language sql security definer set search_path = public as $$
  update public.fee_dues d set paid = greatest(coalesce((
      select sum(l.amount) from public.fee_receipt_lines l join public.fee_receipts r on r.id = l.receipt_id
       where l.due_id = did and not r.cancelled), 0)
    - coalesce((select sum(a.amount) from public.fee_adjustments a where a.due_id = did and a.kind = 'reversal'), 0), 0)
  where d.id = did;
$$;
revoke execute on function public.recalc_due(uuid) from public, anon, authenticated;

create or replace function public.wallet_balance(stu uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.fee_wallet_entries
   where student_id = stu and (public.can_student(school_id, 'fees.collection.view', student_id) or public.is_service());
$$;

-- ───────────── Concessions: approval workflow + only approved ones are billed ─────────────
create or replace function public.concession_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare need boolean; actor boolean := auth.uid() is not null and not public.is_service();
begin
  if tg_op = 'INSERT' then
    select coalesce(concession_approval, false) into need from public.fee_settings where school_id = new.school_id;
    if actor and coalesce(need, false) and not public.has_perm_school(new.school_id, 'fees.concessions.approve') then
      new.status := 'pending'; new.decided_by := null; new.decided_at := null;
    elsif new.status = 'approved' then new.decided_by := auth.uid(); new.decided_at := now();
    end if;
    if new.status = 'rejected' then new.status := 'pending'; end if;
  elsif new.status is distinct from old.status then
    if actor and not public.has_perm_school(new.school_id, 'fees.concessions.approve') then raise exception 'Only the principal can approve or reject concessions.'; end if;
    new.decided_by := auth.uid(); new.decided_at := now();
  end if;
  if new.valid_from is not null and new.valid_to is not null and new.valid_to < new.valid_from then raise exception 'The end date is before the start date.'; end if;
  return new;
end $$;
drop trigger if exists student_concessions_guard on public.student_concessions;
create trigger student_concessions_guard before insert or update on public.student_concessions for each row execute function public.concession_guard();

drop policy if exists "edit" on public.student_concessions;
create policy "edit" on public.student_concessions for update to authenticated
  using (public.has_perm_school(school_id, 'fees.concessions.approve')) with check (public.has_perm_school(school_id, 'fees.concessions.approve'));

-- the concession on one instalment, from approved concessions valid on its due date
create or replace function public.concession_for(stu uuid, head uuid, amt numeric, due date) returns numeric
language sql stable security definer set search_path = public as $$
  select least(amt, coalesce(sum(case when c.kind = 'percent' then amt * c.value / 100 else c.value end), 0))
    from public.student_concessions c
   where c.student_id = stu and c.status = 'approved' and (c.fee_head_id is null or c.fee_head_id = head)
     and (c.valid_from is null or c.valid_from <= due) and (c.valid_to is null or c.valid_to >= due);
$$;
revoke execute on function public.concession_for(uuid, uuid, numeric, date) from public, anon, authenticated;

create or replace function public.generate_dues(sid uuid, sess uuid, cls uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         public.concession_for(s.id, p.fee_head_id, p.amount, p.due_date)
  from public.fee_plans p
  join public.fee_heads h on h.id = p.fee_head_id
  join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.status = 'active'
  where p.school_id = sid and p.session_id = sess and (cls is null or p.class_id = cls)
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

create or replace function public.bill_student_dues(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int; sess uuid;
begin
  select id into sess from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then return 0; end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         public.concession_for(s.id, p.fee_head_id, p.amount, p.due_date)
    from public.fee_plans p
    join public.fee_heads h on h.id = p.fee_head_id
    join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.id = stu and s.status = 'active'
   where p.school_id = sid and p.session_id = sess
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.bill_student_dues(uuid, uuid) from public, anon, authenticated;

create or replace function public.generate_transport_dues(sid uuid, sess uuid, p_label text, p_due date, p_months numeric default 1) returns int
language plpgsql security definer set search_path = public as $$
declare head uuid; cnt int; k text;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(trim(p_label), '') = '' or p_due is null then raise exception 'Label and due date are required.'; end if;
  if p_months is null or p_months <= 0 or p_months > 12 then raise exception 'Months must be between 1 and 12.'; end if;
  if not exists (select 1 from public.sessions where id = sess and school_id = sid) then raise exception 'Session not found.'; end if;
  select id into head from public.fee_heads where school_id = sid and name = 'Transport Fee';
  if head is null then insert into public.fee_heads (school_id, name, sort) values (sid, 'Transport Fee', 50) returning id into head; end if;
  k := 'transport:' || sess || ':' || lower(trim(p_label));
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, source_key)
  select sid, sess, x.student_id, head, 'Transport Fee · ' || trim(p_label), p_due, x.amt, public.concession_for(x.student_id, head, x.amt, p_due), k
    from (select a.student_id, round(coalesce(a.monthly_fee, st.monthly_fee) * p_months, 2) as amt
            from public.transport_allocations a
            join public.transport_stops st on st.id = a.stop_id
            join public.students s on s.id = a.student_id and s.status = 'active'
           where a.school_id = sid and a.session_id = sess and a.start_date <= p_due and (a.end_date is null or a.end_date >= p_due)) x
   where x.amt > 0
  on conflict (student_id, source_key) where source_key is not null do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- recompute concessions on a student's unpaid instalments (waivers / carried amounts are kept)
create or replace function public.reapply_concessions(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not (public.has_perm_school(sid, 'fees.concessions.create') or public.has_perm_school(sid, 'fees.concessions.approve')) then raise exception 'not allowed'; end if;
  update public.fee_dues d
     set concession = least(d.amount, public.concession_for(d.student_id, d.fee_head_id, d.amount, d.due_date)
                         + coalesce((select sum(a.amount) from public.fee_adjustments a where a.due_id = d.id and a.kind in ('waiver','carried')), 0))
   where d.student_id = stu and d.school_id = sid and d.status <> 'paid' and d.kind = 'plan';
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ───────────── Late fine ─────────────
create or replace function public.apply_late_fines_core(sid uuid, stu uuid, on_day date) returns int
language plpgsql security definer set search_path = public as $$
declare st record; cnt int := 0;
begin
  select * into st from public.fee_settings where school_id = sid;
  if st.school_id is null or not st.fine_enabled or st.fine_amount <= 0 then return 0; end if;
  with calc as (
    select d.id, d.fine_auto, d.fine_waived,
           greatest(on_day - d.due_date - st.fine_grace_days, 0) as late
      from public.fee_dues d
     where d.school_id = sid and d.status <> 'paid' and d.kind in ('plan','charge') and d.due_date < on_day and (stu is null or d.student_id = stu)
  ), amt as (
    select id, fine_auto,
           greatest(case when late <= 0 then 0
                         when st.fine_mode = 'per_day' then late * st.fine_amount
                         when st.fine_mode = 'per_month' then ceil(late / 30.0) * st.fine_amount
                         else st.fine_amount end, 0) as raw, fine_waived
      from calc
  ), capped as (
    select id, fine_auto, greatest(least(case when st.fine_cap > 0 then least(raw, st.fine_cap) else raw end, raw) - fine_waived, 0) as want from amt
  ), up as (
    update public.fee_dues d set fine = d.fine - d.fine_auto + c.want, fine_auto = c.want
      from capped c where d.id = c.id and c.want > c.fine_auto returning d.id
  )
  select count(*) into cnt from up;
  return cnt;
end $$;
revoke execute on function public.apply_late_fines_core(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.apply_late_fines(sid uuid, on_day date default null) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  return public.apply_late_fines_core(sid, null, coalesce(on_day, public.today_ist()));
end $$;

-- run by the daily job (service role only)
create or replace function public.apply_late_fines_all(on_day date default null) returns int
language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  for s in select school_id from public.fee_settings where fine_enabled loop
    n := n + public.apply_late_fines_core(s.school_id, null, coalesce(on_day, public.today_ist()));
  end loop;
  return n;
end $$;
revoke execute on function public.apply_late_fines_all(date) from public, anon, authenticated;
grant execute on function public.apply_late_fines_all(date) to service_role;

-- ───────────── Waive / adjust / extend / charge / carry forward ─────────────
create or replace function public.waive_due(did uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.fee_dues where id = did;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.concessions.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount to waive.'; end if;
  if p_amount > greatest(d.amount - d.concession + d.fine - d.paid, 0) then raise exception 'You can waive at most the unpaid balance (%).', greatest(d.amount - d.concession + d.fine - d.paid, 0); end if;
  update public.fee_dues set concession = concession + p_amount where id = did;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, reason, created_by_name) values (d.school_id, did, d.student_id, 'waiver', p_amount, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
end $$;

create or replace function public.waive_fine(did uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record; take numeric;
begin
  select * into d from public.fee_dues where id = did;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.concessions.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  take := least(coalesce(p_amount, d.fine), d.fine, greatest(d.amount - d.concession + d.fine - d.paid, 0));
  if take is null or take <= 0 then raise exception 'There is no unpaid fine on this instalment.'; end if;
  update public.fee_dues set fine = fine - take, fine_auto = greatest(fine_auto - take, 0), fine_waived = fine_waived + take where id = did;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, reason, created_by_name) values (d.school_id, did, d.student_id, 'fine_waiver', take, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
end $$;

create or replace function public.adjust_due_amount(did uuid, p_new numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.fee_dues where id = did;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_new is null or p_new < 0 then raise exception 'Enter the new amount.'; end if;
  if p_new - d.concession + d.fine < d.paid then raise exception 'The new amount is less than what has already been paid (%).', d.paid; end if;
  update public.fee_dues set amount = p_new, concession = least(concession, p_new) where id = did;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, old_value, new_value, reason, created_by_name)
  values (d.school_id, did, d.student_id, 'amount_change', p_new - d.amount, d.amount::text, p_new::text, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
end $$;

create or replace function public.extend_dues(sid uuid, p_ids uuid[], p_date date, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; d record;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_date is null then raise exception 'Choose the new due date.'; end if;
  for d in select * from public.fee_dues where school_id = sid and id = any(p_ids) and status <> 'paid' loop
    update public.fee_dues set original_due_date = coalesce(original_due_date, due_date), due_date = p_date where id = d.id;
    insert into public.fee_adjustments (school_id, due_id, student_id, kind, old_value, new_value, reason, created_by_name)
    values (sid, d.id, d.student_id, 'extension', d.due_date::text, p_date::text, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

-- one charge to chosen students, or to a whole class / section
create or replace function public.add_charge(sid uuid, sess uuid, p_students uuid[], p_class uuid, p_section uuid, p_head uuid, p_label text, p_due date, p_amount numeric)
returns int language plpgsql security definer set search_path = public as $$
declare cnt int; k text := 'charge:' || gen_random_uuid()::text; hn text;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_label), '') = '' or p_due is null then raise exception 'Label and due date are required.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  if not exists (select 1 from public.sessions where id = sess and school_id = sid) then raise exception 'Session not found.'; end if;
  if p_head is not null and not exists (select 1 from public.fee_heads where id = p_head and school_id = sid) then raise exception 'Fee head not found.'; end if;
  if coalesce(cardinality(p_students), 0) = 0 and p_class is null then raise exception 'Choose students or a class.'; end if;
  select name into hn from public.fee_heads where id = p_head;
  insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, kind, source_key)
  select sid, sess, s.id, p_head, case when hn is null then btrim(p_label) else hn || ' · ' || btrim(p_label) end, p_due, p_amount, 'charge', k
    from public.students s
   where s.school_id = sid and s.status = 'active'
     and ((coalesce(cardinality(p_students), 0) > 0 and s.id = any(p_students))
          or (coalesce(cardinality(p_students), 0) = 0 and s.class_id = p_class and (p_section is null or s.section_id = p_section)));
  get diagnostics cnt = row_count;
  return cnt;
end $$;

create or replace function public.carry_forward_dues(sid uuid, from_sess uuid, to_sess uuid, p_due date) returns int
language plpgsql security definer set search_path = public as $$
declare r record; cnt int := 0; fname text;
begin
  if not public.has_perm_school(sid, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if from_sess = to_sess then raise exception 'Choose two different sessions.'; end if;
  if not exists (select 1 from public.sessions where id = from_sess and school_id = sid) or not exists (select 1 from public.sessions where id = to_sess and school_id = sid) then raise exception 'Session not found.'; end if;
  select name into fname from public.sessions where id = from_sess;
  for r in
    select d.student_id, sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) as bal
      from public.fee_dues d join public.students s on s.id = d.student_id
     where d.school_id = sid and d.session_id = from_sess and d.status <> 'paid' and s.status = 'active'
     group by d.student_id having sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) > 0
  loop
    insert into public.fee_dues (school_id, session_id, student_id, label, due_date, amount, kind, source_key)
    values (sid, to_sess, r.student_id, 'Arrears of ' || fname, p_due, r.bal, 'arrears', 'arrears:' || from_sess)
    on conflict (student_id, source_key) where source_key is not null do nothing;
    if found then
      insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, reason, created_by_name)
        select sid, d.id, d.student_id, 'carried', greatest(d.amount - d.concession + d.fine - d.paid, 0), 'Carried forward to ' || (select name from public.sessions where id = to_sess), coalesce(auth.jwt() ->> 'email', '')
          from public.fee_dues d where d.student_id = r.student_id and d.session_id = from_sess and d.school_id = sid and d.status <> 'paid';
      update public.fee_dues d set concession = concession + greatest(d.amount - d.concession + d.fine - d.paid, 0)
       where d.student_id = r.student_id and d.session_id = from_sess and d.school_id = sid and d.status <> 'paid';
      cnt := cnt + 1;
    end if;
  end loop;
  return cnt;
end $$;

-- ───────────── Collection ─────────────
-- Core (no permission check): used by the desk function and by the online-payment completion.
create or replace function public.collect_fee_core(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[], p_wallet_use numeric, p_paid_on date, p_note text, p_by text,
                                                   p_fine numeric, p_force_advance boolean, p_online_order uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st record; sp jsonb; rid uuid; rno text; money numeric := 0; wuse numeric := coalesce(p_wallet_use, 0); bal numeric; wallet numeric; alloc numeric; excess numeric;
        d record; take numeric; left_amt numeric; modes text[] := '{}'; m text; first_ref text; first_due uuid; pid uuid; any_line boolean := false;
begin
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found'; end if;
  select * into st from public.fee_settings where school_id = sid;
  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    if (sp ->> 'mode') not in ('cash','upi','cheque','bank_transfer','card','online') then raise exception 'Unknown payment mode "%".', sp ->> 'mode'; end if;
    if coalesce((sp ->> 'amount')::numeric, 0) <= 0 then raise exception 'Every payment line needs an amount.'; end if;
    money := money + (sp ->> 'amount')::numeric;
    if not ((sp ->> 'mode') = any(modes)) then modes := modes || (sp ->> 'mode'); end if;
  end loop;
  if money + wuse <= 0 then raise exception 'Amount must be more than zero'; end if;
  if wuse < 0 then raise exception 'Wallet amount cannot be negative.'; end if;
  select coalesce(sum(amount), 0) into wallet from public.fee_wallet_entries where student_id = stu;
  if wuse > wallet then raise exception 'The wallet has only % — use less.', wallet; end if;

  -- automatic late fine up to the payment date, then an optional manual fine
  perform public.apply_late_fines_core(sid, stu, coalesce(p_paid_on, public.today_ist()));
  if coalesce(p_fine, 0) > 0 then
    select id into first_due from public.fee_dues where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or id = any(p_due_ids)) order by due_date, label limit 1;
    if first_due is null then raise exception 'No unpaid instalment to add the fine to'; end if;
    update public.fee_dues set fine = fine + p_fine where id = first_due;
  end if;

  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
   where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  excess := greatest(money + wuse - bal, 0);
  if excess > 0 then
    if wuse > 0 and excess > money then raise exception 'The wallet use is more than what is due. Use less.'; end if;
    if not coalesce(st.advance_allowed, true) and not p_force_advance then raise exception 'Amount is more than the total due'; end if;
  end if;
  alloc := money + wuse - excess;

  rno := public.next_school_number_core(sid, 'receipt');
  insert into public.fee_receipts (school_id, receipt_no, student_id, paid_on, mode, reference, amount, note, collected_by, advance_amount, wallet_used, online_order_id)
  values (sid, rno, stu, coalesce(p_paid_on, public.today_ist()),
          case when cardinality(modes) > 1 then 'mixed' when cardinality(modes) = 1 then modes[1] else 'wallet' end,
          nullif(p_splits -> 0 ->> 'reference', ''), alloc, p_note, p_by, excess, wuse, p_online_order)
  returning id into rid;

  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount, reference)
    values (sid, rid, sp ->> 'mode', (sp ->> 'amount')::numeric, nullif(btrim(coalesce(sp ->> 'reference', sp ->> 'cheque_no', '')), '')) returning id into pid;
    if (sp ->> 'mode') = 'cheque' then
      insert into public.fee_cheques (school_id, receipt_id, student_id, cheque_no, bank, cheque_date, amount)
      values (sid, rid, stu, coalesce(nullif(btrim(coalesce(sp ->> 'cheque_no', sp ->> 'reference', '')), ''), 'N/A'), nullif(sp ->> 'bank', ''), nullif(sp ->> 'cheque_date', '')::date, (sp ->> 'amount')::numeric);
    end if;
  end loop;

  left_amt := alloc;
  for d in select id, greatest(amount - concession + fine - paid, 0) as b from public.fee_dues
            where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids))
            order by due_date, label for update loop
    exit when left_amt <= 0;
    take := least(d.b, left_amt);
    if take > 0 then
      insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, d.id, take);
      left_amt := left_amt - take; any_line := true;
    end if;
  end loop;
  if wuse > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'applied', -wuse, rid, 'Used against receipt ' || rno, p_by); end if;
  if excess > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'advance', excess, rid, 'Advance with receipt ' || rno, p_by); end if;
  return rid;
end $$;
revoke execute on function public.collect_fee_core(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric, boolean, uuid) from public, anon, authenticated;

alter table public.fee_receipts add column if not exists online_order_id uuid;

-- number allocator without the permission check (the callers have already checked)
create or replace function public.next_school_number_core(sid uuid, kind text) returns text
language plpgsql security definer set search_path = public as $$
declare n int; p text;
begin
  if kind = 'receipt' then
    update public.schools set next_receipt_no = next_receipt_no + 1 where id = sid returning next_receipt_no - 1, receipt_prefix into n, p;
    return p || lpad(n::text, 5, '0');
  end if;
  raise exception 'unknown kind %', kind;
end $$;
revoke execute on function public.next_school_number_core(uuid, text) from public, anon, authenticated;

create or replace function public.collect_fee_v2(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[] default null, p_wallet_use numeric default 0,
                                                 p_paid_on date default null, p_note text default null, p_by text default null, p_fine numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  return public.collect_fee_core(sid, stu, p_splits, p_due_ids, p_wallet_use, p_paid_on, p_note, p_by, p_fine, false, null);
end $$;

-- the old single-mode entry point keeps working
create or replace function public.collect_fee(sid uuid, stu uuid, amt numeric, p_mode text, p_ref text, p_note text, p_paid_on date, p_fine numeric, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  if amt is null or amt <= 0 then raise exception 'Amount must be more than zero'; end if;
  return public.collect_fee_core(sid, stu, jsonb_build_array(jsonb_build_object('mode', p_mode, 'amount', amt, 'reference', p_ref)), null, 0, p_paid_on, p_note, p_by, p_fine, false, null);
end $$;

-- ───────────── Cheques ─────────────
create or replace function public.set_cheque_status(cid uuid, p_status text, p_day date default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c record; ch numeric; st record; on_day date := coalesce(p_day, public.today_ist());
begin
  select * into c from public.fee_cheques where id = cid;
  if c.id is null then raise exception 'Cheque not found.'; end if;
  if p_status not in ('deposited','cleared','bounced') then raise exception 'Unknown status.'; end if;
  if p_status = 'bounced' then
    if not public.has_perm_school(c.school_id, 'fees.receipts.approve') then raise exception 'Only the principal can mark a cheque bounced.'; end if;
  elsif not public.has_perm_school(c.school_id, 'fees.collection.create') then raise exception 'not allowed';
  end if;
  if c.status in ('cleared','bounced') then raise exception 'This cheque is already %.', c.status; end if;
  if p_status = 'deposited' then
    update public.fee_cheques set status = 'deposited', deposited_on = on_day where id = cid;
  elsif p_status = 'cleared' then
    update public.fee_cheques set status = 'cleared', cleared_on = on_day, deposited_on = coalesce(deposited_on, on_day) where id = cid;
  else
    if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason (insufficient funds, signature…).'; end if;
    select * into st from public.fee_settings where school_id = c.school_id;
    ch := coalesce(st.bounce_charge, 0);
    update public.fee_cheques set status = 'bounced', bounced_on = on_day, bounce_reason = btrim(p_reason), bounce_charge = ch where id = cid;
    -- the receipt's money did not arrive: cancel it (dues come back), and bill the bank charge
    update public.fee_receipts set cancelled = true, cancelled_reason = 'Cheque ' || c.cheque_no || ' bounced: ' || btrim(p_reason) where id = c.receipt_id and not cancelled;
    if ch > 0 then
      insert into public.fee_dues (school_id, session_id, student_id, label, due_date, amount, kind, source_key)
      select c.school_id, coalesce((select session_id from public.fee_dues x join public.fee_receipt_lines l on l.due_id = x.id where l.receipt_id = c.receipt_id limit 1),
                                   (select id from public.sessions where school_id = c.school_id and is_current limit 1)),
             c.student_id, 'Cheque bounce charge · ' || c.cheque_no, on_day, ch, 'bounce', 'bounce:' || c.id
       where exists (select 1 from public.sessions where school_id = c.school_id and is_current)
      on conflict (student_id, source_key) where source_key is not null do nothing;
    end if;
  end if;
end $$;

-- ───────────── Wallet, reversal, refunds ─────────────
create or replace function public.reverse_payment(did uuid, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.fee_dues where id = did;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.refunds.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > d.paid then raise exception 'Enter an amount up to what was paid (%).', d.paid; end if;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, reason, created_by_name) values (d.school_id, did, d.student_id, 'reversal', p_amount, btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
  perform public.recalc_due(did);
  insert into public.fee_wallet_entries (school_id, student_id, kind, amount, note, created_by)
  values (d.school_id, d.student_id, 'reversal', p_amount, 'Payment moved back from "' || d.label || '": ' || btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
end $$;

create or replace function public.request_refund(sid uuid, stu uuid, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare bal numeric; pend numeric; rid uuid;
begin
  if not public.has_perm_school(sid, 'fees.refunds.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  select coalesce(sum(amount), 0) into bal from public.fee_wallet_entries where student_id = stu;
  select coalesce(sum(amount), 0) into pend from public.fee_refunds where student_id = stu and status in ('requested','approved');
  if p_amount > bal - pend then raise exception 'Only % is available in the wallet for refund (move a paid fee back to the wallet first).', greatest(bal - pend, 0); end if;
  insert into public.fee_refunds (school_id, student_id, amount, reason, requested_by_name) values (sid, stu, p_amount, btrim(p_reason), coalesce(auth.jwt() ->> 'email', '')) returning id into rid;
  return rid;
end $$;

create or replace function public.decide_refund(rid uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.fee_refunds where id = rid;
  if r.id is null then raise exception 'Refund not found.'; end if;
  if not public.has_perm_school(r.school_id, 'fees.refunds.approve') then raise exception 'not allowed'; end if;
  if r.status <> 'requested' then raise exception 'This request is already %.', r.status; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Write the reason for rejecting.'; end if;
  update public.fee_refunds set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = rid;
end $$;

create or replace function public.pay_refund(rid uuid, p_mode text, p_ref text, p_paid_on date default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record; bal numeric;
begin
  select * into r from public.fee_refunds where id = rid for update;
  if r.id is null then raise exception 'Refund not found.'; end if;
  if not (public.has_perm_school(r.school_id, 'fees.refunds.approve') or public.has_perm_school(r.school_id, 'fees.refunds.create')) then raise exception 'not allowed'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved refund can be paid (this one is %).', r.status; end if;
  if p_mode not in ('cash','upi','cheque','bank_transfer') then raise exception 'Choose how it was paid.'; end if;
  select coalesce(sum(amount), 0) into bal from public.fee_wallet_entries where student_id = r.student_id;
  if bal < r.amount then raise exception 'The wallet no longer has this amount (%).', bal; end if;
  insert into public.fee_wallet_entries (school_id, student_id, kind, amount, note, created_by) values (r.school_id, r.student_id, 'refund', -r.amount, 'Refund: ' || r.reason, coalesce(auth.jwt() ->> 'email', ''));
  update public.fee_refunds set status = 'paid', mode = p_mode, reference = nullif(btrim(coalesce(p_ref, '')), ''), paid_on = coalesce(p_paid_on, public.today_ist()) where id = rid;
end $$;

-- ───────────── Day-end closing ─────────────
create or replace function public.cash_expected(sid uuid, p_day date, p_collector text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(p.amount) from public.fee_receipt_payments p join public.fee_receipts r on r.id = p.receipt_id
                    where r.school_id = sid and r.paid_on = p_day and not r.cancelled and p.mode = 'cash' and coalesce(r.collected_by, '') = coalesce(p_collector, '')), 0)
       - coalesce((select sum(f.amount) from public.fee_refunds f where f.school_id = sid and f.paid_on = p_day and f.status = 'paid' and f.mode = 'cash'), 0);
$$;
revoke execute on function public.cash_expected(uuid, date, text) from public, anon;

create or replace function public.close_day(sid uuid, p_day date, p_collector text, p_counted numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare exp numeric; cid uuid;
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the cash counted.'; end if;
  if p_day > public.today_ist() then raise exception 'A future day cannot be closed.'; end if;
  exp := public.cash_expected(sid, p_day, p_collector);
  insert into public.fee_day_close (school_id, day, collector, expected_cash, counted_cash, note) values (sid, p_day, coalesce(p_collector, ''), exp, p_counted, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (school_id, day, collector) do update set expected_cash = excluded.expected_cash, counted_cash = excluded.counted_cash, note = excluded.note, closed_by = auth.uid(), closed_at = now()
  returning id into cid;
  return cid;
end $$;

-- ───────────── Online payments (service role) ─────────────
create or replace function public.create_online_order(sid uuid, stu uuid, p_amount numeric, p_due_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare st record; bal numeric; oid uuid;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into st from public.fee_settings where school_id = sid;
  if st.school_id is null or not st.online_enabled then raise exception 'Online payment is not switched on for this school.'; end if;
  if not public.school_writable(sid) then raise exception 'This school cannot take payments right now.'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid and status = 'active') then raise exception 'Student not found.'; end if;
  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
   where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  if bal <= 0 then raise exception 'Nothing is due.'; end if;
  if p_amount is null or p_amount < st.online_min_amount then raise exception 'The minimum online payment is %.', st.online_min_amount; end if;
  if p_amount > bal then raise exception 'The amount is more than what is due (%).', bal; end if;
  if not st.online_allow_partial and p_amount < bal then raise exception 'Please pay the full amount due (%).', bal; end if;
  update public.fee_online_orders set status = 'expired' where student_id = stu and status = 'created' and created_at < now() - interval '2 days';
  insert into public.fee_online_orders (school_id, student_id, amount, due_ids) values (sid, stu, p_amount, nullif(p_due_ids, '{}')) returning id into oid;
  return oid;
end $$;
revoke execute on function public.create_online_order(uuid, uuid, numeric, uuid[]) from public, anon, authenticated;
grant execute on function public.create_online_order(uuid, uuid, numeric, uuid[]) to service_role;

create or replace function public.complete_online_order(p_link text, p_payment text, p_paise bigint) returns json
language plpgsql security definer set search_path = public as $$
declare o record; rid uuid; rno text;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into o from public.fee_online_orders where link_id = p_link for update;
  if o.id is null then return json_build_object('ok', false, 'note', 'no matching order'); end if;
  if o.status = 'paid' then return json_build_object('ok', true, 'note', 'already recorded', 'receipt_id', o.receipt_id); end if;
  if p_payment is not null and exists (select 1 from public.fee_online_orders where school_id = o.school_id and payment_id = p_payment) then
    return json_build_object('ok', true, 'note', 'payment already recorded');
  end if;
  if p_paise is not null and p_paise <> round(o.amount * 100) then
    update public.fee_online_orders set status = 'failed', error = 'Amount mismatch: paid ' || (p_paise / 100.0)::text where id = o.id;
    return json_build_object('ok', false, 'note', 'amount mismatch');
  end if;
  rid := public.collect_fee_core(o.school_id, o.student_id, jsonb_build_array(jsonb_build_object('mode', 'online', 'amount', o.amount, 'reference', p_payment)),
                                 o.due_ids, 0, public.today_ist(), 'Paid online', 'Online payment', 0, true, o.id);
  update public.fee_online_orders set status = 'paid', payment_id = p_payment, receipt_id = rid, paid_at = now() where id = o.id;
  select receipt_no into rno from public.fee_receipts where id = rid;
  return json_build_object('ok', true, 'receipt_id', rid, 'receipt_no', rno);
end $$;
revoke execute on function public.complete_online_order(text, text, bigint) from public, anon, authenticated;
grant execute on function public.complete_online_order(text, text, bigint) to service_role;

-- ───────────── Reports (RLS applies: staff see only what they may) ─────────────
create or replace function public.fee_report(sid uuid, d1 date, d2 date, by text) returns table (key text, label text, receipts bigint, amount numeric)
language plpgsql stable set search_path = public as $$
begin
  if by = 'day' then
    return query select r.paid_on::text, to_char(r.paid_on, 'DD Mon YYYY'), count(*)::bigint, sum(r.amount) from public.fee_receipts r
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by r.paid_on order by r.paid_on;
  elsif by = 'month' then
    return query select to_char(r.paid_on, 'YYYY-MM'), to_char(r.paid_on, 'Mon YYYY'), count(*)::bigint, sum(r.amount) from public.fee_receipts r
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by 1, 2 order by 1;
  elsif by = 'collector' then
    return query select coalesce(r.collected_by, '—'), coalesce(r.collected_by, '—'), count(*)::bigint, sum(r.amount) from public.fee_receipts r
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by 1 order by 4 desc;
  elsif by = 'mode' then
    return query select p.mode, p.mode, count(distinct p.receipt_id)::bigint, sum(p.amount) from public.fee_receipt_payments p join public.fee_receipts r on r.id = p.receipt_id
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by p.mode order by 4 desc;
  elsif by = 'head' then
    return query select coalesce(h.id::text, 'other'), coalesce(h.name, 'Other charges'), count(distinct l.receipt_id)::bigint, sum(l.amount)
      from public.fee_receipt_lines l join public.fee_receipts r on r.id = l.receipt_id join public.fee_dues d on d.id = l.due_id left join public.fee_heads h on h.id = d.fee_head_id
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by 1, 2 order by 4 desc;
  elsif by = 'class' then
    return query select coalesce(c.id::text, 'none'), coalesce('Class ' || c.name, 'No class'), count(distinct r.id)::bigint, sum(r.amount)
      from public.fee_receipts r join public.students s on s.id = r.student_id left join public.classes c on c.id = s.class_id
      where r.school_id = sid and not r.cancelled and r.paid_on between d1 and d2 group by 1, 2, c.sort order by c.sort nulls last;
  else
    raise exception 'Unknown grouping.';
  end if;
end $$;

create or replace function public.fee_aging(sid uuid, sess uuid, on_day date default null) returns table (bucket text, students bigint, amount numeric)
language sql stable set search_path = public as $$
  with b as (
    select d.student_id, greatest(d.amount - d.concession + d.fine - d.paid, 0) as bal,
           case when d.due_date >= coalesce(on_day, public.today_ist()) then '0 · Not yet due'
                when coalesce(on_day, public.today_ist()) - d.due_date <= 30 then '1 · 1–30 days'
                when coalesce(on_day, public.today_ist()) - d.due_date <= 60 then '2 · 31–60 days'
                when coalesce(on_day, public.today_ist()) - d.due_date <= 90 then '3 · 61–90 days'
                else '4 · Over 90 days' end as bucket
      from public.fee_dues d join public.students s on s.id = d.student_id
     where d.school_id = sid and d.session_id = sess and d.status <> 'paid' and s.status = 'active')
  select bucket, count(distinct student_id)::bigint, sum(bal) from b where bal > 0 group by bucket order by bucket;
$$;

-- Money columns of a due change only through the functions above (they run as the owner, not as the signed-in role).
create or replace function public.guard_fee_due() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.amount is distinct from old.amount or new.concession is distinct from old.concession or new.fine is distinct from old.fine
    or new.paid is distinct from old.paid or new.fine_auto is distinct from old.fine_auto or new.fine_waived is distinct from old.fine_waived
    or new.due_date is distinct from old.due_date or new.kind is distinct from old.kind) then
    raise exception 'Fee amounts change only through the fee screens (adjust, waive, extend, concession).';
  end if;
  return new;
end $$;
drop trigger if exists fee_dues_guard on public.fee_dues;
create trigger fee_dues_guard before update on public.fee_dues for each row execute function public.guard_fee_due();

-- ───────────── Row Level Security ─────────────
alter table public.fee_settings enable row level security;
alter table public.fee_receipt_payments enable row level security;
alter table public.fee_wallet_entries enable row level security;
alter table public.fee_cheques enable row level security;
alter table public.fee_adjustments enable row level security;
alter table public.fee_refunds enable row level security;
alter table public.fee_day_close enable row level security;
alter table public.fee_online_orders enable row level security;

drop policy if exists "read" on public.fee_settings;
create policy "read" on public.fee_settings for select to authenticated using (public.has_module_perm(school_id, 'fees'));
drop policy if exists "write" on public.fee_settings;
create policy "write" on public.fee_settings for all to authenticated
  using (public.has_perm_school(school_id, 'fees.structure.edit')) with check (public.has_perm_school(school_id, 'fees.structure.edit'));

drop policy if exists "read" on public.fee_receipt_payments;
create policy "read" on public.fee_receipt_payments for select to authenticated using (public.has_perm_school(school_id, 'fees.collection.view') or public.has_perm_school(school_id, 'fees.receipts.view'));
drop policy if exists "read" on public.fee_wallet_entries;
create policy "read" on public.fee_wallet_entries for select to authenticated using (public.can_student(school_id, 'fees.collection.view', student_id));
drop policy if exists "read" on public.fee_cheques;
create policy "read" on public.fee_cheques for select to authenticated using (public.has_perm_school(school_id, 'fees.collection.view'));
drop policy if exists "read" on public.fee_adjustments;
create policy "read" on public.fee_adjustments for select to authenticated using (public.can_student(school_id, 'fees.collection.view', student_id));
drop policy if exists "read" on public.fee_refunds;
create policy "read" on public.fee_refunds for select to authenticated using (public.has_perm_school(school_id, 'fees.refunds.view'));
drop policy if exists "read" on public.fee_day_close;
create policy "read" on public.fee_day_close for select to authenticated using (public.has_perm_school(school_id, 'fees.collection.view'));
drop policy if exists "read" on public.fee_online_orders;
create policy "read" on public.fee_online_orders for select to authenticated using (public.has_perm_school(school_id, 'fees.online.view'));
-- all of these are written only through the functions above

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['fee_settings','fee_refunds','fee_cheques','fee_adjustments','fee_day_close','fee_online_orders','fee_wallet_entries'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- new permission keys for schools that already exist: nothing new (fees.online / fees.refunds were in the catalogue); mark them built

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 11: Admissions & Fees add-ons.
--   admissions: follow-ups, offer validity + lapse, waitlist promotion, bulk test marks / bulk status,
--               pipeline report, sibling detection, fee quote at admission
--   fees      : sibling discount rule, promise-to-pay follow-ups, copy structure (class → classes, session → session),
--               split an instalment, outstanding by class × head, sibling list on the desk
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Settings ─────────────
create table if not exists public.admission_settings (
  school_id               uuid primary key references public.schools(id) on delete cascade,
  offer_days              int not null default 7 check (offer_days between 1 and 90),   -- how long an approval keeps the seat
  auto_sibling_discount   boolean not null default true,                                 -- apply the fee rule when a sibling is admitted
  updated_at              timestamptz not null default now()
);
drop trigger if exists admission_settings_touch on public.admission_settings;
create trigger admission_settings_touch before update on public.admission_settings for each row execute function public.touch_row();
alter table public.admission_settings enable row level security;
drop policy if exists "read" on public.admission_settings;
create policy "read" on public.admission_settings for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.admissions.view'));
drop policy if exists "write" on public.admission_settings;
create policy "write" on public.admission_settings for all to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.admissions.approve')) with check (public.has_perm_school(school_id, 'frontdesk.admissions.approve'));

alter table public.fee_settings add column if not exists sibling_percent numeric(5,2) not null default 0 check (sibling_percent between 0 and 100);
alter table public.fee_settings add column if not exists sibling_head_id uuid references public.fee_heads(id) on delete set null;

alter table public.admission_applications add column if not exists offer_valid_till date;

-- offer validity is stamped when an application is approved
create or replace function public.application_offer() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select offer_days into d from public.admission_settings where school_id = new.school_id;
    new.offer_valid_till := coalesce(new.offer_valid_till, public.today_ist() + coalesce(d, 7));
  elsif new.status <> 'approved' and old.status = 'approved' then
    new.offer_valid_till := null;
  end if;
  return new;
end $$;
drop trigger if exists admission_applications_offer on public.admission_applications;
create trigger admission_applications_offer before update on public.admission_applications for each row execute function public.application_offer();

-- ───────────── Follow-ups (admissions) ─────────────
create table if not exists public.application_followups (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  application_id  uuid references public.admission_applications(id) on delete cascade,
  enquiry_id      uuid references public.enquiries(id) on delete cascade,
  due_on          date not null,
  channel         text not null default 'call' check (channel in ('call','whatsapp','visit','email','sms')),
  note            text,
  outcome         text,
  done            boolean not null default false,
  done_at         timestamptz,
  done_by_name    text,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  check (application_id is not null or enquiry_id is not null)
);
create index if not exists application_followups_idx on public.application_followups (school_id, done, due_on);
alter table public.application_followups enable row level security;
drop policy if exists "read" on public.application_followups;
create policy "read" on public.application_followups for select to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.admissions.view') or public.has_perm_school(school_id, 'frontdesk.enquiries.view'));

create or replace function public.add_followup(sid uuid, p_app uuid, p_enq uuid, p_due date, p_channel text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if not (public.has_perm_school(sid, 'frontdesk.admissions.edit') or public.has_perm_school(sid, 'frontdesk.enquiries.edit')) then raise exception 'not allowed'; end if;
  if p_due is null then raise exception 'Choose the follow-up date.'; end if;
  if p_app is null and p_enq is null then raise exception 'Choose an application or enquiry.'; end if;
  if p_app is not null and not exists (select 1 from public.admission_applications where id = p_app and school_id = sid) then raise exception 'Application not found.'; end if;
  if p_enq is not null and not exists (select 1 from public.enquiries where id = p_enq and school_id = sid) then raise exception 'Enquiry not found.'; end if;
  insert into public.application_followups (school_id, application_id, enquiry_id, due_on, channel, note, created_by_name)
  values (sid, p_app, p_enq, p_due, coalesce(nullif(p_channel, ''), 'call'), nullif(btrim(coalesce(p_note, '')), ''), coalesce(auth.jwt() ->> 'email', ''))
  returning id into fid;
  return fid;
end $$;

create or replace function public.complete_followup(fid uuid, p_outcome text, p_next_due date default null, p_next_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select * into f from public.application_followups where id = fid for update;
  if f.id is null then raise exception 'Follow-up not found.'; end if;
  if not (public.has_perm_school(f.school_id, 'frontdesk.admissions.edit') or public.has_perm_school(f.school_id, 'frontdesk.enquiries.edit')) then raise exception 'not allowed'; end if;
  if f.done then raise exception 'This follow-up is already done.'; end if;
  update public.application_followups set done = true, done_at = now(), outcome = nullif(btrim(coalesce(p_outcome, '')), ''), done_by_name = coalesce(auth.jwt() ->> 'email', '') where id = fid;
  if p_next_due is not null then
    insert into public.application_followups (school_id, application_id, enquiry_id, due_on, channel, note, created_by_name)
    values (f.school_id, f.application_id, f.enquiry_id, p_next_due, f.channel, nullif(btrim(coalesce(p_next_note, '')), ''), coalesce(auth.jwt() ->> 'email', ''));
  end if;
end $$;

-- ───────────── Siblings ─────────────
-- Same parent phone, or same father and mother name, in the same school.
create or replace function public.student_siblings(sid uuid, stu uuid)
returns table (student_id uuid, name text, admission_no text, class_name text, status text, balance numeric)
language sql stable set search_path = public as $$
  select o.id, btrim(concat_ws(' ', o.first_name, o.middle_name, o.last_name)), o.admission_no, c.name, o.status,
         coalesce((select sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) from public.fee_dues d where d.student_id = o.id), 0)
    from public.students s
    join public.students o on o.school_id = s.school_id and o.id <> s.id and o.status = 'active'
    left join public.classes c on c.id = o.class_id
   where s.id = stu and s.school_id = sid
     and ((s.guardian_phone is not null and s.guardian_phone = o.guardian_phone)
       or (s.father_name is not null and s.mother_name is not null and lower(s.father_name) = lower(o.father_name) and lower(s.mother_name) = lower(o.mother_name)))
   order by o.admission_no;
$$;

create or replace function public.application_siblings(app uuid)
returns table (student_id uuid, name text, admission_no text, class_name text)
language sql stable set search_path = public as $$
  select o.id, btrim(concat_ws(' ', o.first_name, o.middle_name, o.last_name)), o.admission_no, c.name
    from public.admission_applications a
    join public.students o on o.school_id = a.school_id and o.status = 'active'
    left join public.classes c on c.id = o.class_id
   where a.id = app
     and ((nullif(a.phone, '') is not null and a.phone = o.guardian_phone)
       or (nullif(a.form ->> 'father_name', '') is not null and nullif(a.form ->> 'mother_name', '') is not null
           and lower(a.form ->> 'father_name') = lower(o.father_name) and lower(a.form ->> 'mother_name') = lower(o.mother_name)))
   order by o.admission_no;
$$;

-- sibling discount: one approved percent concession per student, only when the school has a rule
create or replace function public.sibling_discount_core(sid uuid, stu uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare st record;
begin
  select * into st from public.fee_settings where school_id = sid;
  if st.school_id is null or coalesce(st.sibling_percent, 0) <= 0 then return false; end if;
  if exists (select 1 from public.student_concessions where student_id = stu and category = 'sibling') then return false; end if;
  if not exists (select 1 from public.student_siblings(sid, stu)) then return false; end if;
  insert into public.student_concessions (school_id, student_id, fee_head_id, kind, value, reason, category, status)
  values (sid, stu, st.sibling_head_id, 'percent', st.sibling_percent, 'Sibling discount', 'sibling', 'approved');
  return true;
end $$;
revoke execute on function public.sibling_discount_core(uuid, uuid) from public, anon, authenticated;

create or replace function public.apply_sibling_discount(sid uuid, stu uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare done boolean;
begin
  if not public.has_perm_school(sid, 'fees.concessions.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found.'; end if;
  if not exists (select 1 from public.fee_settings where school_id = sid and sibling_percent > 0) then raise exception 'Set the sibling discount in Fee settings first.'; end if;
  done := public.sibling_discount_core(sid, stu);
  if done then perform public.reapply_concessions(sid, stu); end if;
  return done;
end $$;

-- admission bills the dues; the sibling rule goes first so the concession is on the new dues
create or replace function public.bill_student_dues(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int; sess uuid; auto boolean;
begin
  select id into sess from public.sessions where school_id = sid and is_current limit 1;
  if sess is null then return 0; end if;
  select coalesce(auto_sibling_discount, true) into auto from public.admission_settings where school_id = sid;
  if coalesce(auto, true) then perform public.sibling_discount_core(sid, stu); end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, s.id, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount,
         public.concession_for(s.id, p.fee_head_id, p.amount, p.due_date)
    from public.fee_plans p
    join public.fee_heads h on h.id = p.fee_head_id
    join public.students s on s.class_id = p.class_id and s.school_id = p.school_id and s.id = stu and s.status = 'active'
   where p.school_id = sid and p.session_id = sess
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.bill_student_dues(uuid, uuid) from public, anon, authenticated;

-- ───────────── Admission workflow helpers ─────────────
create or replace function public.lapse_expired_offers(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; r record;
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  for r in select id from public.admission_applications where school_id = sid and status = 'approved' and offer_valid_till < public.today_ist() loop
    update public.admission_applications set status = 'cancelled', decision_note = 'Offer expired — seat released' where id = r.id;
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

create or replace function public.promote_waitlist(sid uuid, cls uuid, sess uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; free int; r record;
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  select s.seats - s.active_students - s.approved into free from public.admission_seats(sid, sess) s where s.class_id = cls and s.seats is not null;
  if free is null then raise exception 'Set the seats for this class first (Settings → Classes).'; end if;
  for r in select id from public.admission_applications where school_id = sid and class_id = cls and session_id = sess and status = 'waitlisted' order by waitlist_no loop
    exit when free <= 0;
    update public.admission_applications set status = 'approved', decision_note = 'Promoted from the waitlist' where id = r.id;
    free := free - 1; cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

-- rows: [{"id": "...", "marks": 41, "max": 50, "test_on": "2026-10-01"}]
create or replace function public.record_test_marks(sid uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; cnt int := 0;
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.edit') then raise exception 'not allowed'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    update public.admission_applications
       set test_marks = nullif(r ->> 'marks', '')::numeric, test_max = coalesce(nullif(r ->> 'max', '')::numeric, test_max),
           test_on = coalesce(nullif(r ->> 'test_on', '')::date, test_on)
     where id = (r ->> 'id')::uuid and school_id = sid and status not in ('admitted', 'cancelled');
    if found then cnt := cnt + 1; end if;
  end loop;
  return cnt;
end $$;

-- returns {"ok": n, "failed": [{"id":..., "error":...}]}
create or replace function public.bulk_application_status(sid uuid, p_ids uuid[], p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i uuid; ok int := 0; bad jsonb := '[]'::jsonb;
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.edit') then raise exception 'not allowed'; end if;
  if p_status not in ('under_review', 'approved', 'waitlisted', 'rejected', 'cancelled') then raise exception 'That status cannot be set in bulk.'; end if;
  foreach i in array coalesce(p_ids, '{}') loop
    begin
      update public.admission_applications set status = p_status, decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
       where id = i and school_id = sid;
      if found then ok := ok + 1; end if;
    exception when others then
      bad := bad || jsonb_build_object('id', i, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', ok, 'failed', bad);
end $$;

-- Pipeline numbers for the admissions dashboard
create or replace function public.admission_pipeline(sid uuid, sess uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.admission_applications where school_id = sid and session_id = sess group by status) x), '{}'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', coalesce(source, 'Unknown'), 'applications', n, 'admitted', adm) order by n desc)
                  from (select source, count(*) n, count(*) filter (where status = 'admitted') adm from public.admission_applications where school_id = sid and session_id = sess group by source) x), '[]'::jsonb),
    'avg_days_to_decision', (select round(avg(extract(epoch from (decided_at - created_at)) / 86400)::numeric, 1) from public.admission_applications where school_id = sid and session_id = sess and decided_at is not null),
    'oldest_open_days', (select max(public.today_ist() - applied_on) from public.admission_applications where school_id = sid and session_id = sess and status in ('submitted', 'under_review', 'test_scheduled')),
    'docs_pending', (select count(distinct d.application_id) from public.application_documents d join public.admission_applications a on a.id = d.application_id
                      where a.school_id = sid and a.session_id = sess and a.status not in ('admitted', 'cancelled', 'rejected') and d.status in ('pending', 'rejected')),
    'offers_expiring', (select count(*) from public.admission_applications where school_id = sid and session_id = sess and status = 'approved' and offer_valid_till <= public.today_ist() + 2),
    'followups_due', (select count(*) from public.application_followups where school_id = sid and not done and due_on <= public.today_ist()),
    'fee_received', (select coalesce(sum(fee_amount), 0) from public.admission_applications where school_id = sid and session_id = sess and fee_paid_on is not null)
  ) into r;
  return r;
end $$;

-- What the family will be asked to pay: every instalment of the class's plan that falls due within a month, plus one-time heads
create or replace function public.admission_fee_quote(app uuid) returns table (head text, label text, due_date date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null or not public.has_perm_school(a.school_id, 'frontdesk.admissions.view') then return; end if;
  return query
    select h.name, p.label, p.due_date, p.amount
      from public.fee_plans p join public.fee_heads h on h.id = p.fee_head_id
     where p.school_id = a.school_id and p.class_id = a.class_id and p.session_id = a.session_id
       and (p.due_date <= public.today_ist() + 31 or h.name in ('Admission Fee', 'Annual Charges'))
     order by p.due_date, h.name;
end $$;

-- ───────────── Fees: promise to pay ─────────────
create table if not exists public.fee_followups (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  student_id   uuid not null references public.students(id) on delete cascade,
  promised_on  date not null,
  amount       numeric(10,2) check (amount is null or amount > 0),
  note         text,
  status       text not null default 'open' check (status in ('open', 'kept', 'broken', 'closed')),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_name text,
  closed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists fee_followups_idx on public.fee_followups (school_id, status, promised_on);
alter table public.fee_followups enable row level security;
drop policy if exists "read" on public.fee_followups;
create policy "read" on public.fee_followups for select to authenticated using (public.can_student(school_id, 'fees.defaulters.view', student_id));

create or replace function public.add_fee_followup(sid uuid, stu uuid, p_on date, p_amount numeric, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if not (public.has_perm_school(sid, 'fees.defaulters.create') or public.has_perm_school(sid, 'fees.collection.create')) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found.'; end if;
  if p_on is null or p_on < public.today_ist() - 1 then raise exception 'Choose a date from today onwards.'; end if;
  insert into public.fee_followups (school_id, student_id, promised_on, amount, note, created_by_name)
  values (sid, stu, p_on, nullif(p_amount, 0), nullif(btrim(coalesce(p_note, '')), ''), coalesce(auth.jwt() ->> 'email', '')) returning id into fid;
  return fid;
end $$;

create or replace function public.close_fee_followup(fid uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select * into f from public.fee_followups where id = fid;
  if f.id is null then raise exception 'Not found.'; end if;
  if not (public.has_perm_school(f.school_id, 'fees.defaulters.create') or public.has_perm_school(f.school_id, 'fees.collection.create')) then raise exception 'not allowed'; end if;
  if p_status not in ('kept', 'broken', 'closed') then raise exception 'Unknown status.'; end if;
  update public.fee_followups set status = p_status, closed_at = now() where id = fid and status = 'open';
end $$;

-- ───────────── Fees: structure tools ─────────────
create or replace function public.copy_fee_plans(sid uuid, sess uuid, from_class uuid, to_classes uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.has_perm_school(sid, 'fees.structure.create') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.classes where id = from_class and school_id = sid) then raise exception 'Class not found.'; end if;
  if coalesce(cardinality(to_classes), 0) = 0 then raise exception 'Choose at least one class to copy to.'; end if;
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount)
  select p.school_id, p.session_id, c.id, p.fee_head_id, p.label, p.due_date, p.amount
    from public.fee_plans p cross join public.classes c
   where p.school_id = sid and p.session_id = sess and p.class_id = from_class and c.school_id = sid and c.id = any(to_classes) and c.id <> from_class
     and not exists (select 1 from public.fee_plans x where x.class_id = c.id and x.session_id = sess and x.fee_head_id = p.fee_head_id and x.label = p.label);
  get diagnostics cnt = row_count;
  return cnt;
end $$;

create or replace function public.copy_session_plans(sid uuid, from_sess uuid, to_sess uuid, p_years int default 1, p_increase_percent numeric default 0) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.has_perm_school(sid, 'fees.structure.create') then raise exception 'not allowed'; end if;
  if from_sess = to_sess then raise exception 'Choose two different sessions.'; end if;
  if not exists (select 1 from public.sessions where id = from_sess and school_id = sid) or not exists (select 1 from public.sessions where id = to_sess and school_id = sid) then raise exception 'Session not found.'; end if;
  if coalesce(p_increase_percent, 0) < 0 or coalesce(p_increase_percent, 0) > 100 then raise exception 'The increase must be between 0 and 100 per cent.'; end if;
  insert into public.fee_plans (school_id, session_id, class_id, fee_head_id, label, due_date, amount)
  select p.school_id, to_sess, p.class_id, p.fee_head_id, p.label, (p.due_date + make_interval(years => coalesce(p_years, 1)))::date,
         round(p.amount * (1 + coalesce(p_increase_percent, 0) / 100), 2)
    from public.fee_plans p
   where p.school_id = sid and p.session_id = from_sess
     and not exists (select 1 from public.fee_plans x where x.class_id = p.class_id and x.session_id = to_sess and x.fee_head_id = p.fee_head_id and x.label = p.label);
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- ───────────── Fees: split one instalment into parts ─────────────
alter table public.fee_adjustments drop constraint if exists fee_adjustments_kind_check;
alter table public.fee_adjustments add constraint fee_adjustments_kind_check
  check (kind in ('reversal','waiver','carried','extension','amount_change','fine_waiver','split'));

create or replace function public.split_due(did uuid, p_parts int, p_first date, p_gap_days int, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare d record; i int; base numeric; cbase numeric; amt numeric; con numeric;
begin
  select * into d from public.fee_dues where id = did for update;
  if d.id is null then raise exception 'Instalment not found.'; end if;
  if not public.has_perm_school(d.school_id, 'fees.dues.create') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_parts is null or p_parts < 2 or p_parts > 12 then raise exception 'Choose 2 to 12 parts.'; end if;
  if p_first is null or coalesce(p_gap_days, 0) < 1 or p_gap_days > 180 then raise exception 'Choose the first date and the gap between parts (1–180 days).'; end if;
  if d.paid > 0 then raise exception 'Part-paid instalments cannot be split. Collect or reverse the payment first.'; end if;
  base := round(d.amount / p_parts, 2);
  cbase := round(d.concession / p_parts, 2);
  update public.fee_dues set amount = base, concession = least(cbase, base), due_date = p_first, label = d.label || ' · 1/' || p_parts,
         original_due_date = coalesce(original_due_date, d.due_date) where id = did;
  for i in 2..p_parts loop
    amt := case when i = p_parts then d.amount - base * (p_parts - 1) else base end;
    con := case when i = p_parts then d.concession - cbase * (p_parts - 1) else cbase end;
    insert into public.fee_dues (school_id, session_id, student_id, fee_head_id, label, due_date, amount, concession, kind, source_key, original_due_date)
    values (d.school_id, d.session_id, d.student_id, d.fee_head_id, d.label || ' · ' || i || '/' || p_parts, p_first + (i - 1) * p_gap_days, amt, least(con, amt),
            'charge', 'split:' || did || ':' || i, d.due_date);
  end loop;
  insert into public.fee_adjustments (school_id, due_id, student_id, kind, amount, old_value, new_value, reason, created_by_name)
  values (d.school_id, did, d.student_id, 'split', 0, d.amount::text, p_parts || ' parts', btrim(p_reason), coalesce(auth.jwt() ->> 'email', ''));
  return p_parts;
end $$;

-- ───────────── Fees: outstanding by class × head ─────────────
create or replace function public.fee_outstanding(sid uuid, sess uuid)
returns table (class_id uuid, class_name text, head_name text, students bigint, billed numeric, concession numeric, collected numeric, outstanding numeric)
language sql stable set search_path = public as $$
  select c.id, c.name, coalesce(h.name, 'Other charges'), count(distinct d.student_id)::bigint,
         sum(d.amount + d.fine), sum(d.concession), sum(d.paid), sum(greatest(d.amount - d.concession + d.fine - d.paid, 0))
    from public.fee_dues d
    join public.students s on s.id = d.student_id
    left join public.classes c on c.id = s.class_id
    left join public.fee_heads h on h.id = d.fee_head_id
   where d.school_id = sid and d.session_id = sess and s.status = 'active'
   group by c.id, c.name, c.sort, h.name
   order by c.sort nulls last, h.name;
$$;

-- Daily job (service role): a promise whose date has passed becomes "kept" if the student now owes nothing that was due by then,
-- otherwise "broken".
create or replace function public.mark_broken_promises() returns int
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  update public.fee_followups f
     set status = case when exists (select 1 from public.fee_dues d where d.student_id = f.student_id and d.due_date <= f.promised_on and d.status <> 'paid') then 'broken' else 'kept' end,
         closed_at = now()
   where f.status = 'open' and f.promised_on < public.today_ist();
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.mark_broken_promises() from public, anon, authenticated;
grant execute on function public.mark_broken_promises() to service_role;

-- ───────────── Audit ─────────────
do $$
declare t text;
begin
  foreach t in array array['admission_settings', 'application_followups', 'fee_followups'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 12: Students & staff management — search / filter / sort / page in the database,
--          block (ban) and unblock, safe delete, bulk actions.
--   • students / staff get an access-block (reason, since, until); staff login is really cut off
--   • student_list() / staff_list(): one query does search + filters + sort + count + page
--   • delete_student() / delete_staff(): only when there is no financial / academic history
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Columns ─────────────
alter table public.students add column if not exists blocked_at timestamptz;
alter table public.students add column if not exists blocked_till date;
alter table public.students add column if not exists block_reason text;
alter table public.students add column if not exists blocked_by_name text;
alter table public.staff add column if not exists blocked_at timestamptz;
alter table public.staff add column if not exists blocked_till date;
alter table public.staff add column if not exists block_reason text;
alter table public.staff add column if not exists blocked_by_name text;
alter table public.school_members add column if not exists blocked_at timestamptz;
alter table public.school_members add column if not exists blocked_till date;

create index if not exists students_list_idx on public.students (school_id, status, class_id, first_name);
create index if not exists staff_list_idx on public.staff (school_id, status, kind, name);

-- A block is "in force" from blocked_at until blocked_till (inclusive); no end date = until lifted.
create or replace function public.block_active(p_at timestamptz, p_till date) returns boolean
language sql stable set search_path = public as $$
  select p_at is not null and (p_till is null or p_till >= public.today_ist());
$$;

-- ───────────── A blocked login has no permissions ─────────────
create or replace function public.member_blocked(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.school_members m where m.school_id = sid and m.user_id = auth.uid() and public.block_active(m.blocked_at, m.blocked_till));
$$;

create or replace function public.perm_scope(sid uuid, pkey text) returns text
language plpgsql stable security definer set search_path = public as $$
declare s text; is_view boolean := split_part(pkey, '.', 3) = 'view';
begin
  if sid is null or auth.uid() is null then return null; end if;
  -- Platform team: may read every school; may change a school only inside an active support session
  if public.is_platform_admin() then
    if is_view then return 'school'; end if;
    if public.platform_can('impersonate', true) and public.active_support_session(sid) is not null and public.school_writable(sid) then return 'school'; end if;
    return null;
  end if;
  if public.member_blocked(sid) then return null; end if;
  if not public.module_on(sid, split_part(pkey, '.', 1)) then return null; end if;
  if not is_view and not public.school_writable(sid) then return null; end if;
  if exists (select 1 from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = pkey and o.effect = 'deny') then return null; end if;
  select x.scope into s from (
    select rp.scope from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid() and rp.perm_key = pkey
    union all
    select o.scope from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = pkey and o.effect = 'grant'
  ) x order by array_position(array['school','assigned','own','child','self'], x.scope) limit 1;
  -- Group owners / viewers read every branch of their group
  if s is null and is_view and public.in_school_group(sid) then return 'school'; end if;
  return s;
end $$;

create or replace function public.my_permissions(sid uuid) returns table (perm_key text, scope text)
language plpgsql stable security definer set search_path = public as $$
declare w boolean := public.school_writable(sid);
begin
  if auth.uid() is null or sid is null then return; end if;
  if public.is_platform_admin() then
    return query select p.key, 'school'::text from public.erp_permissions p
      where p.action = 'view' or (public.platform_can('impersonate', true) and public.active_support_session(sid) is not null and w);
    return;
  end if;
  if public.member_blocked(sid) then return; end if;
  return query
  with g as (
    select rp.perm_key k, rp.scope sc from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
     where mr.school_id = sid and mr.user_id = auth.uid()
    union all
    select o.perm_key, o.scope from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.effect = 'grant'
    union all
    select p.key, 'school' from public.erp_permissions p where p.action = 'view' and public.in_school_group(sid)
  ), best as (
    select distinct on (k) k, sc from g order by k, array_position(array['school','assigned','own','child','self'], sc)
  )
  select b.k, b.sc from best b join public.erp_permissions p on p.key = b.k
   where public.module_on(sid, p.module_code) and (p.action = 'view' or w)
     and not exists (select 1 from public.member_overrides o where o.school_id = sid and o.user_id = auth.uid() and o.perm_key = b.k and o.effect = 'deny');
end $$;

-- Block columns change only through the functions below.
create or replace function public.guard_block_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.blocked_at is distinct from old.blocked_at or new.blocked_till is distinct from old.blocked_till
    or new.block_reason is distinct from old.block_reason or new.blocked_by_name is distinct from old.blocked_by_name) then
    raise exception 'Use Block / Unblock to change access.';
  end if;
  return new;
end $$;
drop trigger if exists students_block_guard on public.students;
create trigger students_block_guard before update on public.students for each row execute function public.guard_block_columns();
drop trigger if exists staff_block_guard on public.staff;
create trigger staff_block_guard before update on public.staff for each row execute function public.guard_block_columns();

-- ───────────── Block / unblock ─────────────
create or replace function public.block_student(sid uuid, stu uuid, p_reason text, p_till date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'students.profile.block') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_till is not null and p_till < public.today_ist() then raise exception 'The end date is in the past.'; end if;
  update public.students set blocked_at = now(), blocked_till = p_till, block_reason = btrim(p_reason), blocked_by_name = coalesce(auth.jwt() ->> 'email', '')
   where id = stu and school_id = sid;
  if not found then raise exception 'Student not found.'; end if;
end $$;

create or replace function public.unblock_student(sid uuid, stu uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'students.profile.block') then raise exception 'not allowed'; end if;
  update public.students set blocked_at = null, blocked_till = null, block_reason = null, blocked_by_name = null where id = stu and school_id = sid;
  if not found then raise exception 'Student not found.'; end if;
end $$;

create or replace function public.bulk_block_students(sid uuid, p_ids uuid[], p_block boolean, p_reason text default null, p_till date default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.has_perm_school(sid, 'students.profile.block') then raise exception 'not allowed'; end if;
  if p_block and coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_block and p_till is not null and p_till < public.today_ist() then raise exception 'The end date is in the past.'; end if;
  update public.students set
      blocked_at = case when p_block then now() end, blocked_till = case when p_block then p_till end,
      block_reason = case when p_block then btrim(p_reason) end, blocked_by_name = case when p_block then coalesce(auth.jwt() ->> 'email', '') end
   where school_id = sid and id = any(coalesce(p_ids, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.bulk_set_section(sid uuid, p_ids uuid[], p_section uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int; cls uuid;
begin
  if not public.has_perm_school(sid, 'students.profile.edit') then raise exception 'not allowed'; end if;
  select class_id into cls from public.sections where id = p_section and school_id = sid;
  if cls is null then raise exception 'Section not found.'; end if;
  update public.students set section_id = p_section where school_id = sid and id = any(coalesce(p_ids, '{}')) and class_id = cls and status = 'active';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.block_staff(sid uuid, p_staff uuid, p_reason text, p_till date default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid; who text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not public.has_perm_school(sid, 'hr.staff.block') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason.'; end if;
  if p_till is not null and p_till < public.today_ist() then raise exception 'The end date is in the past.'; end if;
  select user_id into uid from public.staff where id = p_staff and school_id = sid;
  if not found then raise exception 'Staff member not found.'; end if;
  if uid is not null and uid = auth.uid() then raise exception 'You cannot block your own login.'; end if;
  update public.staff set blocked_at = now(), blocked_till = p_till, block_reason = btrim(p_reason), blocked_by_name = who where id = p_staff;
  if uid is not null then
    update public.school_members set blocked_at = now(), blocked_till = p_till where school_id = sid and user_id = uid;
  end if;
end $$;

create or replace function public.unblock_staff(sid uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.has_perm_school(sid, 'hr.staff.block') then raise exception 'not allowed'; end if;
  select user_id into uid from public.staff where id = p_staff and school_id = sid;
  if not found then raise exception 'Staff member not found.'; end if;
  update public.staff set blocked_at = null, blocked_till = null, block_reason = null, blocked_by_name = null where id = p_staff;
  if uid is not null then update public.school_members set blocked_at = null, blocked_till = null where school_id = sid and user_id = uid; end if;
end $$;

-- A login (without a staff record) can be blocked from Settings → Staff & access too.
create or replace function public.set_member_blocked(sid uuid, p_user uuid, p_block boolean, p_till date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'hr.staff.block') then raise exception 'not allowed'; end if;
  if p_user = auth.uid() then raise exception 'You cannot block your own login.'; end if;
  update public.school_members set blocked_at = case when p_block then now() end, blocked_till = case when p_block then p_till end where school_id = sid and user_id = p_user;
  if not found then raise exception 'Login not found in this school.'; end if;
  update public.staff set blocked_at = case when p_block then now() end, blocked_till = case when p_block then p_till end,
         block_reason = case when p_block then coalesce(block_reason, 'Login blocked') end, blocked_by_name = case when p_block then coalesce(auth.jwt() ->> 'email', '') end
   where school_id = sid and user_id = p_user;
end $$;

-- ───────────── Delete ─────────────
-- A record with money or academic history is never deleted (mark it Left / Withdrawn instead).
create or replace function public.delete_student(sid uuid, stu uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare s record; why text;
begin
  if not public.has_perm_school(sid, 'students.profile.delete') then raise exception 'not allowed'; end if;
  select * into s from public.students where id = stu and school_id = sid;
  if s.id is null then raise exception 'Student not found.'; end if;
  if btrim(coalesce(p_confirm, '')) <> s.admission_no then raise exception 'Type the admission number to confirm.'; end if;
  select case
    when exists (select 1 from public.fee_receipts where student_id = stu) then 'fee receipts'
    when exists (select 1 from public.fee_dues where student_id = stu and paid > 0) then 'fee payments'
    when exists (select 1 from public.attendance where student_id = stu) then 'attendance'
    when exists (select 1 from public.marks where student_id = stu) then 'exam marks'
    when exists (select 1 from public.student_certificates where student_id = stu) then 'certificates'
    when exists (select 1 from public.issued_documents where student_id = stu) then 'issued documents'
    when exists (select 1 from public.board_registrations where student_id = stu) then 'board registration'
    when exists (select 1 from public.library_issues where student_id = stu) then 'library records'
  end into why;
  if why is not null then
    raise exception 'This student has % and cannot be deleted. Mark them as Left / Withdrawn instead.', why;
  end if;
  delete from public.students where id = stu;
end $$;

create or replace function public.delete_staff(sid uuid, p_staff uuid, p_confirm text) returns void
language plpgsql security definer set search_path = public as $$
declare s record; why text;
begin
  if not public.has_perm_school(sid, 'hr.staff.delete') then raise exception 'not allowed'; end if;
  select * into s from public.staff where id = p_staff and school_id = sid;
  if s.id is null then raise exception 'Staff member not found.'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> lower(s.name) then raise exception 'Type the staff member''s full name to confirm.'; end if;
  select case
    when exists (select 1 from public.payslips where staff_id = p_staff) then 'payroll records'
    when exists (select 1 from public.staff_leaves where staff_id = p_staff) then 'leave records'
    when exists (select 1 from public.issued_documents where staff_id = p_staff) then 'issued documents'
  end into why;
  if why is not null then
    raise exception 'This staff member has % and cannot be deleted. Mark them as Left instead.', why;
  end if;
  delete from public.staff where id = p_staff;
end $$;

-- ───────────── Lists: search + filter + sort + count + page in one query ─────────────
create or replace function public.like_escape(t text) returns text
language sql immutable as $$ select '%' || replace(replace(replace(coalesce(t, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%'; $$;

create or replace function public.student_list(sid uuid, p_q text default null, p_class uuid default null, p_section uuid default null,
    p_status text default 'active', p_gender text default null, p_category text default null, p_blocked text default null,
    p_dues text default null, p_sort text default 'name', p_limit int default 25, p_offset int default 0)
returns table (id uuid, admission_no text, first_name text, middle_name text, last_name text, roll_no int, father_name text, guardian_phone text,
               status text, class_name text, section_name text, gender text, category text, blocked boolean, block_reason text, balance numeric, total bigint)
language sql stable set search_path = public as $$
  with due as (
    select d.student_id, sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)) as bal
      from public.fee_dues d where d.school_id = sid group by d.student_id
  ), base as (
    select s.*, c.name as cname, c.sort as csort, sec.name as secname, coalesce(due.bal, 0) as bal
      from public.students s
      left join public.classes c on c.id = s.class_id
      left join public.sections sec on sec.id = s.section_id
      left join due on due.student_id = s.id
     where s.school_id = sid
       and (p_status is null or p_status = 'all' or s.status = p_status)
       and (p_class is null or s.class_id = p_class)
       and (p_section is null or s.section_id = p_section)
       and (p_gender is null or p_gender = '' or s.gender = p_gender)
       and (p_category is null or p_category = '' or s.category = p_category)
       and (p_blocked is null or p_blocked = '' or (p_blocked = 'yes' and public.block_active(s.blocked_at, s.blocked_till)) or (p_blocked = 'no' and not public.block_active(s.blocked_at, s.blocked_till)))
       and (p_dues is null or p_dues = '' or (p_dues = 'yes' and coalesce(due.bal, 0) > 0) or (p_dues = 'no' and coalesce(due.bal, 0) = 0))
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or concat_ws(' ', s.first_name, s.middle_name, s.last_name) ilike public.like_escape(btrim(p_q))
            or s.admission_no ilike public.like_escape(btrim(p_q))
            or s.father_name ilike public.like_escape(btrim(p_q))
            or s.mother_name ilike public.like_escape(btrim(p_q))
            or s.guardian_phone ilike public.like_escape(btrim(p_q))
            or s.mobile ilike public.like_escape(btrim(p_q)))
  )
  select b.id, b.admission_no, b.first_name, b.middle_name, b.last_name, b.roll_no, b.father_name, b.guardian_phone, b.status,
         b.cname, b.secname, b.gender, b.category, public.block_active(b.blocked_at, b.blocked_till), b.block_reason, b.bal, count(*) over ()
    from base b
   order by
     case when p_sort = 'dues' then b.bal end desc nulls last,
     case when p_sort = 'newest' then b.created_at end desc nulls last,
     case when p_sort = 'class' then b.csort end asc nulls last,
     case when p_sort = 'class' then b.secname end asc nulls last,
     case when p_sort = 'class' then b.roll_no end asc nulls last,
     case when p_sort = 'adm' then b.admission_no end asc,
     b.first_name asc, b.last_name asc nulls last, b.id
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.staff_list(sid uuid, p_q text default null, p_kind text default null, p_department text default null,
    p_status text default 'active', p_login text default null, p_blocked text default null, p_sort text default 'name', p_limit int default 25, p_offset int default 0)
returns table (id uuid, name text, emp_code text, designation text, department text, kind text, phone text, email text, joining_date date, status text,
               user_id uuid, blocked boolean, block_reason text, gross numeric, total bigint)
language sql stable set search_path = public as $$
  with base as (
    select s.*, (select coalesce(sum((e ->> 'amount')::numeric), 0) from jsonb_array_elements(s.earnings) e) as gross
      from public.staff s
     where s.school_id = sid
       and (p_status is null or p_status = 'all' or s.status = p_status)
       and (p_kind is null or p_kind = '' or s.kind = p_kind)
       and (p_department is null or p_department = '' or s.department = p_department)
       and (p_login is null or p_login = '' or (p_login = 'yes' and s.user_id is not null) or (p_login = 'no' and s.user_id is null))
       and (p_blocked is null or p_blocked = '' or (p_blocked = 'yes' and public.block_active(s.blocked_at, s.blocked_till)) or (p_blocked = 'no' and not public.block_active(s.blocked_at, s.blocked_till)))
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or s.name ilike public.like_escape(btrim(p_q)) or s.emp_code ilike public.like_escape(btrim(p_q)) or s.phone ilike public.like_escape(btrim(p_q))
            or s.designation ilike public.like_escape(btrim(p_q)) or s.department ilike public.like_escape(btrim(p_q)) or s.email ilike public.like_escape(btrim(p_q)))
  )
  select b.id, b.name, b.emp_code, b.designation, b.department, b.kind, b.phone, b.email, b.joining_date, b.status, b.user_id,
         public.block_active(b.blocked_at, b.blocked_till), b.block_reason, b.gross, count(*) over ()
    from base b
   order by
     case when p_sort = 'code' then b.emp_code end asc nulls last,
     case when p_sort = 'joined' then b.joining_date end desc nulls last,
     case when p_sort = 'designation' then b.designation end asc nulls last,
     b.name asc, b.id
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- tab counts
create or replace function public.student_counts(sid uuid) returns table (status text, n bigint, blocked bigint)
language sql stable set search_path = public as $$
  select s.status, count(*), count(*) filter (where public.block_active(s.blocked_at, s.blocked_till))
    from public.students s where s.school_id = sid group by s.status;
$$;

create or replace function public.staff_counts(sid uuid) returns table (status text, n bigint, blocked bigint, with_login bigint)
language sql stable set search_path = public as $$
  select s.status, count(*), count(*) filter (where public.block_active(s.blocked_at, s.blocked_till)), count(*) filter (where s.user_id is not null)
    from public.staff s where s.school_id = sid group by s.status;
$$;

-- ───────────── Permissions: new "block" action, backfilled for existing schools ─────────────
insert into public.role_permissions (role_id, perm_key, scope)
select r.id, t.perm_key, t.scope
  from public.roles r
  join public.role_template_permissions t on t.template_code = r.template_code
 where t.perm_key in ('students.profile.block', 'hr.staff.block')
on conflict (role_id, perm_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 13: Admission as one guided flow, in a fixed order:
--
--   1 Enquiry → 2 Student & parent details → 3 Documents → 4 Test / interview (if the school asks)
--   → 5 Principal's decision → 6 Admission fee → 7 Class & section (last) → Admitted
--
--   • every application has an enquiry trail (created automatically when it starts without one)
--   • approval is blocked until details, required documents and (if required) test marks are in;
--     the principal can waive documents with a written reason
--   • "Start admission" creates the student record (status admission_pending, NO class yet), bills the
--     fees of the class applied for and the family pays BEFORE a class and section are given
--   • class and section are assigned last, only when the admission fee is paid (or waived in writing)
--   • one timeline per application: enquiry, documents, decision, fee receipts, allotment
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Settings ─────────────
alter table public.admission_settings add column if not exists strict_workflow boolean not null default true;       -- gate approval on details / documents / test
alter table public.admission_settings add column if not exists fee_before_allotment boolean not null default true;  -- class & section only after the fee
alter table public.admission_settings add column if not exists required_docs text[] not null default array['birth_certificate','photo'];
alter table public.admission_settings add column if not exists require_test boolean not null default false;
alter table public.admission_settings add column if not exists fee_window_days int not null default 31 check (fee_window_days between 0 and 365);

alter table public.admission_applications add column if not exists docs_waiver_note text;
alter table public.admission_applications add column if not exists docs_waived_by text;
alter table public.admission_applications add column if not exists fee_waiver_note text;
alter table public.admission_applications add column if not exists fee_waived_by text;
alter table public.admission_applications add column if not exists enrolled_on date;       -- "Start admission" (student record + fees)

alter table public.students drop constraint if exists students_status_check;
alter table public.students add constraint students_status_check
  check (status in ('active','left','passed_out','transferred','withdrawn','admission_pending'));

-- ───────────── Settings access with defaults ─────────────
create or replace function public.admission_cfg(sid uuid)
returns table (strict_workflow boolean, fee_before_allotment boolean, required_docs text[], require_test boolean, fee_window_days int, offer_days int)
language sql stable security definer set search_path = public as $$
  select coalesce(s.strict_workflow, true), coalesce(s.fee_before_allotment, true), coalesce(s.required_docs, array['birth_certificate','photo']),
         coalesce(s.require_test, false), coalesce(s.fee_window_days, 31), coalesce(s.offer_days, 7)
    from (select 1) one left join public.admission_settings s on s.school_id = sid;
$$;
revoke execute on function public.admission_cfg(uuid) from public, anon, authenticated;

-- ───────────── What is still missing, for one application row ─────────────
create or replace function public.application_missing_details(f jsonb) returns text[]
language sql immutable set search_path = public as $$
  select array_remove(array[
    case when coalesce(btrim(f ->> 'first_name'), '') = '' then 'student name' end,
    case when coalesce(btrim(f ->> 'dob'), '') = '' then 'date of birth' end,
    case when coalesce(btrim(f ->> 'gender'), '') = '' then 'gender' end,
    case when coalesce(btrim(f ->> 'father_name'), '') = '' then 'father''s name' end,
    case when coalesce(btrim(f ->> 'mother_name'), '') = '' then 'mother''s name' end,
    case when coalesce(btrim(f ->> 'guardian_phone'), '') = '' then 'parent mobile' end,
    case when coalesce(btrim(f ->> 'address'), btrim(f ->> 'street'), btrim(f ->> 'city'), '') = '' then 'address' end
  ], null);
$$;

create or replace function public.application_missing_docs(app uuid, req text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d order by d), '{}') from unnest(req) d
   where not exists (select 1 from public.application_documents x where x.application_id = app and x.doc_type = d and x.status in ('uploaded', 'verified', 'not_applicable'));
$$;
revoke execute on function public.application_missing_docs(uuid, text[]) from public, anon, authenticated;

-- what stops an approval right now (empty = nothing)
create or replace function public.approval_blockers(a public.admission_applications) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare c record; out text[] := '{}'; d text[]; m text[];
begin
  select * into c from public.admission_cfg(a.school_id);
  if not c.strict_workflow then return out; end if;
  m := public.application_missing_details(a.form);
  if cardinality(m) > 0 then out := out || ('details: ' || array_to_string(m, ', '))::text; end if;
  d := public.application_missing_docs(a.id, c.required_docs);
  if cardinality(d) > 0 and a.docs_waiver_note is null then out := out || ('documents: ' || array_to_string(d, ', '))::text; end if;
  if c.require_test and a.test_marks is null then out := out || 'entrance test marks'::text; end if;
  return out;
end $$;
revoke execute on function public.approval_blockers(public.admission_applications) from public, anon, authenticated;

-- ───────────── Fee status of an application ─────────────
-- "Admission fee" = every fee of the class that falls due within fee_window_days of today (admission, annual, first instalments).
create or replace function public.admission_fee_status(app uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a record; c record; req numeric := 0; paid numeric := 0; bal numeric := 0; n int := 0; r record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null or not (public.has_perm_school(a.school_id, 'frontdesk.admissions.view') or public.is_service()) then return null; end if;
  select * into c from public.admission_cfg(a.school_id);
  if a.student_id is not null then
    select count(*), coalesce(sum(greatest(d.amount - d.concession, 0) + d.fine), 0), coalesce(sum(d.paid), 0), coalesce(sum(greatest(d.amount - d.concession + d.fine - d.paid, 0)), 0)
      into n, req, paid, bal
      from public.fee_dues d
     where d.student_id = a.student_id and d.kind = 'plan' and d.due_date <= public.today_ist() + c.fee_window_days;
  end if;
  return jsonb_build_object(
    'student_id', a.student_id, 'lines', n, 'required', req, 'paid', paid, 'balance', bal,
    'waived', a.fee_waiver_note is not null,
    'ready', a.student_id is not null and (bal = 0 or a.fee_waiver_note is not null));
end $$;

-- ───────────── Progress: the step-by-step state of one application ─────────────
create or replace function public.application_progress(app uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.admission_applications; c record; det text[]; dmiss text[]; blockers text[]; fee jsonb; steps jsonb := '[]'::jsonb; st text; cur boolean := false;
        enq record; f_ready boolean; done_ boolean; seat_free int; have int; need int;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null or not (public.has_perm_school(a.school_id, 'frontdesk.admissions.view') or public.is_service()) then return null; end if;
  select * into c from public.admission_cfg(a.school_id);
  det := public.application_missing_details(a.form);
  dmiss := public.application_missing_docs(a.id, c.required_docs);
  blockers := public.approval_blockers(a);
  fee := public.admission_fee_status(app);
  f_ready := coalesce((fee ->> 'ready')::boolean, false);
  need := cardinality(c.required_docs); have := need - cardinality(dmiss);
  select s.seats - s.active_students into seat_free from public.admission_seats(a.school_id, a.session_id) s where s.class_id = a.class_id and s.seats is not null;

  -- stage
  st := case
    when a.status = 'admitted' then 'admitted'
    when a.status in ('cancelled', 'rejected') then 'closed'
    when a.status = 'waitlisted' then 'waitlist'
    when cardinality(det) > 0 then 'details'
    when cardinality(dmiss) > 0 and a.docs_waiver_note is null then 'documents'
    when c.require_test and a.test_marks is null then 'assessment'
    when a.status <> 'approved' then 'decision'
    when not f_ready then 'fee'
    else 'allotment' end;

  -- steps in fixed order; the first one that is not done is "current"
  select array_to_json(array_agg(row_to_json(x) order by x.n))::jsonb into steps from (values
    (1, 'enquiry', 'Enquiry', a.enquiry_id is not null, 'enquiry' || case when a.source is not null then ' · ' || a.source else '' end, false),
    (2, 'details', 'Student & parent details', cardinality(det) = 0, case when cardinality(det) = 0 then 'complete' else 'missing: ' || array_to_string(det, ', ') end, false),
    (3, 'documents', 'Documents', cardinality(dmiss) = 0 or a.docs_waiver_note is not null,
        case when a.docs_waiver_note is not null and cardinality(dmiss) > 0 then 'waived: ' || a.docs_waiver_note
             when cardinality(dmiss) = 0 then have || ' of ' || need || ' required received' else 'missing: ' || array_to_string(dmiss, ', ') end, false),
    (4, 'assessment', 'Test / interview', (not c.require_test) or a.test_marks is not null,
        case when not c.require_test then 'not required' when a.test_marks is not null then a.test_marks || ' / ' || coalesce(a.test_max::text, '?') else 'marks pending' end, not c.require_test),
    (5, 'decision', 'Principal''s decision', a.status in ('approved', 'admitted'), a.status || coalesce(' #' || a.waitlist_no, ''), false),
    (6, 'fee', 'Admission fee', f_ready,
        case when a.student_id is null then 'not started'
             when f_ready and a.fee_waiver_note is not null then 'waived: ' || a.fee_waiver_note
             when f_ready then 'paid'
             else 'balance ' || (fee ->> 'balance') end, false),
    (7, 'allotment', 'Class & section', a.status = 'admitted', case when a.status = 'admitted' then 'allotted' else 'after the fee' end, false)
  ) as x(n, key, label, done, detail, skipped);

  -- mark states
  select jsonb_agg(
           e || jsonb_build_object('state',
             case when (e ->> 'done')::boolean then (case when (e ->> 'skipped')::boolean then 'skipped' else 'done' end)
                  when a.status in ('cancelled', 'rejected') then 'closed'
                  when (e ->> 'key') = st or ((e ->> 'key') = 'assessment' and st = 'assessment') then 'current'
                  else 'todo' end)
           order by (e ->> 'n')::int)
    into steps from jsonb_array_elements(steps) e;

  return jsonb_build_object(
    'stage', st, 'steps', steps, 'details_missing', to_jsonb(det), 'docs_missing', to_jsonb(dmiss), 'blockers', to_jsonb(blockers),
    'can_approve', cardinality(blockers) = 0, 'student_id', a.student_id, 'fee', fee,
    'can_start', a.status = 'approved' and a.student_id is null, 'can_allot', a.status = 'approved' and f_ready, 'seat_free', seat_free,
    'fee_before_allotment', c.fee_before_allotment, 'strict', c.strict_workflow);
end $$;

-- ───────────── Approval gate (extends the workflow trigger of 0010) ─────────────
create or replace function public.guard_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_checked boolean := auth.uid() is not null and not public.is_service(); ok boolean; need_approve boolean; b text[];
begin
  if tg_op = 'INSERT' then new.status := 'submitted'; return new; end if;
  if new.school_id is distinct from old.school_id or new.application_no is distinct from old.application_no then raise exception 'Application numbers cannot be changed.'; end if;
  if old.status in ('admitted','cancelled') and (new.status is distinct from old.status or new.form is distinct from old.form or new.class_id is distinct from old.class_id) then
    raise exception 'This application is closed (%).', old.status;
  end if;
  -- once the student record exists the class applied for is fixed (its fees are already billed)
  if old.student_id is not null and new.class_id is distinct from old.class_id and coalesce(current_setting('app.admitting', true), '') <> '1' then
    raise exception 'The admission has started, so the class can no longer be changed here. Allot the class at the last step.';
  end if;
  -- waivers are the principal's
  if (new.docs_waiver_note is distinct from old.docs_waiver_note or new.fee_waiver_note is distinct from old.fee_waiver_note)
     and actor_checked and not public.has_perm_school(new.school_id, 'frontdesk.admissions.approve') then
    raise exception 'Only the principal can waive documents or the admission fee.';
  end if;
  if new.status is distinct from old.status then
    ok := case old.status
      when 'submitted'      then new.status in ('under_review','test_scheduled','approved','waitlisted','rejected','cancelled')
      when 'under_review'   then new.status in ('test_scheduled','approved','waitlisted','rejected','cancelled')
      when 'test_scheduled' then new.status in ('under_review','approved','waitlisted','rejected','cancelled')
      when 'approved'       then new.status in ('waitlisted','cancelled','admitted','under_review')
      when 'waitlisted'     then new.status in ('approved','rejected','cancelled','under_review')
      when 'rejected'       then new.status in ('under_review')
      else false end;
    if not ok then raise exception 'An application cannot go from % to %.', old.status, new.status; end if;
    if new.status = 'admitted' and coalesce(current_setting('app.admitting', true), '') <> '1' then
      raise exception 'An application becomes admitted only through "Admit".';
    end if;
    need_approve := new.status in ('approved','waitlisted','rejected') or (old.status = 'rejected');
    if actor_checked and need_approve and not public.has_perm_school(new.school_id, 'frontdesk.admissions.approve') then
      raise exception 'Only the principal (admission approver) can approve, waitlist or reject.';
    end if;
    if new.status = 'approved' then
      b := public.approval_blockers(new);
      if cardinality(b) > 0 then raise exception 'This application cannot be approved yet — %. Complete these steps, or (principal) waive the documents with a reason.', array_to_string(b, '; '); end if;
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.decision_note), '') = '' then raise exception 'Write the reason for rejecting.'; end if;
    if new.status in ('approved','waitlisted','rejected') then new.decided_by := auth.uid(); new.decided_at := now(); end if;
    if new.status = 'waitlisted' then
      select coalesce(max(waitlist_no), 0) + 1 into new.waitlist_no from public.admission_applications
       where school_id = new.school_id and class_id is not distinct from new.class_id and session_id is not distinct from new.session_id and status = 'waitlisted';
    elsif old.status = 'waitlisted' then new.waitlist_no := null;
    end if;
    if new.status = 'test_scheduled' and new.test_on is null and new.interview_on is null then raise exception 'Set the test or interview date first.'; end if;
  end if;
  return new;
end $$;

-- a cancelled / rejected application releases a student record that was started but never paid
create or replace function public.application_release() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('cancelled', 'rejected') and old.status not in ('cancelled', 'rejected') and new.student_id is not null then
    if exists (select 1 from public.students s where s.id = new.student_id and s.status = 'admission_pending')
       and not exists (select 1 from public.fee_receipts r where r.student_id = new.student_id) then
      delete from public.students where id = new.student_id and status = 'admission_pending';
    end if;
  end if;
  return null;
end $$;
drop trigger if exists admission_applications_release on public.admission_applications;
create trigger admission_applications_release after update on public.admission_applications for each row execute function public.application_release();

-- ───────────── Every application has an enquiry (so there is one trail from the first contact) ─────────────
create or replace function public.create_application_core(sid uuid, p_class uuid, p_enquiry uuid, p_form jsonb, p_rte boolean, p_rte_ref text, p_source text, p_session uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare sess uuid := coalesce(p_session, (select id from public.sessions where school_id = sid and is_current limit 1));
        sname text; n int; num text; nm text; dup text; aid uuid; f jsonb := coalesce(p_form, '{}'::jsonb); enq uuid := p_enquiry; cname text;
begin
  if coalesce(btrim(f ->> 'first_name'), '') = '' then raise exception 'The student''s first name is required.'; end if;
  if p_class is not null and not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Class not found.'; end if;
  if p_enquiry is not null and not exists (select 1 from public.enquiries where id = p_enquiry and school_id = sid) then raise exception 'Enquiry not found.'; end if;
  nm := btrim(concat_ws(' ', f ->> 'first_name', f ->> 'middle_name', f ->> 'last_name'));
  select application_no into dup from public.admission_applications
   where school_id = sid and session_id is not distinct from sess and status not in ('cancelled','rejected')
     and lower(applicant_name) = lower(nm) and coalesce(form ->> 'dob', '') = coalesce(f ->> 'dob', '') and coalesce(lower(father_name), '') = coalesce(lower(f ->> 'father_name'), '')
   limit 1;
  if dup is not null and coalesce((f ->> 'allow_duplicate')::boolean, false) is not true then
    raise exception 'An application for the same student already exists (no. %).', dup;
  end if;
  if enq is null then
    select name into cname from public.classes where id = p_class;
    insert into public.enquiries (school_id, student_name, class_sought, parent_name, phone, source, status, notes)
    values (sid, nm, cname, nullif(btrim(f ->> 'father_name'), ''), nullif(btrim(f ->> 'guardian_phone'), ''), nullif(btrim(coalesce(p_source, '')), ''), 'test',
            'Created with the application')
    returning id into enq;
  end if;
  select coalesce((select name from public.sessions where id = sess), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, 'application', sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1 returning next_no - 1 into n;
  num := 'APP/' || sname || '/' || lpad(n::text, 4, '0');
  insert into public.admission_applications (school_id, application_no, session_id, class_id, enquiry_id, applicant_name, father_name, phone, form, rte_applicant, rte_reference, source)
  values (sid, num, sess, p_class, enq, nm, nullif(btrim(f ->> 'father_name'), ''), nullif(btrim(f ->> 'guardian_phone'), ''), f - 'allow_duplicate', coalesce(p_rte, false),
          nullif(btrim(coalesce(p_rte_ref, '')), ''), nullif(btrim(coalesce(p_source, '')), ''))
  returning id into aid;
  if p_enquiry is not null then update public.enquiries set status = case when status in ('new','contacted','visited') then 'test' else status end where id = p_enquiry and school_id = sid; end if;
  return aid;
end $$;
revoke execute on function public.create_application_core(uuid, uuid, uuid, jsonb, boolean, text, text, uuid) from public, anon, authenticated;

-- ───────────── Student record from an application (shared by "Start admission" and the one-step admit) ─────────────
create or replace function public.enrol_from_application(a public.admission_applications, p_adm text, p_date date, p_status text, p_class uuid, p_section uuid, p_roll int)
returns uuid language plpgsql security definer set search_path = public as $$
declare f jsonb := a.form; sid uuid := a.school_id; stu uuid; adm text; c jsonb; pr jsonb; d record; today date := public.today_ist();
begin
  adm := nullif(btrim(coalesce(p_adm, '')), '');
  if adm is null then adm := public.next_school_number_internal(sid, 'admission'); end if;
  insert into public.students (school_id, admission_no, first_name, middle_name, last_name, gender, dob, class_id, section_id, roll_no, status,
      father_name, mother_name, guardian_phone, alt_phone, email, address, city, district, block_tehsil, pincode, state, locality_type, mother_tongue, nationality,
      category, blood_group, permanent_address, previous_school, previous_board, previous_class, name_hi, father_name_hi, mother_name_hi, mobile, street, post_office,
      religion, caste, medium, bpl, admission_date, admission_class_id, application_no, application_id,
      admission_category, previous_year_percent, previous_year_days, distance_km)
  values (sid, adm, btrim(f ->> 'first_name'), nullif(f ->> 'middle_name', ''), nullif(f ->> 'last_name', ''), nullif(f ->> 'gender', ''), nullif(f ->> 'dob', '')::date,
      p_class, p_section, p_roll, p_status,
      nullif(f ->> 'father_name', ''), nullif(f ->> 'mother_name', ''), nullif(f ->> 'guardian_phone', ''), nullif(f ->> 'alt_phone', ''), nullif(f ->> 'email', ''),
      nullif(f ->> 'address', ''), nullif(f ->> 'city', ''), nullif(f ->> 'district', ''), nullif(f ->> 'block_tehsil', ''), nullif(f ->> 'pincode', ''), nullif(f ->> 'state', ''),
      nullif(f ->> 'locality_type', ''), nullif(f ->> 'mother_tongue', ''), coalesce(nullif(f ->> 'nationality', ''), 'Indian'),
      nullif(f ->> 'category', ''), nullif(f ->> 'blood_group', ''), nullif(f ->> 'permanent_address', ''), nullif(f ->> 'previous_school', ''), nullif(f ->> 'previous_board', ''),
      nullif(f ->> 'previous_class', ''), nullif(f ->> 'name_hi', ''), nullif(f ->> 'father_name_hi', ''), nullif(f ->> 'mother_name_hi', ''), nullif(f ->> 'mobile', ''),
      nullif(f ->> 'street', ''), nullif(f ->> 'post_office', ''), nullif(f ->> 'religion', ''), nullif(f ->> 'caste', ''), nullif(f ->> 'medium', ''),
      nullif(f ->> 'bpl', '')::boolean, coalesce(p_date, today), a.class_id, a.application_no, a.id,
      case when a.rte_applicant then 'rte' else nullif(f ->> 'admission_category', '') end,
      nullif(f ->> 'previous_year_percent', '')::numeric, nullif(f ->> 'previous_year_days', '')::int, nullif(f ->> 'distance_km', '')::numeric)
  returning id into stu;

  if f ?| array['pen','apaar_id','aadhaar_enc','allergies','medical_conditions','medication','disability','disability_type','accommodations'] then
    insert into public.student_sensitive (student_id, school_id, pen, apaar_id, apaar_status, apaar_consent, aadhaar_enc, aadhaar_last4, aadhaar_consent,
        allergies, medical_conditions, medication, disability, disability_type, disability_percent, accommodations)
    values (stu, sid, nullif(f ->> 'pen', ''), nullif(f ->> 'apaar_id', ''), coalesce(nullif(f ->> 'apaar_status', ''), 'not_created'),
        coalesce((f ->> 'apaar_consent')::boolean, false), nullif(f ->> 'aadhaar_enc', ''), nullif(f ->> 'aadhaar_last4', ''),
        coalesce((f ->> 'aadhaar_consent')::boolean, false), nullif(f ->> 'allergies', ''), nullif(f ->> 'medical_conditions', ''), nullif(f ->> 'medication', ''),
        nullif(f ->> 'disability', ''), nullif(f ->> 'disability_type', ''), nullif(f ->> 'disability_percent', '')::numeric, nullif(f ->> 'accommodations', ''))
    on conflict (student_id) do nothing;
  end if;

  for c in select * from jsonb_array_elements(coalesce(f -> 'contacts', '[]'::jsonb)) loop
    declare gid uuid; ph text := nullif(regexp_replace(coalesce(c ->> 'phone', ''), '\D', '', 'g'), '');
    begin
      if coalesce(btrim(c ->> 'name'), '') = '' then continue; end if;
      if ph is not null and length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
      if ph is not null and ph !~ '^[6-9][0-9]{9}$' then ph := null; end if;
      insert into public.guardians (school_id, name, relation, phone, occupation, is_emergency, can_pickup)
      values (sid, btrim(c ->> 'name'), nullif(c ->> 'relation', ''), ph, nullif(c ->> 'occupation', ''),
              coalesce((c ->> 'is_emergency')::boolean, false) and ph is not null, coalesce((c ->> 'can_pickup')::boolean, false) and ph is not null)
      returning id into gid;
      insert into public.student_guardians (school_id, student_id, guardian_id, is_primary)
      values (sid, stu, gid, coalesce((c ->> 'is_primary')::boolean, false) and not exists (select 1 from public.student_guardians where student_id = stu and is_primary));
    end;
  end loop;

  for pr in select * from jsonb_array_elements(coalesce(f -> 'prior', '[]'::jsonb)) loop
    if (pr ->> 'level') in ('class8','class9_registration','class9','high_school','class11_registration','intermediate','iti','other') then
      insert into public.student_prior_exams (school_id, student_id, level, board_name, exam_year, roll_no, registration_no, school_name, district_code, school_code, result, percentage)
      values (sid, stu, pr ->> 'level', nullif(pr ->> 'board_name', ''), nullif(pr ->> 'exam_year', '')::int, nullif(pr ->> 'roll_no', ''), nullif(pr ->> 'registration_no', ''),
              nullif(pr ->> 'school_name', ''), nullif(pr ->> 'district_code', ''), nullif(pr ->> 'school_code', ''), nullif(pr ->> 'result', ''), nullif(pr ->> 'percentage', '')::numeric)
      on conflict (student_id, level) do nothing;
    end if;
  end loop;

  for d in select * from public.application_documents where application_id = a.id loop
    insert into public.student_documents (school_id, student_id, doc_type, title, status, file_path, file_name, mime_type, size_bytes, due_by, uploaded_by, uploaded_by_name,
                                          uploaded_at, verified_by, verified_by_name, verified_at, reject_reason, remark)
    values (sid, stu, d.doc_type, d.title, d.status, d.file_path, d.file_name, d.mime_type, d.size_bytes, d.due_by, d.uploaded_by, d.uploaded_by_name,
            d.uploaded_at, d.verified_by, d.verified_by_name, d.verified_at, d.reject_reason, d.remark)
    on conflict (student_id, doc_type) where doc_type <> 'other' do nothing;
  end loop;
  return stu;
end $$;
revoke execute on function public.enrol_from_application(public.admission_applications, text, date, text, uuid, uuid, int) from public, anon, authenticated;

-- the original allocator checks the caller's permission; this one is for functions that have already checked
create or replace function public.next_school_number_internal(sid uuid, kind text) returns text
language plpgsql security definer set search_path = public as $$
declare n int; p text;
begin
  if kind = 'admission' then
    update public.schools set next_admission_no = next_admission_no + 1 where id = sid returning next_admission_no - 1, admission_prefix into n, p;
    return p || n::text;
  end if;
  raise exception 'unknown kind %', kind;
end $$;
revoke execute on function public.next_school_number_internal(uuid, text) from public, anon, authenticated;

-- fees of the class applied for, billed to the (pending) student
create or replace function public.bill_application_dues(sid uuid, stu uuid, cls uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int; sess uuid; auto boolean;
begin
  select id into sess from public.sessions where school_id = sid and is_current limit 1;
  if sess is null or cls is null then return 0; end if;
  select coalesce(auto_sibling_discount, true) into auto from public.admission_settings where school_id = sid;
  if coalesce(auto, true) then perform public.sibling_discount_core(sid, stu); end if;
  insert into public.fee_dues (school_id, session_id, student_id, fee_plan_id, fee_head_id, label, due_date, amount, concession)
  select p.school_id, p.session_id, stu, p.id, p.fee_head_id, h.name || ' · ' || p.label, p.due_date, p.amount, public.concession_for(stu, p.fee_head_id, p.amount, p.due_date)
    from public.fee_plans p join public.fee_heads h on h.id = p.fee_head_id
   where p.school_id = sid and p.session_id = sess and p.class_id = cls
  on conflict (student_id, fee_plan_id) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.bill_application_dues(uuid, uuid, uuid) from public, anon, authenticated;

-- ───────────── Step 6: start the admission → student record (no class yet) + fees ─────────────
create or replace function public.begin_admission(app uuid, p_admission_no text default null, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.admission_applications; stu uuid;
begin
  select * into a from public.admission_applications where id = app for update;
  if a.id is null then raise exception 'Application not found.'; end if;
  if not public.has_perm_school(a.school_id, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if a.status <> 'approved' then raise exception 'Only an approved application can start the admission (this one is %).', a.status; end if;
  if a.student_id is not null then return a.student_id; end if;
  if a.class_id is null then raise exception 'Set the class applied for first.'; end if;
  stu := public.enrol_from_application(a, p_admission_no, p_date, 'admission_pending', null, null, null);
  perform public.bill_application_dues(a.school_id, stu, a.class_id);
  if a.enquiry_id is not null then update public.enquiries set student_id = stu where id = a.enquiry_id and school_id = a.school_id; end if;
  update public.admission_applications set student_id = stu, enrolled_on = public.today_ist() where id = app;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (a.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'admission started — fees billed', jsonb_build_object('student_id', stu));
  return stu;
end $$;

create or replace function public.waive_application_docs(app uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null then raise exception 'Application not found.'; end if;
  if not public.has_perm_school(a.school_id, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write the reason for waiving the documents.'; end if;
  update public.admission_applications set docs_waiver_note = btrim(p_note), docs_waived_by = coalesce(auth.jwt() ->> 'email', '') where id = app;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (a.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'documents waived', jsonb_build_object('note', btrim(p_note)));
end $$;

create or replace function public.waive_application_fee(app uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null then raise exception 'Application not found.'; end if;
  if not public.has_perm_school(a.school_id, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if a.student_id is null then raise exception 'Start the admission first.'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Write the reason for waiving the admission fee.'; end if;
  update public.admission_applications set fee_waiver_note = btrim(p_note), fee_waived_by = coalesce(auth.jwt() ->> 'email', '') where id = app;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (a.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'admission fee waived', jsonb_build_object('note', btrim(p_note)));
end $$;

-- ───────────── Step 7: class & section, last ─────────────
create or replace function public.admit_application(app uuid, p_class uuid, p_section uuid, p_admission_no text default null,
                                                    p_admission_date date default null, p_roll int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a public.admission_applications; c record; stu uuid; fee jsonb; free int; sid uuid; today date := public.today_ist(); cls_changed boolean;
begin
  select * into a from public.admission_applications where id = app for update;
  if a.id is null then raise exception 'Application not found.'; end if;
  sid := a.school_id;
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  if a.status <> 'approved' then raise exception 'Only an approved application can be admitted (this one is %).', a.status; end if;
  if p_class is null or not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Choose the class.'; end if;
  if p_section is not null and not exists (select 1 from public.sections where id = p_section and class_id = p_class) then raise exception 'The section does not belong to that class.'; end if;
  select * into c from public.admission_cfg(sid);

  if a.student_id is null then
    if c.fee_before_allotment then raise exception 'Start the admission and collect the admission fee first — the class and section are given at the last step.'; end if;
    -- school has switched the fee gate off: one-step admission as before
    stu := public.enrol_from_application(a, p_admission_no, coalesce(p_admission_date, today), 'admission_pending', null, null, null);
    perform public.bill_application_dues(sid, stu, p_class);
  else
    stu := a.student_id;
    fee := public.admission_fee_status(app);
    if c.fee_before_allotment and not coalesce((fee ->> 'ready')::boolean, false) then
      raise exception 'The admission fee is not paid (balance %). Collect it, or ask the principal to waive it with a reason.', fee ->> 'balance';
    end if;
  end if;

  -- a different class from the one applied for: only while nothing has been paid; the fees are billed again for the new class
  cls_changed := p_class is distinct from a.class_id;
  if cls_changed then
    if exists (select 1 from public.fee_dues where student_id = stu and paid > 0) then
      raise exception 'Fees of the applied class are already paid, so the class cannot be changed. Admit into that class.';
    end if;
    delete from public.fee_dues where student_id = stu and fee_plan_id is not null and paid = 0;
    perform public.bill_application_dues(sid, stu, p_class);
  end if;

  -- a free seat
  select s.seats - s.active_students into free from public.admission_seats(sid, a.session_id) s where s.class_id = p_class and s.seats is not null;
  if free is not null and free <= 0 then raise exception 'No free seat in this class. Raise the seats in Settings, or waitlist this application.'; end if;

  -- admission number (if it was not given at the start), then the class goes in last
  if nullif(btrim(coalesce(p_admission_no, '')), '') is not null then
    update public.students set admission_no = btrim(p_admission_no) where id = stu and admission_no is distinct from btrim(p_admission_no);
  end if;
  update public.students set class_id = p_class, section_id = p_section, roll_no = p_roll, status = 'active', admission_date = coalesce(p_admission_date, admission_date, today)
   where id = stu;
  if a.enquiry_id is not null then update public.enquiries set status = 'admitted', student_id = stu where id = a.enquiry_id and school_id = sid; end if;
  perform set_config('app.admitting', '1', true);
  update public.admission_applications set status = 'admitted', student_id = stu, admitted_on = coalesce(p_admission_date, today), class_id = p_class where id = app;
  perform set_config('app.admitting', '', true);
  return stu;
end $$;

-- ───────────── Timeline: documents and fee receipts write into the same trail ─────────────
create or replace function public.log_application_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text;
begin
  if tg_op = 'INSERT' then
    ev := case new.status when 'uploaded' then 'document uploaded' when 'pending' then 'document marked pending' when 'not_applicable' then 'document not applicable' else 'document ' || new.status end;
  elsif new.status is distinct from old.status then ev := 'document ' || new.status;
  else return null; end if;
  insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
  values (new.school_id, new.application_id, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), ev, jsonb_build_object('type', new.doc_type, 'note', new.reject_reason));
  return null;
end $$;
drop trigger if exists application_documents_log on public.application_documents;
create trigger application_documents_log after insert or update on public.application_documents for each row execute function public.log_application_document();

create or replace function public.log_application_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
declare app uuid;
begin
  select application_id into app from public.students where id = new.student_id;
  if app is null then return null; end if;
  if tg_op = 'INSERT' and not new.cancelled then
    insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
    values (new.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', new.collected_by, ''), 'fee received', jsonb_build_object('receipt', new.receipt_no, 'amount', new.amount, 'mode', new.mode));
  elsif tg_op = 'UPDATE' and new.cancelled and not old.cancelled then
    insert into public.admission_application_events (school_id, application_id, actor, actor_name, event, details)
    values (new.school_id, app, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), 'receipt cancelled', jsonb_build_object('receipt', new.receipt_no, 'amount', new.amount));
  end if;
  return null;
end $$;
drop trigger if exists fee_receipts_application_log on public.fee_receipts;
create trigger fee_receipts_application_log after insert or update on public.fee_receipts for each row execute function public.log_application_receipt();

-- followups and enquiries join the application's timeline
create or replace function public.application_timeline(app uuid) returns table (at timestamptz, actor text, event text, details jsonb, source text)
language plpgsql stable security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.admission_applications where id = app;
  if a.id is null or not public.has_perm_school(a.school_id, 'frontdesk.admissions.view') then return; end if;
  return query
    select e.at, e.actor_name, e.event, e.details, 'application'::text from public.admission_application_events e where e.application_id = app
    union all
    select q.created_at, null::text, 'enquiry received' || coalesce(' via ' || q.source, ''), jsonb_build_object('note', q.notes), 'enquiry'::text from public.enquiries q where q.id = a.enquiry_id
    union all
    select f.created_at, f.created_by_name, 'follow-up planned for ' || to_char(f.due_on, 'DD Mon') || ' (' || f.channel || ')', jsonb_build_object('note', f.note), 'followup'::text
      from public.application_followups f where f.application_id = app
    union all
    select f.done_at, f.done_by_name, 'follow-up done', jsonb_build_object('note', f.outcome), 'followup'::text from public.application_followups f where f.application_id = app and f.done
    order by 1 desc;
end $$;

-- ───────────── Board: one row per application with its stage ─────────────
create or replace function public.application_board(sid uuid, sess uuid, p_stage text default null, p_q text default null, p_class uuid default null,
                                                    p_limit int default 25, p_offset int default 0)
returns table (id uuid, application_no text, applicant_name text, father_name text, phone text, class_id uuid, status text, stage text, applied_on date,
               rte_applicant boolean, source text, waitlist_no int, offer_valid_till date, student_id uuid, total bigint)
language sql stable security definer set search_path = public as $$
  with base as (
    select a.*, case
      when a.status = 'admitted' then 'admitted'
      when a.status in ('cancelled', 'rejected') then 'closed'
      when a.status = 'waitlisted' then 'waitlist'
      when cardinality(public.application_missing_details(a.form)) > 0 then 'details'
      when cardinality(public.application_missing_docs(a.id, (select required_docs from public.admission_cfg(sid)))) > 0 and a.docs_waiver_note is null then 'documents'
      when (select require_test from public.admission_cfg(sid)) and a.test_marks is null then 'assessment'
      when a.status <> 'approved' then 'decision'
      when a.student_id is null then 'fee'
      when exists (select 1 from public.fee_dues d where d.student_id = a.student_id and d.kind = 'plan' and d.due_date <= public.today_ist() + (select fee_window_days from public.admission_cfg(sid))
                      and d.amount - d.concession + d.fine - d.paid > 0) and a.fee_waiver_note is null then 'fee'
      else 'allotment' end as stg
    from public.admission_applications a
   where a.school_id = sid and a.session_id = sess and public.has_perm_school(sid, 'frontdesk.admissions.view')
  )
  select b.id, b.application_no, b.applicant_name, b.father_name, b.phone, b.class_id, b.status, b.stg, b.applied_on, b.rte_applicant, b.source, b.waitlist_no, b.offer_valid_till, b.student_id,
         count(*) over ()
    from base b
   where (p_stage is null or p_stage = '' or b.stg = p_stage)
     and (p_class is null or b.class_id = p_class)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or b.applicant_name ilike public.like_escape(btrim(p_q)) or b.application_no ilike public.like_escape(btrim(p_q))
          or b.father_name ilike public.like_escape(btrim(p_q)) or b.phone ilike public.like_escape(btrim(p_q)))
   order by b.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.application_stage_counts(sid uuid, sess uuid) returns table (stage text, n bigint)
language sql stable security definer set search_path = public as $$
  select x.stage, count(*) from public.application_board(sid, sess, null, null, null, 200, 0) x group by x.stage
  union all select 'total', max(total) from public.application_board(sid, sess, null, null, null, 1, 0);
$$;

-- ───────────── Settings save (principal) ─────────────
create or replace function public.save_admission_flow(sid uuid, p_required_docs text[], p_require_test boolean, p_fee_before boolean, p_strict boolean, p_window int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.approve') then raise exception 'not allowed'; end if;
  insert into public.admission_settings (school_id, required_docs, require_test, fee_before_allotment, strict_workflow, fee_window_days)
  values (sid, coalesce(p_required_docs, '{}'), coalesce(p_require_test, false), coalesce(p_fee_before, true), coalesce(p_strict, true), least(greatest(coalesce(p_window, 31), 0), 365))
  on conflict (school_id) do update set required_docs = excluded.required_docs, require_test = excluded.require_test, fee_before_allotment = excluded.fee_before_allotment,
        strict_workflow = excluded.strict_workflow, fee_window_days = excluded.fee_window_days;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 14 (part 1): fix — students had TWO foreign keys to classes (class_id and admission_class_id),
-- which makes every PostgREST embed "students → classes(name)" ambiguous, so the student page,
-- fee collect, receipts, board pages … returned "not found". admission_class_id is a plain column again.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
     where con.contype = 'f' and con.conrelid = 'public.students'::regclass and con.confrelid = 'public.classes'::regclass and a.attname = 'admission_class_id'
  loop
    execute format('alter table public.students drop constraint %I', c.conname);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 14 (part 2): fee templates (receipt / demand notice / statement), payment methods and payment links.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Payment methods: cash · debit / credit card · others (UPI, cheque, bank transfer, DD, other) · gateway / link ─────────────
alter table public.fee_receipts drop constraint if exists fee_receipts_mode_check;
alter table public.fee_receipts add constraint fee_receipts_mode_check
  check (mode in ('cash','upi','cheque','bank_transfer','card','online','dd','other','mixed','wallet'));
alter table public.fee_receipt_payments drop constraint if exists fee_receipt_payments_mode_check;
alter table public.fee_receipt_payments add constraint fee_receipt_payments_mode_check
  check (mode in ('cash','upi','cheque','bank_transfer','card','online','dd','other'));
alter table public.fee_receipt_payments add column if not exists sub_type text;     -- debit / credit, or the label of "other"

create or replace function public.collect_fee_core(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[], p_wallet_use numeric, p_paid_on date, p_note text, p_by text,
                                                   p_fine numeric, p_force_advance boolean, p_online_order uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st record; sp jsonb; rid uuid; rno text; money numeric := 0; wuse numeric := coalesce(p_wallet_use, 0); bal numeric; wallet numeric; alloc numeric; excess numeric;
        d record; take numeric; left_amt numeric; modes text[] := '{}'; m text; first_ref text; first_due uuid; pid uuid; any_line boolean := false;
begin
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found'; end if;
  select * into st from public.fee_settings where school_id = sid;
  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    if (sp ->> 'mode') not in ('cash','upi','cheque','bank_transfer','card','online','dd','other') then raise exception 'Unknown payment mode "%".', sp ->> 'mode'; end if;
    if coalesce((sp ->> 'amount')::numeric, 0) <= 0 then raise exception 'Every payment line needs an amount.'; end if;
    money := money + (sp ->> 'amount')::numeric;
    if not ((sp ->> 'mode') = any(modes)) then modes := modes || (sp ->> 'mode'); end if;
  end loop;
  if money + wuse <= 0 then raise exception 'Amount must be more than zero'; end if;
  if wuse < 0 then raise exception 'Wallet amount cannot be negative.'; end if;
  select coalesce(sum(amount), 0) into wallet from public.fee_wallet_entries where student_id = stu;
  if wuse > wallet then raise exception 'The wallet has only % — use less.', wallet; end if;

  -- automatic late fine up to the payment date, then an optional manual fine
  perform public.apply_late_fines_core(sid, stu, coalesce(p_paid_on, public.today_ist()));
  if coalesce(p_fine, 0) > 0 then
    select id into first_due from public.fee_dues where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or id = any(p_due_ids)) order by due_date, label limit 1;
    if first_due is null then raise exception 'No unpaid instalment to add the fine to'; end if;
    update public.fee_dues set fine = fine + p_fine where id = first_due;
  end if;

  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
   where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  excess := greatest(money + wuse - bal, 0);
  if excess > 0 then
    if wuse > 0 and excess > money then raise exception 'The wallet use is more than what is due. Use less.'; end if;
    if not coalesce(st.advance_allowed, true) and not p_force_advance then raise exception 'Amount is more than the total due'; end if;
  end if;
  alloc := money + wuse - excess;

  rno := public.next_school_number_core(sid, 'receipt');
  insert into public.fee_receipts (school_id, receipt_no, student_id, paid_on, mode, reference, amount, note, collected_by, advance_amount, wallet_used, online_order_id)
  values (sid, rno, stu, coalesce(p_paid_on, public.today_ist()),
          case when cardinality(modes) > 1 then 'mixed' when cardinality(modes) = 1 then modes[1] else 'wallet' end,
          nullif(p_splits -> 0 ->> 'reference', ''), alloc, p_note, p_by, excess, wuse, p_online_order)
  returning id into rid;

  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount, reference, sub_type)
    values (sid, rid, sp ->> 'mode', (sp ->> 'amount')::numeric, nullif(btrim(coalesce(sp ->> 'reference', sp ->> 'cheque_no', '')), ''), nullif(btrim(coalesce(sp ->> 'sub_type', '')), '')) returning id into pid;
    if (sp ->> 'mode') = 'cheque' then
      insert into public.fee_cheques (school_id, receipt_id, student_id, cheque_no, bank, cheque_date, amount)
      values (sid, rid, stu, coalesce(nullif(btrim(coalesce(sp ->> 'cheque_no', sp ->> 'reference', '')), ''), 'N/A'), nullif(sp ->> 'bank', ''), nullif(sp ->> 'cheque_date', '')::date, (sp ->> 'amount')::numeric);
    end if;
  end loop;

  left_amt := alloc;
  for d in select id, greatest(amount - concession + fine - paid, 0) as b from public.fee_dues
            where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids))
            order by due_date, label for update loop
    exit when left_amt <= 0;
    take := least(d.b, left_amt);
    if take > 0 then
      insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, d.id, take);
      left_amt := left_amt - take; any_line := true;
    end if;
  end loop;
  if wuse > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'applied', -wuse, rid, 'Used against receipt ' || rno, p_by); end if;
  if excess > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'advance', excess, rid, 'Advance with receipt ' || rno, p_by); end if;
  return rid;
end $$;

revoke execute on function public.collect_fee_core(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric, boolean, uuid) from public, anon, authenticated;

-- ───────────── Payment links (staff) and gateway orders ─────────────
alter table public.fee_online_orders add column if not exists created_by_name text;
alter table public.fee_online_orders add column if not exists channel text not null default 'parent';
alter table public.fee_online_orders add column if not exists note text;
alter table public.fee_online_orders add column if not exists phone text;
alter table public.fee_online_orders add column if not exists expires_at timestamptz;
alter table public.fee_online_orders add column if not exists cancelled_at timestamptz;
alter table public.fee_online_orders drop constraint if exists fee_online_orders_channel_check;
alter table public.fee_online_orders add constraint fee_online_orders_channel_check check (channel in ('parent','link','gateway'));

drop function if exists public.create_online_order(uuid, uuid, numeric, uuid[]);
create or replace function public.create_online_order(sid uuid, stu uuid, p_amount numeric, p_due_ids uuid[],
                                                      p_channel text default 'parent', p_by text default null, p_note text default null, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st record; bal numeric; oid uuid;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into st from public.fee_settings where school_id = sid;
  if st.school_id is null or not st.online_enabled then raise exception 'Online payment is not switched on for this school (Fees → Fee settings).'; end if;
  if not public.school_writable(sid) then raise exception 'This school cannot take payments right now.'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid and status in ('active', 'admission_pending')) then raise exception 'Student not found.'; end if;
  if p_channel not in ('parent', 'link', 'gateway') then raise exception 'Unknown channel.'; end if;
  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
   where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  if bal <= 0 then raise exception 'Nothing is due.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  if p_channel = 'parent' and p_amount < st.online_min_amount then raise exception 'The minimum online payment is %.', st.online_min_amount; end if;
  if p_amount > bal then raise exception 'The amount is more than what is due (%).', bal; end if;
  if p_channel = 'parent' and not st.online_allow_partial and p_amount < bal then raise exception 'Please pay the full amount due (%).', bal; end if;
  update public.fee_online_orders set status = 'expired' where student_id = stu and status = 'created' and coalesce(expires_at, created_at + interval '2 days') < now();
  insert into public.fee_online_orders (school_id, student_id, amount, due_ids, channel, created_by_name, note, phone, expires_at)
  values (sid, stu, p_amount, nullif(p_due_ids, '{}'), p_channel, p_by, nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''), now() + interval '3 days')
  returning id into oid;
  return oid;
end $$;
revoke execute on function public.create_online_order(uuid, uuid, numeric, uuid[], text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_online_order(uuid, uuid, numeric, uuid[], text, text, text, text) to service_role;

create or replace function public.cancel_payment_link(oid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.fee_online_orders where id = oid for update;
  if o.id is null then raise exception 'Payment link not found.'; end if;
  if not (public.has_perm_school(o.school_id, 'fees.online.create') or public.is_service()) then raise exception 'not allowed'; end if;
  if o.status <> 'created' then raise exception 'This link is already % and cannot be cancelled.', o.status; end if;
  update public.fee_online_orders set status = 'cancelled', cancelled_at = now() where id = oid;
  return o.link_id;
end $$;

-- ───────────── Fee templates ─────────────
alter table public.document_templates drop constraint if exists document_templates_category_check;
alter table public.document_templates add constraint document_templates_category_check check (category in ('certificate','id_card','letter','fees','other'));

-- {{fee.*_html}} values are built by the functions below (every cell escaped) and inserted as they are.
create or replace function public.render_document(body text, data jsonb) returns text
language plpgsql immutable as $$
declare out text := regexp_replace(coalesce(body, ''), '\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}', '{{\1}}', 'g'); k text; v text;
begin
  for k in select distinct t.m[1] from regexp_matches(out, '\{\{([a-zA-Z0-9_.]+)\}\}', 'g') as t(m) loop
    v := data #>> string_to_array(k, '.');
    if k = 'student.photo' then
      out := replace(out, '{{' || k || '}}', '<img class="doc-photo" data-photo="1" src="" alt="Photograph" style="width:100%;height:100%;object-fit:cover">');
    elsif k = 'school.logo' then
      out := replace(out, '{{' || k || '}}', case when v ~* '^https://' then '<img class="doc-logo" src="' || public.html_escape(v) || '" alt="Logo" style="width:100%;height:100%;object-fit:contain">' else '' end);
    elsif k ~ '^fee\.[a-z_]+_html$' then
      out := replace(out, '{{' || k || '}}', coalesce(v, ''));
    else
      out := replace(out, '{{' || k || '}}', public.html_escape(v));
    end if;
  end loop;
  return out;
end $$;

create or replace function public.money_text(n numeric) returns text
language sql immutable as $$ select '₹' || trim(to_char(coalesce(n, 0), 'FM99,99,99,990.00')); $$;

create or replace function public.rupee_words(n numeric) returns text
language plpgsql immutable as $$
declare r int := floor(abs(coalesce(n, 0)))::int; p int := round((abs(coalesce(n, 0)) - floor(abs(coalesce(n, 0)))) * 100)::int; t text;
begin
  t := case when r >= 100000 then public.number_words(r / 100000) || ' Lakh' || case when r % 100000 > 0 then ' ' || public.number_words(r % 100000) else '' end else public.number_words(r) end;
  return t || ' Rupees' || case when p > 0 then ' and ' || public.number_words(p) || ' Paise' else '' end || ' Only';
end $$;

-- the data of a fee document. kind: receipt (subject = receipt id), demand | statement (subject = student id)
create or replace function public.fee_template_data(p_kind text, subject uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid; stu uuid; r record; s record; sc record; d jsonb; fee jsonb; rows text := ''; rows2 text := ''; owed numeric; over numeric; paid_t numeric; billed_t numeric;
        adv numeric; pays text; sess text;
  td text := 'border:1px solid #444;padding:4px 8px';
begin
  if p_kind = 'receipt' then
    select * into r from public.fee_receipts where id = subject;
    if r.id is null then return null; end if;
    sid := r.school_id; stu := r.student_id;
    if not (public.can_student(sid, 'fees.receipts.view', stu) or public.can_student(sid, 'fees.collection.view', stu) or public.is_service()) then return null; end if;
  else
    select school_id into sid from public.students where id = subject;
    if sid is null then return null; end if;
    stu := subject;
    if not (public.can_student(sid, 'fees.collection.view', stu) or public.can_student(sid, 'fees.defaulters.view', stu) or public.is_service()) then return null; end if;
  end if;
  select * into sc from public.schools where id = sid;
  select st.*, c.name as cname, sec.name as sname into s from public.students st left join public.classes c on c.id = st.class_id left join public.sections sec on sec.id = st.section_id where st.id = stu;
  select name into sess from public.sessions where school_id = sid and is_current limit 1;
  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0),
         coalesce(sum(greatest(amount - concession + fine - paid, 0)) filter (where due_date < public.today_ist()), 0),
         coalesce(sum(paid), 0), coalesce(sum(amount + fine), 0)
    into owed, over, paid_t, billed_t from public.fee_dues where student_id = stu;
  select coalesce(sum(amount), 0) into adv from public.fee_wallet_entries where student_id = stu;

  d := jsonb_build_object(
    'school', jsonb_build_object('name', sc.name, 'address', sc.address, 'city', sc.city, 'state', sc.state, 'pincode', sc.pincode, 'phone', sc.phone, 'email', sc.email,
      'board', sc.board, 'affiliation_no', sc.affiliation_no, 'udise_code', sc.udise_code, 'principal_name', sc.principal_name, 'logo', sc.logo_url),
    'student', jsonb_build_object('name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)), 'admission_no', s.admission_no, 'class', s.cname, 'section', s.sname,
      'class_section', concat_ws('-', s.cname, s.sname), 'father_name', s.father_name, 'mother_name', s.mother_name, 'phone', s.guardian_phone, 'roll_no', s.roll_no),
    'doc', jsonb_build_object('session', sess, 'date', to_char(public.today_ist(), 'DD/MM/YYYY'), 'no', ''));

  if p_kind = 'receipt' then
    select coalesce(string_agg('<tr><td style="' || td || '">' || public.html_escape(coalesce(du.label, 'Fee')) || '</td><td style="' || td || ';text-align:right">' || public.money_text(l.amount) || '</td></tr>', '' order by du.due_date, du.label), '')
      into rows from public.fee_receipt_lines l left join public.fee_dues du on du.id = l.due_id where l.receipt_id = r.id;
    select coalesce(string_agg(case p.mode when 'cash' then 'Cash' when 'card' then coalesce(initcap(p.sub_type) || ' card', 'Card') when 'upi' then 'UPI' when 'cheque' then 'Cheque'
                  when 'bank_transfer' then 'Bank transfer' when 'dd' then 'Demand draft' when 'online' then 'Online' else coalesce(p.sub_type, 'Other') end
                  || ' ' || public.money_text(p.amount) || coalesce(' (' || p.reference || ')', ''), ' + ' order by p.amount desc), '')
      into pays from public.fee_receipt_payments p where p.receipt_id = r.id;
    fee := jsonb_build_object(
      'receipt_no', r.receipt_no, 'date', to_char(r.paid_on, 'DD/MM/YYYY'), 'amount', public.money_text(r.amount), 'amount_words', public.rupee_words(r.amount),
      'mode', case r.mode when 'mixed' then 'Split payment' when 'wallet' then 'From advance' else initcap(replace(r.mode, '_', ' ')) end, 'payments', coalesce(pays, ''),
      'reference', coalesce(r.reference, ''), 'note', coalesce(r.note, ''), 'collected_by', coalesce(r.collected_by, ''),
      'advance', case when r.advance_amount > 0 then public.money_text(r.advance_amount) else '' end,
      'wallet_used', case when r.wallet_used > 0 then public.money_text(r.wallet_used) else '' end,
      'balance', public.money_text(owed), 'status', case when r.cancelled then 'CANCELLED' else '' end,
      'lines_html', '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="' || td || ';text-align:left">Particulars</th><th style="' || td || ';text-align:right">Amount</th></tr></thead><tbody>'
                    || rows || '</tbody><tfoot><tr><th style="' || td || ';text-align:left">Total received</th><th style="' || td || ';text-align:right">' || public.money_text(r.amount) || '</th></tr></tfoot></table>');
    d := jsonb_set(d, '{doc,no}', to_jsonb(r.receipt_no)) || jsonb_build_object('fee', fee);
  else
    select coalesce(string_agg('<tr><td style="' || td || '">' || public.html_escape(du.label) || '</td><td style="' || td || '">' || to_char(du.due_date, 'DD/MM/YYYY') || '</td><td style="' || td || ';text-align:right">'
             || public.money_text(du.amount - du.concession + du.fine) || '</td><td style="' || td || ';text-align:right">' || public.money_text(du.paid) || '</td><td style="' || td || ';text-align:right"><b>'
             || public.money_text(greatest(du.amount - du.concession + du.fine - du.paid, 0)) || '</b></td></tr>', '' order by du.due_date, du.label), '')
      into rows from public.fee_dues du where du.student_id = stu and (p_kind = 'statement' or du.amount - du.concession + du.fine - du.paid > 0);
    select coalesce(string_agg('<tr><td style="' || td || '">' || public.html_escape(fr.receipt_no) || '</td><td style="' || td || '">' || to_char(fr.paid_on, 'DD/MM/YYYY') || '</td><td style="' || td || '">'
             || public.html_escape(initcap(replace(fr.mode, '_', ' '))) || '</td><td style="' || td || ';text-align:right">' || public.money_text(fr.amount) || '</td></tr>', '' order by fr.paid_on), '')
      into rows2 from public.fee_receipts fr where fr.student_id = stu and not fr.cancelled;
    fee := jsonb_build_object(
      'total_due', public.money_text(owed), 'overdue', public.money_text(over), 'paid_total', public.money_text(paid_t), 'billed_total', public.money_text(billed_t),
      'due_words', public.rupee_words(owed), 'advance', case when adv > 0 then public.money_text(adv) else '' end, 'as_on', to_char(public.today_ist(), 'DD/MM/YYYY'),
      'dues_html', '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="' || td || ';text-align:left">Fee</th><th style="' || td || ';text-align:left">Due date</th><th style="'
                   || td || ';text-align:right">Amount</th><th style="' || td || ';text-align:right">Paid</th><th style="' || td || ';text-align:right">Balance</th></tr></thead><tbody>' || rows
                   || '</tbody><tfoot><tr><th style="' || td || '" colspan="4">Total outstanding</th><th style="' || td || ';text-align:right">' || public.money_text(owed) || '</th></tr></tfoot></table>',
      'receipts_html', '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="' || td || ';text-align:left">Receipt</th><th style="' || td || ';text-align:left">Date</th><th style="'
                   || td || ';text-align:left">Mode</th><th style="' || td || ';text-align:right">Amount</th></tr></thead><tbody>' || rows2 || '</tbody></table>');
    d := d || jsonb_build_object('fee', fee);
  end if;
  return d;
end $$;
revoke execute on function public.fee_template_data(text, uuid) from public, anon, authenticated;

-- the rendered, sanitised document (null when the school has no active template of this kind: the app then uses its built-in layout)
create or replace function public.render_fee_document(p_kind text, subject uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb; t record; sid uuid;
begin
  if p_kind not in ('receipt', 'demand', 'statement') then raise exception 'Unknown document.'; end if;
  d := public.fee_template_data(p_kind, subject);
  if d is null then return null; end if;
  select school_id into sid from public.students where id = (case when p_kind = 'receipt' then (select student_id from public.fee_receipts where id = subject) else subject end);
  select * into t from public.document_templates where school_id = sid and code = 'fee_' || p_kind and active;
  if t.id is null then return null; end if;
  return jsonb_build_object('html', public.sanitize_template_html(public.render_document(t.body_html, d)), 'template_id', t.id, 'name', t.name,
                            'page_size', t.page_size, 'orientation', t.orientation);
end $$;

-- preview for the template editor: the latest receipt (receipt) or the student with the largest balance (demand / statement)
create or replace function public.preview_fee_template(tpl uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t record; subj uuid; d jsonb;
begin
  select * into t from public.document_templates where id = tpl;
  if t.id is null or t.category <> 'fees' or not public.has_perm_school(t.school_id, 'documents.templates.view') then return null; end if;
  if t.code = 'fee_receipt' then
    select id into subj from public.fee_receipts where school_id = t.school_id order by created_at desc limit 1;
  else
    select du.student_id into subj from public.fee_dues du where du.school_id = t.school_id group by du.student_id order by sum(du.amount - du.concession + du.fine - du.paid) desc limit 1;
  end if;
  if subj is null then return jsonb_build_object('empty', true); end if;
  d := public.fee_template_data(case t.code when 'fee_receipt' then 'receipt' when 'fee_demand' then 'demand' else 'statement' end, subj);
  if d is null then return jsonb_build_object('empty', true); end if;
  return jsonb_build_object('html', public.sanitize_template_html(public.render_document(t.body_html, d)));
end $$;

-- the standard fee templates
create or replace function public.seed_fee_templates_internal(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; hdr text := $h$<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:8px"><div style="font-size:20px;font-weight:800;text-transform:uppercase">{{school.name}}</div><div style="font-size:12px">{{school.address}}, {{school.city}} {{school.pincode}} · {{school.phone}}</div><div style="font-size:11px">{{school.board}} · Aff. No. {{school.affiliation_no}}</div></div>$h$;
begin
  insert into public.document_templates (school_id, code, name, category, audience, body_html, page_size, orientation, numbering_prefix, fields, is_system) values
  (sid, 'fee_receipt', 'Fee receipt', 'fees', 'student',
   '<div style="font-size:13px;line-height:1.5">' || hdr || $b$<div style="text-align:center;font-weight:800;letter-spacing:1px;margin:6px 0">FEE RECEIPT <span style="color:#b00020">{{fee.status}}</span></div>
<div style="display:flex;justify-content:space-between"><span>Receipt no.: <b>{{fee.receipt_no}}</b></span><span>Date: <b>{{fee.date}}</b></span></div>
<div style="display:flex;justify-content:space-between;margin-top:4px"><span>Student: <b>{{student.name}}</b></span><span>Adm. no.: <b>{{student.admission_no}}</b></span></div>
<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Father: {{student.father_name}}</span><span>Class: {{student.class_section}}</span></div>
{{fee.lines_html}}
<p style="margin:8px 0 2px">In words: <b>{{fee.amount_words}}</b></p>
<p style="margin:2px 0">Paid by: <b>{{fee.payments}}</b> {{fee.note}}</p>
<p style="margin:2px 0">Balance after this receipt: <b>{{fee.balance}}</b></p>
<div style="display:flex;justify-content:space-between;margin-top:36px;font-size:12px"><span>Received by: {{fee.collected_by}}</span><span>Authorised signatory</span></div>
<p style="font-size:11px;color:#555;margin-top:8px">Fees once paid are not refundable. Computer generated receipt.</p></div>$b$,
   'A5', 'portrait', 'FR', '[]', true),
  (sid, 'fee_demand', 'Fee demand notice', 'fees', 'student',
   '<div style="font-size:14px;line-height:1.6">' || hdr || $b$<div style="display:flex;justify-content:space-between"><span>Date: <b>{{fee.as_on}}</b></span><span>Session: <b>{{doc.session}}</b></span></div>
<h2 style="text-align:center;text-transform:uppercase;margin:12px 0">Fee demand notice</h2>
<p>To,<br>The Parent / Guardian of <b>{{student.name}}</b> (Adm. no. {{student.admission_no}}, Class {{student.class_section}})<br>Father: {{student.father_name}}</p>
<p>Our records show that the following fees are outstanding. You are requested to pay <b>{{fee.total_due}}</b> ({{fee.due_words}}) at the school office at the earliest.</p>
{{fee.dues_html}}
<p style="margin-top:14px">If you have already paid, please ignore this notice or show the receipt at the office.</p>
<div style="display:flex;justify-content:space-between;margin-top:60px"><span>Accounts office</span><span style="text-align:center">Principal<br><small>(signature &amp; school seal)</small></span></div></div>$b$,
   'A4', 'portrait', 'FD', '[]', true),
  (sid, 'fee_statement', 'Fee statement', 'fees', 'student',
   '<div style="font-size:13.5px;line-height:1.5">' || hdr || $b$<h2 style="text-align:center;margin:10px 0">Fee statement — {{doc.session}}</h2>
<p><b>{{student.name}}</b> · Adm. no. {{student.admission_no}} · Class {{student.class_section}} · Father: {{student.father_name}}</p>
<h4 style="margin:10px 0 4px">Instalments</h4>
{{fee.dues_html}}
<h4 style="margin:12px 0 4px">Receipts</h4>
{{fee.receipts_html}}
<p style="margin-top:10px">Billed <b>{{fee.billed_total}}</b> · Paid <b>{{fee.paid_total}}</b> · Outstanding <b>{{fee.total_due}}</b> {{fee.advance}}</p>
<p style="font-size:11px;color:#555">Statement as on {{fee.as_on}}.</p></div>$b$,
   'A4', 'portrait', 'FS', '[]', true)
  on conflict (school_id, code) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.seed_fee_templates_internal(uuid) from public, anon, authenticated;

create or replace function public.seed_fee_templates(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'documents.templates.create') and not public.has_perm_school(sid, 'fees.structure.edit') then raise exception 'not allowed'; end if;
  return public.seed_fee_templates_internal(sid);
end $$;

create or replace function public.seed_fee_templates_on_school() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.seed_fee_templates_internal(new.id); return null; end $$;
drop trigger if exists schools_seed_fee_templates on public.schools;
create trigger schools_seed_fee_templates after insert on public.schools for each row execute function public.seed_fee_templates_on_school();

select public.seed_fee_templates_internal(id) from public.schools;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 15: collect fees structure-wise (each instalment / fee head with its own amount) and fetch the fine automatically.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════
-- (also in 0016; repeated so this migration works on its own)
alter table public.fee_receipts drop constraint if exists fee_receipts_mode_check;
alter table public.fee_receipts add constraint fee_receipts_mode_check
  check (mode in ('cash','upi','cheque','bank_transfer','card','online','dd','other','mixed','wallet'));
alter table public.fee_receipt_payments drop constraint if exists fee_receipt_payments_mode_check;
alter table public.fee_receipt_payments add constraint fee_receipt_payments_mode_check
  check (mode in ('cash','upi','cheque','bank_transfer','card','online','dd','other'));
alter table public.fee_receipt_payments add column if not exists sub_type text;     -- debit / credit, or the label of "other"

drop function if exists public.collect_fee_core(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric, boolean, uuid);
drop function if exists public.collect_fee_v2(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric);

create or replace function public.collect_fee_core(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[], p_wallet_use numeric, p_paid_on date, p_note text, p_by text,
                                                   p_fine numeric, p_force_advance boolean, p_online_order uuid default null, p_alloc jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st record; sp jsonb; rid uuid; rno text; money numeric := 0; wuse numeric := coalesce(p_wallet_use, 0); bal numeric; wallet numeric; alloc numeric; excess numeric;
        d record; take numeric; left_amt numeric; modes text[] := '{}'; m text; first_ref text; first_due uuid; pid uuid; any_line boolean := false;
        use_alloc boolean := false; al jsonb; a_ids uuid[] := '{}'; a_amt numeric[] := '{}'; i int; bal_d numeric; lbl text;
begin
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found'; end if;
  select * into st from public.fee_settings where school_id = sid;
  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    if (sp ->> 'mode') not in ('cash','upi','cheque','bank_transfer','card','online','dd','other') then raise exception 'Unknown payment mode "%".', sp ->> 'mode'; end if;
    if coalesce((sp ->> 'amount')::numeric, 0) <= 0 then raise exception 'Every payment line needs an amount.'; end if;
    money := money + (sp ->> 'amount')::numeric;
    if not ((sp ->> 'mode') = any(modes)) then modes := modes || (sp ->> 'mode'); end if;
  end loop;
  if money + wuse <= 0 then raise exception 'Amount must be more than zero'; end if;
  if wuse < 0 then raise exception 'Wallet amount cannot be negative.'; end if;
  select coalesce(sum(amount), 0) into wallet from public.fee_wallet_entries where student_id = stu;
  if wuse > wallet then raise exception 'The wallet has only % — use less.', wallet; end if;

  -- structure-wise collection: [{"due_id": "...", "amount": 500}, …]
  use_alloc := p_alloc is not null and jsonb_typeof(p_alloc) = 'array' and jsonb_array_length(p_alloc) > 0;
  if use_alloc then
    for al in select * from jsonb_array_elements(p_alloc) loop
      a_ids := a_ids || (al ->> 'due_id')::uuid;
      a_amt := a_amt || round((al ->> 'amount')::numeric, 2);
    end loop;
    if exists (select 1 from unnest(a_amt) x where x is null or x <= 0) then raise exception 'Every instalment you pay needs an amount above zero.'; end if;
    if (select count(distinct x) from unnest(a_ids) x) <> cardinality(a_ids) then raise exception 'An instalment appears twice.'; end if;
    if (select count(*) from public.fee_dues where id = any(a_ids) and student_id = stu and school_id = sid and status <> 'paid') <> cardinality(a_ids) then
      raise exception 'One of the chosen instalments is not open for this student.';
    end if;
    p_due_ids := a_ids;
  end if;

  -- automatic late fine up to the payment date, then an optional manual fine
  perform public.apply_late_fines_core(sid, stu, coalesce(p_paid_on, public.today_ist()));
  if coalesce(p_fine, 0) > 0 then
    if use_alloc then first_due := a_ids[1];
    else select id into first_due from public.fee_dues where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or id = any(p_due_ids)) order by due_date, label limit 1;
    end if;
    if first_due is null then raise exception 'No unpaid instalment to add the fine to'; end if;
    update public.fee_dues set fine = fine + p_fine where id = first_due;
    if use_alloc then a_amt[1] := a_amt[1] + p_fine; end if;
  end if;

  if use_alloc then
    for i in 1..cardinality(a_ids) loop
      select greatest(amount - concession + fine - paid, 0), label into bal_d, lbl from public.fee_dues where id = a_ids[i];
      if a_amt[i] > bal_d then raise exception 'The amount for "%" is more than its balance (%).', lbl, bal_d; end if;
    end loop;
    bal := (select coalesce(sum(x), 0) from unnest(a_amt) x);
    if money + wuse < bal then raise exception 'The payment (%) is less than the fees chosen (%).', money + wuse, bal; end if;
  else
    select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
     where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  end if;
  excess := greatest(money + wuse - bal, 0);
  if excess > 0 then
    if wuse > 0 and excess > money then raise exception 'The wallet use is more than what is due. Use less.'; end if;
    if not coalesce(st.advance_allowed, true) and not p_force_advance then raise exception 'Amount is more than the total due'; end if;
  end if;
  alloc := money + wuse - excess;

  rno := public.next_school_number_core(sid, 'receipt');
  insert into public.fee_receipts (school_id, receipt_no, student_id, paid_on, mode, reference, amount, note, collected_by, advance_amount, wallet_used, online_order_id)
  values (sid, rno, stu, coalesce(p_paid_on, public.today_ist()),
          case when cardinality(modes) > 1 then 'mixed' when cardinality(modes) = 1 then modes[1] else 'wallet' end,
          nullif(p_splits -> 0 ->> 'reference', ''), alloc, p_note, p_by, excess, wuse, p_online_order)
  returning id into rid;

  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount, reference, sub_type)
    values (sid, rid, sp ->> 'mode', (sp ->> 'amount')::numeric, nullif(btrim(coalesce(sp ->> 'reference', sp ->> 'cheque_no', '')), ''), nullif(btrim(coalesce(sp ->> 'sub_type', '')), '')) returning id into pid;
    if (sp ->> 'mode') = 'cheque' then
      insert into public.fee_cheques (school_id, receipt_id, student_id, cheque_no, bank, cheque_date, amount)
      values (sid, rid, stu, coalesce(nullif(btrim(coalesce(sp ->> 'cheque_no', sp ->> 'reference', '')), ''), 'N/A'), nullif(sp ->> 'bank', ''), nullif(sp ->> 'cheque_date', '')::date, (sp ->> 'amount')::numeric);
    end if;
  end loop;

  left_amt := alloc;
  if use_alloc then
    for i in 1..cardinality(a_ids) loop
      insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, a_ids[i], a_amt[i]);
    end loop;
  else
    for d in select id, greatest(amount - concession + fine - paid, 0) as b from public.fee_dues
              where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids))
              order by due_date, label for update loop
      exit when left_amt <= 0;
      take := least(d.b, left_amt);
      if take > 0 then
        insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, d.id, take);
        left_amt := left_amt - take; any_line := true;
      end if;
    end loop;
  end if;
  if wuse > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'applied', -wuse, rid, 'Used against receipt ' || rno, p_by); end if;
  if excess > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'advance', excess, rid, 'Advance with receipt ' || rno, p_by); end if;
  return rid;
end $$;


revoke execute on function public.collect_fee_core(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric, boolean, uuid, jsonb) from public, anon, authenticated;

create or replace function public.collect_fee_v2(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[] default null, p_wallet_use numeric default 0,
                                                 p_paid_on date default null, p_note text default null, p_by text default null, p_fine numeric default 0,
                                                 p_alloc jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'fees.collection.create') then raise exception 'not allowed'; end if;
  return public.collect_fee_core(sid, stu, p_splits, p_due_ids, p_wallet_use, p_paid_on, p_note, p_by, p_fine, false, null, p_alloc);
end $$;

-- brings the late fine of one student up to date (the fee desk calls it when a student is opened)
create or replace function public.refresh_student_fines(sid uuid, stu uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_perm_school(sid, 'fees.collection.create') or public.has_perm_school(sid, 'fees.collection.view')) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid) then return 0; end if;
  return public.apply_late_fines_core(sid, stu, public.today_ist());
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 16: template studio — templates can carry a visual design (drag-and-drop canvas, like Canva).
--   design  : the canvas as JSON (items with position, size, style) — the editable source
--   body_html : the HTML compiled from it (what the database renders and sanitises, unchanged)
--   module  : which module the template belongs to (students, staff, fees, admissions, library, transport …)
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════
-- (also in 0016; repeated so this migration works on its own) the "fees" category of fee receipts / notices / statements
alter table public.document_templates drop constraint if exists document_templates_category_check;
alter table public.document_templates add constraint document_templates_category_check
  check (category in ('certificate','id_card','letter','fees','other'));

alter table public.document_templates add column if not exists design jsonb;
alter table public.document_templates add column if not exists module text;
alter table public.document_templates add column if not exists preset text;          -- the gallery design it was made from

-- design is kept with the version history, so a restore brings the canvas back too
alter table public.document_template_versions add column if not exists design jsonb;

create or replace function public.template_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    insert into public.document_template_versions (template_id, school_id, version, name, body_html, fields, design, changed_by)
    values (new.id, new.school_id, new.version, new.name, new.body_html, new.fields, new.design, auth.uid()) on conflict (template_id, version) do nothing;
  end if;
  return null;
end $$;

-- a new design counts as a new version even if the compiled html happened to be identical
create or replace function public.template_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body_html := public.sanitize_template_html(new.body_html);
  if tg_op = 'UPDATE' then
    if new.body_html is distinct from old.body_html or new.fields is distinct from old.fields or new.design is distinct from old.design then new.version := old.version + 1; else new.version := old.version; end if;
    new.updated_at := now();
    new.code := old.code; new.school_id := old.school_id;
  end if;
  return new;
end $$;

-- module of the standard templates
update public.document_templates set module = case
  when category = 'fees' then 'fees'
  when audience = 'staff' then 'staff'
  else 'students' end
 where module is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 17: bind a fee template to what it is used for.
-- Before: the receipt looked for a template with the code "fee_receipt" only, so a template made from the
-- gallery (or a blank design) under another code was never applied.
-- Now: document_templates.fee_kind says "this one is THE receipt / demand notice / statement"; one per school.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.document_templates drop constraint if exists document_templates_category_check;
alter table public.document_templates add constraint document_templates_category_check
  check (category in ('certificate','id_card','letter','fees','other'));
alter table public.document_templates add column if not exists design jsonb;
alter table public.document_templates add column if not exists module text;
alter table public.document_templates add column if not exists preset text;

alter table public.document_templates add column if not exists fee_kind text;
alter table public.document_templates drop constraint if exists document_templates_fee_kind_check;
alter table public.document_templates add constraint document_templates_fee_kind_check check (fee_kind is null or fee_kind in ('receipt', 'demand', 'statement'));
drop index if exists public.document_templates_fee_kind;

-- templates that already exist: the standard code wins, else the gallery design, else the newest one of the category
update public.document_templates set fee_kind = null where fee_kind is not null;
with ranked as (
  select id, school_id,
         case when code = 'fee_receipt' or preset = 'fee_receipt_design' or code like 'fee_receipt%' then 'receipt'
              when code = 'fee_demand' or preset = 'fee_demand_design' or code like 'fee_demand%' then 'demand'
              when code = 'fee_statement' or preset = 'fee_statement_design' or code like 'fee_statement%' then 'statement' end as k,
         row_number() over (partition by school_id,
              case when code = 'fee_receipt' or preset = 'fee_receipt_design' or code like 'fee_receipt%' then 'receipt'
                   when code = 'fee_demand' or preset = 'fee_demand_design' or code like 'fee_demand%' then 'demand'
                   when code = 'fee_statement' or preset = 'fee_statement_design' or code like 'fee_statement%' then 'statement' end
              order by (code like 'fee\_%' and code in ('fee_receipt', 'fee_demand', 'fee_statement')) asc, updated_at desc) as rn
    from public.document_templates where category = 'fees' and active
)
update public.document_templates t set fee_kind = r.k from ranked r where t.id = r.id and r.k is not null and r.rn = 1;

create unique index if not exists document_templates_fee_kind on public.document_templates (school_id, fee_kind) where fee_kind is not null;

-- the template to use for a document: the bound one, else the standard code, else any active fee template of that name
create or replace function public.render_fee_document(p_kind text, subject uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb; t record; sid uuid;
begin
  if p_kind not in ('receipt', 'demand', 'statement') then raise exception 'Unknown document.'; end if;
  d := public.fee_template_data(p_kind, subject);
  if d is null then return null; end if;
  select school_id into sid from public.students where id = (case when p_kind = 'receipt' then (select student_id from public.fee_receipts where id = subject) else subject end);
  select * into t from public.document_templates
   where school_id = sid and category = 'fees' and active
     and (fee_kind = p_kind or code = 'fee_' || p_kind or preset = 'fee_' || p_kind || '_design')
   order by (fee_kind = p_kind) desc nulls last, (code = 'fee_' || p_kind) desc, updated_at desc limit 1;
  if t.id is null then return null; end if;
  return jsonb_build_object('html', public.sanitize_template_html(public.render_document(t.body_html, d)), 'template_id', t.id, 'name', t.name,
                            'page_size', t.page_size, 'orientation', t.orientation);
end $$;

create or replace function public.preview_fee_template(tpl uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t record; subj uuid; d jsonb; k text;
begin
  select * into t from public.document_templates where id = tpl;
  if t.id is null or t.category <> 'fees' or not public.has_perm_school(t.school_id, 'documents.templates.view') then return null; end if;
  k := coalesce(t.fee_kind, case when t.code like 'fee_demand%' or t.preset like 'fee_demand%' then 'demand' when t.code like 'fee_statement%' or t.preset like 'fee_statement%' then 'statement' else 'receipt' end);
  if k = 'receipt' then
    select id into subj from public.fee_receipts where school_id = t.school_id order by created_at desc limit 1;
  else
    select du.student_id into subj from public.fee_dues du where du.school_id = t.school_id group by du.student_id order by sum(du.amount - du.concession + du.fine - du.paid) desc limit 1;
  end if;
  if subj is null then return jsonb_build_object('empty', true); end if;
  d := public.fee_template_data(k, subj);
  if d is null then return jsonb_build_object('empty', true); end if;
  return jsonb_build_object('html', public.sanitize_template_html(public.render_document(t.body_html, d)));
end $$;

-- "use this template for receipts / demand notices / statements" (one per school and kind); null = stop using it
create or replace function public.set_fee_template(tpl uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.document_templates where id = tpl;
  if t.id is null then raise exception 'Template not found.'; end if;
  if not public.has_perm_school(t.school_id, 'documents.templates.edit') then raise exception 'not allowed'; end if;
  if p_kind is not null and p_kind not in ('receipt', 'demand', 'statement') then raise exception 'Unknown document type.'; end if;
  if p_kind is null then
    update public.document_templates set fee_kind = null where id = tpl;
    return;
  end if;
  update public.document_templates set fee_kind = null where school_id = t.school_id and fee_kind = p_kind and id <> tpl;
  update public.document_templates set category = 'fees', fee_kind = p_kind, active = true, module = 'fees' where id = tpl;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 18: transport — live bus tracking (driver phone → map for parents and the office), stop locations,
--          trips, position history, and database-side list functions (search / filter / pages).
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Locations ─────────────
alter table public.transport_stops add column if not exists lat numeric(9,6);
alter table public.transport_stops add column if not exists lng numeric(9,6);
alter table public.transport_stops drop constraint if exists transport_stops_geo_check;
alter table public.transport_stops add constraint transport_stops_geo_check
  check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180));

alter table public.schools add column if not exists lat numeric(9,6);
alter table public.schools add column if not exists lng numeric(9,6);

-- the driver's private link: /drive/<token>
alter table public.transport_vehicles add column if not exists track_token text;
update public.transport_vehicles set track_token = encode(gen_random_bytes(12), 'hex') where track_token is null;
alter table public.transport_vehicles alter column track_token set default encode(gen_random_bytes(12), 'hex');
create unique index if not exists transport_vehicles_token on public.transport_vehicles (track_token);

-- ───────────── Trips and positions ─────────────
create table if not exists public.transport_trips (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  vehicle_id  uuid not null references public.transport_vehicles(id) on delete cascade,
  route_id    uuid references public.transport_routes(id) on delete set null,
  kind        text not null default 'pickup' check (kind in ('pickup', 'drop')),
  status      text not null default 'running' check (status in ('running', 'ended')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists transport_trips_vehicle_idx on public.transport_trips (vehicle_id, started_at desc);
create unique index if not exists transport_trips_one_running on public.transport_trips (vehicle_id) where status = 'running';

create table if not exists public.transport_vehicle_position (
  vehicle_id  uuid primary key references public.transport_vehicles(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  trip_id     uuid references public.transport_trips(id) on delete set null,
  lat         numeric(9,6) not null check (lat between -90 and 90),
  lng         numeric(9,6) not null check (lng between -180 and 180),
  speed_kmh   numeric(6,1) check (speed_kmh is null or speed_kmh between 0 and 250),
  heading     numeric(5,1) check (heading is null or heading between 0 and 360),
  accuracy_m  numeric(8,1),
  updated_at  timestamptz not null default now()
);

create table if not exists public.transport_position_log (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references public.schools(id) on delete cascade,
  trip_id     uuid not null references public.transport_trips(id) on delete cascade,
  lat         numeric(9,6) not null,
  lng         numeric(9,6) not null,
  speed_kmh   numeric(6,1),
  at          timestamptz not null default now()
);
create index if not exists transport_position_log_trip_idx on public.transport_position_log (trip_id, at);

alter table public.transport_trips enable row level security;
alter table public.transport_vehicle_position enable row level security;
alter table public.transport_position_log enable row level security;
drop policy if exists "read" on public.transport_trips;
create policy "read" on public.transport_trips for select to authenticated using (public.has_perm_school(school_id, 'transport.tracking.view'));
drop policy if exists "read" on public.transport_vehicle_position;
create policy "read" on public.transport_vehicle_position for select to authenticated using (public.has_perm_school(school_id, 'transport.tracking.view'));
drop policy if exists "read" on public.transport_position_log;
create policy "read" on public.transport_position_log for select to authenticated using (public.has_perm_school(school_id, 'transport.tracking.view'));
-- written only by the driver functions below

-- ───────────── Geometry ─────────────
create or replace function public.geo_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable as $$
  select (2 * 6371 * asin(least(1, sqrt(
    power(sin(radians((lat2 - lat1) / 2)), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lng2 - lng1) / 2)), 2)))))::numeric;
$$;

-- ───────────── Driver side (called by the app server only, with the vehicle's private token) ─────────────
create or replace function public._vehicle_by_token(p_token text) returns public.transport_vehicles
language plpgsql stable security definer set search_path = public as $$
declare v public.transport_vehicles;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{24}$' then raise exception 'This driver link is not valid.'; end if;
  select * into v from public.transport_vehicles where track_token = p_token and active;
  if v.id is null then raise exception 'This driver link is not valid or the vehicle is switched off.'; end if;
  return v;
end $$;
revoke execute on function public._vehicle_by_token(text) from public, anon, authenticated;

create or replace function public.driver_status(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.transport_vehicles; t record; p record; r record;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  v := public._vehicle_by_token(p_token);
  select * into t from public.transport_trips where vehicle_id = v.id and status = 'running';
  select * into p from public.transport_vehicle_position where vehicle_id = v.id;
  select r2.name, r2.id into r from public.transport_routes r2 where r2.vehicle_id = v.id and r2.active order by r2.name limit 1;
  return jsonb_build_object('vehicle', v.reg_no, 'driver', v.driver_name, 'route', r.name, 'route_id', r.id,
    'trip', case when t.id is null then null else jsonb_build_object('id', t.id, 'kind', t.kind, 'started_at', t.started_at) end,
    'last_ping', p.updated_at, 'school', (select name from public.schools where id = v.school_id));
end $$;
revoke execute on function public.driver_status(text) from public, anon, authenticated;
grant execute on function public.driver_status(text) to service_role;

create or replace function public.driver_start_trip(p_token text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.transport_vehicles; rid uuid; tid uuid;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  if p_kind not in ('pickup', 'drop') then raise exception 'Choose pickup or drop.'; end if;
  v := public._vehicle_by_token(p_token);
  select id into rid from public.transport_routes where vehicle_id = v.id and active order by name limit 1;
  update public.transport_trips set status = 'ended', ended_at = now() where vehicle_id = v.id and status = 'running';
  insert into public.transport_trips (school_id, vehicle_id, route_id, kind) values (v.school_id, v.id, rid, p_kind) returning id into tid;
  -- old position from a previous trip must not look live
  delete from public.transport_vehicle_position where vehicle_id = v.id;
  return jsonb_build_object('trip_id', tid, 'kind', p_kind);
end $$;
revoke execute on function public.driver_start_trip(text, text) from public, anon, authenticated;
grant execute on function public.driver_start_trip(text, text) to service_role;

create or replace function public.driver_ping(p_token text, p_lat numeric, p_lng numeric, p_speed numeric default null, p_heading numeric default null, p_accuracy numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.transport_vehicles; t record; last_at timestamptz; last_log timestamptz;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location.'; end if;
  v := public._vehicle_by_token(p_token);
  select * into t from public.transport_trips where vehicle_id = v.id and status = 'running';
  if t.id is null then raise exception 'Start the trip first.'; end if;
  select updated_at into last_at from public.transport_vehicle_position where vehicle_id = v.id;
  if last_at is not null and last_at > now() - interval '2 seconds' then return jsonb_build_object('ok', true, 'skipped', true); end if;
  insert into public.transport_vehicle_position (vehicle_id, school_id, trip_id, lat, lng, speed_kmh, heading, accuracy_m, updated_at)
  values (v.id, v.school_id, t.id, round(p_lat, 6), round(p_lng, 6), least(greatest(coalesce(p_speed, 0), 0), 250), p_heading, p_accuracy, now())
  on conflict (vehicle_id) do update set trip_id = excluded.trip_id, lat = excluded.lat, lng = excluded.lng, speed_kmh = excluded.speed_kmh,
        heading = excluded.heading, accuracy_m = excluded.accuracy_m, updated_at = excluded.updated_at;
  select max(at) into last_log from public.transport_position_log where trip_id = t.id;
  if last_log is null or last_log < now() - interval '8 seconds' then
    insert into public.transport_position_log (school_id, trip_id, lat, lng, speed_kmh) values (v.school_id, t.id, round(p_lat, 6), round(p_lng, 6), p_speed);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.driver_ping(text, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.driver_ping(text, numeric, numeric, numeric, numeric, numeric) to service_role;

create or replace function public.driver_end_trip(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.transport_vehicles;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  v := public._vehicle_by_token(p_token);
  update public.transport_trips set status = 'ended', ended_at = now() where vehicle_id = v.id and status = 'running';
  delete from public.transport_vehicle_position where vehicle_id = v.id;
  -- history older than 45 days is dropped
  delete from public.transport_position_log where school_id = v.school_id and at < now() - interval '45 days';
end $$;
revoke execute on function public.driver_end_trip(text) from public, anon, authenticated;
grant execute on function public.driver_end_trip(text) to service_role;

create or replace function public.rotate_driver_token(vid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v record; t text;
begin
  select * into v from public.transport_vehicles where id = vid;
  if v.id is null or not public.has_perm_school(v.school_id, 'transport.routes.edit') then raise exception 'not allowed'; end if;
  t := encode(gen_random_bytes(12), 'hex');
  update public.transport_vehicles set track_token = t where id = vid;
  update public.transport_trips set status = 'ended', ended_at = now() where vehicle_id = vid and status = 'running';
  delete from public.transport_vehicle_position where vehicle_id = vid;
  return t;
end $$;

create or replace function public.set_school_location(sid uuid, p_lat numeric, p_lng numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'transport.routes.edit') then raise exception 'not allowed'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Invalid location.'; end if;
  update public.schools set lat = round(p_lat, 6), lng = round(p_lng, 6) where id = sid;
end $$;

-- ───────────── Office side ─────────────
-- every vehicle with its route, its trip and its last position (fresh = a ping in the last 60 seconds)
create or replace function public.live_vehicles(sid uuid)
returns table (vehicle_id uuid, reg_no text, kind text, driver_name text, driver_phone text, route_id uuid, route_name text, trip_id uuid, trip_kind text, trip_started timestamptz,
               lat numeric, lng numeric, speed_kmh numeric, heading numeric, updated_at timestamptz, age_s int, state text, riders bigint)
language sql stable security definer set search_path = public as $$
  select v.id, v.reg_no, v.kind, v.driver_name, v.driver_phone, r.id, r.name, t.id, t.kind, t.started_at,
         p.lat, p.lng, p.speed_kmh, p.heading, p.updated_at, extract(epoch from now() - p.updated_at)::int,
         case when t.id is null then 'idle' when p.updated_at is null then 'waiting' when p.updated_at < now() - interval '90 seconds' then 'offline'
              when coalesce(p.speed_kmh, 0) < 2 then 'stopped' else 'moving' end,
         (select count(*) from public.transport_allocations a where a.route_id = r.id and a.end_date is null)
    from public.transport_vehicles v
    left join lateral (select * from public.transport_routes rr where rr.vehicle_id = v.id and rr.active order by rr.name limit 1) r on true
    left join public.transport_trips t on t.vehicle_id = v.id and t.status = 'running'
    left join public.transport_vehicle_position p on p.vehicle_id = v.id and p.trip_id = t.id
   where v.school_id = sid and v.active and public.has_perm_school(sid, 'transport.tracking.view')
   order by (t.id is not null) desc, v.reg_no;
$$;

create or replace function public.trip_trace(p_trip uuid) returns table (lat numeric, lng numeric, at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.lat, l.lng, l.at from public.transport_position_log l join public.transport_trips t on t.id = l.trip_id
   where l.trip_id = p_trip and public.has_perm_school(t.school_id, 'transport.tracking.view') order by l.at limit 3000;
$$;

-- recent trips of the school (history screen)
create or replace function public.trip_history(sid uuid, p_vehicle uuid default null, p_limit int default 25, p_offset int default 0)
returns table (trip_id uuid, vehicle_id uuid, reg_no text, route_name text, kind text, started_at timestamptz, ended_at timestamptz, minutes int, points bigint, total bigint)
language sql stable security definer set search_path = public as $$
  select t.id, v.id, v.reg_no, r.name, t.kind, t.started_at, t.ended_at,
         (extract(epoch from coalesce(t.ended_at, now()) - t.started_at) / 60)::int,
         (select count(*) from public.transport_position_log l where l.trip_id = t.id), count(*) over ()
    from public.transport_trips t join public.transport_vehicles v on v.id = t.vehicle_id left join public.transport_routes r on r.id = t.route_id
   where t.school_id = sid and public.has_perm_school(sid, 'transport.tracking.view') and (p_vehicle is null or t.vehicle_id = p_vehicle)
   order by t.started_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── Parent side (called by the app server for a valid parent link) ─────────────
create or replace function public.child_bus(stu uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v record; t record; p record; st record; sc record; stops jsonb; d numeric; sp numeric; eta int; state text; stop_lat numeric; stop_lng numeric;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select al.*, r.name as route_name, r.vehicle_id, s.name as stop_name, s.lat as slat, s.lng as slng, s.pickup_time, s.drop_time, s.sort as stop_sort
    into a from public.transport_allocations al join public.transport_routes r on r.id = al.route_id join public.transport_stops s on s.id = al.stop_id
   where al.student_id = stu and al.end_date is null order by al.start_date desc limit 1;
  if a.id is null then return jsonb_build_object('allocated', false); end if;
  select * into v from public.transport_vehicles where id = a.vehicle_id;
  select * into sc from public.schools where id = a.school_id;
  select * into t from public.transport_trips where vehicle_id = a.vehicle_id and status = 'running';
  select * into p from public.transport_vehicle_position where vehicle_id = a.vehicle_id and trip_id = t.id;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'seq', s.sort, 'lat', s.lat, 'lng', s.lng, 'pickup', s.pickup_time, 'drop', s.drop_time,
           'mine', s.id = a.stop_id,
           'visited', t.id is not null and s.lat is not null and exists (select 1 from public.transport_position_log l where l.trip_id = t.id and public.geo_km(l.lat, l.lng, s.lat, s.lng) < 0.15))
           order by s.sort), '[]'::jsonb)
    into stops from public.transport_stops s where s.route_id = a.route_id;

  state := 'not_started';
  if t.id is not null then
    state := case when p.updated_at is null then 'starting' when p.updated_at < now() - interval '90 seconds' then 'offline' else 'on_the_way' end;
  end if;
  if p.lat is not null and a.slat is not null then
    d := public.geo_km(p.lat, p.lng, a.slat, a.slng);
    sp := greatest(coalesce(p.speed_kmh, 0), 18);                          -- a moving school bus; slower readings are treated as 18 km/h
    eta := ceil(d / sp * 60);
    if d < 0.15 then state := 'reached'; elsif d < 1 and state = 'on_the_way' then state := 'near'; end if;
  end if;
  return jsonb_build_object(
    'allocated', true, 'state', state, 'student_trip', a.trip,
    'vehicle', jsonb_build_object('reg_no', v.reg_no, 'driver', v.driver_name, 'phone', v.driver_phone, 'attendant', v.attendant_name, 'attendant_phone', v.attendant_phone),
    'route', a.route_name,
    'my_stop', jsonb_build_object('name', a.stop_name, 'lat', a.slat, 'lng', a.slng, 'pickup', a.pickup_time, 'drop', a.drop_time),
    'school', jsonb_build_object('name', sc.name, 'lat', sc.lat, 'lng', sc.lng),
    'trip', case when t.id is null then null else jsonb_build_object('kind', t.kind, 'started_at', t.started_at) end,
    'position', case when p.lat is null then null else jsonb_build_object('lat', p.lat, 'lng', p.lng, 'speed', p.speed_kmh, 'heading', p.heading, 'age_s', extract(epoch from now() - p.updated_at)::int) end,
    'distance_km', case when d is null then null else round(d, 2) end, 'eta_min', eta, 'stops', stops);
end $$;
revoke execute on function public.child_bus(uuid) from public, anon, authenticated;
grant execute on function public.child_bus(uuid) to service_role;

-- ───────────── Riders: search + filter + sort + count + page in the database ─────────────
create or replace function public.transport_riders(sid uuid, sess uuid, p_q text default null, p_route uuid default null, p_stop uuid default null, p_class uuid default null,
    p_trip text default null, p_ended boolean default false, p_sort text default 'route', p_limit int default 25, p_offset int default 0)
returns table (alloc_id uuid, student_id uuid, admission_no text, student_name text, class_name text, section_name text, guardian_phone text, father_name text,
               route_id uuid, route_name text, stop_id uuid, stop_name text, pickup_time time, trip text, fee numeric, start_date date, end_date date, total bigint, monthly_total numeric)
language sql stable set search_path = public as $$
  with base as (
    select al.id as aid, s.id as sid2, s.admission_no, btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)) as nm, c.name as cname, c.sort as csort, sec.name as secname,
           s.guardian_phone, s.father_name, r.id as rid, r.name as rname, st.id as stid, st.name as stname, st.pickup_time, al.trip,
           coalesce(al.monthly_fee, st.monthly_fee, 0) as fee, al.start_date, al.end_date, st.sort as stsort
      from public.transport_allocations al
      join public.students s on s.id = al.student_id
      join public.transport_routes r on r.id = al.route_id
      join public.transport_stops st on st.id = al.stop_id
      left join public.classes c on c.id = s.class_id
      left join public.sections sec on sec.id = s.section_id
     where al.school_id = sid and al.session_id = sess
       and (p_ended or al.end_date is null)
       and (p_route is null or al.route_id = p_route) and (p_stop is null or al.stop_id = p_stop) and (p_class is null or s.class_id = p_class)
       and (p_trip is null or p_trip = '' or al.trip = p_trip)
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or concat_ws(' ', s.first_name, s.middle_name, s.last_name) ilike public.like_escape(btrim(p_q)) or s.admission_no ilike public.like_escape(btrim(p_q))
            or s.guardian_phone ilike public.like_escape(btrim(p_q)) or s.father_name ilike public.like_escape(btrim(p_q)) or st.name ilike public.like_escape(btrim(p_q)))
  )
  select b.aid, b.sid2, b.admission_no, b.nm, b.cname, b.secname, b.guardian_phone, b.father_name, b.rid, b.rname, b.stid, b.stname, b.pickup_time, b.trip, b.fee, b.start_date, b.end_date,
         count(*) over (), sum(case when b.end_date is null then b.fee else 0 end) over ()
    from base b
   order by
     case when p_sort = 'name' then b.nm end asc,
     case when p_sort = 'class' then b.csort end asc nulls last,
     case when p_sort = 'fee' then b.fee end desc,
     b.rname asc, b.stsort asc, b.nm asc, b.aid
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- vehicles: papers due is computed here so it can be filtered and paged
create or replace function public.vehicle_list(sid uuid, p_q text default null, p_kind text default null, p_active text default 'yes', p_papers text default null,
    p_limit int default 25, p_offset int default 0)
returns table (id uuid, reg_no text, kind text, capacity int, driver_name text, driver_phone text, attendant_name text, active boolean, route_names text,
               insurance_upto date, fitness_upto date, permit_upto date, puc_upto date, papers_due int, track_token text, seen_at timestamptz, trip_state text, total bigint)
language sql stable security definer set search_path = public as $$
  with base as (
    select v.*, (select string_agg(r.name, ', ' order by r.name) from public.transport_routes r where r.vehicle_id = v.id) as rn,
           (select count(*) from unnest(array[v.insurance_upto, v.fitness_upto, v.permit_upto, v.puc_upto]) d where d is not null and d <= public.today_ist() + 30)::int as due,
           p.updated_at as seen, t.status as ts
      from public.transport_vehicles v
      left join public.transport_vehicle_position p on p.vehicle_id = v.id
      left join public.transport_trips t on t.vehicle_id = v.id and t.status = 'running'
     where v.school_id = sid and (public.has_perm_school(sid, 'transport.routes.view') or public.has_perm_school(sid, 'transport.allocation.view'))
       and (p_kind is null or p_kind = '' or v.kind = p_kind)
       and (p_active is null or p_active = '' or p_active = 'all' or (p_active = 'yes' and v.active) or (p_active = 'no' and not v.active))
       and (nullif(btrim(coalesce(p_q, '')), '') is null or v.reg_no ilike public.like_escape(btrim(p_q)) or v.driver_name ilike public.like_escape(btrim(p_q))
            or v.driver_phone ilike public.like_escape(btrim(p_q)) or v.attendant_name ilike public.like_escape(btrim(p_q)))
  )
  select b.id, b.reg_no, b.kind, b.capacity, b.driver_name, b.driver_phone, b.attendant_name, b.active, b.rn, b.insurance_upto, b.fitness_upto, b.permit_upto, b.puc_upto, b.due,
         case when public.has_perm_school(sid, 'transport.routes.edit') then b.track_token end, b.seen, b.ts, count(*) over ()
    from base b
   where (p_papers is null or p_papers = '' or (p_papers = 'due' and b.due > 0) or (p_papers = 'ok' and b.due = 0))
   order by b.reg_no
   limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- audit for the vehicle token rotation is covered by the audit trigger on transport_vehicles when present
