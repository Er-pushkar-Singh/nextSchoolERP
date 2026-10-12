"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, oneOf, str, uuid } from "@/lib/action-util";

export async function issueCertificate(f: FormData) {
  const { supabase, school, myName } = await requirePerm("students.certificates.create");
  const stu = uuid(f, "student_id");
  const kind = oneOf(f, "kind", ["transfer", "bonafide", "character", "study"] as const, "bonafide");
  const back = `/app/certificates/new?student=${stu}&kind=${kind}`;
  if (!stu) go("/app/certificates", { error: "Pick a student." });
  const extra: Record<string, string> = {};
  for (const k of ["last_exam", "result", "promotion", "conduct", "reason", "working_days", "days_present", "remarks", "left_on"]) {
    const v = str(f, k, 300);
    if (v) extra[k] = v;
  }
  if (f.get("duplicate") === "1") extra.duplicate = "true";
  if (kind === "transfer" && !extra.reason) go(back, { error: "Write the reason for leaving." });
  const { data, error } = await supabase.rpc("issue_certificate", {
    sid: school.id, stu, p_kind: kind, p_issued_on: date(f, "issued_on"), p_extra: extra, p_mark_left: f.get("mark_left") === "1", p_by: myName || null,
  });
  revalidatePath("/app/certificates");
  revalidatePath(`/app/students/${stu}`);
  if (error) go(back, { error: errMsg(error) });
  go(`/app/certificates/${data}`, { ok: "Certificate issued." });
}

export async function cancelCertificate(f: FormData) {
  const { supabase } = await requirePerm("students.certificates.approve");
  const id = uuid(f, "id");
  const { error } = await supabase.rpc("cancel_certificate", { cid: id, p_reason: str(f, "reason", 200) });
  revalidatePath("/app/certificates");
  go(`/app/certificates/${id}`, error ? { error: errMsg(error) } : { ok: "Certificate cancelled. It stays on record." });
}
