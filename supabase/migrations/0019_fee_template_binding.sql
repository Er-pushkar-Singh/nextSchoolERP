-- ═══════════════════════════════════════════════════════════════════════════
-- Step 17: bind a fee template to what it is used for.
-- Before: the receipt looked for a template with the code "fee_receipt" only, so a template made from the
-- gallery (or a blank design) under another code was never applied.
-- Now: document_templates.fee_kind says "this one is THE receipt / demand notice / statement"; one per school.
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.document_templates drop constraint if exists document_templates_category_check;
alter table public.document_templates add constraint document_templates_category_check
  check (category in ('certificate','id_card','letter','fees','other'));
alter table public.document_templates add column if not exists design jsonb;
alter table public.document_templates add column if not exists module text;
alter table public.document_templates add column if not exists preset text;

alter table public.document_templates add column if not exists fee_kind text;
alter table public.document_templates drop constraint if exists document_templates_fee_kind_check;
alter table public.document_templates add constraint document_templates_fee_kind_check check (fee_kind is null or fee_kind in ('receipt', 'demand', 'statement'));
drop index if exists public.document_templates_fee_kind;

-- templates that already exist: the standard code wins, else the gallery design, else the newest one of the category
update public.document_templates set fee_kind = null where fee_kind is not null;
with ranked as (
  select id, school_id,
         case when code = 'fee_receipt' or preset = 'fee_receipt_design' or code like 'fee_receipt%' then 'receipt'
              when code = 'fee_demand' or preset = 'fee_demand_design' or code like 'fee_demand%' then 'demand'
              when code = 'fee_statement' or preset = 'fee_statement_design' or code like 'fee_statement%' then 'statement' end as k,
         row_number() over (partition by school_id,
              case when code = 'fee_receipt' or preset = 'fee_receipt_design' or code like 'fee_receipt%' then 'receipt'
                   when code = 'fee_demand' or preset = 'fee_demand_design' or code like 'fee_demand%' then 'demand'
                   when code = 'fee_statement' or preset = 'fee_statement_design' or code like 'fee_statement%' then 'statement' end
              order by (code like 'fee\_%' and code in ('fee_receipt', 'fee_demand', 'fee_statement')) asc, updated_at desc) as rn
    from public.document_templates where category = 'fees' and active
)
update public.document_templates t set fee_kind = r.k from ranked r where t.id = r.id and r.k is not null and r.rn = 1;

create unique index if not exists document_templates_fee_kind on public.document_templates (school_id, fee_kind) where fee_kind is not null;

-- the template to use for a document: the bound one, else the standard code, else any active fee template of that name
create or replace function public.render_fee_document(p_kind text, subject uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb; t record; sid uuid;
begin
  if p_kind not in ('receipt', 'demand', 'statement') then raise exception 'Unknown document.'; end if;
  d := public.fee_template_data(p_kind, subject);
  if d is null then return null; end if;
  select school_id into sid from public.students where id = (case when p_kind = 'receipt' then (select student_id from public.fee_receipts where id = subject) else subject end);
  select * into t from public.document_templates
   where school_id = sid and category = 'fees' and active
     and (fee_kind = p_kind or code = 'fee_' || p_kind or preset = 'fee_' || p_kind || '_design')
   order by (fee_kind = p_kind) desc nulls last, (code = 'fee_' || p_kind) desc, updated_at desc limit 1;
  if t.id is null then return null; end if;
  return jsonb_build_object('html', public.sanitize_template_html(public.render_document(t.body_html, d)), 'template_id', t.id, 'name', t.name,
                            'page_size', t.page_size, 'orientation', t.orientation);
end $$;

create or replace function public.preview_fee_template(tpl uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t record; subj uuid; d jsonb; k text;
begin
  select * into t from public.document_templates where id = tpl;
  if t.id is null or t.category <> 'fees' or not public.has_perm_school(t.school_id, 'documents.templates.view') then return null; end if;
  k := coalesce(t.fee_kind, case when t.code like 'fee_demand%' or t.preset like 'fee_demand%' then 'demand' when t.code like 'fee_statement%' or t.preset like 'fee_statement%' then 'statement' else 'receipt' end);
  if k = 'receipt' then
    select id into subj from public.fee_receipts where school_id = t.school_id order by created_at desc limit 1;
  else
    select du.student_id into subj from public.fee_dues du where du.school_id = t.school_id group by du.student_id order by sum(du.amount - du.concession + du.fine - du.paid) desc limit 1;
  end if;
  if subj is null then return jsonb_build_object('empty', true); end if;
  d := public.fee_template_data(k, subj);
  if d is null then return jsonb_build_object('empty', true); end if;
  return jsonb_build_object('html', public.sanitize_template_html(public.render_document(t.body_html, d)));
end $$;

-- "use this template for receipts / demand notices / statements" (one per school and kind); null = stop using it
create or replace function public.set_fee_template(tpl uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from public.document_templates where id = tpl;
  if t.id is null then raise exception 'Template not found.'; end if;
  if not public.has_perm_school(t.school_id, 'documents.templates.edit') then raise exception 'not allowed'; end if;
  if p_kind is not null and p_kind not in ('receipt', 'demand', 'statement') then raise exception 'Unknown document type.'; end if;
  if p_kind is null then
    update public.document_templates set fee_kind = null where id = tpl;
    return;
  end if;
  update public.document_templates set fee_kind = null where school_id = t.school_id and fee_kind = p_kind and id <> tpl;
  update public.document_templates set category = 'fees', fee_kind = p_kind, active = true, module = 'fees' where id = tpl;
end $$;
