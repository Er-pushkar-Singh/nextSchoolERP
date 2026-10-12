"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { buildApplicationForm as buildForm } from "@/lib/application-form";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DOC_BUCKET, DOC_LIMITS, DOC_TYPES, sniffFile } from "@/lib/student-docs";
import { todayIST } from "@/lib/format";
import { FEE_MODES } from "@/lib/applications";

const LIST = "/app/admissions/applications";
const DOC_KEYS = DOC_TYPES.map(([k]) => k) as readonly string[];

export async function createApplication(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.create");
  const cls = uuid(f, "applied_class_id");
  const enquiry = uuid(f, "enquiry_id");
  const back = `${LIST}/new${enquiry ? `?enquiry=${enquiry}` : ""}`;
  const { form, error } = buildForm(f);
  if (error || !form) go(back, { error: error ?? "Check the form." });
  if (!cls) go(back, { error: "Choose the class applied for." });
  if (f.get("allow_duplicate") === "1") form!.allow_duplicate = true;
  const { data, error: e } = await supabase.rpc("create_application", {
    sid: school.id, p_class: cls, p_enquiry: enquiry, p_form: form, p_rte: f.get("rte_applicant") === "1", p_rte_ref: str(f, "rte_reference", 60), p_source: str(f, "source", 40),
  });
  if (e) go(back, { error: errMsg(e) });
  revalidatePath(LIST);
  go(`${LIST}/${data}`, { ok: "Application received. Collect the documents, then schedule the test or send it for approval." });
}

export async function updateApplication(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit");
  const id = uuid(f, "id");
  const to = `${LIST}/${id}`;
  const { form, error } = buildForm(f);
  if (error || !form) go(`${to}?edit=1`, { error: error ?? "Check the form." });
  const cls = uuid(f, "applied_class_id");
  const { data, error: e } = await supabase.from("admission_applications").update({
    form, class_id: cls, rte_applicant: f.get("rte_applicant") === "1", rte_reference: str(f, "rte_reference", 60), source: str(f, "source", 40),
    applicant_name: [form!.first_name, form!.middle_name, form!.last_name].filter(Boolean).join(" "), father_name: (form!.father_name as string) ?? null, phone: (form!.guardian_phone as string) ?? null,
  }).eq("id", id!).eq("school_id", school.id).select("id");
  revalidatePath(LIST);
  go(to, e ? { error: /closed/i.test(e.message) ? "This application is closed and can't be edited." : errMsg(e) } : data?.length ? { ok: "Application updated." } : { error: "Not allowed." });
}

export async function saveTest(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit");
  const id = uuid(f, "id");
  const marks = num(f, "test_marks"), max = num(f, "test_max");
  if (marks !== null && max !== null && marks > max) go(`${LIST}/${id}`, { error: "Marks can't be more than the maximum." });
  const { error } = await supabase.from("admission_applications").update({
    test_on: date(f, "test_on"), interview_on: date(f, "interview_on"), test_marks: marks, test_max: max, interview_note: str(f, "interview_note", 500),
  }).eq("id", id!).eq("school_id", school.id);
  go(`${LIST}/${id}`, error ? { error: errMsg(error) } : { ok: "Test / interview details saved." });
}

const STEPS = ["under_review", "test_scheduled", "approved", "waitlisted", "rejected", "cancelled"] as const;
export async function setApplicationStatus(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit", "frontdesk.admissions.approve");
  const id = uuid(f, "id");
  const status = oneOf(f, "status", STEPS, "under_review");
  const note = str(f, "decision_note", 400);
  const { data, error } = await supabase.from("admission_applications").update({ status, ...(note ? { decision_note: note } : {}) }).eq("id", id!).eq("school_id", school.id).select("id");
  revalidatePath(LIST);
  go(`${LIST}/${id}`, error ? { error: errMsg(error) } : data?.length ? { ok: `Application marked “${status.replace("_", " ")}”.` } : { error: "Not allowed." });
}

export async function recordApplicationFee(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit");
  const id = uuid(f, "id");
  const amount = num(f, "fee_amount");
  if (amount === null || amount < 0) go(`${LIST}/${id}`, { error: "Enter the amount received." });
  const { error } = await supabase.from("admission_applications").update({
    fee_amount: amount, fee_paid_on: date(f, "fee_paid_on") ?? todayIST(), fee_mode: oneOf(f, "fee_mode", FEE_MODES.map(([k]) => k) as unknown as readonly string[], "cash"), fee_ref: str(f, "fee_ref", 60),
  }).eq("id", id!).eq("school_id", school.id);
  go(`${LIST}/${id}`, error ? { error: errMsg(error) } : { ok: "Application fee recorded." });
}

export async function admitApplication(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.admissions.approve");
  const id = uuid(f, "id");
  const to = `${LIST}/${id}`;
  const cls = uuid(f, "class_id");
  if (!cls) go(to, { error: "Choose the class to admit into." });
  const roll = num(f, "roll_no");
  const { data, error } = await supabase.rpc("admit_application", {
    app: id, p_class: cls, p_section: uuid(f, "section_id"), p_admission_no: str(f, "admission_no", 30), p_admission_date: date(f, "admission_date"), p_roll: roll && roll > 0 ? Math.round(roll) : null,
  });
  if (error) go(to, { error: /unique/i.test(error.message) ? "That admission number is already used." : errMsg(error) });
  revalidatePath(LIST);
  revalidatePath("/app/students");
  go(`/app/students/${data}`, { ok: "Admitted. The student record, class history, documents, contacts and fee dues were created from the application." });
}

/* ───────── Documents of an application ───────── */

