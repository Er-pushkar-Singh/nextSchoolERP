-- ═══════════════════════════════════════════════════════════════════════════
-- Step 29: Document branding and exam documents — principal's signature, school seal and a watermark kept in settings,
--          marksheet / report card / result data for templates ({{exam.*}}), placeholders {{school.signature}} {{school.seal}}.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.school_branding (
  school_id         uuid primary key references public.schools(id) on delete cascade,
  signature         text,
  seal              text,
  watermark_mode    text not null default 'logo' check (watermark_mode in ('none', 'logo', 'text')),
  watermark_text    text,
  watermark_opacity int  not null default 10 check (watermark_opacity between 3 and 30),
  updated_at        timestamptz not null default now(),
  check (signature is null or (signature ~ '^data:image/(png|jpeg|webp);base64,' and length(signature) <= 450000)),
  check (seal is null or (seal ~ '^data:image/(png|jpeg|webp);base64,' and length(seal) <= 450000))
);
alter table public.school_branding enable row level security;
drop policy if exists "read" on public.school_branding;
create policy "read" on public.school_branding for select to authenticated using (public.is_member(school_id));
drop policy if exists "write" on public.school_branding;
create policy "write" on public.school_branding for all to authenticated
  using (public.has_perm_school(school_id, 'settings.school.edit')) with check (public.has_perm_school(school_id, 'settings.school.edit'));

do $$
begin
  execute 'drop trigger if exists audit_school_branding on public.school_branding';
  execute 'create trigger audit_school_branding after insert or update or delete on public.school_branding for each row execute function public.audit_row()';
end $$;

-- ───────────── Exam block for marksheets ─────────────
create or replace function public._exam_doc_block(sid uuid, stu uuid, p_exam uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ex public.exams; r public.exam_results; scale jsonb; sess text; cname text; strength int; rows text := ''; pass_mark numeric; pct numeric; g text;
        allh text := ''; hdr text := ''; x record; sub record; cell text; ex_ids uuid[]; att_p int; att_t int; th text := 'border:1px solid #444;padding:4px 8px';
begin
  select * into ex from public.exams where id = p_exam and school_id = sid;
  if ex.id is null then raise exception 'Choose the examination.'; end if;
  select * into r from public.exam_results where exam_id = p_exam and student_id = stu;
  if r.id is null then raise exception 'The result of this exam is not declared for this student''s class yet.'; end if;
  select grade_scale into scale from public.schools where id = sid;
  select name into sess from public.sessions where id = ex.session_id;
  select name into cname from public.classes where id = r.class_id;
  select count(*) into strength from public.exam_results where exam_id = p_exam and class_id = r.class_id;

  for sub in
    select sb.name, es.max_marks, es.pass_marks, m.marks, coalesce(m.absent, false) as absent
      from public.exam_subjects es join public.subjects sb on sb.id = es.subject_id
      left join public.marks m on m.exam_id = es.exam_id and m.student_id = stu and m.subject_id = es.subject_id
     where es.exam_id = p_exam and es.class_id = r.class_id order by sb.sort, sb.name
  loop
    pct := case when sub.max_marks > 0 and sub.marks is not null then 100.0 * sub.marks / sub.max_marks else 0 end;
    select gg ->> 'grade' into g from jsonb_array_elements(scale) gg where (gg ->> 'min')::numeric <= pct order by (gg ->> 'min')::numeric desc limit 1;
    pass_mark := coalesce(sub.pass_marks, round(sub.max_marks * 0.33, 2));
    rows := rows || '<tr><td style="' || th || '">' || public.html_escape(sub.name) || '</td><td style="' || th || ';text-align:center">' || sub.max_marks::text
         || '</td><td style="' || th || ';text-align:center">' || pass_mark::text || '</td><td style="' || th || ';text-align:center;font-weight:bold">'
         || case when sub.absent then 'AB' when sub.marks is null then '—' else trim(trailing '.' from trim(trailing '0' from sub.marks::text)) end
         || '</td><td style="' || th || ';text-align:center">' || case when sub.absent or sub.marks is null then '—' else coalesce(g, '') end || '</td></tr>';
  end loop;

  -- every declared exam of the session up to this one, side by side
  select array_agg(e.id order by e.sort, e.start_date) into ex_ids from public.exams e
   where e.session_id = ex.session_id and e.sort <= ex.sort and exists (select 1 from public.exam_results z where z.exam_id = e.id and z.student_id = stu);
  if ex_ids is not null then
    for x in select e.id, e.name from public.exams e where e.id = any(ex_ids) order by e.sort, e.start_date loop
      hdr := hdr || '<th style="' || th || ';text-align:center">' || public.html_escape(x.name) || '</th>';
    end loop;
    for sub in select distinct sb.id, sb.name, sb.sort from public.exam_subjects es join public.subjects sb on sb.id = es.subject_id
                where es.exam_id = any(ex_ids) and es.class_id = r.class_id order by sb.sort, sb.name loop
      allh := allh || '<tr><td style="' || th || '">' || public.html_escape(sub.name) || '</td>';
      for x in select e.id from public.exams e where e.id = any(ex_ids) order by e.sort, e.start_date loop
        select case when m.absent then 'AB' when m.marks is null then '—' else trim(trailing '.' from trim(trailing '0' from m.marks::text)) || '/' || trim(trailing '.' from trim(trailing '0' from es.max_marks::text)) end
          into cell from public.exam_subjects es left join public.marks m on m.exam_id = es.exam_id and m.student_id = stu and m.subject_id = es.subject_id
         where es.exam_id = x.id and es.class_id = r.class_id and es.subject_id = sub.id;
        allh := allh || '<td style="' || th || ';text-align:center">' || coalesce(public.html_escape(cell), '') || '</td>';
      end loop;
      allh := allh || '</tr>';
    end loop;
    allh := '<table style="width:100%;border-collapse:collapse;font-size:11px"><tr><th style="' || th || ';text-align:left">Subject</th>' || hdr || '</tr>' || allh || '</table>';
  end if;

  select count(*) filter (where status in ('P', 'L', 'H')), count(*) into att_p, att_t from public.attendance a
   where a.student_id = stu and a.date between (select start_date from public.sessions where id = ex.session_id) and (select end_date from public.sessions where id = ex.session_id);

  return jsonb_build_object(
    'name', ex.name, 'session', sess, 'class', cname, 'total', trim(trailing '.' from trim(trailing '0' from r.total::text)), 'max_total', trim(trailing '.' from trim(trailing '0' from r.max_total::text)),
    'percent', r.percent::text || '%', 'grade', coalesce(r.grade, ''), 'rank', coalesce(r.rank::text, ''), 'strength', strength::text,
    'result', case r.result when 'pass' then 'PASS' when 'fail' then 'FAIL' when 'absent' then 'ABSENT' else 'WITHHELD' end,
    'failed_subjects', r.failed_subjects::text, 'remark', coalesce(r.remark, ''), 'declared_on', to_char(r.declared_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY'),
    'attendance', case when att_t > 0 then att_p || ' / ' || att_t || ' days' else '' end,
    'marks_html', '<table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#eef1f6"><th style="' || th || ';text-align:left">Subject</th><th style="' || th || '">Max</th><th style="' || th
                  || '">Pass</th><th style="' || th || '">Marks</th><th style="' || th || '">Grade</th></tr>' || rows
                  || '<tr style="font-weight:bold"><td style="' || th || '">Total</td><td style="' || th || ';text-align:center">' || trim(trailing '.' from trim(trailing '0' from r.max_total::text))
                  || '</td><td style="' || th || '"></td><td style="' || th || ';text-align:center">' || trim(trailing '.' from trim(trailing '0' from r.total::text))
                  || '</td><td style="' || th || ';text-align:center">' || coalesce(r.grade, '') || '</td></tr></table>',
    'all_html', allh);
end $$;
revoke execute on function public._exam_doc_block(uuid, uuid, uuid) from public, anon, authenticated;

-- ───────────── document_data now carries the exam block and the branding flags ─────────────
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'document_data')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'document_data_att') then
    alter function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) rename to document_data_att;
  end if;
