"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { parseFields } from "@/lib/documents";
import { sanitizeHtml } from "@/lib/html-sanitize";

const HUB = "/app/documents";

export async function seedTemplates() {
  const { supabase, school } = await requirePerm("documents.templates.create");
  const { data, error } = await supabase.rpc("seed_document_templates", { sid: school.id });
  revalidatePath(HUB);
  go(`${HUB}/templates`, error ? { error: errMsg(error) } : { ok: data ? `Added ${data} standard template(s).` : "All standard templates are already there." });
}

export async function saveTemplate(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "documents.templates.edit" : "documents.templates.create");
  const to = id ? `${HUB}/templates/${id}` : `${HUB}/templates/new`;
  const name = str(f, "name", 100);
  if (!name) go(to, { error: "Template name is required." });
  const category = oneOf(f, "category", ["certificate", "id_card", "letter", "fees", "other"] as const, "certificate");
  const audience = oneOf(f, "audience", ["student", "staff"] as const, "student");
  const page_size = oneOf(f, "page_size", ["A4", "A5", "card"] as const, "A4");
  const w = num(f, "card_width_mm"), h = num(f, "card_height_mm");
  if (page_size === "card" && (!w || !h || w < 30 || h < 30)) go(to, { error: "A card needs a width and height in mm (30–300)." });
  const prefix = (str(f, "numbering_prefix", 8) ?? "DOC").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "DOC";
  const body = sanitizeHtml(String(f.get("body_html") ?? "").slice(0, 60_000));
  const row = {
    name, category, audience, page_size, orientation: oneOf(f, "orientation", ["portrait", "landscape"] as const, "portrait"),
    card_width_mm: page_size === "card" ? Math.round(w!) : null, card_height_mm: page_size === "card" ? Math.round(h!) : null,
    numbering_prefix: prefix, on_issue: oneOf(f, "on_issue", ["none", "mark_transferred"] as const, "none"), one_per_student: f.get("one_per_student") === "1",
    valid_days: num(f, "valid_days") ? Math.round(num(f, "valid_days")!) : null, fields: parseFields(String(f.get("fields_text") ?? "")),
    body_html: body, active: f.get("active") !== "0",
  };
  if (id) {
    const { data, error } = await supabase.from("document_templates").update(row).eq("id", id).eq("school_id", school.id).select("id");
    revalidatePath(HUB);
    go(to, error ? { error: errMsg(error) } : data?.length ? { ok: "Template saved (new version recorded)." } : { error: "Not allowed." });
  }
  const code = (str(f, "code", 40) ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  if (code.length < 2) go(to, { error: "Give the template a short code (letters and numbers)." });
  const { data, error } = await supabase.from("document_templates").insert({ ...row, school_id: school.id, code }).select("id").single();
  if (error) go(to, { error: /unique/i.test(error.message) ? "A template with this code already exists." : errMsg(error) });
  revalidatePath(HUB);
  go(`${HUB}/templates/${data!.id}`, { ok: "Template created." });
}

export async function restoreVersion(f: FormData) {
  const { supabase, school } = await requirePerm("documents.templates.edit");
  const id = uuid(f, "id");
  const { data: v } = await supabase.from("document_template_versions").select("body_html,fields,design").eq("id", uuid(f, "version_id")!).eq("template_id", id!).eq("school_id", school.id).maybeSingle();
  if (!v) go(`${HUB}/templates/${id}`, { error: "Version not found." });
  const { error } = await supabase.from("document_templates").update({ body_html: v!.body_html, fields: v!.fields, design: v!.design ?? null }).eq("id", id!).eq("school_id", school.id);
  revalidatePath(HUB);
  go(`${HUB}/templates/${id}`, error ? { error: errMsg(error) } : { ok: "Restored as a new version." });
}

