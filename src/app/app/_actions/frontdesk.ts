"use server";

import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const back = (f: FormData, fallback: string) => {
  const b = str(f, "back", 300);
  return b && b.startsWith("/app/frontdesk") ? b : fallback;
};
const PURPOSES = ["meeting", "admission", "parent", "vendor", "official", "interview", "delivery", "other"] as const;
const FOLLOW = ["pending", "done", "no_answer", "rescheduled", "dropped"] as const;

export async function checkInVisitor(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.visitors.create");
  const { error } = await supabase.rpc("visitor_checkin", {
    sid: school.id, p_name: str(f, "name", 80) ?? "", p_phone: str(f, "phone", 20), p_purpose: oneOf(f, "purpose", PURPOSES, "meeting"), p_to_meet: str(f, "to_meet", 80), p_student: uuid(f, "student_id"),
    p_org: str(f, "organisation", 80), p_id_proof: str(f, "id_proof", 60), p_people: Math.round(num(f, "people") ?? 1), p_vehicle: str(f, "vehicle_no", 20), p_note: str(f, "note", 300),
  });
  go(back(f, "/app/frontdesk"), error ? { error: errMsg(error) } : { ok: "Visitor checked in. Give them the pass." });
}

export async function updateVisitor(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.visitors.edit");
  const { error } = await supabase.rpc("visitor_update", {
    vid: uuid(f, "id"), p_name: str(f, "name", 80) ?? "", p_phone: str(f, "phone", 20), p_purpose: oneOf(f, "purpose", PURPOSES, "meeting"), p_to_meet: str(f, "to_meet", 80),
    p_org: str(f, "organisation", 80), p_people: Math.round(num(f, "people") ?? 1), p_vehicle: str(f, "vehicle_no", 20), p_id_proof: str(f, "id_proof", 60), p_note: str(f, "note", 300),
  });
  go(back(f, "/app/frontdesk"), error ? { error: errMsg(error) } : { ok: "Visit updated." });
}

export async function deleteVisitor(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.visitors.delete");
  const { error } = await supabase.from("visitors").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back(f, "/app/frontdesk"), error ? { error: errMsg(error) } : { ok: "Visit deleted." });
}

export async function checkOutVisitor(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.visitors.create");
  const { error } = await supabase.rpc("visitor_checkout", { vid: uuid(f, "id") });
  go(back(f, "/app/frontdesk"), error ? { error: errMsg(error) } : { ok: "Visitor checked out." });
}

export async function rotateVisitLink(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.visitors.edit");
  const { error } = await supabase.rpc("rotate_visit_token", { sid: school.id });
  go(back(f, "/app/frontdesk"), error ? { error: errMsg(error) } : { ok: "A new visitor QR was created. Print it again — the old one no longer works." });
}

export async function logCall(f: FormData) {
  const { supabase, school, myName } = await requirePerm("frontdesk.visitors.create");
  const { error } = await supabase.from("phone_calls").insert({
    school_id: school.id, direction: oneOf(f, "direction", ["incoming", "outgoing"] as const, "incoming"), name: str(f, "name", 80), phone: str(f, "phone", 20),
    purpose: oneOf(f, "purpose", ["enquiry", "complaint", "fees", "leave", "transport", "staff", "other"] as const, "enquiry"), summary: str(f, "summary", 500),
    follow_up_on: date(f, "follow_up_on"), handled_by_name: myName || null,
  });
  go(back(f, "/app/frontdesk/calls"), error ? { error: errMsg(error) } : { ok: "Call logged." });
}

export async function updateCall(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.visitors.edit");
  const { error } = await supabase.from("phone_calls").update({
    direction: oneOf(f, "direction", ["incoming", "outgoing"] as const, "incoming"), name: str(f, "name", 80), phone: str(f, "phone", 20),
    purpose: oneOf(f, "purpose", ["enquiry", "complaint", "fees", "leave", "transport", "staff", "other"] as const, "enquiry"), summary: str(f, "summary", 500),
  }).eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back(f, "/app/frontdesk/calls"), error ? { error: errMsg(error) } : { ok: "Call updated." });
}

export async function deleteCall(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.visitors.delete");
  const { error } = await supabase.from("phone_calls").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back(f, "/app/frontdesk/calls"), error ? { error: errMsg(error) } : { ok: "Call deleted." });
}

/** Follow-up status: done, no answer (call again on …), rescheduled (new date), dropped, or back to pending. */
export async function setCallFollowup(f: FormData) {
  const { supabase } = await requirePerm("frontdesk.visitors.edit");
  const status = oneOf(f, "status", FOLLOW, "done");
  const { error } = await supabase.rpc("call_set_followup", { cid: uuid(f, "id"), p_status: status, p_next: date(f, "next"), p_note: str(f, "note", 200) });
  go(back(f, "/app/frontdesk/calls"), error ? { error: errMsg(error) } : { ok: "Follow-up updated." });
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
  const student = uuid(f, "student_id");
  if (!student) go(dest, { error: "Search and choose the student." });
  const staffId = f.get("pickup_kind") === "staff" ? uuid(f, "pickup_staff_id") : null;
  if (f.get("pickup_kind") === "staff" && !staffId) go(dest, { error: "Search and choose the staff member who will take the child." });
  const { error } = await supabase.rpc("gate_pass_request", { sid: school.id, p_student: student, p_reason: str(f, "reason", 200) ?? "", p_pickup: str(f, "pickup_name", 80) ?? "",
    p_relation: str(f, "pickup_relation", 40), p_phone: str(f, "pickup_phone", 20), p_pickup_staff: staffId });
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
