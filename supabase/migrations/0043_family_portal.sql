-- ═══════════════════════════════════════════════════════════════════════════
-- Step 41: Parent & student logins. A family login sees only its own children (or itself), applies for leave, and talks to the class team.
--   • is_my_child() / family_children()
--   • student_leaves (apply, approve / reject, cancel; an approved leave writes LV into the attendance register)
--   • family_messages (one conversation per student between the family and the class team)
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.is_my_child(stu uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id where sg.student_id = stu and g.user_id = auth.uid())
    or exists (select 1 from public.students s where s.id = stu and s.user_id = auth.uid()));
$$;

-- the children (or the student itself) the signed-in family login can open
create or replace function public.family_children()
returns table (student_id uuid, school_id uuid, school_name text, admission_no text, first_name text, last_name text, class_name text, section_name text, status text, relation text, is_self boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.school_id, sc.name, s.admission_no, s.first_name, s.last_name, c.name, sec.name, s.status, g.relation, false
    from public.guardians g
    join public.student_guardians sg on sg.guardian_id = g.id
    join public.students s on s.id = sg.student_id
    join public.schools sc on sc.id = s.school_id
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
   where g.user_id = auth.uid() and auth.uid() is not null and s.status = 'active' and sc.archived_at is null
  union
  select s.id, s.school_id, sc.name, s.admission_no, s.first_name, s.last_name, c.name, sec.name, s.status, 'self', true
    from public.students s
    join public.schools sc on sc.id = s.school_id
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
   where s.user_id = auth.uid() and auth.uid() is not null and s.status = 'active' and sc.archived_at is null
  order by 7, 5;
$$;

-- ───────────── Student leave ─────────────
create table if not exists public.student_leaves (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  student_id       uuid not null references public.students(id) on delete cascade,
  from_date        date not null,
  to_date          date not null,
  reason           text,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  applied_by       uuid references auth.users(id) on delete set null,
  applied_by_name  text,
  applied_via      text not null default 'family' check (applied_via in ('family', 'staff')),
  decided_by       uuid references auth.users(id) on delete set null,
  decided_by_name  text,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 45)
);
create index if not exists student_leaves_school_idx on public.student_leaves (school_id, status, from_date desc);
create index if not exists student_leaves_student_idx on public.student_leaves (student_id, from_date desc);
alter table public.student_leaves enable row level security;
drop policy if exists "read" on public.student_leaves;
create policy "read" on public.student_leaves for select to authenticated
  using (public.can_student(school_id, 'attendance.leave.view', student_id) or public.is_my_child(student_id));

create or replace function public._person_name(sid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select m.name from public.school_members m where m.school_id = sid and m.user_id = auth.uid()),
                  (select g.name from public.guardians g where g.user_id = auth.uid() limit 1),
                  (select u.email from auth.users u where u.id = auth.uid()), 'User');
$$;
revoke execute on function public._person_name(uuid) from public, anon;