export async function uploadApplicationDocument(f: FormData) {
  const { supabase, school, myName, user } = await requirePerm("frontdesk.admissions.create", "frontdesk.admissions.edit");
  const id = uuid(f, "application_id");
  const to = `${LIST}/${id}#documents`;
  const doc_type = oneOf(f, "doc_type", DOC_KEYS, "other");
  const file = f.get("file");
  if (!id) go(LIST, { error: "Application not found." });
  if (!(file instanceof File) || file.size === 0) go(to, { error: "Choose a file to upload." });
  const lim = doc_type === "photo" ? DOC_LIMITS.photo : DOC_LIMITS.document;
  if (file.size > lim.bytes) go(to, { error: `File must be under ${lim.bytes / 1024 / 1024} MB.` });
  const buf = new Uint8Array(await file.arrayBuffer());
  const kind = sniffFile(buf);
  if (!kind || (doc_type === "photo" && kind.ext === "pdf")) go(to, { error: doc_type === "photo" ? "Photograph must be a JPG or PNG image." : "Only PDF, JPG or PNG files are accepted." });
  const { data: app } = await supabase.from("admission_applications").select("id,status").eq("id", id!).eq("school_id", school.id).maybeSingle();
  if (!app) go(LIST, { error: "Application not found." });
  const db = supabaseAdmin();
  if (!db) go(to, { error: "File storage is not configured (SUPABASE_SECRET_KEY)." });
  const path = `${school.id}/applications/${id}/${doc_type}-${crypto.randomUUID()}.${kind!.ext}`;
  let up = await db!.storage.from(DOC_BUCKET).upload(path, buf, { contentType: kind!.mime, upsert: false });
  if (up.error && /not found|bucket/i.test(up.error.message)) {
    await db!.storage.createBucket(DOC_BUCKET, { public: false });
    up = await db!.storage.from(DOC_BUCKET).upload(path, buf, { contentType: kind!.mime, upsert: false });
  }
  if (up.error) go(to, { error: "Upload failed. Please try again." });
  const row = {
    school_id: school.id, application_id: id, doc_type, title: str(f, "title", 80), status: "uploaded", file_path: path,
    file_name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120), mime_type: kind!.mime, size_bytes: file.size,
    uploaded_by: user.id, uploaded_by_name: myName || null, uploaded_at: new Date().toISOString(), due_by: null, remark: str(f, "remark", 200),
  };
  const { data: old } = await supabase.from("application_documents").select("id,file_path").eq("application_id", id!).eq("doc_type", doc_type).maybeSingle();
  const { error } = doc_type !== "other" && old
    ? await supabase.from("application_documents").update(row).eq("id", old.id)
    : await supabase.from("application_documents").insert(row);
  if (error) { await db!.storage.from(DOC_BUCKET).remove([path]); go(to, { error: errMsg(error) }); }
  if (old?.file_path) await db!.storage.from(DOC_BUCKET).remove([old.file_path]);
  go(to, { ok: "Document uploaded." });
}

export async function markApplicationDocPending(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.create", "frontdesk.admissions.edit");
  const id = uuid(f, "application_id");
  const to = `${LIST}/${id}#documents`;
  const doc_type = oneOf(f, "doc_type", DOC_KEYS, "other");
  const na = f.get("not_applicable") === "1";
  const row = { school_id: school.id, application_id: id, doc_type, title: str(f, "title", 80), status: na ? "not_applicable" : "pending", due_by: na ? null : date(f, "due_by"), remark: str(f, "remark", 200) };
  const { data: old } = await supabase.from("application_documents").select("id,file_path").eq("application_id", id!).eq("doc_type", doc_type).maybeSingle();
  if (old?.file_path) go(to, { error: "This document is already uploaded." });
  const { error } = old && doc_type !== "other"
    ? await supabase.from("application_documents").update(row).eq("id", old.id)
    : await supabase.from("application_documents").insert(row);
  go(to, error ? { error: errMsg(error) } : { ok: na ? "Marked as not applicable." : "Recorded as pending — the admission is not held up." });
}

export async function reviewApplicationDocument(f: FormData) {
  const { supabase, school, myName } = await requirePerm("frontdesk.admissions.edit");
  const id = uuid(f, "application_id");
  const to = `${LIST}/${id}#documents`;
  const status = oneOf(f, "status", ["verified", "rejected"] as const, "verified");
  const reason = str(f, "reject_reason", 200);
  if (status === "rejected" && !reason) go(to, { error: "Write the reason for rejecting the document." });
  const { data, error } = await supabase.from("application_documents")
    .update({ status, reject_reason: status === "rejected" ? reason : null, verified_by_name: myName || null })
    .eq("id", uuid(f, "id")!).eq("school_id", school.id).select("id");
  go(to, error ? { error: errMsg(error) } : data?.length ? { ok: status === "verified" ? "Document verified." : "Document rejected." } : { error: "Not allowed." });
}

export async function deleteApplicationDocument(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit");
  const id = uuid(f, "application_id");
  const docId = uuid(f, "id");
  const { data: d } = await supabase.from("application_documents").select("file_path").eq("id", docId!).eq("school_id", school.id).maybeSingle();
  const { data, error } = await supabase.from("application_documents").delete().eq("id", docId!).eq("school_id", school.id).select("id");
  if (!error && data?.length && d?.file_path) await supabaseAdmin()?.storage.from(DOC_BUCKET).remove([d.file_path]);
  go(`${LIST}/${id}#documents`, error ? { error: errMsg(error) } : data?.length ? { ok: "Document removed." } : { error: "Not allowed." });
}
