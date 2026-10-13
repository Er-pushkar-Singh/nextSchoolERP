-- ═══════════════════════════════════════════════════════════════════════════
-- Step 16: template studio — templates can carry a visual design (drag-and-drop canvas, like Canva).
--   design  : the canvas as JSON (items with position, size, style) — the editable source
--   body_html : the HTML compiled from it (what the database renders and sanitises, unchanged)
--   module  : which module the template belongs to (students, staff, fees, admissions, library, transport …)
-- Safe to run again.
-- ═══════════════════════════════════════════════════════════════════════════
-- (also in 0016; repeated so this migration works on its own) the "fees" category of fee receipts / notices / statements
alter table public.document_templates drop constraint if exists document_templates_category_check;
alter table public.document_templates add constraint document_templates_category_check
  check (category in ('certificate','id_card','letter','fees','other'));

alter table public.document_templates add column if not exists design jsonb;
alter table public.document_templates add column if not exists module text;
alter table public.document_templates add column if not exists preset text;          -- the gallery design it was made from

-- design is kept with the version history, so a restore brings the canvas back too
alter table public.document_template_versions add column if not exists design jsonb;

create or replace function public.template_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    insert into public.document_template_versions (template_id, school_id, version, name, body_html, fields, design, changed_by)
    values (new.id, new.school_id, new.version, new.name, new.body_html, new.fields, new.design, auth.uid()) on conflict (template_id, version) do nothing;
  end if;
  return null;
end $$;

-- a new design counts as a new version even if the compiled html happened to be identical
create or replace function public.template_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body_html := public.sanitize_template_html(new.body_html);
  if tg_op = 'UPDATE' then
    if new.body_html is distinct from old.body_html or new.fields is distinct from old.fields or new.design is distinct from old.design then new.version := old.version + 1; else new.version := old.version; end if;
    new.updated_at := now();
    new.code := old.code; new.school_id := old.school_id;
  end if;
  return new;
end $$;

-- module of the standard templates
update public.document_templates set module = case
  when category = 'fees' then 'fees'
  when audience = 'staff' then 'staff'
  else 'students' end
 where module is null;
