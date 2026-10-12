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
