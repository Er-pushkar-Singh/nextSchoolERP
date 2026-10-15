"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";

const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
const safeBack = (f: FormData, fallback: string) => {
  const b = String(f.get("back") ?? "");
  return b.startsWith("/app/admissions") ? b : fallback;
};

export async function saveAdmissionSettings(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.approve");
  const days = Math.min(90, Math.max(1, Math.round(num(f, "offer_days") ?? 7)));
  const { error } = await supabase.from("admission_settings").upsert({ school_id: school.id, offer_days: days, auto_sibling_discount: f.get("auto_sibling_discount") === "on" }, { onConflict: "school_id" });
  go("/app/admissions/pipeline", error ? { error: errMsg(error) } : { ok: "Admission settings saved." });
}

export async function addFollowup(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit", "frontdesk.enquiries.edit");
  const back = safeBack(f, "/app/admissions/followups");
  const who = String(f.get("who") ?? "");
  const pick = (t: string) => (who.startsWith(`${t}:`) && /^[0-9a-f-]{36}$/.test(who.slice(2)) ? who.slice(2) : null);
  const { error } = await supabase.rpc("add_followup", {
    sid: school.id, p_app: uuid(f, "application_id") ?? pick("a"), p_enq: uuid(f, "enquiry_id") ?? pick("e"), p_due: date(f, "due_on"),
    p_channel: oneOf(f, "channel", ["call", "whatsapp", "visit", "email", "sms"] as const, "call"), p_note: str(f, "note", 300),
  });
  go(back, error ? { error: errMsg(error) } : { ok: "Follow-up added." });
}

export async function completeFollowup(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.admissions.edit", "frontdesk.enquiries.edit");
  const back = safeBack(f, "/app/admissions/followups");
  const { error } = await supabase.rpc("complete_followup", { fid: uuid(f, "id"), p_outcome: str(f, "outcome", 300), p_next_due: date(f, "next_due"), p_next_note: str(f, "next_note", 300) });
  go(back, error ? { error: errMsg(error) } : { ok: "Follow-up done." });
}

export async function bulkStatus(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit");
  const back = safeBack(f, "/app/admissions/applications");
  const picked = ids(f, "id");
  if (!picked.length) go(back, { error: "Tick at least one application." });
  const status = oneOf(f, "status", ["under_review", "approved", "waitlisted", "rejected", "cancelled"] as const, "under_review");
  const note = str(f, "note", 200);
  if (status === "rejected" && !note) go(back, { error: "Write the reason for rejecting." });
  const { data, error } = await supabase.rpc("bulk_application_status", { sid: school.id, p_ids: picked, p_status: status, p_note: note });
  if (error) go(back, { error: errMsg(error) });
  const r = data as { ok: number; failed: { id: string; error: string }[] };
  revalidatePath("/app/admissions/applications");
  const failMsg = r.failed.length ? ` ${r.failed.length} could not be changed: ${[...new Set(r.failed.map((x) => x.error))].slice(0, 2).join("; ")}` : "";
  go(back, r.ok ? { ok: `${r.ok} application(s) updated.${failMsg}` } : { error: failMsg.trim() || "Nothing changed." });
}

export async function saveTestSheet(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit");
  const back = safeBack(f, "/app/admissions/applications");
  const rows = ids(f, "id").map((id) => ({
    id, marks: String(f.get(`marks_${id}`) ?? "").trim(), max: String(f.get("max") ?? "").trim(), test_on: String(f.get("test_on") ?? "").trim(),
  })).filter((r) => r.marks !== "").map((r) => ({ ...r, marks: Number(r.marks), max: r.max ? Number(r.max) : null, test_on: /^\d{4}-\d{2}-\d{2}$/.test(r.test_on) ? r.test_on : null }));
  if (!rows.length) go(back, { error: "Enter marks for at least one applicant." });
  if (rows.some((r) => !Number.isFinite(r.marks) || r.marks < 0 || (r.max !== null && r.marks > r.max))) go(back, { error: "Marks must be a number, not more than the maximum." });
  const { data, error } = await supabase.rpc("record_test_marks", { sid: school.id, p_rows: rows });
  go(back, error ? { error: errMsg(error) } : { ok: `Marks saved for ${data} applicant(s).` });
}

export async function promoteWaitlist(f: FormData) {
  const { supabase, school, session } = await requirePerm("frontdesk.admissions.approve");
  const back = "/app/admissions/pipeline";
  if (!session) go(back, { error: "No current session." });
  const { data, error } = await supabase.rpc("promote_waitlist", { sid: school.id, cls: uuid(f, "class_id"), sess: session!.id });
  go(back, error ? { error: errMsg(error) } : { ok: data ? `${data} application(s) promoted from the waitlist.` : "No free seat, or nobody on the waitlist." });
}

export async function lapseOffers() {
  const { supabase, school } = await requirePerm("frontdesk.admissions.approve");
  const { data, error } = await supabase.rpc("lapse_expired_offers", { sid: school.id });
  go("/app/admissions/pipeline", error ? { error: errMsg(error) } : { ok: data ? `${data} expired offer(s) cancelled; seats released.` : "No offer has expired." });
}

/** Change the date, channel or note of an open follow-up. */
export async function updateFollowup(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit", "frontdesk.enquiries.edit");
  const back = safeBack(f, "/app/admissions/followups");
  const { error } = await supabase.from("application_followups")
    .update({ due_on: date(f, "due_on"), channel: oneOf(f, "channel", ["call", "whatsapp", "visit", "email", "sms"] as const, "call"), note: str(f, "note", 300) })
    .eq("id", uuid(f, "id")!).eq("school_id", school.id).eq("done", false);
  go(back, error ? { error: errMsg(error) } : { ok: "Follow-up updated." });
}

export async function deleteFollowup(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.admissions.edit", "frontdesk.enquiries.edit");
  const back = safeBack(f, "/app/admissions/followups");
  const { error } = await supabase.from("application_followups").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back, error ? { error: errMsg(error) } : { ok: "Follow-up deleted." });
}