end $$;
create or replace function public.document_data(sid uuid, stu uuid, stf uuid, doc_no text, on_day date, valid_until date, p_extra jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb; eid uuid;
begin
  d := public.document_data_att(sid, stu, stf, doc_no, on_day, valid_until, p_extra);
  if stu is not null and coalesce(p_extra ->> 'exam_id', '') ~ '^[0-9a-f-]{36}$' then
    eid := (p_extra ->> 'exam_id')::uuid;
    if p_extra ->> 'exam_id' like '[%' then null; end if;
    d := d || jsonb_build_object('exam', public._exam_doc_block(sid, stu, eid));
  end if;
  return d;
end $$;
revoke execute on function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;
revoke execute on function public.document_data_att(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;

-- preview with a placeholder exam must not fail: preview_document passes '[Examination]' which is not a uuid, so no block is built.

-- ───────────── renderer: signature, seal and exam tables ─────────────
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
    elsif k in ('school.signature', 'school.seal') then
      out := replace(out, '{{' || k || '}}', '<img class="doc-brand" data-brand="' || split_part(k, '.', 2) || '" src="" alt="' || case when k = 'school.seal' then 'School seal' else 'Principal signature' end
                                             || '" style="width:100%;height:100%;object-fit:contain">');
    elsif k in ('student.qr', 'staff.qr') then
      v := data #>> string_to_array(case when k = 'student.qr' then 'student.att_code' else 'staff.att_code' end, '.');
      out := replace(out, '{{' || k || '}}', case when v ~ '^[0-9a-f]{12}$' then '<img class="doc-qr" data-qr="' || v || '" src="" alt="QR" style="width:100%;height:100%;object-fit:contain">' else '' end);
    elsif k ~ '^(fee|exam)\.[a-z_]+_html$' then
      out := replace(out, '{{' || k || '}}', coalesce(v, ''));
    else
      out := replace(out, '{{' || k || '}}', public.html_escape(v));
    end if;
  end loop;
  return out;
end $$;
