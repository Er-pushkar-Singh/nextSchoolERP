-- ═══════════════════════════════════════════════════════════════════════════
-- Step 14 (part 1): fix — students had TWO foreign keys to classes (class_id and admission_class_id),
-- which makes every PostgREST embed "students → classes(name)" ambiguous, so the student page,
-- fee collect, receipts, board pages … returned "not found". admission_class_id is a plain column again.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
     where con.contype = 'f' and con.conrelid = 'public.students'::regclass and con.confrelid = 'public.classes'::regclass and a.attname = 'admission_class_id'
  loop
    execute format('alter table public.students drop constraint %I', c.conname);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Step 14 (part 2): fee templates (receipt / demand notice / statement), payment methods and payment links.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────── Payment methods: cash · debit / credit card · others (UPI, cheque, bank transfer, DD, other) · gateway / link ─────────────
alter table public.fee_receipts drop constraint if exists fee_receipts_mode_check;
alter table public.fee_receipts add constraint fee_receipts_mode_check
  check (mode in ('cash','upi','cheque','bank_transfer','card','online','dd','other','mixed','wallet'));
alter table public.fee_receipt_payments drop constraint if exists fee_receipt_payments_mode_check;
alter table public.fee_receipt_payments add constraint fee_receipt_payments_mode_check
  check (mode in ('cash','upi','cheque','bank_transfer','card','online','dd','other'));
alter table public.fee_receipt_payments add column if not exists sub_type text;     -- debit / credit, or the label of "other"

create or replace function public.collect_fee_core(sid uuid, stu uuid, p_splits jsonb, p_due_ids uuid[], p_wallet_use numeric, p_paid_on date, p_note text, p_by text,
                                                   p_fine numeric, p_force_advance boolean, p_online_order uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st record; sp jsonb; rid uuid; rno text; money numeric := 0; wuse numeric := coalesce(p_wallet_use, 0); bal numeric; wallet numeric; alloc numeric; excess numeric;
        d record; take numeric; left_amt numeric; modes text[] := '{}'; m text; first_ref text; first_due uuid; pid uuid; any_line boolean := false;
begin
  if not exists (select 1 from public.students where id = stu and school_id = sid) then raise exception 'Student not found'; end if;
  select * into st from public.fee_settings where school_id = sid;
  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    if (sp ->> 'mode') not in ('cash','upi','cheque','bank_transfer','card','online','dd','other') then raise exception 'Unknown payment mode "%".', sp ->> 'mode'; end if;
    if coalesce((sp ->> 'amount')::numeric, 0) <= 0 then raise exception 'Every payment line needs an amount.'; end if;
    money := money + (sp ->> 'amount')::numeric;
    if not ((sp ->> 'mode') = any(modes)) then modes := modes || (sp ->> 'mode'); end if;
  end loop;
  if money + wuse <= 0 then raise exception 'Amount must be more than zero'; end if;
  if wuse < 0 then raise exception 'Wallet amount cannot be negative.'; end if;
  select coalesce(sum(amount), 0) into wallet from public.fee_wallet_entries where student_id = stu;
  if wuse > wallet then raise exception 'The wallet has only % — use less.', wallet; end if;

  -- automatic late fine up to the payment date, then an optional manual fine
  perform public.apply_late_fines_core(sid, stu, coalesce(p_paid_on, public.today_ist()));
  if coalesce(p_fine, 0) > 0 then
    select id into first_due from public.fee_dues where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or id = any(p_due_ids)) order by due_date, label limit 1;
    if first_due is null then raise exception 'No unpaid instalment to add the fine to'; end if;
    update public.fee_dues set fine = fine + p_fine where id = first_due;
  end if;

  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
   where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  excess := greatest(money + wuse - bal, 0);
  if excess > 0 then
    if wuse > 0 and excess > money then raise exception 'The wallet use is more than what is due. Use less.'; end if;
    if not coalesce(st.advance_allowed, true) and not p_force_advance then raise exception 'Amount is more than the total due'; end if;
  end if;
  alloc := money + wuse - excess;

  rno := public.next_school_number_core(sid, 'receipt');
  insert into public.fee_receipts (school_id, receipt_no, student_id, paid_on, mode, reference, amount, note, collected_by, advance_amount, wallet_used, online_order_id)
  values (sid, rno, stu, coalesce(p_paid_on, public.today_ist()),
          case when cardinality(modes) > 1 then 'mixed' when cardinality(modes) = 1 then modes[1] else 'wallet' end,
          nullif(p_splits -> 0 ->> 'reference', ''), alloc, p_note, p_by, excess, wuse, p_online_order)
  returning id into rid;

  for sp in select * from jsonb_array_elements(coalesce(p_splits, '[]'::jsonb)) loop
    insert into public.fee_receipt_payments (school_id, receipt_id, mode, amount, reference, sub_type)
    values (sid, rid, sp ->> 'mode', (sp ->> 'amount')::numeric, nullif(btrim(coalesce(sp ->> 'reference', sp ->> 'cheque_no', '')), ''), nullif(btrim(coalesce(sp ->> 'sub_type', '')), '')) returning id into pid;
    if (sp ->> 'mode') = 'cheque' then
      insert into public.fee_cheques (school_id, receipt_id, student_id, cheque_no, bank, cheque_date, amount)
      values (sid, rid, stu, coalesce(nullif(btrim(coalesce(sp ->> 'cheque_no', sp ->> 'reference', '')), ''), 'N/A'), nullif(sp ->> 'bank', ''), nullif(sp ->> 'cheque_date', '')::date, (sp ->> 'amount')::numeric);
    end if;
  end loop;

  left_amt := alloc;
  for d in select id, greatest(amount - concession + fine - paid, 0) as b from public.fee_dues
            where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids))
            order by due_date, label for update loop
    exit when left_amt <= 0;
    take := least(d.b, left_amt);
    if take > 0 then
      insert into public.fee_receipt_lines (school_id, receipt_id, due_id, amount) values (sid, rid, d.id, take);
      left_amt := left_amt - take; any_line := true;
    end if;
  end loop;
  if wuse > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'applied', -wuse, rid, 'Used against receipt ' || rno, p_by); end if;
  if excess > 0 then insert into public.fee_wallet_entries (school_id, student_id, kind, amount, receipt_id, note, created_by) values (sid, stu, 'advance', excess, rid, 'Advance with receipt ' || rno, p_by); end if;
  return rid;
