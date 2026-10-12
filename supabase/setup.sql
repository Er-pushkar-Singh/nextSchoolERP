-- School ERP: full database setup (migrations 0001–0007 combined).
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
  ('academics', 'Academic setup', 'Academic', 'MVP', false, 3),
  ('homework', 'Homework & study material', 'Academic', 'Phase 2', false, 4),
  ('attendance', 'Attendance', 'Academic', 'MVP', false, 5),
  ('exams', 'Examinations', 'Academic', 'MVP', false, 6),
  ('fees', 'Fees', 'Finance', 'MVP', false, 7),
  ('accounts', 'Accounts', 'Finance', 'Phase 3', false, 8),
  ('hr', 'Staff & payroll', 'Operations', 'Phase 2', false, 9),
  ('comms', 'Communication', 'Communication', 'MVP', false, 10),
  ('transport', 'Transport', 'Operations', 'Phase 2', false, 11),
  ('library', 'Library', 'Operations', 'Phase 3', false, 12),
  ('hostel', 'Hostel', 'Operations', 'Phase 3', false, 13),
  ('inventory', 'Inventory & sales', 'Operations', 'Phase 3', false, 14),
  ('wellbeing', 'Health & discipline', 'Operations', 'Phase 3', false, 15),
  ('reports', 'Reports & analytics', 'Reports', 'MVP', false, 16),
  ('settings', 'Settings & security', 'Core', 'MVP', true, 17),
  ('support', 'Help & support', 'Core', 'MVP', true, 18)
on conflict (code) do update set name = excluded.name, grp = excluded.grp, tier = excluded.tier, core = excluded.core, sort = excluded.sort;

