"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { errMsg, go, str, uuid } from "@/lib/action-util";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { compileDesign, normalizeDesign, pageOf, presetByKey } from "@/lib/design";

const STUDIO = "/app/templates";

/** Saves the canvas: the design JSON is the source, the HTML is compiled here (never trusted from the browser). */
export async function saveDesign(f: FormData) {
  const { supabase, school } = await requirePerm("documents.templates.edit");
  const id = uuid(f, "id");
  const to = `/app/documents/templates/${id}/design`;
  let raw: unknown;
  try { raw = JSON.parse(String(f.get("design") ?? "{}").slice(0, 400_000)); } catch { go(to, { error: "The design could not be read. Please try again." }); }
  const design = normalizeDesign(raw);
  if (!design.items.length) go(to, { error: "The design is empty — add at least one element." });
  const html = sanitizeHtml(compileDesign(design));
  const name = str(f, "name", 100);
  const { data, error } = await supabase.from("document_templates")
    .update({ design, body_html: html, ...pageOf(design), ...(name ? { name } : {}) })
    .eq("id", id!).eq("school_id", school.id).select("id");
  revalidatePath(STUDIO);
  // a fee template that is not yet chosen for anything becomes the one for its document, when that document has none
  let note = "";
  if (!error && data?.length) {
    const { data: t } = await supabase.from("document_templates").select("category,fee_kind,code,preset").eq("id", id!).maybeSingle();
    if (t?.category === "fees" && !t.fee_kind) {
      const k = /demand/.test(`${t.code} ${t.preset ?? ""}`) ? "demand" : /statement/.test(`${t.code} ${t.preset ?? ""}`) ? "statement" : "receipt";
      const { data: taken } = await supabase.from("document_templates").select("id").eq("school_id", school.id).eq("fee_kind", k).maybeSingle();
      if (!taken) { await supabase.rpc("set_fee_template", { tpl: id, p_kind: k }); note = ` It is now used for ${k === "receipt" ? "fee receipts" : k === "demand" ? "demand notices" : "fee statements"}.`; }
      else note = " Choose it under Fees → Fee templates → “Use this template for” to start using it.";
    }
  }
  go(to, error ? { error: errMsg(error) } : data?.length ? { ok: `Design saved (a new version was recorded).${note}` } : { error: "Not allowed." });
}

/** One click: a starter design becomes a template of the school (or replaces the layout of a standard fee template). */
export async function useDesign(f: FormData) {
  const { supabase, school } = await requirePerm("documents.templates.create", "documents.templates.edit");
  const key = str(f, "preset", 60) ?? "";
  const preset = presetByKey(key);
  if (!preset) go(STUDIO, { error: "That design is not available." });
  const design = normalizeDesign(preset!.build());
  const html = sanitizeHtml(compileDesign(design));
  const page = pageOf(design);

  const feeKind = preset!.category === "fees" ? ({ fee_receipt: "receipt", fee_demand: "demand", fee_statement: "statement" } as Record<string, string>)[preset!.kind] ?? null : null;
  if (feeKind) {
    // the template that is already used for this document (or has the standard code) takes the design
    const { data: rows } = await supabase.from("document_templates").select("id,code,fee_kind").eq("school_id", school.id).eq("category", "fees");
    const mine = (rows ?? []).find((r) => r.fee_kind === feeKind) ?? (rows ?? []).find((r) => r.code === preset!.target);
    if (mine) {
      const { error } = await supabase.from("document_templates").update({ design, body_html: html, ...page, preset: preset!.key, active: true, fee_kind: feeKind, module: "fees" }).eq("id", mine.id).eq("school_id", school.id);
      revalidatePath(STUDIO);
      go(error ? STUDIO : `/app/documents/templates/${mine.id}/design`, error ? { error: errMsg(error) } : { ok: `“${preset!.name}” applied — it is now used for ${feeKind === "receipt" ? "fee receipts" : feeKind === "demand" ? "demand notices" : "fee statements"}.` });
    }
    const { data, error } = await supabase.from("document_templates").insert({
      school_id: school.id, code: preset!.target ?? preset!.key, name: preset!.name, category: "fees", audience: "student", body_html: html, design, ...page,
      numbering_prefix: "FEE", fields: [], module: "fees", preset: preset!.key, fee_kind: feeKind, is_system: false,
    }).select("id").single();
    if (error) go(STUDIO, { error: /fee_kind/.test(error.message) ? "Apply migration 0019 (fee template binding) first." : errMsg(error) });
    revalidatePath(STUDIO);
    go(`/app/documents/templates/${data!.id}/design`, { ok: `“${preset!.name}” is ready and in use. Make it yours.` });
  }
  const base = preset!.key.replace(/[^a-z0-9_]/g, "_").slice(0, 30);
  const { data: existing } = await supabase.from("document_templates").select("code").eq("school_id", school.id).like("code", `${base}%`);
  const code = `${base}${existing?.length ? `_${existing.length + 1}` : ""}`.slice(0, 40);
  const { data, error } = await supabase.from("document_templates").insert({
    school_id: school.id, code, name: `${preset!.name}${existing?.length ? ` (${existing.length + 1})` : ""}`, category: preset!.category, audience: preset!.audience,
    body_html: html, design, ...page, numbering_prefix: (preset!.kind.replace(/[^a-z]/g, "").slice(0, 3) || "DOC").toUpperCase(), fields: preset!.fields ?? [],
    module: preset!.module, preset: preset!.key, one_per_student: preset!.category === "id_card",
  }).select("id").single();
  if (error) go(STUDIO, { error: errMsg(error) });
  revalidatePath(STUDIO);
  go(`/app/documents/templates/${data!.id}/design`, { ok: "Template created from the gallery. Make it yours." });
}

