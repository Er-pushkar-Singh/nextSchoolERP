-- ═══════════════════════════════════════════════════════════════════════════
-- Step 9: (a) public online admission form for parents, (b) Documents & templates:
--         school-editable templates (TC, bonafide, character, study, ID cards, letters …),
--         versioned, rendered in the database and issued with numbers; bulk ID cards.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═════════════════════════ (a) Online admission ═════════════════════════
create table if not exists public.online_admission_settings (
  school_id      uuid primary key references public.schools(id) on delete cascade,
  enabled        boolean not null default false,
  class_ids      uuid[] not null default '{}',          -- classes open for online applications (empty = all)
  intro          text,
  instructions   text,
  fee_note       text,
  closes_on      date,
  ask_documents  boolean not null default true,
  updated_by     uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);
drop trigger if exists online_admission_settings_touch on public.online_admission_settings;
create trigger online_admission_settings_touch before update on public.online_admission_settings for each row execute function public.touch_row();

-- abuse control for the public form / status lookup (no policies: only the functions touch it)
create table if not exists public.online_submissions (
  id         bigint generated always as identity primary key,
  school_id  uuid not null references public.schools(id) on delete cascade,
  kind       text not null default 'apply' check (kind in ('apply','status')),
  ip_hash    text,
  phone      text,
  application_id uuid references public.admission_applications(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists online_submissions_idx on public.online_submissions (school_id, kind, created_at desc);

alter table public.online_admission_settings enable row level security;
alter table public.online_submissions enable row level security;
drop policy if exists "read" on public.online_admission_settings;
create policy "read" on public.online_admission_settings for select to authenticated using (public.has_perm_school(school_id, 'frontdesk.online_form.view'));
drop policy if exists "write" on public.online_admission_settings;
create policy "write" on public.online_admission_settings for all to authenticated
  using (public.has_perm_school(school_id, 'frontdesk.online_form.edit')) with check (public.has_perm_school(school_id, 'frontdesk.online_form.edit'));

-- the numbering / duplicate / enquiry logic of 0010 as an internal function, so staff and the public form share it
create or replace function public.create_application_core(sid uuid, p_class uuid, p_enquiry uuid, p_form jsonb, p_rte boolean, p_rte_ref text, p_source text, p_session uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare sess uuid := coalesce(p_session, (select id from public.sessions where school_id = sid and is_current limit 1));
        sname text; n int; num text; nm text; dup text; aid uuid; f jsonb := coalesce(p_form, '{}'::jsonb);
begin
  if coalesce(btrim(f ->> 'first_name'), '') = '' then raise exception 'The student''s first name is required.'; end if;
  if p_class is not null and not exists (select 1 from public.classes where id = p_class and school_id = sid) then raise exception 'Class not found.'; end if;
  if p_enquiry is not null and not exists (select 1 from public.enquiries where id = p_enquiry and school_id = sid) then raise exception 'Enquiry not found.'; end if;
  nm := btrim(concat_ws(' ', f ->> 'first_name', f ->> 'middle_name', f ->> 'last_name'));
  select application_no into dup from public.admission_applications
   where school_id = sid and session_id is not distinct from sess and status not in ('cancelled','rejected')
     and lower(applicant_name) = lower(nm) and coalesce(form ->> 'dob', '') = coalesce(f ->> 'dob', '') and coalesce(lower(father_name), '') = coalesce(lower(f ->> 'father_name'), '')
   limit 1;
  if dup is not null and coalesce((f ->> 'allow_duplicate')::boolean, false) is not true then
    raise exception 'An application for the same student already exists (no. %).', dup;
  end if;
  select coalesce((select name from public.sessions where id = sess), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, 'application', sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1 returning next_no - 1 into n;
  num := 'APP/' || sname || '/' || lpad(n::text, 4, '0');
  insert into public.admission_applications (school_id, application_no, session_id, class_id, enquiry_id, applicant_name, father_name, phone, form, rte_applicant, rte_reference, source)
  values (sid, num, sess, p_class, p_enquiry, nm, nullif(btrim(f ->> 'father_name'), ''), nullif(btrim(f ->> 'guardian_phone'), ''), f - 'allow_duplicate', coalesce(p_rte, false),
          nullif(btrim(coalesce(p_rte_ref, '')), ''), nullif(btrim(coalesce(p_source, '')), ''))
  returning id into aid;
  if p_enquiry is not null then update public.enquiries set status = case when status in ('new','contacted','visited') then 'test' else status end where id = p_enquiry and school_id = sid; end if;
  return aid;
end $$;
revoke execute on function public.create_application_core(uuid, uuid, uuid, jsonb, boolean, text, text, uuid) from public, anon, authenticated;

create or replace function public.create_application(sid uuid, p_class uuid, p_enquiry uuid, p_form jsonb, p_rte boolean default false,
                                                     p_rte_ref text default null, p_source text default null, p_session uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'frontdesk.admissions.create') then raise exception 'not allowed'; end if;
  return public.create_application_core(sid, p_class, p_enquiry, p_form, p_rte, p_rte_ref, p_source, p_session);
end $$;

-- called only by the app server with the secret key
create or replace function public.public_create_application(p_code text, p_class uuid, p_form jsonb, p_rte boolean, p_ip_hash text)
returns json language plpgsql security definer set search_path = public as $$
declare sid uuid; st record; aid uuid; no text; ph text := nullif(regexp_replace(coalesce(p_form ->> 'guardian_phone', ''), '\D', '', 'g'), '');
begin
  select id into sid from public.schools where code = lower(btrim(p_code)) and archived_at is null;
  if sid is null then raise exception 'School not found.'; end if;
  select * into st from public.online_admission_settings where school_id = sid;
  if st.school_id is null or not st.enabled then raise exception 'Online admission is not open for this school.'; end if;
  if st.closes_on is not null and st.closes_on < public.today_ist() then raise exception 'Online admission closed on %.', to_char(st.closes_on, 'DD Mon YYYY'); end if;
  if cardinality(st.class_ids) > 0 and not (p_class = any(st.class_ids)) then raise exception 'That class is not open for online admission.'; end if;
  if not public.school_writable(sid) then raise exception 'This school is not accepting applications right now.'; end if;
  if ph is null or ph !~ '^(91)?[6-9][0-9]{9}$' then raise exception 'A valid 10-digit parent mobile number is required.'; end if;
  if (select count(*) from public.online_submissions where school_id = sid and kind = 'apply' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many forms from this network. Please try again in an hour.';
  end if;
  if (select count(*) from public.online_submissions where school_id = sid and kind = 'apply' and phone = right(ph, 10) and created_at > now() - interval '1 day') >= 4 then
    raise exception 'This mobile number has already submitted several forms today.';
  end if;
  aid := public.create_application_core(sid, p_class, null, p_form, p_rte, null, 'Online', null);
  insert into public.online_submissions (school_id, kind, ip_hash, phone, application_id) values (sid, 'apply', p_ip_hash, right(ph, 10), aid);
  select application_no into no from public.admission_applications where id = aid;
  return json_build_object('id', aid, 'application_no', no, 'school_id', sid);
end $$;
revoke execute on function public.public_create_application(text, uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.public_create_application(text, uuid, jsonb, boolean, text) to service_role;

-- parents track their application with the application number + the mobile number they gave
create or replace function public.public_application_status(p_code text, p_no text, p_phone text, p_ip_hash text)
returns json language plpgsql security definer set search_path = public as $$
declare sid uuid; a record; ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); docs json;
begin
  select id into sid from public.schools where code = lower(btrim(p_code));
  if sid is null then return null; end if;
  if (select count(*) from public.online_submissions where school_id = sid and kind = 'status' and ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many lookups. Please try again later.';
  end if;
  insert into public.online_submissions (school_id, kind, ip_hash) values (sid, 'status', p_ip_hash);
  select * into a from public.admission_applications where school_id = sid and upper(application_no) = upper(btrim(p_no));
  if a.id is null or ph !~ '^[6-9][0-9]{9}$' or right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) <> ph then return null; end if;
  select coalesce(json_agg(json_build_object('doc_type', doc_type, 'status', status, 'due_by', due_by, 'reason', reject_reason)), '[]'::json) into docs
    from public.application_documents where application_id = a.id;
  return json_build_object('application_no', a.application_no, 'name', a.applicant_name, 'status', a.status, 'applied_on', a.applied_on,
    'class', (select name from public.classes where id = a.class_id), 'test_on', a.test_on, 'interview_on', a.interview_on, 'waitlist_no', a.waitlist_no,
    'decision_note', case when a.status = 'rejected' then null else a.decision_note end, 'documents', docs, 'school', (select name from public.schools where id = sid));
end $$;
revoke execute on function public.public_application_status(text, text, text, text) from public, anon, authenticated;
grant execute on function public.public_application_status(text, text, text, text) to service_role;

-- ═════════════════════════ (b) Documents & templates ═════════════════════════
create or replace function public.sanitize_template_html(h text) returns text
language plpgsql immutable as $$
begin
  h := coalesce(h, '');
  h := regexp_replace(h, '<\s*(script|iframe|object|embed|style|link|meta|base|form|input|button|textarea|svg|math)\y[^>]*>.*?<\s*/\s*\1\s*>', '', 'gis');
  h := regexp_replace(h, '<\s*/?\s*(script|iframe|object|embed|style|link|meta|base|form|input|button|textarea|svg|math)\y[^>]*>', '', 'gi');
  h := regexp_replace(h, '\son[a-z]+\s*=\s*("[^"]*"|''[^'']*''|[^\s>]+)', '', 'gi');
  h := regexp_replace(h, 'javascript\s*:', '', 'gi');
  h := regexp_replace(h, 'vbscript\s*:', '', 'gi');
  h := regexp_replace(h, 'expression\s*\(', '', 'gi');
  h := regexp_replace(h, '@import', '', 'gi');
  return h;
end $$;

create table if not exists public.document_templates (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  code            text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  name            text not null check (length(btrim(name)) > 0),
  category        text not null default 'certificate' check (category in ('certificate','id_card','letter','other')),
  audience        text not null default 'student' check (audience in ('student','staff')),
  body_html       text not null default '',
  page_size       text not null default 'A4' check (page_size in ('A4','A5','card')),
  orientation     text not null default 'portrait' check (orientation in ('portrait','landscape')),
  card_width_mm   int check (card_width_mm is null or card_width_mm between 30 and 300),
  card_height_mm  int check (card_height_mm is null or card_height_mm between 30 and 300),
  numbering_prefix text not null default 'DOC' check (numbering_prefix ~ '^[A-Za-z0-9]{1,8}$'),
  on_issue        text not null default 'none' check (on_issue in ('none','mark_transferred')),
  one_per_student boolean not null default false,
  valid_days      int check (valid_days is null or valid_days between 1 and 3650),
  fields          jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),   -- [{key,label,type text|date|number,required}]
  active          boolean not null default true,
  is_system       boolean not null default false,
  version         int not null default 1,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (school_id, code)
);

create table if not exists public.document_template_versions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.document_templates(id) on delete cascade,
  school_id   uuid not null references public.schools(id) on delete cascade,
  version     int not null,
  name        text,
  body_html   text not null,
  fields      jsonb not null default '[]',
  changed_by  uuid default auth.uid() references auth.users(id) on delete set null,
  changed_at  timestamptz not null default now(),
  unique (template_id, version)
);

create or replace function public.template_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body_html := public.sanitize_template_html(new.body_html);
  if tg_op = 'UPDATE' then
    if new.body_html is distinct from old.body_html or new.fields is distinct from old.fields then new.version := old.version + 1; else new.version := old.version; end if;
    new.updated_at := now();
    new.code := old.code; new.school_id := old.school_id;
  end if;
  return new;
end $$;
drop trigger if exists document_templates_guard on public.document_templates;
create trigger document_templates_guard before insert or update on public.document_templates for each row execute function public.template_guard();

create or replace function public.template_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    insert into public.document_template_versions (template_id, school_id, version, name, body_html, fields, changed_by)
    values (new.id, new.school_id, new.version, new.name, new.body_html, new.fields, auth.uid()) on conflict (template_id, version) do nothing;
  end if;
  return null;
end $$;
drop trigger if exists document_templates_version on public.document_templates;
create trigger document_templates_version after insert or update on public.document_templates for each row execute function public.template_version_log();

create table if not exists public.issued_documents (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete cascade,
  template_id      uuid references public.document_templates(id) on delete set null,
  template_code    text not null,
  template_name    text not null,
  template_version int not null,
  category         text not null,
  audience         text not null,
  student_id       uuid references public.students(id) on delete cascade,
  staff_id         uuid references public.staff(id) on delete cascade,
  doc_no           text not null,
  issued_on        date not null default public.today_ist(),
  valid_until      date,
  is_duplicate     boolean not null default false,
  data             jsonb not null default '{}',
  html             text not null,
  page_size        text not null default 'A4',
  orientation      text not null default 'portrait',
  card_width_mm    int,
  card_height_mm   int,
  status           text not null default 'issued' check (status in ('issued','cancelled')),
  cancelled_reason text,
  cancelled_at     timestamptz,
  cancelled_by     uuid references auth.users(id) on delete set null,
  issued_by        uuid default auth.uid() references auth.users(id) on delete set null,
  issued_by_name   text,
  created_at       timestamptz not null default now(),
  unique (school_id, doc_no),
  check (num_nonnulls(student_id, staff_id) = 1)
);
create index if not exists issued_documents_student_idx on public.issued_documents (school_id, student_id);
create index if not exists issued_documents_template_idx on public.issued_documents (school_id, template_code, created_at desc);

-- small SQL helpers for rendering
create or replace function public.number_words(n int) returns text
language plpgsql immutable as $$
declare o text[] := array['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
        t text[] := array['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
begin
  if n < 20 then return o[n + 1]; end if;
  if n < 100 then return t[n / 10 + 1] || case when n % 10 > 0 then '-' || o[n % 10 + 1] else '' end; end if;
  if n < 1000 then return o[n / 100 + 1] || ' Hundred' || case when n % 100 > 0 then ' ' || public.number_words(n % 100) else '' end; end if;
  return public.number_words(n / 1000) || ' Thousand' || case when n % 1000 > 0 then ' ' || public.number_words(n % 1000) else '' end;
end $$;

create or replace function public.date_words(d date) returns text
language sql immutable as $$
  select case when d is null then '' else
    to_char(d, 'DD/MM/YYYY') || ' (' ||
    (array['First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth','Eleventh','Twelfth','Thirteenth','Fourteenth','Fifteenth','Sixteenth','Seventeenth','Eighteenth','Nineteenth','Twentieth',
           'Twenty-first','Twenty-second','Twenty-third','Twenty-fourth','Twenty-fifth','Twenty-sixth','Twenty-seventh','Twenty-eighth','Twenty-ninth','Thirtieth','Thirty-first'])[extract(day from d)::int]
    || ' ' || trim(to_char(d, 'Month')) || ', ' || public.number_words(extract(year from d)::int) || ')' end;
$$;

create or replace function public.html_escape(t text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

-- {{a.b}} → value (HTML-escaped). Special: {{student.photo}} and {{school.logo}} become <img> tags.
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
    else
      out := replace(out, '{{' || k || '}}', public.html_escape(v));
    end if;
  end loop;
  return out;
end $$;

-- the data a template can use (built on the server from the records, never from the browser)
create or replace function public.document_data(sid uuid, stu uuid, stf uuid, doc_no text, on_day date, valid_until date, p_extra jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; w record; sc record; sess record; owed numeric; d jsonb;
begin
  select * into sc from public.schools where id = sid;
  select name, start_date, end_date into sess from public.sessions where school_id = sid and is_current limit 1;
  d := jsonb_build_object(
    'school', jsonb_build_object('name', sc.name, 'address', sc.address, 'city', sc.city, 'state', sc.state, 'pincode', sc.pincode, 'phone', sc.phone, 'email', sc.email,
      'board', sc.board, 'affiliation_no', sc.affiliation_no, 'udise_code', sc.udise_code, 'principal_name', sc.principal_name, 'logo', sc.logo_url),
    'doc', jsonb_build_object('no', doc_no, 'date', to_char(on_day, 'DD/MM/YYYY'), 'session', sess.name, 'valid_until', case when valid_until is null then '' else to_char(valid_until, 'DD/MM/YYYY') end),
    'extra', coalesce(p_extra, '{}'::jsonb));
  if stu is not null then
    select st.*, c.name as cname, sec.name as sname, ac.name as acname,
           ss.apaar_id as apaar, ss.apaar_status as apaar_status
      into s from public.students st
      left join public.classes c on c.id = st.class_id left join public.sections sec on sec.id = st.section_id
      left join public.classes ac on ac.id = st.admission_class_id left join public.student_sensitive ss on ss.student_id = st.id
     where st.id = stu and st.school_id = sid;
    if s.id is null then raise exception 'Student not found.'; end if;
    select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into owed from public.fee_dues where student_id = stu and school_id = sid;
    d := d || jsonb_build_object(
      'student', jsonb_build_object(
        'name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)), 'first_name', s.first_name, 'last_name', s.last_name, 'name_hi', s.name_hi,
        'admission_no', s.admission_no, 'roll_no', s.roll_no, 'class', s.cname, 'section', s.sname, 'class_section', s.cname || coalesce('-' || s.sname, ''),
        'father_name', s.father_name, 'father_name_hi', s.father_name_hi, 'mother_name', s.mother_name, 'mother_name_hi', s.mother_name_hi,
        'dob', to_char(s.dob, 'DD/MM/YYYY'), 'dob_words', public.date_words(s.dob),
        'gender', case s.gender when 'M' then 'Male' when 'F' then 'Female' when 'O' then 'Other' else '' end,
        'son_daughter', case s.gender when 'F' then 'daughter' when 'M' then 'son' else 'ward' end,
        'he_she', case s.gender when 'F' then 'she' when 'M' then 'he' else 'the student' end,
        'his_her', case s.gender when 'F' then 'her' when 'M' then 'his' else 'the' end,
        'category', s.category, 'religion', s.religion, 'caste', s.caste, 'nationality', coalesce(s.nationality, 'Indian'), 'blood_group', s.blood_group,
        'address', btrim(concat_ws(', ', s.street, s.address, s.city, s.post_office, s.block_tehsil, s.district, s.state, s.pincode)), 'permanent_address', s.permanent_address,
        'phone', s.guardian_phone, 'guardian_phone', s.guardian_phone, 'mobile', s.mobile, 'email', s.email,
        'admission_date', to_char(s.admission_date, 'DD/MM/YYYY'), 'admission_class', s.acname,
        'apaar_id', case when s.apaar_status in ('generated','verified') then s.apaar else null end,
        'tc_no', s.tc_no,
        'transport_route', (select r.name from public.transport_allocations a join public.transport_routes r on r.id = a.route_id where a.student_id = stu and a.end_date is null limit 1),
        'transport_stop', (select p.name from public.transport_allocations a join public.transport_stops p on p.id = a.stop_id where a.student_id = stu and a.end_date is null limit 1)),
      'dues', jsonb_build_object('outstanding', owed, 'text', case when owed > 0 then 'Rs. ' || owed::text || ' outstanding' else 'All dues cleared' end));
  end if;
  if stf is not null then
    select * into w from public.staff where id = stf and school_id = sid;
    if w.id is null then raise exception 'Staff member not found.'; end if;
    d := d || jsonb_build_object('staff', jsonb_build_object('name', w.name, 'designation', w.designation, 'department', w.department, 'emp_code', w.emp_code,
        'phone', w.phone, 'email', w.email, 'joining_date', to_char(w.joining_date, 'DD/MM/YYYY'), 'leaving_date', to_char(w.leaving_date, 'DD/MM/YYYY'),
        'qualification', w.qualification, 'dob', to_char(w.dob, 'DD/MM/YYYY')));
  end if;
  return d;
end $$;
revoke execute on function public.document_data(uuid, uuid, uuid, text, date, date, jsonb) from public, anon, authenticated;

-- issue one document
create or replace function public.issue_document(sid uuid, tpl uuid, stu uuid, stf uuid, p_issued_on date, p_extra jsonb default '{}', p_mark_left boolean default false, p_by text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t record; sname text; n int; num text; on_day date := coalesce(p_issued_on, public.today_ist()); valid date; dup boolean := coalesce((p_extra ->> 'duplicate')::boolean, false);
        prev text; d jsonb; html text; allowed text[]; k text; ex jsonb := '{}'; cid uuid; st record;
begin
  if not public.has_perm_school(sid, 'documents.issue.create') then raise exception 'not allowed'; end if;
  select * into t from public.document_templates where id = tpl and school_id = sid;
  if t.id is null then raise exception 'Template not found.'; end if;
  if not t.active then raise exception 'This template is switched off.'; end if;
  if (t.audience = 'student' and (stu is null or stf is not null)) or (t.audience = 'staff' and (stf is null or stu is not null)) then
    raise exception 'This template is for % only.', t.audience;
  end if;
  if on_day > public.today_ist() then raise exception 'The issue date cannot be in the future.'; end if;
  -- only the fields the template declares (plus a few standard ones) are accepted from the form
  allowed := array['reason','remarks','last_exam','result','promotion','conduct','working_days','days_present','left_on']
             || coalesce((select array_agg(f ->> 'key') from jsonb_array_elements(t.fields) f), '{}');
  for k in select jsonb_object_keys(coalesce(p_extra, '{}'::jsonb)) loop
    if k = any(allowed) then ex := ex || jsonb_build_object(k, left(coalesce(p_extra ->> k, ''), 300)); end if;
  end loop;
  -- required custom fields
  for k in select f ->> 'key' from jsonb_array_elements(t.fields) f where coalesce((f ->> 'required')::boolean, false) loop
    if coalesce(btrim(ex ->> k), '') = '' then raise exception 'Fill in: %.', coalesce((select f ->> 'label' from jsonb_array_elements(t.fields) f where f ->> 'key' = k limit 1), k); end if;
  end loop;

  if t.one_per_student then
    select doc_no into prev from public.issued_documents
     where school_id = sid and template_code = t.code and status = 'issued' and not is_duplicate and student_id is not distinct from stu and staff_id is not distinct from stf order by created_at limit 1;
    if prev is not null and not dup then raise exception 'Already issued (no. %). Tick "Duplicate copy" to issue another.', prev; end if;
    if prev is null then dup := false; end if;
  else
    dup := false;
  end if;

  select coalesce((select name from public.sessions where school_id = sid and is_current limit 1), 'NA') into sname;
  insert into public.certificate_counters (school_id, kind, session_name, next_no) values (sid, 'doc:' || t.code, sname, 2)
  on conflict (school_id, kind, session_name) do update set next_no = public.certificate_counters.next_no + 1 returning next_no - 1 into n;
  num := t.numbering_prefix || '/' || sname || '/' || lpad(n::text, 4, '0') || case when dup then '-D' else '' end;
  valid := case when t.valid_days is not null then on_day + t.valid_days else null end;
  if valid is null and t.category = 'id_card' then valid := (select end_date from public.sessions where school_id = sid and is_current limit 1); end if;

  d := public.document_data(sid, stu, stf, num, on_day, valid, ex);
  html := public.render_document(t.body_html, d);

  insert into public.issued_documents (school_id, template_id, template_code, template_name, template_version, category, audience, student_id, staff_id, doc_no, issued_on, valid_until,
      is_duplicate, data, html, page_size, orientation, card_width_mm, card_height_mm, issued_by_name)
  values (sid, t.id, t.code, t.name, t.version, t.category, t.audience, stu, stf, num, on_day, valid, dup, d, html, t.page_size, t.orientation, t.card_width_mm, t.card_height_mm, p_by)
  returning id into cid;

  if t.on_issue = 'mark_transferred' and stu is not null then
    select status into st from public.students where id = stu;
    if p_mark_left and st.status = 'active' then
      update public.students set status = 'transferred', left_on = coalesce(nullif(ex ->> 'left_on', '')::date, on_day),
             left_reason = coalesce(nullif(ex ->> 'reason', ''), 'Transfer certificate issued'), tc_no = num, tc_issued_on = on_day where id = stu;
    elsif not dup then
      update public.students set tc_no = num, tc_issued_on = on_day where id = stu;
    end if;
  end if;
  return cid;
end $$;

-- ID cards etc. for a whole class / section / all staff in one go (skips people who already have a live one)
create or replace function public.issue_documents_bulk(sid uuid, tpl uuid, p_class uuid, p_section uuid, p_by text default null)
returns int language plpgsql security definer set search_path = public as $$
declare t record; r record; cnt int := 0;
begin
  if not public.has_perm_school(sid, 'documents.issue.create') then raise exception 'not allowed'; end if;
  select * into t from public.document_templates where id = tpl and school_id = sid and active;
  if t.id is null then raise exception 'Template not found.'; end if;
  if t.one_per_student then raise exception 'Documents of this type are issued one by one (they need a reason or details).'; end if;
  if t.audience = 'student' then
    if p_class is null then raise exception 'Choose the class.'; end if;
    for r in select s.id from public.students s where s.school_id = sid and s.status = 'active' and s.class_id = p_class and (p_section is null or s.section_id = p_section)
              and not exists (select 1 from public.issued_documents i where i.template_code = t.code and i.student_id = s.id and i.status = 'issued')
              order by s.roll_no nulls last, s.first_name limit 3000 loop
      perform public.issue_document(sid, tpl, r.id, null, null, '{}', false, p_by); cnt := cnt + 1;
    end loop;
  else
    for r in select w.id from public.staff w where w.school_id = sid and w.status = 'active'
              and not exists (select 1 from public.issued_documents i where i.template_code = t.code and i.staff_id = w.id and i.status = 'issued')
              order by w.name limit 3000 loop
      perform public.issue_document(sid, tpl, null, r.id, null, '{}', false, p_by); cnt := cnt + 1;
    end loop;
  end if;
  return cnt;
end $$;

create or replace function public.preview_document(tpl uuid, stu uuid, stf uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.document_templates where id = tpl;
  if t.id is null or not (public.has_perm_school(t.school_id, 'documents.templates.view') or public.has_perm_school(t.school_id, 'documents.issue.create')) then raise exception 'not allowed'; end if;
  return public.render_document(t.body_html, public.document_data(t.school_id, stu, stf, 'PREVIEW', public.today_ist(), null,
         (select coalesce(jsonb_object_agg(f ->> 'key', '[' || (f ->> 'label') || ']'), '{}'::jsonb) from jsonb_array_elements(t.fields) f)
         || jsonb_build_object('reason', '[reason]', 'remarks', '[remarks]', 'last_exam', '[last exam]', 'result', '[result]', 'promotion', '[promotion]', 'conduct', 'Good',
                               'working_days', '[days]', 'days_present', '[days]', 'left_on', to_char(public.today_ist(), 'DD/MM/YYYY'))));
end $$;

create or replace function public.cancel_issued_document(did uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from public.issued_documents where id = did;
  if d.id is null then raise exception 'Document not found.'; end if;
  if not public.has_perm_school(d.school_id, 'documents.issue.approve') then raise exception 'not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write the reason for cancelling.'; end if;
  if d.status = 'cancelled' then raise exception 'Already cancelled.'; end if;
  update public.issued_documents set status = 'cancelled', cancelled_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid() where id = did;
end $$;

alter table public.document_templates enable row level security;
alter table public.document_template_versions enable row level security;
alter table public.issued_documents enable row level security;
drop policy if exists "read" on public.document_templates;
create policy "read" on public.document_templates for select to authenticated
  using (public.has_perm_school(school_id, 'documents.templates.view') or public.has_perm_school(school_id, 'documents.issue.view') or public.has_perm_school(school_id, 'documents.issue.create'));
drop policy if exists "create" on public.document_templates;
create policy "create" on public.document_templates for insert to authenticated with check (public.has_perm_school(school_id, 'documents.templates.create'));
drop policy if exists "edit" on public.document_templates;
create policy "edit" on public.document_templates for update to authenticated
  using (public.has_perm_school(school_id, 'documents.templates.edit')) with check (public.has_perm_school(school_id, 'documents.templates.edit'));
drop policy if exists "delete" on public.document_templates;
create policy "delete" on public.document_templates for delete to authenticated using (public.has_perm_school(school_id, 'documents.templates.delete') and not is_system);
drop policy if exists "read" on public.document_template_versions;
create policy "read" on public.document_template_versions for select to authenticated using (public.has_perm_school(school_id, 'documents.templates.view'));
drop policy if exists "read" on public.issued_documents;
create policy "read" on public.issued_documents for select to authenticated using (public.has_perm_school(school_id, 'documents.issue.view'));
-- issued only through issue_document() / issue_documents_bulk(); cancelled only through cancel_issued_document()

-- ───────────── default templates ─────────────
create or replace function public.seed_templates_internal(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; hdr text := $h$<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px"><div style="width:60px;height:60px;margin:0 auto 4px">{{school.logo}}</div><div style="font-size:22px;font-weight:800;text-transform:uppercase">{{school.name}}</div><div style="font-size:12px">{{school.address}}, {{school.city}} {{school.pincode}}</div><div style="font-size:12px">{{school.board}} · Aff. No. {{school.affiliation_no}} · UDISE {{school.udise_code}} · {{school.phone}}</div></div>$h$;
        ftr text := $f$<div style="display:flex;justify-content:space-between;margin-top:70px;font-size:13px"><span>Prepared by</span><span style="text-align:center">Principal<br><small>(signature &amp; school seal)</small></span></div>$f$;
begin
  insert into public.document_templates (school_id, code, name, category, audience, body_html, numbering_prefix, on_issue, one_per_student, fields, is_system) values
  (sid, 'transfer_certificate', 'Transfer certificate (TC)', 'certificate', 'student',
   '<div style="font-size:14px;line-height:1.7">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:14px 0">Transfer Certificate</h2>
<table style="width:100%;border-collapse:collapse;font-size:13.5px">
<tr><td style="border:1px solid #000;padding:4px 8px;width:40px">1</td><td style="border:1px solid #000;padding:4px 8px;width:42%">Name of the student</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.name}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">2</td><td style="border:1px solid #000;padding:4px 8px">Admission no.</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.admission_no}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">3</td><td style="border:1px solid #000;padding:4px 8px">Father's / guardian's name</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.father_name}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">4</td><td style="border:1px solid #000;padding:4px 8px">Mother's name</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.mother_name}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">5</td><td style="border:1px solid #000;padding:4px 8px">Nationality / category</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.nationality}} / {{student.category}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">6</td><td style="border:1px solid #000;padding:4px 8px">Date of birth (as per school record)</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.dob_words}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">7</td><td style="border:1px solid #000;padding:4px 8px">Date of admission / class at admission</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.admission_date}} / {{student.admission_class}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">8</td><td style="border:1px solid #000;padding:4px 8px">Class in which last studied</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.class_section}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">9</td><td style="border:1px solid #000;padding:4px 8px">Last examination passed / result</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.last_exam}} {{extra.result}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">10</td><td style="border:1px solid #000;padding:4px 8px">Whether qualified for promotion</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.promotion}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">11</td><td style="border:1px solid #000;padding:4px 8px">Fee dues</td><td style="border:1px solid #000;padding:4px 8px"><b>{{dues.text}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">12</td><td style="border:1px solid #000;padding:4px 8px">Date of leaving / reason</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.left_on}} — {{extra.reason}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">13</td><td style="border:1px solid #000;padding:4px 8px">Working days / days present</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.working_days}} / {{extra.days_present}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">14</td><td style="border:1px solid #000;padding:4px 8px">General conduct</td><td style="border:1px solid #000;padding:4px 8px"><b>{{extra.conduct}}</b></td></tr>
<tr><td style="border:1px solid #000;padding:4px 8px">15</td><td style="border:1px solid #000;padding:4px 8px">APAAR ID / remarks</td><td style="border:1px solid #000;padding:4px 8px"><b>{{student.apaar_id}} {{extra.remarks}}</b></td></tr>
</table>$b$ || ftr || '</div>', 'TC', 'mark_transferred', true,
   '[{"key":"last_exam","label":"Last examination passed","type":"text"},{"key":"result","label":"Result","type":"text"},{"key":"promotion","label":"Promotion","type":"text"},{"key":"reason","label":"Reason for leaving","type":"text","required":true},{"key":"left_on","label":"Date of leaving","type":"date"},{"key":"working_days","label":"Working days","type":"number"},{"key":"days_present","label":"Days present","type":"number"},{"key":"conduct","label":"Conduct","type":"text"},{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true),
  (sid, 'bonafide_certificate', 'Bonafide certificate', 'certificate', 'student',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">Bonafide Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b>, is a bonafide student of this school, studying in Class <b>{{student.class_section}}</b> in the session <b>{{doc.session}}</b> (Admission no. {{student.admission_no}}). As per the school record {{student.his_her}} date of birth is <b>{{student.dob_words}}</b>. {{extra.remarks}}</p>$b$ || ftr || '</div>', 'BC', 'none', false,
   '[{"key":"remarks","label":"Purpose / remarks","type":"text"}]'::jsonb, true),
  (sid, 'character_certificate', 'Character certificate', 'certificate', 'student',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">Character Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b> (Admission no. {{student.admission_no}}) has been a student of this school since {{student.admission_date}} and is studying in Class <b>{{student.class_section}}</b>. To the best of my knowledge {{student.he_she}} bears a <b>{{extra.conduct}}</b> moral character and {{student.his_her}} conduct has been <b>{{extra.conduct}}</b>. {{extra.remarks}}</p>$b$ || ftr || '</div>', 'CC', 'none', false,
   '[{"key":"conduct","label":"Conduct","type":"text"},{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true),
  (sid, 'study_certificate', 'Study certificate', 'certificate', 'student',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">Study Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b> (Admission no. {{student.admission_no}}) is studying in Class <b>{{student.class_section}}</b> of this school in the session <b>{{doc.session}}</b>. {{extra.remarks}}</p>$b$ || ftr || '</div>', 'SC', 'none', false,
   '[{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true),
  (sid, 'no_dues_certificate', 'No-dues certificate', 'certificate', 'student',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">No Dues Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b> (Admission no. {{student.admission_no}}, Class {{student.class_section}}) — school fee status on {{doc.date}}: <b>{{dues.text}}</b>. {{extra.remarks}}</p>$b$ || ftr || '</div>', 'ND', 'none', false,
   '[{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true),
  (sid, 'admission_letter', 'Admission confirmation letter', 'letter', 'student',
   '<div style="font-size:15px;line-height:1.9">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>Ref.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<p>To,<br>{{student.father_name}}<br>{{student.address}}</p>
<p><b>Subject: Confirmation of admission</b></p>
<p style="text-align:justify">Dear Parent, we are pleased to confirm the admission of <b>{{student.name}}</b> to Class <b>{{student.class_section}}</b> for the session <b>{{doc.session}}</b>. Admission no.: <b>{{student.admission_no}}</b>. Please complete the formalities and fee payment as advised by the school office.</p>$b$ || ftr || '</div>', 'AL', 'none', false, '[]'::jsonb, true),
  (sid, 'student_id_card', 'Student ID card', 'id_card', 'student',
   $c$<div style="width:86mm;height:54mm;box-sizing:border-box;border:1px solid #1e3a8a;border-radius:6px;overflow:hidden;font-family:Arial,sans-serif;font-size:9px;line-height:1.35;color:#111;background:#fff">
<div style="background:#1e3a8a;color:#fff;padding:3px 6px;display:flex;align-items:center;gap:6px"><div style="width:9mm;height:9mm;background:#fff;border-radius:3px">{{school.logo}}</div><div><div style="font-size:11px;font-weight:700">{{school.name}}</div><div style="font-size:7.5px">{{school.city}} · {{school.phone}}</div></div></div>
<div style="display:flex;gap:6px;padding:5px 6px"><div style="width:20mm;height:25mm;border:1px solid #999;flex:none">{{student.photo}}</div>
<div style="flex:1"><div style="font-size:11px;font-weight:700">{{student.name}}</div>
<div>Class: <b>{{student.class_section}}</b> · Roll: <b>{{student.roll_no}}</b></div><div>Adm. no.: <b>{{student.admission_no}}</b></div><div>S/D of: {{student.father_name}}</div><div>DOB: {{student.dob}} · Blood: {{student.blood_group}}</div><div>Ph: {{student.phone}}</div></div></div>
<div style="display:flex;justify-content:space-between;padding:0 6px;font-size:7.5px"><span>Valid upto: {{doc.valid_until}}</span><span>Principal</span></div></div>$c$,
   'ID', 'none', false, '[]'::jsonb, true),
  (sid, 'staff_id_card', 'Staff ID card', 'id_card', 'staff',
   $c$<div style="width:86mm;height:54mm;box-sizing:border-box;border:1px solid #14532d;border-radius:6px;overflow:hidden;font-family:Arial,sans-serif;font-size:9px;line-height:1.4;color:#111;background:#fff">
<div style="background:#14532d;color:#fff;padding:3px 6px;display:flex;align-items:center;gap:6px"><div style="width:9mm;height:9mm;background:#fff;border-radius:3px">{{school.logo}}</div><div><div style="font-size:11px;font-weight:700">{{school.name}}</div><div style="font-size:7.5px">{{school.city}} · {{school.phone}}</div></div></div>
<div style="padding:8px 8px"><div style="font-size:12px;font-weight:700">{{staff.name}}</div><div>{{staff.designation}} · {{staff.department}}</div><div>Emp. code: <b>{{staff.emp_code}}</b></div><div>Phone: {{staff.phone}}</div><div>Joined: {{staff.joining_date}}</div></div>
<div style="display:flex;justify-content:space-between;padding:0 8px;font-size:7.5px"><span>Valid upto: {{doc.valid_until}}</span><span>Principal</span></div></div>$c$,
   'SID', 'none', false, '[]'::jsonb, true),
  (sid, 'experience_certificate', 'Experience certificate (staff)', 'certificate', 'staff',
   '<div style="font-size:15px;line-height:2">' || hdr || $b$<div style="display:flex;justify-content:space-between;font-size:13px"><span>No.: <b>{{doc.no}}</b></span><span>Date: <b>{{doc.date}}</b></span></div>
<h2 style="text-align:center;text-decoration:underline;text-transform:uppercase;margin:16px 0">Experience Certificate</h2>
<p style="text-align:justify">This is to certify that <b>{{staff.name}}</b> worked in this school as <b>{{staff.designation}}</b> ({{staff.department}}) from <b>{{staff.joining_date}}</b> to <b>{{staff.leaving_date}}</b>. {{extra.remarks}} We wish {{staff.name}} all the best.</p>$b$ || ftr || '</div>', 'EXP', 'none', true,
   '[{"key":"remarks","label":"Remarks","type":"text"}]'::jsonb, true)
  on conflict (school_id, code) do nothing;
  get diagnostics cnt = row_count;
  update public.document_templates set page_size = 'card', card_width_mm = 86, card_height_mm = 54, valid_days = null
   where school_id = sid and code in ('student_id_card', 'staff_id_card') and card_width_mm is null;
  return cnt;
end $$;
revoke execute on function public.seed_templates_internal(uuid) from public, anon, authenticated;

create or replace function public.seed_document_templates(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'documents.templates.create') then raise exception 'not allowed'; end if;
  return public.seed_templates_internal(sid);
end $$;

create or replace function public.seed_templates_on_school() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.seed_templates_internal(new.id); return null; end $$;
drop trigger if exists schools_seed_templates on public.schools;
create trigger schools_seed_templates after insert on public.schools for each row execute function public.seed_templates_on_school();

select public.seed_templates_internal(id) from public.schools;

-- every plan includes the new module
update public.plans set modules = array_append(modules, 'documents') where not ('documents' = any(modules));
insert into public.school_modules (school_id, module_code, licensed, enabled)
select s.id, 'documents', true, true from public.schools s on conflict do nothing;

-- audit
do $$
declare t text;
begin
  foreach t in array array['online_admission_settings','document_templates','issued_documents'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- new permission keys for schools that already exist
insert into public.role_permissions (role_id, perm_key, scope)
select r.id, t.perm_key, t.scope
  from public.roles r
  join public.role_template_permissions t on t.template_code = r.template_code
 where t.perm_key like 'documents.%' or t.perm_key like 'frontdesk.online_form.%'
on conflict (role_id, perm_key) do nothing;