insert into public.erp_submodules (code, module_code, name, built, sort) values
  ('dashboard.overview', 'dashboard', 'Dashboard', true, 0),
  ('frontdesk.enquiries', 'frontdesk', 'Admission enquiries', true, 0),
  ('frontdesk.admissions', 'frontdesk', 'Admission approval', false, 1),
  ('frontdesk.online_form', 'frontdesk', 'Online registration form', false, 2),
  ('frontdesk.visitors', 'frontdesk', 'Visitor & call log, gate pass', false, 3),
  ('students.profile', 'students', 'Student profile & guardians', true, 0),
  ('students.sensitive', 'students', 'Aadhaar, medical, PEN / APAAR', false, 1),
  ('students.import', 'students', 'Bulk import', true, 2),
  ('students.promotion', 'students', 'Promotion & section change', true, 3),
  ('students.certificates', 'students', 'TC, bonafide & ID cards', false, 4),
  ('students.parent_link', 'students', 'Parent page link', true, 5),
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
  ('fees.online', 'fees', 'Online payment', false, 6),
  ('fees.refunds', 'fees', 'Refunds', false, 7),
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
  ('transport.tracking', 'transport', 'GPS tracking', false, 2),
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
  ('frontdesk.admissions.approve', 'frontdesk.admissions', 'frontdesk', 'approve'),
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
delete from public.erp_permissions where key not in ('dashboard.overview.view', 'frontdesk.enquiries.view', 'frontdesk.enquiries.create', 'frontdesk.enquiries.edit', 'frontdesk.enquiries.delete', 'frontdesk.enquiries.export', 'frontdesk.admissions.view', 'frontdesk.admissions.approve', 'frontdesk.online_form.view', 'frontdesk.online_form.edit', 'frontdesk.visitors.view', 'frontdesk.visitors.create', 'frontdesk.visitors.edit', 'frontdesk.visitors.delete', 'students.profile.view', 'students.profile.create', 'students.profile.edit', 'students.profile.delete', 'students.profile.export', 'students.profile.print', 'students.sensitive.view', 'students.sensitive.edit', 'students.import.create', 'students.promotion.view', 'students.promotion.create', 'students.certificates.view', 'students.certificates.create', 'students.certificates.print', 'students.certificates.approve', 'students.parent_link.view', 'students.parent_link.edit', 'academics.setup.view', 'academics.setup.create', 'academics.setup.edit', 'academics.setup.delete', 'academics.allocation.view', 'academics.allocation.create', 'academics.allocation.edit', 'academics.allocation.delete', 'academics.timetable.view', 'academics.timetable.create', 'academics.timetable.edit', 'academics.timetable.delete', 'academics.timetable.print', 'academics.syllabus.view', 'academics.syllabus.create', 'academics.syllabus.edit', 'academics.syllabus.delete', 'academics.syllabus.approve', 'homework.homework.view', 'homework.homework.create', 'homework.homework.edit', 'homework.homework.delete', 'homework.material.view', 'homework.material.create', 'homework.material.edit', 'homework.material.delete', 'attendance.students.view', 'attendance.students.create', 'attendance.students.edit', 'attendance.students.export', 'attendance.students.print', 'attendance.leave.view', 'attendance.leave.create', 'attendance.leave.approve', 'attendance.staff.view', 'attendance.staff.create', 'attendance.staff.edit', 'attendance.staff.export', 'exams.setup.view', 'exams.setup.create', 'exams.setup.edit', 'exams.setup.delete', 'exams.marks.view', 'exams.marks.create', 'exams.marks.edit', 'exams.marks.approve', 'exams.results.view', 'exams.results.print', 'exams.results.publish', 'exams.admit_cards.view', 'exams.admit_cards.create', 'exams.admit_cards.print', 'fees.structure.view', 'fees.structure.create', 'fees.structure.edit', 'fees.structure.delete', 'fees.dues.view', 'fees.dues.create', 'fees.collection.view', 'fees.collection.create', 'fees.collection.print', 'fees.collection.export', 'fees.receipts.view', 'fees.receipts.print', 'fees.receipts.export', 'fees.receipts.approve', 'fees.concessions.view', 'fees.concessions.create', 'fees.concessions.delete', 'fees.concessions.approve', 'fees.defaulters.view', 'fees.defaulters.create', 'fees.defaulters.export', 'fees.online.view', 'fees.online.create', 'fees.refunds.view', 'fees.refunds.create', 'fees.refunds.approve', 'accounts.vouchers.view', 'accounts.vouchers.create', 'accounts.vouchers.edit', 'accounts.vouchers.delete', 'accounts.vouchers.approve', 'accounts.vouchers.export', 'accounts.books.view', 'accounts.books.export', 'accounts.books.print', 'hr.staff.view', 'hr.staff.create', 'hr.staff.edit', 'hr.staff.delete', 'hr.staff.export', 'hr.leave.view', 'hr.leave.create', 'hr.leave.approve', 'hr.payroll.view', 'hr.payroll.create', 'hr.payroll.edit', 'hr.payroll.approve', 'hr.payroll.export', 'hr.payroll.print', 'comms.notices.view', 'comms.notices.create', 'comms.notices.edit', 'comms.notices.delete', 'comms.notices.publish', 'comms.broadcast.create', 'comms.templates.view', 'comms.templates.create', 'comms.templates.edit', 'comms.templates.delete', 'comms.calendar.view', 'comms.calendar.create', 'comms.calendar.edit', 'comms.calendar.delete', 'comms.messages.view', 'comms.messages.create', 'transport.routes.view', 'transport.routes.create', 'transport.routes.edit', 'transport.routes.delete', 'transport.allocation.view', 'transport.allocation.create', 'transport.allocation.edit', 'transport.allocation.delete', 'transport.tracking.view', 'library.catalogue.view', 'library.catalogue.create', 'library.catalogue.edit', 'library.catalogue.delete', 'library.circulation.view', 'library.circulation.create', 'library.circulation.edit', 'hostel.rooms.view', 'hostel.rooms.create', 'hostel.rooms.edit', 'hostel.rooms.delete', 'hostel.allocation.view', 'hostel.allocation.create', 'hostel.allocation.edit', 'hostel.allocation.delete', 'inventory.items.view', 'inventory.items.create', 'inventory.items.edit', 'inventory.items.delete', 'inventory.sales.view', 'inventory.sales.create', 'inventory.sales.print', 'wellbeing.medical.view', 'wellbeing.medical.create', 'wellbeing.medical.edit', 'wellbeing.discipline.view', 'wellbeing.discipline.create', 'wellbeing.discipline.edit', 'reports.fees.view', 'reports.fees.export', 'reports.academic.view', 'reports.academic.export', 'reports.udise.export', 'settings.school.view', 'settings.school.edit', 'settings.billing.view', 'settings.billing.create', 'settings.users.view', 'settings.users.create', 'settings.users.edit', 'settings.users.delete', 'settings.roles.view', 'settings.roles.create', 'settings.roles.edit', 'settings.roles.delete', 'settings.integrations.view', 'settings.integrations.edit', 'settings.backups.view', 'settings.backups.create', 'settings.audit.view', 'support.tickets.view', 'support.tickets.create');
delete from public.erp_submodules where code not in ('dashboard.overview', 'frontdesk.enquiries', 'frontdesk.admissions', 'frontdesk.online_form', 'frontdesk.visitors', 'students.profile', 'students.sensitive', 'students.import', 'students.promotion', 'students.certificates', 'students.parent_link', 'academics.setup', 'academics.allocation', 'academics.timetable', 'academics.syllabus', 'homework.homework', 'homework.material', 'attendance.students', 'attendance.leave', 'attendance.staff', 'exams.setup', 'exams.marks', 'exams.results', 'exams.admit_cards', 'fees.structure', 'fees.dues', 'fees.collection', 'fees.receipts', 'fees.concessions', 'fees.defaulters', 'fees.online', 'fees.refunds', 'accounts.vouchers', 'accounts.books', 'hr.staff', 'hr.leave', 'hr.payroll', 'comms.notices', 'comms.broadcast', 'comms.templates', 'comms.calendar', 'comms.messages', 'transport.routes', 'transport.allocation', 'transport.tracking', 'library.catalogue', 'library.circulation', 'hostel.rooms', 'hostel.allocation', 'inventory.items', 'inventory.sales', 'wellbeing.medical', 'wellbeing.discipline', 'reports.fees', 'reports.academic', 'reports.udise', 'settings.school', 'settings.billing', 'settings.users', 'settings.roles', 'settings.integrations', 'settings.backups', 'settings.audit', 'support.tickets');

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
  ('principal', 'frontdesk.admissions.approve', 'school'),
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
  ('vice_principal', 'frontdesk.admissions.approve', 'school'),
  ('vice_principal', 'students.profile.view', 'school'),
  ('vice_principal', 'students.profile.edit', 'school'),
  ('vice_principal', 'students.profile.export', 'school'),
  ('vice_principal', 'students.profile.print', 'school'),
  ('vice_principal', 'students.sensitive.view', 'school'),
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
  route_id    uuid not null references public.transport_routes(id) on delete restrict,
  stop_id     uuid not null references public.transport_stops(id) on delete restrict,
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
  staff_id         uuid not null references public.staff(id) on delete restrict,
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
    if old.status <> 'draft' then raise exception 'An approved payroll cannot be deleted. Reopen it first.'; end if;
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
  book_id        uuid not null references public.library_books(id) on delete restrict,
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