/** A blank canvas of a chosen size. */
export async function newBlankDesign(f: FormData) {
  const { supabase, school } = await requirePerm("documents.templates.create");
  const hint = /^(\d{2,3})x(\d{2,3})$/.exec(String(f.get("size_hint") ?? ""));
  const w = Math.min(300, Math.max(30, Number(f.get("w")) || Number(hint?.[1]) || 210)), h = Math.min(300, Math.max(30, Number(f.get("h")) || Number(hint?.[2]) || 297));
  const audience = f.get("audience") === "staff" ? "staff" : "student";
  const design = normalizeDesign({ v: 1, w, h, bg: "#ffffff", items: [] });
  const { count } = await supabase.from("document_templates").select("id", { count: "exact", head: true }).eq("school_id", school.id).like("code", "custom_%");
  const code = `custom_${(count ?? 0) + 1}`;
  const { data, error } = await supabase.from("document_templates").insert({
    school_id: school.id, code, name: str(f, "name", 80) ?? `Custom design ${(count ?? 0) + 1}`, category: w <= 100 || h <= 100 ? "id_card" : "letter", audience,
    body_html: " ", design, ...pageOf(design), module: audience === "staff" ? "staff" : "students", numbering_prefix: "DOC",
  }).select("id").single();
  if (error) go(STUDIO, { error: errMsg(error) });
  go(`/app/documents/templates/${data!.id}/design`, { ok: "Blank canvas ready." });
}

/** Fees → Fee templates: choose which template prints the receipt / demand notice / statement. */
export async function setFeeTemplate(f: FormData) {
  const { supabase } = await requirePerm("documents.templates.edit");
  const id = uuid(f, "id");
  const kind = String(f.get("kind") ?? "");
  const { error } = await supabase.rpc("set_fee_template", { tpl: id, p_kind: ["receipt", "demand", "statement"].includes(kind) ? kind : null });
  revalidatePath("/app/fees/templates");
  go("/app/fees/templates", error ? { error: errMsg(error) } : { ok: kind ? "Saved — this template is now used." : "This template is no longer used (the built-in layout applies)." });
}

/** A blank fee template for one of the three documents. */
export async function newFeeTemplate(f: FormData) {
  const { supabase, school } = await requirePerm("documents.templates.create");
  const kind = String(f.get("kind") ?? "receipt");
  if (!["receipt", "demand", "statement"].includes(kind)) go("/app/fees/templates", { error: "Choose the document." });
  const portrait = kind !== "receipt" ? { w: 210, h: 297 } : { w: 148, h: 210 };
  const design = normalizeDesign({ v: 1, ...portrait, bg: "#ffffff", items: [] });
  const { count } = await supabase.from("document_templates").select("id", { count: "exact", head: true }).eq("school_id", school.id).like("code", `fee_${kind}%`);
  const { data, error } = await supabase.from("document_templates").insert({
    school_id: school.id, code: `fee_${kind}_${(count ?? 0) + 1}`, name: `${kind === "receipt" ? "Fee receipt" : kind === "demand" ? "Fee demand notice" : "Fee statement"} — my design`,
    category: "fees", audience: "student", body_html: " ", design, ...pageOf(design), numbering_prefix: "FEE", module: "fees", fee_kind: null,
  }).select("id").single();
  if (error) go("/app/fees/templates", { error: errMsg(error) });
  go(`/app/documents/templates/${data!.id}/design`, { ok: "Blank canvas ready. After saving, choose \u201cUse for\u201d on the Fee templates page." });
}
