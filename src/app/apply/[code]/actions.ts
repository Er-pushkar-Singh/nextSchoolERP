"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildApplicationForm } from "@/lib/application-form";
import { DOC_BUCKET, DOC_LIMITS, sniffFile } from "@/lib/student-docs";

const UPLOADS = [["photo", "Photograph"], ["birth_certificate", "Birth certificate"], ["previous_marksheet", "Previous marksheet"], ["transfer_certificate", "Transfer certificate"], ["address_proof", "Address proof"]] as const;

const back = (code: string, error: string): never => redirect(`/apply/${encodeURIComponent(code)}?error=${encodeURIComponent(error.slice(0, 220))}`);

/** Parents' online application: no login. Everything runs with the server's secret key through a function that checks the school's settings. */
export async function submitOnline(f: FormData) {
  const code = String(f.get("code") ?? "").toLowerCase().slice(0, 40);
  if (!/^[a-z0-9-]{3,40}$/.test(code)) redirect("/login");
  // bots: honeypot + too fast
  if (String(f.get("website") ?? "") || Date.now() - Number(f.get("t")) < 6000) back(code, "Please check the form and try again.");
  if (f.get("declaration") !== "1") back(code, "Please tick the declaration at the end of the form.");
  const admin = supabaseAdmin();
  if (!admin) back(code, "Online admission is not available right now.");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  const ipHash = createHash("sha256").update(`${ip}|${code}`).digest("hex").slice(0, 24);

  const { form, error } = buildApplicationForm(f, { allowAadhaar: false });
  if (error || !form) back(code, error ?? "Please check the form.");
  const cls = String(f.get("applied_class_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(cls)) back(code, "Please choose the class.");
  if (f.get("allow_duplicate") === "1") form!.allow_duplicate = true;

  const { data, error: e } = await admin!.rpc("public_create_application", { p_code: code, p_class: cls, p_form: form, p_rte: f.get("rte_applicant") === "1", p_ip_hash: ipHash });
  if (e || !data) back(code, (e?.message ?? "Could not submit.").replace(/^.*?: /, ""));
  const res = data as { id: string; application_no: string; school_id: string };

  // documents are optional; a failed upload never loses the application
  const failed: string[] = [];
  for (const [type, label] of UPLOADS) {
    const file = f.get(`doc_${type}`);
    if (!(file instanceof File) || file.size === 0) continue;
    const lim = type === "photo" ? DOC_LIMITS.photo : DOC_LIMITS.document;
    const buf = new Uint8Array(await file.arrayBuffer());
    const kind = sniffFile(buf);
    if (file.size > lim.bytes || !kind || (type === "photo" && kind.ext === "pdf")) { failed.push(label); continue; }
    const path = `${res.school_id}/applications/${res.id}/${type}-${crypto.randomUUID()}.${kind.ext}`;
    let up = await admin!.storage.from(DOC_BUCKET).upload(path, buf, { contentType: kind.mime, upsert: false });
    if (up.error && /not found|bucket/i.test(up.error.message)) {
      await admin!.storage.createBucket(DOC_BUCKET, { public: false });
      up = await admin!.storage.from(DOC_BUCKET).upload(path, buf, { contentType: kind.mime, upsert: false });
    }
    if (up.error) { failed.push(label); continue; }
    const { error: de } = await admin!.from("application_documents").insert({
      school_id: res.school_id, application_id: res.id, doc_type: type, status: "uploaded", file_path: path, file_name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120),
      mime_type: kind.mime, size_bytes: file.size, uploaded_by_name: "Parent (online)", uploaded_at: new Date().toISOString(),
    });
    if (de) { await admin!.storage.from(DOC_BUCKET).remove([path]); failed.push(label); }
  }
  const q = new URLSearchParams({ no: res.application_no });
  if (failed.length) q.set("failed", failed.join(", "));
  redirect(`/apply/${code}/done?${q}`);
}

export async function lookupStatus(f: FormData) {
  const code = String(f.get("code") ?? "").toLowerCase().slice(0, 40);
  const no = String(f.get("no") ?? "").trim().slice(0, 40);
  const phone = String(f.get("phone") ?? "").replace(/\D/g, "").slice(-10);
  if (!/^[a-z0-9-]{3,40}$/.test(code)) redirect("/login");
  redirect(`/apply/${code}/track?no=${encodeURIComponent(no)}&phone=${encodeURIComponent(phone)}`);
}
