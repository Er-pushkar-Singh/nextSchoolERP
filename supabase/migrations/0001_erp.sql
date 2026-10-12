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
