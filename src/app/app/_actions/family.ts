"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, str, uuid } from "@/lib/action-util";
import { showPasswordOnce } from "@/lib/logins";
import { resetFamilyPassword } from "@/lib/family-admin";
import { after } from "next/server";
import { notifyLeaveDecided } from "@/lib/message-events";
import { processOutbox } from "@/lib/messages";

/** New temporary password for a student's parent login (or the student's own login) — shown once on the student page. */
export async function resetFamilyLogin(f: FormData) {
  const { supabase, school } = await requirePerm("settings.users.edit");
  const id = uuid(f, "student_id");
  const kind = f.get("kind") === "student" ? "student" : "parent";
  const back = `/app/students/${id}`;
  if (!id) go("/app/students", { error: "Student not found." });
  const { data: s } = await supabase.from("students")
    .select("id,admission_no,user_id,student_guardians(is_primary,guardians(user_id,phone,email,name))").eq("id", id!).eq("school_id", school.id).maybeSingle();
  if (!s) go("/app/students", { error: "Student not found." });
  const gs = ((s!.student_guardians ?? []) as unknown as { is_primary: boolean; guardians: { user_id: string | null; phone: string | null; email: string | null; name: string } | null }[])
    .filter((x) => x.guardians?.user_id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const uid = kind === "student" ? (s!.user_id as string | null) : gs[0]?.guardians?.user_id ?? null;
  if (!uid) go(back, { error: kind === "student" ? "The student has no login yet." : "No parent login yet — create one first." });
  const r = await resetFamilyPassword(school.id, uid!);
  if ("error" in r) go(back, { error: r.error });
  const shown = kind === "student" ? `${school.code}/${s!.admission_no}` : (gs[0]?.guardians?.email || gs[0]?.guardians?.phone?.replace(/\D/g, "").slice(-10) || "parent login");
  await supabase.rpc("log_event", { p_action: "user.password_reset", p_school: school.id, p_entity: "auth.users", p_entity_id: uid, p_details: { kind } });
  await showPasswordOnce("/app/students", shown, (r as { pw: string }).pw);
  revalidatePath(back);
  go(back, { ok: "New temporary password set. Copy it below — it is shown only once." });
}

const LEAVE = "/app/attendance/leave";
/** The page to come back to: only the leave and inbox screens, filters kept. */
function back(f: FormData, fallback: string) {
  const raw = String(f.get("back") ?? "");
  if (!/^\/app\/(attendance\/leave|inbox)(\/|\?|$)/.test(raw) || raw.includes("//")) return fallback;
  const [base, query = ""] = raw.split("?");
  const q = new URLSearchParams(query); q.delete("ok"); q.delete("error");
  return `${base}${q.size ? `?${q}` : ""}`;
}

/** The class teacher / office decides a student's leave request. */
export async function decideStudentLeave(f: FormData) {
  const { supabase, school, myName } = await requirePerm("attendance.leave.approve");
  const id = uuid(f, "id");
  const to = back(f, LEAVE);
  const { error } = await supabase.rpc("decide_student_leave", { lid: id, approve: f.get("decision") === "approve", note: str(f, "note", 300) });
  if (!error && id) after(async () => { await notifyLeaveDecided(school.id, id, myName || null); await processOutbox({ schoolId: school.id, limit: 20 }); });
  revalidatePath(LEAVE);
  go(to, error ? { error: errMsg(error) } : { ok: f.get("decision") === "approve" ? "Approved. The days show as leave in the attendance register." : "Rejected." });
}

export async function cancelStudentLeaveStaff(f: FormData) {
  const { supabase } = await requirePerm("attendance.leave.approve", "attendance.leave.create");
  const { error } = await supabase.rpc("cancel_student_leave", { lid: uuid(f, "id") });
  revalidatePath(LEAVE);
  go(back(f, LEAVE), error ? { error: errMsg(error) } : { ok: "Leave cancelled." });
}

/** The office enters a leave that the parent asked for on the phone. */
export async function applyStudentLeaveForParent(f: FormData) {
  const { supabase } = await requirePerm("attendance.leave.create");
  const stu = uuid(f, "student_id");
  const d1 = date(f, "from_date"), d2 = date(f, "to_date") ?? d1;
  if (!stu || !d1 || !d2) go(back(f, LEAVE), { error: "Pick the student and the dates." });
  const { data: lid, error } = await supabase.rpc("apply_student_leave", { stu, d1, d2, why: str(f, "reason", 300) });
  if (!error && f.get("approve_now") === "on" && lid) {
    const r = await supabase.rpc("decide_student_leave", { lid, approve: true, note: "Entered on the parent's request" });
    if (r.error) go(back(f, LEAVE), { error: `Saved, but not approved: ${errMsg(r.error)}` });
  }
  revalidatePath(LEAVE);
  go(back(f, LEAVE), error ? { error: errMsg(error) } : { ok: f.get("approve_now") === "on" ? "Leave entered and approved." : "Leave entered — waiting for approval." });
}

/** The class team answers a parent. */
export async function replyToFamily(f: FormData) {
  const { supabase } = await requirePerm("comms.messages.create");
  const stu = uuid(f, "student_id");
  const to = `/app/inbox/${stu}`;
  const body = str(f, "body", 2000);
  if (!stu || !body) go(to, { error: "Write a message first." });
  const { error } = await supabase.rpc("send_family_message", { stu, msg: body });
  revalidatePath("/app/inbox");
  go(`${to}#end`, error ? { error: errMsg(error) } : { ok: "Sent." });
}
