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
  go(to, error ? { error: errMsg(error) } : data?.length ? { ok: "Design saved (a new version was recorded)." } : { error: "Not allowed." });
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

  if (preset!.target) {
    const { data: t } = await supabase.from("document_templates").select("id").eq("school_id", school.id).eq("code", preset!.target).maybeSingle();
    if (t) {
      const { error } = await supabase.from("document_templates").update({ design, body_html: html, ...page, preset: preset!.key, active: true }).eq("id", t.id).eq("school_id", school.id);
      revalidatePath(STUDIO);
      go(error ? STUDIO : `/app/documents/templates/${t.id}/design`, error ? { error: errMsg(error) } : { ok: `“${preset!.name}” applied. Adjust it as you like.` });
    }
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
