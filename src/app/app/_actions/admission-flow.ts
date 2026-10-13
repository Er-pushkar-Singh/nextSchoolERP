"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, str, uuid } from "@/lib/action-util";
import { DOC_TYPES } from "@/lib/student-docs";

const LIST = "/app/admissions/applications";

export async function beginAdmission(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.admissions.approve");
  const id = uuid(f, "id");
  const { error } = await supabase.rpc("begin_admission", { app: id, p_admission_no: str(f, "admission_no", 30), p_date: date(f, "admission_date") });
  revalidatePath(`${LIST}/${id}`);
  go(`${LIST}/${id}#fee`, error ? { error: /unique/i.test(error.message) ? "That admission number is already used." : errMsg(error) } : { ok: "Admission started. The fees are billed — collect the admission fee, then give the class and section." });
}

export async function waiveDocs(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.admissions.approve");
  const id = uuid(f, "id");
  const { error } = await supabase.rpc("waive_application_docs", { app: id, p_note: str(f, "note", 300) ?? "" });
  revalidatePath(`${LIST}/${id}`);
  go(`${LIST}/${id}`, error ? { error: errMsg(error) } : { ok: "Documents waived. They can still be uploaded later." });
}

export async function waiveFee(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.admissions.approve");
  const id = uuid(f, "id");
  const { error } = await supabase.rpc("waive_application_fee", { app: id, p_note: str(f, "note", 300) ?? "" });
  revalidatePath(`${LIST}/${id}`);
  go(`${LIST}/${id}#fee`, error ? { error: errMsg(error) } : { ok: "Admission fee waived. The class and section can now be given." });
}

/** Principal: which documents are required, whether a test is needed, and the order rules. */
export async function saveAdmissionFlow(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.approve");
  const keys = DOC_TYPES.map(([k]) => k) as readonly string[];
  const docs = f.getAll("required_docs").map(String).filter((k) => keys.includes(k));
  const { error } = await supabase.rpc("save_admission_flow", {
    sid: school.id, p_required_docs: docs, p_require_test: f.get("require_test") === "on", p_fee_before: f.get("fee_before_allotment") === "on",
    p_strict: f.get("strict_workflow") === "on", p_window: Math.round(Number(f.get("fee_window_days") ?? 31)),
  });
  go("/app/admissions/pipeline", error ? { error: errMsg(error) } : { ok: "Admission flow saved." });
}
