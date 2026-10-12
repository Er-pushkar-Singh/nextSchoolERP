"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, oneOf, str, uuid } from "@/lib/action-util";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DOC_BUCKET, DOC_LIMITS, DOC_TYPES, sniffFile } from "@/lib/student-docs";
import { validAadhaar } from "@/lib/aadhaar";
import { encryptJson, encryptionReady } from "@/lib/crypto";

const back = (id: string | null, hash = "") => `/app/students/${id}${hash}`;
const digits = (v: string | null) => (v ? v.replace(/\D/g, "") : null);
const DOC_KEYS = DOC_TYPES.map(([k]) => k) as readonly string[];

/* ───────── Identity (PEN, APAAR), health, internal notes ───────── */

export async function saveIdentity(f: FormData) {
  const { supabase, school } = await requirePerm("students.sensitive.edit");
  const id = uuid(f, "student_id");
  if (!id) go("/app/students", { error: "Student not found." });
  const to = back(id, "#identity");
  const pen = str(f, "pen", 20)?.replace(/\s/g, "").toUpperCase() ?? null;
  const apaar = digits(str(f, "apaar_id", 20));
  if (pen && !/^[A-Z0-9]{6,20}$/.test(pen)) go(to, { error: "PEN should be letters and digits only (6–20 characters)." });
  if (apaar && !/^\d{12}$/.test(apaar)) go(to, { error: "APAAR ID is a 12-digit number." });
  const status = oneOf(f, "apaar_status", ["not_created", "requested", "generated", "verified", "mismatch"] as const, "not_created");
  const consent = f.get("apaar_consent") === "1";
  if (status === "requested" && !consent) go(to, { error: "Record the parent's / guardian's consent before requesting an APAAR ID." });
  if ((status === "generated" || status === "verified") && !apaar) go(to, { error: "Enter the 12-digit APAAR ID." });
  const row = {
    student_id: id, school_id: school.id, pen, apaar_id: apaar, apaar_status: status,
    apaar_consent: consent, apaar_consent_by: consent ? str(f, "apaar_consent_by", 80) : null, apaar_consent_on: consent ? date(f, "apaar_consent_on") : null,
    identity_verified_on: date(f, "identity_verified_on"), identity_note: str(f, "identity_note", 300),
    allergies: str(f, "allergies", 300), medical_conditions: str(f, "medical_conditions", 300), medication: str(f, "medication", 300),
    disability: str(f, "disability", 200), accommodations: str(f, "accommodations", 300),
    doctor_name: str(f, "doctor_name", 80), doctor_phone: str(f, "doctor_phone", 20), internal_notes: str(f, "internal_notes", 1000),
  };
  // Disability
  const dtype = str(f, "disability_type", 20);
  const dpct = str(f, "disability_percent", 6);
  Object.assign(row, {
    disability_type: dtype && ["visual", "hearing", "speech", "locomotor", "hand", "multiple", "other"].includes(dtype) ? dtype : null,
    disability_percent: dpct && Number.isFinite(Number(dpct)) && Number(dpct) >= 0 && Number(dpct) <= 100 ? Number(dpct) : null,
  });
  // Aadhaar: only when a new number is typed (kept encrypted, consent required), or removed on request
  const aad = digits(str(f, "aadhaar", 20));
  if (f.get("aadhaar_remove") === "1") {
    Object.assign(row, { aadhaar_enc: null, aadhaar_last4: null, aadhaar_consent: false });
  } else if (aad) {
    if (!validAadhaar(aad)) go(to, { error: "That Aadhaar number is not valid. Check the 12 digits." });
    if (f.get("aadhaar_consent") !== "1") go(to, { error: "Tick that the parent / guardian has consented to the Aadhaar number being recorded." });
    if (!encryptionReady()) go(to, { error: "The server's SETTINGS_ENCRYPTION_KEY is not set, so the Aadhaar number cannot be stored safely." });
    Object.assign(row, { aadhaar_enc: encryptJson({ n: aad }), aadhaar_last4: aad.slice(-4), aadhaar_consent: true });
  }
  const { error } = await supabase.from("student_sensitive").upsert(row, { onConflict: "student_id" });
  if (error) {
    const m = /student_sensitive_apaar/i.test(error.message) ? "Another student already has this APAAR ID."
      : /student_sensitive_pen/i.test(error.message) ? "Another student already has this PEN." : errMsg(error);
    go(to, { error: m });
  }
  revalidatePath(back(id));
  go(to, { ok: "Identity and health details saved." });
}

