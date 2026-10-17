-- ═══════════════════════════════════════════════════════════════════════════
-- Step 42: Admit cards from the date sheet, and the backup / data-export log.
--   • {{exam.datesheet_html}} — the student's own date sheet (subject, date, time, room) for an examination
--   • issue_admit_cards() — one card per student of a class for one examination (a second examination gets its own cards)
--   • backup_log — who exported the school's data and when
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'document_data')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'document_data_hr') then
    alter function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) rename to document_data_hr;
  end if;
end $$;

create or replace function public.document_data(sid uuid, stu uuid, stf uuid, doc_no text, on_day date, valid_until date, p_extra jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb; eid uuid; ex public.exams; sc public.students; rows text := ''; r record; th text := 'border:1px solid #444;padding:4px 8px';
begin
  d := public.document_data_hr(sid, stu, stf, doc_no, on_day, valid_until, p_extra);
  if stu is not null and coalesce(p_extra ->> 'exam_ref', '') ~ '^[0-9a-f-]{36}$' then
    eid := (p_extra ->> 'exam_ref')::uuid;
    select * into ex from public.exams where id = eid and school_id = sid;
    select * into sc from public.students where id = stu and school_id = sid;
    if ex.id is not null and sc.id is not null then
      for r in select su.name as subject, es.exam_date, es.start_time, es.end_time, es.room
                 from public.exam_subjects es join public.subjects su on su.id = es.subject_id
                where es.exam_id = ex.id and es.class_id = sc.class_id
                order by es.exam_date nulls last, es.start_time nulls last, su.name loop
        rows := rows || '<tr><td style="' || th || '">' || public.html_escape(r.subject) || '</td><td style="' || th || ';text-align:center">' || coalesce(to_char(r.exam_date, 'DD/MM/YYYY'), '—')
             || '</td><td style="' || th || ';text-align:center">' || coalesce(to_char(r.start_time, 'HH24:MI') || coalesce(' – ' || to_char(r.end_time, 'HH24:MI'), ''), '—')
             || '</td><td style="' || th || ';text-align:center">' || coalesce(public.html_escape(r.room), '') || '</td></tr>';
      end loop;
      d := jsonb_set(d, '{exam}', coalesce(d -> 'exam', '{}'::jsonb) || jsonb_build_object(
        'id', ex.id::text, 'name', coalesce(d #>> '{exam,name}', ex.name),
        'datesheet_html', case when rows = '' then '' else '<table style="width:100%;border-collapse:collapse;font-size:11px"><tr style="background:#eef1f6"><th style="' || th || ';text-align:left">Subject</th><th style="' || th
                          || '">Date</th><th style="' || th || '">Time</th><th style="' || th || '">Room</th></tr>' || rows || '</table>' end));
    end if;
  end if;
  return d;
end $$;
revoke execute on function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;
revoke execute on function public.document_data_hr(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;

-- admit cards for a class / section, from the template that declares an "exam_ref" question
create or replace function public.issue_admit_cards(sid uuid, tpl uuid, p_exam uuid, p_class uuid, p_section uuid default null, p_extra jsonb default '{}', p_by text default null)
returns int language plpgsql security definer set search_path = public as $$
declare t record; r record; cnt int := 0;
begin
  if not public.has_perm_school(sid, 'documents.issue.create') then raise exception 'not allowed'; end if;
  select * into t from public.document_templates where id = tpl and school_id = sid and active and audience = 'student';
  if t.id is null then raise exception 'Template not found.'; end if;
  if not exists (select 1 from jsonb_array_elements(t.fields) f where f ->> 'key' = 'exam_ref') then raise exception 'This template does not ask for an examination. Use the "Exam admit card" design from the gallery.'; end if;
  if not exists (select 1 from public.exams where id = p_exam and school_id = sid) then raise exception 'Examination not found.'; end if;
  if p_class is null then raise exception 'Choose the class.'; end if;
  if not exists (select 1 from public.exam_subjects where exam_id = p_exam and class_id = p_class) then raise exception 'This class has no subjects in the date sheet of this examination yet.'; end if;
  for r in select s.id from public.students s
            where s.school_id = sid and s.status = 'active' and s.class_id = p_class and (p_section is null or s.section_id = p_section)
              and not exists (select 1 from public.issued_documents i where i.template_code = t.code and i.student_id = s.id and i.status = 'issued' and i.data #>> '{exam,id}' = p_exam::text)
            order by s.roll_no nulls last, s.first_name limit 3000 loop
    perform public.issue_document(sid, tpl, r.id, null, null, coalesce(p_extra, '{}'::jsonb) || jsonb_build_object('exam_ref', p_exam::text), false, p_by);
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;
grant execute on function public.issue_admit_cards(uuid, uuid, uuid, uuid, uuid, jsonb, text) to authenticated;

-- ───────────── backups ─────────────
create table if not exists public.backup_log (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  kind       text not null default 'full',
  tables     int not null default 0,
  row_count  int not null default 0,
  size_bytes bigint not null default 0,
  by_user    uuid references auth.users(id) on delete set null,
  by_name    text,
  created_at timestamptz not null default now()
);
create index if not exists backup_log_school_idx on public.backup_log (school_id, created_at desc);
alter table public.backup_log enable row level security;
drop policy if exists "read" on public.backup_log;
create policy "read" on public.backup_log for select to authenticated using (public.has_perm_school(school_id, 'settings.backups.view') or public.has_perm_school(school_id, 'settings.backups.create'));
drop policy if exists "write" on public.backup_log;
create policy "write" on public.backup_log for insert to authenticated with check (public.has_perm_school(school_id, 'settings.backups.create'));

notify pgrst, 'reload schema';
