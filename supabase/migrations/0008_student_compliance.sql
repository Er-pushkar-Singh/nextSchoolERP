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
  add column if not exists admission_class_id uuid references public.classes(id) on delete set null,
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