/* ───────── Documents (private storage) ───────── */

export async function uploadDocument(f: FormData) {
  const { supabase, school, myName, user } = await requirePerm("students.documents.create");
  const id = uuid(f, "student_id");
  const to = back(id, "#documents");
  const doc_type = oneOf(f, "doc_type", DOC_KEYS, "other");
  const file = f.get("file");
  if (!id) go("/app/students", { error: "Student not found." });
  if (!(file instanceof File) || file.size === 0) go(to, { error: "Choose a file to upload." });
  const lim = doc_type === "photo" ? DOC_LIMITS.photo : DOC_LIMITS.document;
  if (file.size > lim.bytes) go(to, { error: `File must be under ${lim.bytes / 1024 / 1024} MB.` });
  const buf = new Uint8Array(await file.arrayBuffer());
  const kind = sniffFile(buf);
  if (!kind || (doc_type === "photo" && kind.ext === "pdf")) go(to, { error: doc_type === "photo" ? "Photograph must be a JPG or PNG image." : "Only PDF, JPG or PNG files are accepted." });
  // The student must be visible to this user (RLS) — also proves it belongs to this school
  const { data: stu } = await supabase.from("students").select("id").eq("id", id!).eq("school_id", school.id).maybeSingle();
  if (!stu) go("/app/students", { error: "Student not found." });
  const db = supabaseAdmin();
  if (!db) go(to, { error: "File storage is not configured (SUPABASE_SECRET_KEY)." });
  const path = `${school.id}/${id}/${doc_type}-${crypto.randomUUID()}.${kind!.ext}`;
  let up = await db!.storage.from(DOC_BUCKET).upload(path, buf, { contentType: kind!.mime, upsert: false });
  if (up.error && /not found|bucket/i.test(up.error.message)) {
    await db!.storage.createBucket(DOC_BUCKET, { public: false });
    up = await db!.storage.from(DOC_BUCKET).upload(path, buf, { contentType: kind!.mime, upsert: false });
  }
  if (up.error) go(to, { error: "Upload failed. Please try again." });
  const row = {
    school_id: school.id, student_id: id, doc_type, title: str(f, "title", 80), status: "uploaded", file_path: path,
    file_name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120), mime_type: kind!.mime, size_bytes: file.size,
    uploaded_by: user.id, uploaded_by_name: myName || null, uploaded_at: new Date().toISOString(), due_by: null, remark: str(f, "remark", 200),
  };
  const { data: old } = await supabase.from("student_documents").select("id,file_path").eq("student_id", id!).eq("doc_type", doc_type).maybeSingle();
  const { error } = doc_type !== "other" && old
    ? await supabase.from("student_documents").update(row).eq("id", old.id)
    : await supabase.from("student_documents").insert(row);
  if (error) {
    await db!.storage.from(DOC_BUCKET).remove([path]);
    go(to, { error: errMsg(error) });
  }
  if (old?.file_path) await db!.storage.from(DOC_BUCKET).remove([old.file_path]);
  revalidatePath(back(id));
  go(to, { ok: "Document uploaded." });
}

/** Admission goes ahead; the document is recorded as "to be submitted by <date>". */
export async function markDocumentPending(f: FormData) {
  const { supabase, school } = await requirePerm("students.documents.create");
  const id = uuid(f, "student_id");
  const to = back(id, "#documents");
  const doc_type = oneOf(f, "doc_type", DOC_KEYS, "other");
  const na = f.get("not_applicable") === "1";
  const row = { school_id: school.id, student_id: id, doc_type, title: str(f, "title", 80), status: na ? "not_applicable" : "pending", due_by: na ? null : date(f, "due_by"), remark: str(f, "remark", 200) };
  const { data: old } = await supabase.from("student_documents").select("id,file_path").eq("student_id", id!).eq("doc_type", doc_type).maybeSingle();
  if (old?.file_path) go(to, { error: "This document is already uploaded." });
  const { error } = old && doc_type !== "other"
    ? await supabase.from("student_documents").update(row).eq("id", old.id)
    : await supabase.from("student_documents").insert(row);
  go(to, error ? { error: errMsg(error) } : { ok: na ? "Marked as not applicable." : "Recorded as pending — admission is not held up." });
}

