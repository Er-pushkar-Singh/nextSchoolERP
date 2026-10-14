"use server";

import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const back = (f: FormData, fallback: string) => {
  const b = str(f, "back", 200);
  return b && b.startsWith("/app/frontdesk") ? b : fallback;
};
const PURPOSES = ["meeting", "admission", "parent", "vendor", "official", "interview", "delivery", "other"] as const;

export async function checkInVisitor(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.visitors.create");
  let student: string | null = null;
  const adm = str(f, "admission_no", 40);
  if (adm) {
    const { data } = await supabase.from("students").select("id").eq("school_id", school.id).eq("admission_no", adm).maybeSingle();
    if (!data) go(back(f, "/app/frontdesk"), { error: `No student with admission no. ${adm}.` });
    student = data!.id;
  }
  const { error } = await supabase.rpc("visitor_checkin", {
    sid: school.id, p_name: str(f, "name", 80) ?? "", p_phone: str(f, "phone", 20), p_purpose: oneOf(f, "purpose", PURPOSES, "meeting"), p_to_meet: str(f, "to_meet", 80), p_student: student,
    p_org: str(f, "organisation", 80), p_id_proof: str(f, "id_proof", 60), p_people: Math.round(num(f, "people") ?? 1), p_vehicle: str(f, "vehicle_no", 20), p_note: str(f, "note", 300),
  });
  go(back(f, "/app/frontdesk"), error ? { error: errMsg(error) } : { ok: "Visitor checked in. Give them the pass." });
}

export async function checkOutVisitor(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.visitors.create");
  const { error } = await supabase.rpc("visitor_checkout", { vid: uuid(f, "id") });
  go(back(f, "/app/frontdesk"), error ? { error: errMsg(error) } : { ok: "Visitor checked out." });
}

export async function logCall(f: FormData) {
  const { supabase, school, myName } = await requirePerm("frontdesk.visitors.create");
  const { error } = await supabase.from("phone_calls").insert({
    school_id: school.id, direction: oneOf(f, "direction", ["incoming", "outgoing"] as const, "incoming"), name: str(f, "name", 80), phone: str(f, "phone", 20),
    purpose: oneOf(f, "purpose", ["enquiry", "complaint", "fees", "leave", "transport", "staff", "other"] as const, "enquiry"), summary: str(f, "summary", 500),
    follow_up_on: date(f, "follow_up_on"), handled_by_name: myName || null,
  });
  go("/app/frontdesk/calls", error ? { error: errMsg(error) } : { ok: "Call logged." });
}

export async function callDone(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.visitors.edit");
  const { error } = await supabase.rpc("call_followup_done", { cid: uuid(f, "id") });
  go(back(f, "/app/frontdesk/calls"), error ? { error: errMsg(error) } : { ok: "Follow-up marked done." });
}

export async function logPostal(f: FormData) {
  const { supabase, school, myName } = await requirePerm("frontdesk.visitors.create");
  const party = str(f, "party", 100);
  if (!party) go("/app/frontdesk/postal", { error: "Enter who it is from / to." });
  const { error } = await supabase.from("postal_items").insert({
    school_id: school.id, direction: oneOf(f, "direction", ["received", "dispatched"] as const, "received"), on_date: date(f, "on_date") ?? todayIST(),
    mode: oneOf(f, "mode", ["post", "speed_post", "courier", "hand", "other"] as const, "post"), party, reference_no: str(f, "reference_no", 60), subject: str(f, "subject", 150),
    to_whom: str(f, "to_whom", 80), note: str(f, "note", 300), created_by_name: myName || null,
  });
  go("/app/frontdesk/postal", error ? { error: errMsg(error) } : { ok: "Entered in the postal register." });
}

export async function requestGatePass(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.visitors.create");
  const dest = "/app/frontdesk/gatepass";
  const adm = str(f, "admission_no", 40);
  if (!adm) go(dest, { error: "Enter the student's admission number." });
  const { data: st } = await supabase.from("students").select("id").eq("school_id", school.id).eq("admission_no", adm!).maybeSingle();
  if (!st) go(dest, { error: `No student with admission no. ${adm}.` });
  const { error } = await supabase.rpc("gate_pass_request", { sid: school.id, p_student: st!.id, p_reason: str(f, "reason", 200) ?? "", p_pickup: str(f, "pickup_name", 80) ?? "",
    p_relation: str(f, "pickup_relation", 40), p_phone: str(f, "pickup_phone", 20) });
  go(dest, error ? { error: errMsg(error) } : { ok: "Gate pass created." });
}

export async function decideGatePass(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.visitors.edit");
  const approve = f.get("approve") === "1";
  const { error } = await supabase.rpc("gate_pass_decide", { gid: uuid(f, "id"), p_approve: approve, p_note: str(f, "note", 200) });
  go("/app/frontdesk/gatepass", error ? { error: errMsg(error) } : { ok: approve ? "Pass approved." : "Pass refused." });
}

export async function releaseGatePass(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.visitors.create");
  const { error } = await supabase.rpc("gate_pass_complete", { gid: uuid(f, "id") });
  go("/app/frontdesk/gatepass", error ? { error: errMsg(error) } : { ok: "Child released. Out-time recorded on attendance." });
}

export async function cancelGatePass(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.visitors.create");
  const { error } = await supabase.rpc("gate_pass_cancel", { gid: uuid(f, "id") });
  go("/app/frontdesk/gatepass", error ? { error: errMsg(error) } : { ok: "Pass cancelled." });
}