export async function deleteTemplate(f: FormData) {
  const { supabase, school } = await requirePerm("documents.templates.delete");
  const id = uuid(f, "id");
  const { data, error } = await supabase.from("document_templates").delete().eq("id", id!).eq("school_id", school.id).eq("is_system", false).select("id");
  revalidatePath(HUB);
  go(`${HUB}/templates`, error ? { error: errMsg(error) } : data?.length ? { ok: "Template deleted. Documents already issued from it are kept." } : { error: "Standard templates can't be deleted — switch them off instead." });
}

export async function issueDocument(f: FormData) {
  const { supabase, school, myName } = await requirePerm("documents.issue.create");
  const tpl = uuid(f, "template_id");
  const stu = uuid(f, "student_id"), stf = uuid(f, "staff_id");
  const to = `${HUB}/issue?template=${tpl}${stu ? `&student=${stu}` : ""}${stf ? `&staff=${stf}` : ""}`;
  if (!tpl || (!stu && !stf)) go(HUB, { error: "Pick a template and a person." });
  const extra: Record<string, string> = {};
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("x_") || typeof v !== "string") continue;
    const val = v.trim().slice(0, 300);
    if (val) extra[k.slice(2)] = val;
  }
  if (f.get("duplicate") === "1") extra.duplicate = "true";
  const { data, error } = await supabase.rpc("issue_document", {
    sid: school.id, tpl, stu, stf, p_issued_on: str(f, "issued_on", 10), p_extra: extra, p_mark_left: f.get("mark_left") === "1", p_by: myName || null,
  });
  revalidatePath(HUB);
  if (stu) revalidatePath(`/app/students/${stu}`);
  if (error) go(to, { error: errMsg(error) });
  go(`${HUB}/${data}`, { ok: "Document issued. Print it from here." });
}

export async function issueBulk(f: FormData) {
  const { supabase, school, myName } = await requirePerm("documents.issue.create");
  const tpl = uuid(f, "template_id");
  const cls = uuid(f, "class_id"), sec = uuid(f, "section_id");
  const to = `${HUB}/bulk?template=${tpl ?? ""}${cls ? `&class_id=${cls}` : ""}${sec ? `&section_id=${sec}` : ""}`;
  if (!tpl) go(`${HUB}/bulk`, { error: "Pick a template." });
  const { data, error } = await supabase.rpc("issue_documents_bulk", { sid: school.id, tpl, p_class: cls, p_section: sec, p_by: myName || null });
  revalidatePath(HUB);
  go(to, error ? { error: errMsg(error) } : { ok: data ? `Issued ${data} document(s). Print the sheet below.` : "Nothing new to issue — everyone already has one." });
}

export async function cancelDocument(f: FormData) {
  const { supabase } = await requirePerm("documents.issue.approve");
  const id = uuid(f, "id");
  const { error } = await supabase.rpc("cancel_issued_document", { did: id, p_reason: str(f, "reason", 200) });
  revalidatePath(HUB);
  go(`${HUB}/${id}`, error ? { error: errMsg(error) } : { ok: "Cancelled. It stays on record." });
}

/** Admit cards for a class from an examination's date sheet (one card per student; a student keeps one card per examination). */
export async function issueAdmitCards(f: FormData) {
  const { supabase, school, myName } = await requirePerm("documents.issue.create");
  const tpl = uuid(f, "template_id"), exam = uuid(f, "exam_id"), cls = uuid(f, "class_id"), sec = uuid(f, "section_id");
  const back = `/app/exams/${exam ?? ""}`;
  if (!tpl || !exam || !cls) go(back, { error: "Choose the template and the class." });
  const { data, error } = await supabase.rpc("issue_admit_cards", { sid: school.id, tpl, p_exam: exam, p_class: cls, p_section: sec, p_extra: { centre: str(f, "centre", 80) ?? "" }, p_by: myName || null });
  revalidatePath(HUB);
  if (error) go(back, { error: errMsg(error) });
  go(`${HUB}/bulk?template=${tpl}&class_id=${cls}${sec ? `&section_id=${sec}` : ""}`, { ok: data ? `Issued ${data} admit card(s). Print the sheet below.` : "Nothing new to issue — every student already has this examination's admit card." });
}
