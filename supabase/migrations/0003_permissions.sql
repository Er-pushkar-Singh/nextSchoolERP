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