end $$;

revoke execute on function public.collect_fee_core(uuid, uuid, jsonb, uuid[], numeric, date, text, text, numeric, boolean, uuid) from public, anon, authenticated;

-- ───────────── Payment links (staff) and gateway orders ─────────────
alter table public.fee_online_orders add column if not exists created_by_name text;
alter table public.fee_online_orders add column if not exists channel text not null default 'parent';
alter table public.fee_online_orders add column if not exists note text;
alter table public.fee_online_orders add column if not exists phone text;
alter table public.fee_online_orders add column if not exists expires_at timestamptz;
alter table public.fee_online_orders add column if not exists cancelled_at timestamptz;
alter table public.fee_online_orders drop constraint if exists fee_online_orders_channel_check;
alter table public.fee_online_orders add constraint fee_online_orders_channel_check check (channel in ('parent','link','gateway'));

drop function if exists public.create_online_order(uuid, uuid, numeric, uuid[]);
create or replace function public.create_online_order(sid uuid, stu uuid, p_amount numeric, p_due_ids uuid[],
                                                      p_channel text default 'parent', p_by text default null, p_note text default null, p_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st record; bal numeric; oid uuid;
begin
  if not public.is_service() then raise exception 'not allowed'; end if;
  select * into st from public.fee_settings where school_id = sid;
  if st.school_id is null or not st.online_enabled then raise exception 'Online payment is not switched on for this school (Fees → Fee settings).'; end if;
  if not public.school_writable(sid) then raise exception 'This school cannot take payments right now.'; end if;
  if not exists (select 1 from public.students where id = stu and school_id = sid and status in ('active', 'admission_pending')) then raise exception 'Student not found.'; end if;
  if p_channel not in ('parent', 'link', 'gateway') then raise exception 'Unknown channel.'; end if;
  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0) into bal from public.fee_dues
   where student_id = stu and school_id = sid and status <> 'paid' and (p_due_ids is null or cardinality(p_due_ids) = 0 or id = any(p_due_ids));
  if bal <= 0 then raise exception 'Nothing is due.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  if p_channel = 'parent' and p_amount < st.online_min_amount then raise exception 'The minimum online payment is %.', st.online_min_amount; end if;
  if p_amount > bal then raise exception 'The amount is more than what is due (%).', bal; end if;
  if p_channel = 'parent' and not st.online_allow_partial and p_amount < bal then raise exception 'Please pay the full amount due (%).', bal; end if;
  update public.fee_online_orders set status = 'expired' where student_id = stu and status = 'created' and coalesce(expires_at, created_at + interval '2 days') < now();
  insert into public.fee_online_orders (school_id, student_id, amount, due_ids, channel, created_by_name, note, phone, expires_at)
  values (sid, stu, p_amount, nullif(p_due_ids, '{}'), p_channel, p_by, nullif(btrim(coalesce(p_note, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''), now() + interval '3 days')
  returning id into oid;
  return oid;
end $$;
revoke execute on function public.create_online_order(uuid, uuid, numeric, uuid[], text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_online_order(uuid, uuid, numeric, uuid[], text, text, text, text) to service_role;

create or replace function public.cancel_payment_link(oid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.fee_online_orders where id = oid for update;
  if o.id is null then raise exception 'Payment link not found.'; end if;
  if not (public.has_perm_school(o.school_id, 'fees.online.create') or public.is_service()) then raise exception 'not allowed'; end if;
  if o.status <> 'created' then raise exception 'This link is already % and cannot be cancelled.', o.status; end if;
  update public.fee_online_orders set status = 'cancelled', cancelled_at = now() where id = oid;
  return o.link_id;
end $$;

-- ───────────── Fee templates ─────────────
alter table public.document_templates drop constraint if exists document_templates_category_check;
alter table public.document_templates add constraint document_templates_category_check check (category in ('certificate','id_card','letter','fees','other'));

-- {{fee.*_html}} values are built by the functions below (every cell escaped) and inserted as they are.
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
    elsif k ~ '^fee\.[a-z_]+_html$' then
      out := replace(out, '{{' || k || '}}', coalesce(v, ''));
    else
      out := replace(out, '{{' || k || '}}', public.html_escape(v));
    end if;
  end loop;
  return out;
end $$;

create or replace function public.money_text(n numeric) returns text
language sql immutable as $$ select '₹' || trim(to_char(coalesce(n, 0), 'FM99,99,99,990.00')); $$;

create or replace function public.rupee_words(n numeric) returns text
language plpgsql immutable as $$
declare r int := floor(abs(coalesce(n, 0)))::int; p int := round((abs(coalesce(n, 0)) - floor(abs(coalesce(n, 0)))) * 100)::int; t text;
begin
  t := case when r >= 100000 then public.number_words(r / 100000) || ' Lakh' || case when r % 100000 > 0 then ' ' || public.number_words(r % 100000) else '' end else public.number_words(r) end;
  return t || ' Rupees' || case when p > 0 then ' and ' || public.number_words(p) || ' Paise' else '' end || ' Only';
end $$;

-- the data of a fee document. kind: receipt (subject = receipt id), demand | statement (subject = student id)
create or replace function public.fee_template_data(p_kind text, subject uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sid uuid; stu uuid; r record; s record; sc record; d jsonb; fee jsonb; rows text := ''; rows2 text := ''; owed numeric; over numeric; paid_t numeric; billed_t numeric;
        adv numeric; pays text; sess text;
  td text := 'border:1px solid #444;padding:4px 8px';
begin
  if p_kind = 'receipt' then
    select * into r from public.fee_receipts where id = subject;
    if r.id is null then return null; end if;
    sid := r.school_id; stu := r.student_id;
    if not (public.can_student(sid, 'fees.receipts.view', stu) or public.can_student(sid, 'fees.collection.view', stu) or public.is_service()) then return null; end if;
  else
    select school_id into sid from public.students where id = subject;
    if sid is null then return null; end if;
    stu := subject;
    if not (public.can_student(sid, 'fees.collection.view', stu) or public.can_student(sid, 'fees.defaulters.view', stu) or public.is_service()) then return null; end if;
  end if;
  select * into sc from public.schools where id = sid;
  select st.*, c.name as cname, sec.name as sname into s from public.students st left join public.classes c on c.id = st.class_id left join public.sections sec on sec.id = st.section_id where st.id = stu;
  select name into sess from public.sessions where school_id = sid and is_current limit 1;
  select coalesce(sum(greatest(amount - concession + fine - paid, 0)), 0),
         coalesce(sum(greatest(amount - concession + fine - paid, 0)) filter (where due_date < public.today_ist()), 0),
         coalesce(sum(paid), 0), coalesce(sum(amount + fine), 0)
    into owed, over, paid_t, billed_t from public.fee_dues where student_id = stu;
  select coalesce(sum(amount), 0) into adv from public.fee_wallet_entries where student_id = stu;

  d := jsonb_build_object(
    'school', jsonb_build_object('name', sc.name, 'address', sc.address, 'city', sc.city, 'state', sc.state, 'pincode', sc.pincode, 'phone', sc.phone, 'email', sc.email,
      'board', sc.board, 'affiliation_no', sc.affiliation_no, 'udise_code', sc.udise_code, 'principal_name', sc.principal_name, 'logo', sc.logo_url),
    'student', jsonb_build_object('name', btrim(concat_ws(' ', s.first_name, s.middle_name, s.last_name)), 'admission_no', s.admission_no, 'class', s.cname, 'section', s.sname,
      'class_section', concat_ws('-', s.cname, s.sname), 'father_name', s.father_name, 'mother_name', s.mother_name, 'phone', s.guardian_phone, 'roll_no', s.roll_no),
    'doc', jsonb_build_object('session', sess, 'date', to_char(public.today_ist(), 'DD/MM/YYYY'), 'no', ''));

  if p_kind = 'receipt' then
    select coalesce(string_agg('<tr><td style="' || td || '">' || public.html_escape(coalesce(du.label, 'Fee')) || '</td><td style="' || td || ';text-align:right">' || public.money_text(l.amount) || '</td></tr>', '' order by du.due_date, du.label), '')
      into rows from public.fee_receipt_lines l left join public.fee_dues du on du.id = l.due_id where l.receipt_id = r.id;
    select coalesce(string_agg(case p.mode when 'cash' then 'Cash' when 'card' then coalesce(initcap(p.sub_type) || ' card', 'Card') when 'upi' then 'UPI' when 'cheque' then 'Cheque'
                  when 'bank_transfer' then 'Bank transfer' when 'dd' then 'Demand draft' when 'online' then 'Online' else coalesce(p.sub_type, 'Other') end
                  || ' ' || public.money_text(p.amount) || coalesce(' (' || p.reference || ')', ''), ' + ' order by p.amount desc), '')
      into pays from public.fee_receipt_payments p where p.receipt_id = r.id;
    fee := jsonb_build_object(
      'receipt_no', r.receipt_no, 'date', to_char(r.paid_on, 'DD/MM/YYYY'), 'amount', public.money_text(r.amount), 'amount_words', public.rupee_words(r.amount),
      'mode', case r.mode when 'mixed' then 'Split payment' when 'wallet' then 'From advance' else initcap(replace(r.mode, '_', ' ')) end, 'payments', coalesce(pays, ''),
      'reference', coalesce(r.reference, ''), 'note', coalesce(r.note, ''), 'collected_by', coalesce(r.collected_by, ''),
      'advance', case when r.advance_amount > 0 then public.money_text(r.advance_amount) else '' end,
      'wallet_used', case when r.wallet_used > 0 then public.money_text(r.wallet_used) else '' end,
      'balance', public.money_text(owed), 'status', case when r.cancelled then 'CANCELLED' else '' end,
      'lines_html', '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="' || td || ';text-align:left">Particulars</th><th style="' || td || ';text-align:right">Amount</th></tr></thead><tbody>'
                    || rows || '</tbody><tfoot><tr><th style="' || td || ';text-align:left">Total received</th><th style="' || td || ';text-align:right">' || public.money_text(r.amount) || '</th></tr></tfoot></table>');
    d := jsonb_set(d, '{doc,no}', to_jsonb(r.receipt_no)) || jsonb_build_object('fee', fee);
  else
    select coalesce(string_agg('<tr><td style="' || td || '">' || public.html_escape(du.label) || '</td><td style="' || td || '">' || to_char(du.due_date, 'DD/MM/YYYY') || '</td><td style="' || td || ';text-align:right">'
             || public.money_text(du.amount - du.concession + du.fine) || '</td><td style="' || td || ';text-align:right">' || public.money_text(du.paid) || '</td><td style="' || td || ';text-align:right"><b>'
             || public.money_text(greatest(du.amount - du.concession + du.fine - du.paid, 0)) || '</b></td></tr>', '' order by du.due_date, du.label), '')
      into rows from public.fee_dues du where du.student_id = stu and (p_kind = 'statement' or du.amount - du.concession + du.fine - du.paid > 0);
    select coalesce(string_agg('<tr><td style="' || td || '">' || public.html_escape(fr.receipt_no) || '</td><td style="' || td || '">' || to_char(fr.paid_on, 'DD/MM/YYYY') || '</td><td style="' || td || '">'
             || public.html_escape(initcap(replace(fr.mode, '_', ' '))) || '</td><td style="' || td || ';text-align:right">' || public.money_text(fr.amount) || '</td></tr>', '' order by fr.paid_on), '')
      into rows2 from public.fee_receipts fr where fr.student_id = stu and not fr.cancelled;
    fee := jsonb_build_object(
      'total_due', public.money_text(owed), 'overdue', public.money_text(over), 'paid_total', public.money_text(paid_t), 'billed_total', public.money_text(billed_t),
      'due_words', public.rupee_words(owed), 'advance', case when adv > 0 then public.money_text(adv) else '' end, 'as_on', to_char(public.today_ist(), 'DD/MM/YYYY'),
      'dues_html', '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="' || td || ';text-align:left">Fee</th><th style="' || td || ';text-align:left">Due date</th><th style="'
                   || td || ';text-align:right">Amount</th><th style="' || td || ';text-align:right">Paid</th><th style="' || td || ';text-align:right">Balance</th></tr></thead><tbody>' || rows
                   || '</tbody><tfoot><tr><th style="' || td || '" colspan="4">Total outstanding</th><th style="' || td || ';text-align:right">' || public.money_text(owed) || '</th></tr></tfoot></table>',
      'receipts_html', '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="' || td || ';text-align:left">Receipt</th><th style="' || td || ';text-align:left">Date</th><th style="'
                   || td || ';text-align:left">Mode</th><th style="' || td || ';text-align:right">Amount</th></tr></thead><tbody>' || rows2 || '</tbody></table>');
    d := d || jsonb_build_object('fee', fee);
  end if;
  return d;
end $$;
revoke execute on function public.fee_template_data(text, uuid) from public, anon, authenticated;

-- the rendered, sanitised document (null when the school has no active template of this kind: the app then uses its built-in layout)
create or replace function public.render_fee_document(p_kind text, subject uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb; t record; sid uuid;
begin
  if p_kind not in ('receipt', 'demand', 'statement') then raise exception 'Unknown document.'; end if;
  d := public.fee_template_data(p_kind, subject);
  if d is null then return null; end if;
  select school_id into sid from public.students where id = (case when p_kind = 'receipt' then (select student_id from public.fee_receipts where id = subject) else subject end);
  select * into t from public.document_templates where school_id = sid and code = 'fee_' || p_kind and active;
  if t.id is null then return null; end if;
  return jsonb_build_object('html', public.sanitize_template_html(public.render_document(t.body_html, d)), 'template_id', t.id, 'name', t.name,
                            'page_size', t.page_size, 'orientation', t.orientation);
end $$;

-- preview for the template editor: the latest receipt (receipt) or the student with the largest balance (demand / statement)
create or replace function public.preview_fee_template(tpl uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t record; subj uuid; d jsonb;
begin
  select * into t from public.document_templates where id = tpl;
  if t.id is null or t.category <> 'fees' or not public.has_perm_school(t.school_id, 'documents.templates.view') then return null; end if;
  if t.code = 'fee_receipt' then
    select id into subj from public.fee_receipts where school_id = t.school_id order by created_at desc limit 1;
  else
    select du.student_id into subj from public.fee_dues du where du.school_id = t.school_id group by du.student_id order by sum(du.amount - du.concession + du.fine - du.paid) desc limit 1;
  end if;
  if subj is null then return jsonb_build_object('empty', true); end if;
  d := public.fee_template_data(case t.code when 'fee_receipt' then 'receipt' when 'fee_demand' then 'demand' else 'statement' end, subj);
  if d is null then return jsonb_build_object('empty', true); end if;
  return jsonb_build_object('html', public.sanitize_template_html(public.render_document(t.body_html, d)));
end $$;

-- the standard fee templates
create or replace function public.seed_fee_templates_internal(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cnt int := 0; hdr text := $h$<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:8px"><div style="font-size:20px;font-weight:800;text-transform:uppercase">{{school.name}}</div><div style="font-size:12px">{{school.address}}, {{school.city}} {{school.pincode}} · {{school.phone}}</div><div style="font-size:11px">{{school.board}} · Aff. No. {{school.affiliation_no}}</div></div>$h$;
begin
  insert into public.document_templates (school_id, code, name, category, audience, body_html, page_size, orientation, numbering_prefix, fields, is_system) values
  (sid, 'fee_receipt', 'Fee receipt', 'fees', 'student',
   '<div style="font-size:13px;line-height:1.5">' || hdr || $b$<div style="text-align:center;font-weight:800;letter-spacing:1px;margin:6px 0">FEE RECEIPT <span style="color:#b00020">{{fee.status}}</span></div>
<div style="display:flex;justify-content:space-between"><span>Receipt no.: <b>{{fee.receipt_no}}</b></span><span>Date: <b>{{fee.date}}</b></span></div>
<div style="display:flex;justify-content:space-between;margin-top:4px"><span>Student: <b>{{student.name}}</b></span><span>Adm. no.: <b>{{student.admission_no}}</b></span></div>
<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Father: {{student.father_name}}</span><span>Class: {{student.class_section}}</span></div>
{{fee.lines_html}}
<p style="margin:8px 0 2px">In words: <b>{{fee.amount_words}}</b></p>
<p style="margin:2px 0">Paid by: <b>{{fee.payments}}</b> {{fee.note}}</p>
<p style="margin:2px 0">Balance after this receipt: <b>{{fee.balance}}</b></p>
<div style="display:flex;justify-content:space-between;margin-top:36px;font-size:12px"><span>Received by: {{fee.collected_by}}</span><span>Authorised signatory</span></div>
<p style="font-size:11px;color:#555;margin-top:8px">Fees once paid are not refundable. Computer generated receipt.</p></div>$b$,
   'A5', 'portrait', 'FR', '[]', true),
  (sid, 'fee_demand', 'Fee demand notice', 'fees', 'student',
   '<div style="font-size:14px;line-height:1.6">' || hdr || $b$<div style="display:flex;justify-content:space-between"><span>Date: <b>{{fee.as_on}}</b></span><span>Session: <b>{{doc.session}}</b></span></div>
<h2 style="text-align:center;text-transform:uppercase;margin:12px 0">Fee demand notice</h2>
<p>To,<br>The Parent / Guardian of <b>{{student.name}}</b> (Adm. no. {{student.admission_no}}, Class {{student.class_section}})<br>Father: {{student.father_name}}</p>
<p>Our records show that the following fees are outstanding. You are requested to pay <b>{{fee.total_due}}</b> ({{fee.due_words}}) at the school office at the earliest.</p>
{{fee.dues_html}}
<p style="margin-top:14px">If you have already paid, please ignore this notice or show the receipt at the office.</p>
<div style="display:flex;justify-content:space-between;margin-top:60px"><span>Accounts office</span><span style="text-align:center">Principal<br><small>(signature &amp; school seal)</small></span></div></div>$b$,
   'A4', 'portrait', 'FD', '[]', true),
  (sid, 'fee_statement', 'Fee statement', 'fees', 'student',
   '<div style="font-size:13.5px;line-height:1.5">' || hdr || $b$<h2 style="text-align:center;margin:10px 0">Fee statement — {{doc.session}}</h2>
<p><b>{{student.name}}</b> · Adm. no. {{student.admission_no}} · Class {{student.class_section}} · Father: {{student.father_name}}</p>
<h4 style="margin:10px 0 4px">Instalments</h4>
{{fee.dues_html}}
<h4 style="margin:12px 0 4px">Receipts</h4>
{{fee.receipts_html}}
<p style="margin-top:10px">Billed <b>{{fee.billed_total}}</b> · Paid <b>{{fee.paid_total}}</b> · Outstanding <b>{{fee.total_due}}</b> {{fee.advance}}</p>
<p style="font-size:11px;color:#555">Statement as on {{fee.as_on}}.</p></div>$b$,
   'A4', 'portrait', 'FS', '[]', true)
  on conflict (school_id, code) do nothing;
  get diagnostics cnt = row_count;
  return cnt;
end $$;
revoke execute on function public.seed_fee_templates_internal(uuid) from public, anon, authenticated;

create or replace function public.seed_fee_templates(sid uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm_school(sid, 'documents.templates.create') and not public.has_perm_school(sid, 'fees.structure.edit') then raise exception 'not allowed'; end if;
  return public.seed_fee_templates_internal(sid);
end $$;

create or replace function public.seed_fee_templates_on_school() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public.seed_fee_templates_internal(new.id); return null; end $$;
drop trigger if exists schools_seed_fee_templates on public.schools;
create trigger schools_seed_fee_templates after insert on public.schools for each row execute function public.seed_fee_templates_on_school();

select public.seed_fee_templates_internal(id) from public.schools;
