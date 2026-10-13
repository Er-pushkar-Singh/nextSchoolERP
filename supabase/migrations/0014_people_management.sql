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