export async function reviewDocument(f: FormData) {
  const { supabase, school, myName } = await requirePerm("students.documents.approve");
  const id = uuid(f, "student_id");
  const to = back(id, "#documents");
  const status = oneOf(f, "status", ["verified", "rejected"] as const, "verified");
  const reason = str(f, "reject_reason", 200);
  if (status === "rejected" && !reason) go(to, { error: "Write the reason for rejecting the document." });
  const { data, error } = await supabase.from("student_documents")
    .update({ status, reject_reason: status === "rejected" ? reason : null, verified_by_name: myName || null })
    .eq("id", uuid(f, "id")!).eq("school_id", school.id).select("id");
  go(to, error ? { error: errMsg(error) } : data?.length ? { ok: status === "verified" ? "Document verified." : "Document rejected — ask the parent to upload it again." } : { error: "Not allowed." });
}

export async function deleteDocument(f: FormData) {
  const { supabase, school } = await requirePerm("students.documents.delete");
  const id = uuid(f, "student_id");
  const docId = uuid(f, "id");
  const { data: d } = await supabase.from("student_documents").select("file_path").eq("id", docId!).eq("school_id", school.id).maybeSingle();
  const { data, error } = await supabase.from("student_documents").delete().eq("id", docId!).eq("school_id", school.id).select("id");
  if (!error && data?.length && d?.file_path) await supabaseAdmin()?.storage.from(DOC_BUCKET).remove([d.file_path]);
  go(back(id, "#documents"), error ? { error: errMsg(error) } : data?.length ? { ok: "Document removed." } : { error: "Not allowed." });
}

/* ───────── Guardians, emergency and pickup contacts ───────── */

export async function addContact(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.edit");
  const id = uuid(f, "student_id");
  const { error } = await supabase.rpc("add_student_contact", {
    sid: school.id, stu: id, p_name: str(f, "name", 100), p_relation: str(f, "relation", 40), p_phone: str(f, "phone", 20), p_occupation: str(f, "occupation", 80),
    p_primary: f.get("is_primary") === "1", p_emergency: f.get("is_emergency") === "1", p_pickup: f.get("can_pickup") === "1",
  });
  revalidatePath(back(id));
  go(back(id, "#contacts"), error ? { error: errMsg(error) } : { ok: "Contact added." });
}

export async function removeContact(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.edit");
  const id = uuid(f, "student_id");
  const { error } = await supabase.rpc("remove_student_contact", { sid: school.id, stu: id, gid: uuid(f, "guardian_id") });
  revalidatePath(back(id));
  go(back(id, "#contacts"), error ? { error: errMsg(error) } : { ok: "Contact removed." });
}

/* ───────── Earlier examinations / schools ───────── */

const PRIOR_LEVELS = ["class8", "class9_registration", "class9", "high_school", "class11_registration", "intermediate", "iti", "other"] as const;

export async function savePriorExam(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.edit");
  const id = uuid(f, "student_id");
  const to = back(id, "#prior");
  const level = oneOf(f, "level", PRIOR_LEVELS, "other");
  const year = str(f, "exam_year", 4);
  const pct = str(f, "percentage", 6);
  if (year && !/^(19|20)\d{2}$/.test(year)) go(to, { error: "Year should be like 2025." });
  if (pct && !(Number(pct) >= 0 && Number(pct) <= 100)) go(to, { error: "Percentage must be between 0 and 100." });
  const row = {
    school_id: school.id, student_id: id, level, board_name: str(f, "board_name", 80), exam_year: year ? Number(year) : null,
    roll_no: str(f, "roll_no", 30), registration_no: str(f, "registration_no", 30), school_name: str(f, "school_name", 150),
    district_code: str(f, "district_code", 10), school_code: str(f, "school_code", 12), result: str(f, "result", 40), percentage: pct ? Number(pct) : null,
  };
  const { error } = await supabase.from("student_prior_exams").upsert(row, { onConflict: "student_id,level" });
  revalidatePath(back(id));
  go(to, error ? { error: errMsg(error) } : { ok: "Saved." });
}

export async function deletePriorExam(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.edit");
  const id = uuid(f, "student_id");
  const { error } = await supabase.from("student_prior_exams").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  revalidatePath(back(id));
  go(back(id, "#prior"), error ? { error: errMsg(error) } : { ok: "Removed." });
}
