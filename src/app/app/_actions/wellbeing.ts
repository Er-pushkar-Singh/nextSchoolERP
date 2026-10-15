"use server";

import { revalidatePath } from "next/cache";
import { requireSchool } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const backTo = (f: FormData, fallback: string) => {
  const b = str(f, "back", 300);
  return b && /^\/app\/(health|discipline)(\/[a-z-]+)?(\?[^#\s]*)?$/.test(b) ? b : fallback;
};
const OUTCOMES = ["rested", "returned_class", "sent_home", "referred", "hospital"] as const;
const CATEGORIES = ["bullying", "fighting", "misbehaviour", "late_coming", "uniform", "mobile_phone", "property_damage", "cheating", "absconding", "abuse", "other"] as const;
const SEVERITIES = ["minor", "moderate", "serious"] as const;
const STATUSES = ["open", "under_review", "action_taken", "closed", "escalated"] as const;

/* ───────── Medical room ───────── */

export async function addHealthVisit(f: FormData) {
  const { supabase, school, can } = await requireSchool();
  const back = backTo(f, "/app/health");
  if (!can("wellbeing.medical.create")) go(back, { error: "You don't have permission to do that." });
  const student = uuid(f, "student_id");
  if (!student) go(back, { error: "Pick the student." });
  const { error } = await supabase.rpc("health_visit_add", {
    sid: school.id, p_student: student!, p_complaint: str(f, "complaint", 300) ?? "", p_temp: num(f, "temperature"), p_treatment: str(f, "treatment", 300),
    p_medicine: str(f, "medicine", 200), p_outcome: oneOf(f, "outcome", OUTCOMES, "rested"), p_informed: f.get("informed") === "on", p_follow: date(f, "follow_up_on"),
  });
  revalidatePath("/app/health");
  go(back, error ? { error: errMsg(error) } : { ok: "Visit recorded." });
}

export async function informParent(f: FormData) {
  const { supabase, school } = await requireSchool();
  const back = backTo(f, "/app/health");
  const { error } = await supabase.rpc("health_visit_inform", { sid: school.id, p_visit: uuid(f, "id")! });
  revalidatePath("/app/health");
  go(back, error ? { error: errMsg(error) } : { ok: "Marked: parent informed." });
}

export async function saveHealthRecord(f: FormData) {
  const { supabase, school, can, myName } = await requireSchool();
  const back = backTo(f, "/app/health/records");
  const student = uuid(f, "student_id");
  if (!student) go(back, { error: "Pick the student." });
  if (!can("wellbeing.medical.create") && !can("wellbeing.medical.edit")) go(back, { error: "You don't have permission to do that." });
  const row = {
    student_id: student!, school_id: school.id, blood_group: str(f, "blood_group", 5), allergies: str(f, "allergies", 300), conditions: str(f, "conditions", 300),
    medications: str(f, "medications", 300), vision: str(f, "vision", 80), disability: str(f, "disability", 200), emergency_name: str(f, "emergency_name", 80),
    emergency_phone: str(f, "emergency_phone", 20)?.replace(/[^0-9+ ]/g, "") ?? null, doctor_name: str(f, "doctor_name", 80), doctor_phone: str(f, "doctor_phone", 20)?.replace(/[^0-9+ ]/g, "") ?? null,
    insurance: str(f, "insurance", 120), notes: str(f, "notes", 500), updated_at: new Date().toISOString(), updated_by_name: myName || null,
  };
  const { error } = await supabase.from("student_health").upsert(row, { onConflict: "student_id" });
  revalidatePath("/app/health");
  go("/app/health/records", error ? { error: errMsg(error) } : { ok: "Health record saved." });
}

export async function addCheckup(f: FormData) {
  const { supabase, school, can, myName } = await requireSchool();
  const back = backTo(f, "/app/health/records");
  if (!can("wellbeing.medical.create")) go(back, { error: "You don't have permission to do that." });
  const student = uuid(f, "student_id");
  if (!student) go(back, { error: "Pick the student." });
  const on = date(f, "on_date") ?? todayIST();
  if (on > todayIST()) go(back, { error: "The check-up date can't be in the future." });
  const { error } = await supabase.from("health_checkups").insert({
    school_id: school.id, student_id: student!, on_date: on, height_cm: num(f, "height_cm"), weight_kg: num(f, "weight_kg"), vision_left: str(f, "vision_left", 20), vision_right: str(f, "vision_right", 20),
    dental: str(f, "dental", 120), remarks: str(f, "remarks", 300), camp: str(f, "camp", 80), by_name: myName || null,
  });
  revalidatePath("/app/health");
  go(back, error ? { error: /check/i.test(error.message) ? "Height must be 40–230 cm and weight 5–200 kg." : errMsg(error) } : { ok: "Check-up recorded." });
}

/* ───────── Discipline ───────── */

export async function reportIncident(f: FormData) {
  const { supabase, school, can } = await requireSchool();
  const back = backTo(f, "/app/discipline");
  if (!can("wellbeing.discipline.create")) go(back, { error: "You don't have permission to do that." });
  // one picker + one role per row; an empty picker still submits (an empty value), so rows are paired by position
  const ids = f.getAll("student_id").map((v) => (typeof v === "string" ? v : ""));
  const roles = f.getAll("role").map(String);
  const students: string[] = [], victims: string[] = [];
  ids.forEach((id, i) => {
    if (!/^[0-9a-f-]{36}$/i.test(id) || students.includes(id)) return;
    students.push(id);
    if (roles[i] === "victim") victims.push(id);
  });
  if (!students.length) go(back, { error: "Add at least one student." });
  const { error } = await supabase.rpc("discipline_report", {
    sid: school.id, p_students: students, p_category: oneOf(f, "category", CATEGORIES, "misbehaviour"), p_severity: oneOf(f, "severity", SEVERITIES, "minor"),
    p_on: date(f, "incident_on") ?? todayIST(), p_location: str(f, "location", 80), p_description: str(f, "description", 1500) ?? "", p_action: str(f, "action_taken", 500),
    p_informed: f.get("informed") === "on", p_follow: date(f, "follow_up_on"), p_confidential: f.get("confidential") === "on", p_victims: victims,
  });
  revalidatePath("/app/discipline");
  go(back, error ? { error: errMsg(error) } : { ok: "Incident recorded." });
}

export async function updateIncident(f: FormData) {
  const { supabase, school } = await requireSchool();
  const back = backTo(f, "/app/discipline");
  const { error } = await supabase.rpc("discipline_update", {
    sid: school.id, p_incident: uuid(f, "id")!, p_status: oneOf(f, "status", STATUSES, "open"), p_action: str(f, "action_taken", 500),
    p_informed: f.get("informed") === "on", p_follow: date(f, "follow_up_on"),
  });
  revalidatePath("/app/discipline");
  go(back, error ? { error: errMsg(error) } : { ok: "Incident updated." });
}

export async function addCounselling(f: FormData) {
  const { supabase, school } = await requireSchool();
  const back = backTo(f, "/app/discipline");
  const student = uuid(f, "student_id");
  if (!student) go(back, { error: "Pick the student." });
  const { error } = await supabase.rpc("counselling_add", { sid: school.id, p_student: student!, p_note: str(f, "note", 2000) ?? "" });
  revalidatePath("/app/discipline");
  go(back, error ? { error: errMsg(error) } : { ok: "Counselling note saved." });
}

/** A fine for an incident goes on the fee account of every student involved (not victims). 0 withdraws an unpaid fine. */
export async function setDisciplineFine(f: FormData) {
  const { supabase, school } = await requireSchool();
  const back = backTo(f, "/app/discipline");
  const amount = Math.max(0, num(f, "fine") ?? 0);
  const { data, error } = await supabase.rpc("discipline_set_fine", { sid: school.id, p_incident: uuid(f, "id")!, p_amount: amount });
  revalidatePath("/app/discipline");
  revalidatePath("/app/fees");
  go(back, error ? { error: errMsg(error) } : { ok: amount > 0 ? `Fine of ₹${amount} added to the fee account of ${data} student${data === 1 ? "" : "s"}.` : "Fine withdrawn." });
}