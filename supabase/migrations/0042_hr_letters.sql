-- ═══════════════════════════════════════════════════════════════════════════
-- Step 40: HR letters. The data a staff letter needs (Mr./Ms., pronouns, gross / net salary in figures and words, salary breakup,
--          length of service, probation) is built from the staff record when the letter is issued — never typed by hand.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.staff add column if not exists probation_months int not null default 6 check (probation_months between 0 and 24);

-- {{staff.earnings_html}} (like fee.* and exam.*) is a table built by the database, not text to escape
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
    elsif k in ('student.barcode', 'staff.barcode') then
      v := data #>> string_to_array(case when k = 'student.barcode' then 'student.att_code' else 'staff.att_code' end, '.');
      out := replace(out, '{{' || k || '}}', case when v ~ '^[0-9a-f]{12}$' then '<img class="doc-barcode" data-barcode="' || v || '" src="" alt="Barcode" style="width:100%;height:100%;object-fit:fill">' else '' end);
    elsif k = 'doc.verify_qr' then
      out := replace(out, '{{' || k || '}}', '<img class="doc-qr" data-verify="1" src="" alt="Scan to verify" style="width:100%;height:100%;object-fit:contain">');
    elsif k ~ '^(fee|exam|staff)\.[a-z_]+_html$' then
      out := replace(out, '{{' || k || '}}', coalesce(v, ''));
    else
      out := replace(out, '{{' || k || '}}', public.html_escape(v));
    end if;
  end loop;
  return out;
end $$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'document_data')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'document_data_exam') then
    alter function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) rename to document_data_exam;
  end if;
end $$;

create or replace function public.document_data(sid uuid, stu uuid, stf uuid, doc_no text, on_day date, valid_until date, p_extra jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb; w public.staff; gross numeric := 0; ded numeric := 0; e jsonb; th text := 'border:1px solid #444;padding:4px 8px'; erows text := ''; drows text := ''; yrs int; mon int; endd date; svc text;
begin
  d := public.document_data_exam(sid, stu, stf, doc_no, on_day, valid_until, p_extra);
  if stf is not null then
    select * into w from public.staff where id = stf and school_id = sid;
    for e in select * from jsonb_array_elements(coalesce(w.earnings, '[]'::jsonb)) loop
      gross := gross + coalesce((e ->> 'amount')::numeric, 0);
      erows := erows || '<tr><td style="' || th || '">' || public.html_escape(e ->> 'name') || '</td><td style="' || th || ';text-align:right">' || to_char(coalesce((e ->> 'amount')::numeric, 0), 'FM9,99,99,990.00') || '</td></tr>';
    end loop;
    for e in select * from jsonb_array_elements(coalesce(w.deductions, '[]'::jsonb)) loop
      ded := ded + coalesce((e ->> 'amount')::numeric, 0);
      drows := drows || '<tr><td style="' || th || '">' || public.html_escape(e ->> 'name') || '</td><td style="' || th || ';text-align:right">− ' || to_char(coalesce((e ->> 'amount')::numeric, 0), 'FM9,99,99,990.00') || '</td></tr>';
    end loop;
    endd := coalesce(w.leaving_date, on_day);
    if w.joining_date is not null and endd >= w.joining_date then
      yrs := extract(year from age(endd + 1, w.joining_date))::int; mon := extract(month from age(endd + 1, w.joining_date))::int;
      svc := trim(both ' ' from concat_ws(' ', case when yrs > 0 then yrs || (case when yrs = 1 then ' year' else ' years' end) end, case when mon > 0 then mon || (case when mon = 1 then ' month' else ' months' end) end));
      if svc = '' then svc := 'less than a month'; end if;
    else
      svc := '';
    end if;
    d := jsonb_set(d, '{staff}', coalesce(d -> 'staff', '{}'::jsonb) || jsonb_build_object(
      'mr_ms', case w.gender when 'F' then 'Ms.' when 'M' then 'Mr.' else '' end,
      'he_she', case w.gender when 'F' then 'she' when 'M' then 'he' else 'the employee' end,
      'his_her', case w.gender when 'F' then 'her' when 'M' then 'his' else 'the' end,
      'him_her', case w.gender when 'F' then 'her' when 'M' then 'him' else 'the employee' end,
      'address', coalesce(w.address, ''),
      'gross', to_char(gross, 'FM9,99,99,990'), 'gross_words', public.rupee_words(gross),
      'net', to_char(gross - ded, 'FM9,99,99,990'), 'net_words', public.rupee_words(gross - ded),
      'probation_months', w.probation_months::text,
      'service_years', svc,
      'earnings_html', case when erows = '' then '' else '<table style="width:100%;border-collapse:collapse;font-size:11px"><tr style="background:#eef1f6"><th style="' || th || ';text-align:left">Salary component</th><th style="' || th
                          || ';text-align:right">Rs. per month</th></tr>' || erows || drows || '<tr style="font-weight:bold"><td style="' || th || '">Net monthly salary</td><td style="' || th || ';text-align:right">'
                          || to_char(gross - ded, 'FM9,99,99,990.00') || '</td></tr></table>' end));
  end if;
  return d;
end $$;
revoke execute on function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;
revoke execute on function public.document_data_exam(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