-- apply for leave: the family for its own child, or the office on a phone call
create or replace function public.apply_student_leave(stu uuid, d1 date, d2 date, why text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.students; via text; lid uuid; today date := public.today_ist();
begin
  select * into s from public.students where id = stu;
  if s.id is null then raise exception 'Student not found'; end if;
  if public.is_my_child(stu) then via := 'family';
  elsif public.can_student(s.school_id, 'attendance.leave.create', stu) then via := 'staff';
  else raise exception 'not allowed'; end if;
  if via = 'family' and not public.school_writable(s.school_id) then raise exception 'The school is not accepting requests right now.'; end if;
  if d1 is null or d2 is null or d2 < d1 then raise exception 'Choose the first and last day of the leave.'; end if;
  if d2 - d1 > 45 then raise exception 'A leave request can cover at most 45 days.'; end if;
  if d2 < today - 7 then raise exception 'That leave is too far in the past.'; end if;
  if s.status <> 'active' then raise exception 'Only current students can apply for leave.'; end if;
  if exists (select 1 from public.student_leaves l where l.student_id = stu and l.status in ('pending', 'approved') and l.from_date <= d2 and l.to_date >= d1) then
    raise exception 'There is already a leave request for these days.';
  end if;
  insert into public.student_leaves (school_id, student_id, from_date, to_date, reason, applied_by, applied_by_name, applied_via)
    values (s.school_id, stu, d1, d2, nullif(left(btrim(coalesce(why, '')), 300), ''), auth.uid(), public._person_name(s.school_id), via)
    returning id into lid;
  return lid;
end $$;

-- write LV into the register for the school days of an approved leave (the teacher can still change a day)
create or replace function public._leave_to_register(l public.student_leaves) returns int
language plpgsql security definer set search_path = public as $$
declare s public.students; d date; n int := 0;
begin
  select * into s from public.students where id = l.student_id;
  for d in select g::date from generate_series(l.from_date, l.to_date, interval '1 day') g loop
    continue when extract(dow from d) = 0 or public.holiday_on(l.school_id, d) is not null;
    insert into public.attendance (school_id, student_id, class_id, section_id, date, status, marked_by)
      values (l.school_id, l.student_id, s.class_id, s.section_id, d, 'LV', 'leave:' || l.id)
      on conflict (student_id, date) do update set status = 'LV', marked_by = 'leave:' || l.id, marked_at = now()
       where public.attendance.status in ('A', 'LV');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public._leave_to_register(public.student_leaves) from public, anon, authenticated;

create or replace function public.decide_student_leave(lid uuid, approve boolean, note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare l public.student_leaves;
begin
  select * into l from public.student_leaves where id = lid for update;
  if l.id is null then raise exception 'Leave request not found'; end if;
  if not public.can_student(l.school_id, 'attendance.leave.approve', l.student_id) then raise exception 'not allowed'; end if;
  if l.status <> 'pending' then raise exception 'This request has already been %.', l.status; end if;
  update public.student_leaves set status = case when approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_by_name = public._person_name(l.school_id),
         decided_at = now(), decision_note = nullif(left(btrim(coalesce(note, '')), 300), '') where id = lid;
  if approve then perform public._leave_to_register(l); end if;
  return case when approve then 'approved' else 'rejected' end;
end $$;

create or replace function public.cancel_student_leave(lid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.student_leaves;
begin
  select * into l from public.student_leaves where id = lid for update;
  if l.id is null then raise exception 'Leave request not found'; end if;
  if l.status in ('cancelled', 'rejected') then return; end if;
  if not (public.can_student(l.school_id, 'attendance.leave.approve', l.student_id) or (l.status = 'pending' and l.applied_by = auth.uid())) then raise exception 'not allowed'; end if;
  update public.student_leaves set status = 'cancelled', decided_by = auth.uid(), decided_by_name = public._person_name(l.school_id), decided_at = now() where id = lid;
  delete from public.attendance where student_id = l.student_id and marked_by = 'leave:' || l.id and status = 'LV';
end $$;

-- staff list: filter + search + count + page in one query (RLS limits it to the teacher's sections)
create or replace function public.student_leave_list(sid uuid, p_status text default null, p_q text default null, p_limit int default 25, p_offset int default 0)
returns table (id uuid, student_id uuid, student_name text, admission_no text, class_name text, section_name text, from_date date, to_date date, days int, reason text, status text,
               applied_via text, applied_by_name text, decided_by_name text, decision_note text, created_at timestamptz, total bigint)
language sql stable set search_path = public as $$
  select l.id, l.student_id, concat_ws(' ', s.first_name, s.last_name), s.admission_no, c.name, sec.name, l.from_date, l.to_date, (l.to_date - l.from_date + 1)::int, l.reason, l.status,
         l.applied_via, l.applied_by_name, l.decided_by_name, l.decision_note, l.created_at, count(*) over ()
    from public.student_leaves l
    join public.students s on s.id = l.student_id
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
   where l.school_id = sid
     and (p_status is null or p_status = '' or p_status = 'all' or l.status = p_status)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', s.first_name, s.last_name) ilike public.like_escape(btrim(p_q)) or s.admission_no ilike public.like_escape(btrim(p_q)))
   order by (l.status = 'pending') desc, l.from_date desc, l.created_at desc, l.id
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ───────────── Parent ⇄ class team messages (one conversation per student) ─────────────
create table if not exists public.family_messages (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  sender_user uuid references auth.users(id) on delete set null,
  sender_name text,
  from_family boolean not null,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists family_messages_student_idx on public.family_messages (student_id, created_at desc);
create index if not exists family_messages_school_idx on public.family_messages (school_id, created_at desc);
alter table public.family_messages enable row level security;
drop policy if exists "read" on public.family_messages;
create policy "read" on public.family_messages for select to authenticated
  using (public.can_student(school_id, 'comms.messages.view', student_id) or public.is_my_child(student_id));

create or replace function public.send_family_message(stu uuid, msg text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.students; fam boolean; mid uuid;
begin
  select * into s from public.students where id = stu;
  if s.id is null then raise exception 'Student not found'; end if;
  if public.is_my_child(stu) then fam := true;
  elsif public.can_student(s.school_id, 'comms.messages.create', stu) then fam := false;
  else raise exception 'not allowed'; end if;
  if not public.school_writable(s.school_id) then raise exception 'The school is not accepting messages right now.'; end if;
  if length(btrim(coalesce(msg, ''))) = 0 then raise exception 'Write a message first.'; end if;
  if fam and (select count(*) from public.family_messages m where m.student_id = stu and m.from_family and m.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many messages in the last hour. Please wait a little.';
  end if;
  insert into public.family_messages (school_id, student_id, sender_user, sender_name, from_family, body)
    values (s.school_id, stu, auth.uid(), public._person_name(s.school_id), fam, left(btrim(msg), 2000)) returning id into mid;
  return mid;
end $$;

-- the reader marks what the other side wrote as read
create or replace function public.read_family_messages(stu uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s public.students; fam boolean; n int;
begin
  select * into s from public.students where id = stu;
  if s.id is null then return 0; end if;
  if public.is_my_child(stu) then fam := true;
  elsif public.can_student(s.school_id, 'comms.messages.view', stu) then fam := false;
  else return 0; end if;
  update public.family_messages set read_at = now() where student_id = stu and read_at is null and from_family <> fam;
  get diagnostics n = row_count;
  return n;
end $$;

-- staff inbox: one row per student with a conversation, unread first
create or replace function public.family_inbox(sid uuid, p_q text default null, p_unread boolean default false, p_limit int default 25, p_offset int default 0)
returns table (student_id uuid, student_name text, admission_no text, class_name text, section_name text, last_body text, last_at timestamptz, last_from_family boolean, unread bigint, total bigint)
language sql stable set search_path = public as $$
  with t as (
    select m.student_id, max(m.created_at) as last_at, count(*) filter (where m.from_family and m.read_at is null) as unread
      from public.family_messages m where m.school_id = sid group by m.student_id
  )
  select s.id, concat_ws(' ', s.first_name, s.last_name), s.admission_no, c.name, sec.name,
         (select m.body from public.family_messages m where m.student_id = s.id order by m.created_at desc limit 1),
         t.last_at,
         (select m.from_family from public.family_messages m where m.student_id = s.id order by m.created_at desc limit 1),
         t.unread, count(*) over ()
    from t join public.students s on s.id = t.student_id
    left join public.classes c on c.id = s.class_id
    left join public.sections sec on sec.id = s.section_id
   where (not p_unread or t.unread > 0)
     and (nullif(btrim(coalesce(p_q, '')), '') is null or concat_ws(' ', s.first_name, s.last_name) ilike public.like_escape(btrim(p_q)) or s.admission_no ilike public.like_escape(btrim(p_q)))
   order by (t.unread > 0) desc, t.last_at desc, s.id
   limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
$$;

-- unread counts for the sidebar / header badges
create or replace function public.family_unread(sid uuid) returns bigint
language sql stable set search_path = public as $$
  select count(*) from public.family_messages m where m.school_id = sid and m.from_family and m.read_at is null;
$$;

grant execute on function public.is_my_child(uuid), public.family_children(), public.apply_student_leave(uuid, date, date, text), public.decide_student_leave(uuid, boolean, text),
  public.cancel_student_leave(uuid), public.student_leave_list(uuid, text, text, int, int), public.send_family_message(uuid, text), public.read_family_messages(uuid),
  public.family_inbox(uuid, text, boolean, int, int), public.family_unread(uuid) to authenticated;

notify pgrst, 'reload schema';
