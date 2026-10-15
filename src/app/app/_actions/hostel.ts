"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireSchool } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const backTo = (f: FormData, fallback: string) => {
  const b = str(f, "back", 300);
  return b && /^\/app\/hostel(\/[a-z-]+)?(\?[^#\s]*)?$/.test(b) ? b : fallback;
};
const done = () => revalidatePath("/app/hostel", "layout");

/* ───────── Hostels & rooms ───────── */

export async function saveHostel(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "hostel.rooms.edit" : "hostel.rooms.create");
  const back = backTo(f, "/app/hostel");
  const name = str(f, "name", 60);
  if (!name) go(back, { error: "Give the hostel a name." });
  const warden = uuid(f, "warden_id");
  // when editing, leaving the warden picker empty keeps the current warden
  const row = { name: name!, kind: oneOf(f, "kind", ["boys", "girls", "mixed"] as const, "boys"), ...(warden || !id ? { warden_id: warden } : {}), address: str(f, "address", 200), active: id ? f.get("active") === "on" : true };
  const { error } = id ? await supabase.from("hostels").update(row).eq("id", id).eq("school_id", school.id) : await supabase.from("hostels").insert({ ...row, school_id: school.id });
  done();
  go(back, error ? { error: /unique/i.test(error.message) ? "A hostel with this name already exists." : errMsg(error) } : { ok: id ? "Hostel updated." : `${name} added. Now add its rooms.` });
}

export async function saveRoom(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "hostel.rooms.edit" : "hostel.rooms.create");
  const back = backTo(f, "/app/hostel/rooms");
  const hostel = uuid(f, "hostel_id");
  const room_no = str(f, "room_no", 20);
  if (!hostel || !room_no) go(back, { error: "Choose the hostel and give the room a number." });
  const beds = Math.round(num(f, "beds") ?? 4);
  if (beds < 1 || beds > 40) go(back, { error: "A room has 1 to 40 beds." });
  if (id) {
    const { count } = await supabase.from("hostel_allocations").select("id", { count: "exact", head: true }).eq("room_id", id).eq("status", "active");
    if ((count ?? 0) > beds) go(back, { error: `${count} students live here — vacate some beds before reducing to ${beds}.` });
  }
  const row = { hostel_id: hostel!, room_no: room_no!, floor: Math.round(num(f, "floor") ?? 0), beds, room_type: oneOf(f, "room_type", ["dormitory", "double", "single"] as const, "dormitory"),
    monthly_fee: Math.max(0, num(f, "monthly_fee") ?? 0), active: id ? f.get("active") === "on" : true };
  const { error } = id ? await supabase.from("hostel_rooms").update(row).eq("id", id).eq("school_id", school.id) : await supabase.from("hostel_rooms").insert({ ...row, school_id: school.id });
  done();
  go(back, error ? { error: /unique/i.test(error.message) ? "This hostel already has a room with that number." : errMsg(error) } : { ok: id ? "Room updated." : `Room ${room_no} added.` });
}

/* ───────── Beds ───────── */

export async function allocateBed(f: FormData) {
  const { supabase, school } = await requirePerm("hostel.allocation.create");
  const back = backTo(f, "/app/hostel/allocation");
  const student = uuid(f, "student_id"), room = uuid(f, "room_id");
  if (!student || !room) go(back, { error: "Pick the student and the room." });
  let bed = Math.round(num(f, "bed_no") ?? 0);
  if (!bed) {
    const [{ data: rm }, { data: taken }] = await Promise.all([
      supabase.from("hostel_rooms").select("beds").eq("id", room!).eq("school_id", school.id).maybeSingle(),
      supabase.from("hostel_allocations").select("bed_no").eq("room_id", room!).eq("status", "active"),
    ]);
    const used = new Set((taken ?? []).map((t) => t.bed_no));
    for (let b = 1; b <= (rm?.beds ?? 0); b++) if (!used.has(b)) { bed = b; break; }
    if (!bed) go(back, { error: "This room is full." });
  }
  const { error } = await supabase.rpc("hostel_allocate", { sid: school.id, p_student: student!, p_room: room!, p_bed: bed, p_start: date(f, "start_date"), p_fee: num(f, "monthly_fee") });
  done();
  go(back, error ? { error: errMsg(error) } : { ok: `Bed ${bed} allotted.` });
}

export async function vacateBed(f: FormData) {
  const { supabase, school } = await requirePerm("hostel.allocation.edit");
  const back = backTo(f, "/app/hostel/allocation");
  const { error } = await supabase.rpc("hostel_vacate", { sid: school.id, p_alloc: uuid(f, "id")!, p_end: date(f, "end_date") });
  done();
  go(back, error ? { error: errMsg(error) } : { ok: "Bed vacated." });
}

export async function generateHostelFee(f: FormData) {
  const { supabase, school, session } = await requireSchool();
  const back = backTo(f, "/app/hostel/allocation");
  const label = str(f, "label", 40), due = date(f, "due_date");
  if (!label || !due) go(back, { error: "Give the fee a label (e.g. “October”) and a due date." });
  if (!session) go(back, { error: "No current session is set." });
  const { data, error } = await supabase.rpc("generate_hostel_dues", { sid: school.id, sess: session!.id, p_label: label!, p_due: due!, p_months: num(f, "months") ?? 1 });
  done();
  revalidatePath("/app/fees");
  go(back, error ? { error: errMsg(error) } : { ok: data ? `Hostel fee added for ${data} student${data === 1 ? "" : "s"}.` : "Nothing new — this label was already billed." });
}

/* ───────── Roll call ───────── */

export async function saveRollcall(f: FormData) {
  const { supabase, school } = await requirePerm("hostel.rollcall.create");
  const hostel = uuid(f, "hostel_id");
  const on = date(f, "on_date") ?? todayIST();
  const slot = oneOf(f, "slot", ["night", "morning"] as const, "night");
  const back = backTo(f, `/app/hostel/rollcall?hostel=${hostel ?? ""}&date=${on}&slot=${slot}`);
  if (!hostel) go(back, { error: "Choose the hostel." });
  const marks: { student: string; status: string; note: string | null }[] = [];
  for (const [k, v] of f.entries()) {
    const m = /^st_([0-9a-f-]{36})$/.exec(k);
    if (!m || typeof v !== "string" || !["P", "A", "LV"].includes(v)) continue;
    marks.push({ student: m[1], status: v, note: str(f, `note_${m[1]}`, 120) });
  }
  const { data, error } = await supabase.rpc("hostel_save_rollcall", { sid: school.id, p_hostel: hostel!, p_date: on, p_slot: slot, p_marks: marks });
  done();
  go(back, error ? { error: errMsg(error) } : { ok: `Roll call saved for ${data} student${data === 1 ? "" : "s"}.` });
}

/* ───────── Outpass & visitors ───────── */

export async function requestOutpass(f: FormData) {
  const { supabase, school } = await requirePerm("hostel.rollcall.create");
  const back = backTo(f, "/app/hostel/outpass");
  const student = uuid(f, "student_id");
  if (!student) go(back, { error: "Pick the student." });
  const out = str(f, "out_at", 25), ret = str(f, "expected_back", 25);
  if (!out || !ret) go(back, { error: "Give the going-out and expected-return time." });
  // the form sends local (India) time without an offset
  const at = (s: string) => new Date(`${s}:00+05:30`).toISOString();
  const { error } = await supabase.rpc("hostel_outpass_request", {
    sid: school.id, p_student: student!, p_kind: oneOf(f, "kind", ["home", "local", "medical", "event"] as const, "home"), p_reason: str(f, "reason", 200) ?? "",
    p_out: at(out!), p_back: at(ret!), p_guardian: str(f, "guardian_name", 80), p_phone: str(f, "guardian_phone", 20),
  });
  done();
  go(back, error ? { error: errMsg(error) } : { ok: "Outpass created." });
}

export async function outpassStep(f: FormData) {
  const { supabase, school } = await requireSchool();
  const back = backTo(f, "/app/hostel/outpass");
  const action = oneOf(f, "action", ["approve", "reject", "out", "return", "cancel"] as const, "approve");
  const { error } = await supabase.rpc("hostel_outpass_step", { sid: school.id, p_pass: uuid(f, "id")!, p_action: action, p_note: str(f, "note", 200) });
  done();
  go(back, error ? { error: errMsg(error) } : { ok: { approve: "Outpass approved.", reject: "Outpass refused.", out: "Marked: student has left.", return: "Marked: student is back.", cancel: "Outpass cancelled." }[action] });
}

export async function addHostelVisitor(f: FormData) {
  const { supabase, school, myName } = await requirePerm("hostel.mess.create");
  const back = backTo(f, "/app/hostel/outpass");
  const student = uuid(f, "student_id"), name = str(f, "visitor_name", 80);
  if (!student || !name) go(back, { error: "Pick the student and write the visitor's name." });
  const { data: al } = await supabase.from("hostel_allocations").select("room:hostel_rooms(hostel_id)").eq("student_id", student!).eq("status", "active").maybeSingle();
  const room = Array.isArray(al?.room) ? al?.room[0] : al?.room;
  const { error } = await supabase.from("hostel_visitors").insert({
    school_id: school.id, hostel_id: room?.hostel_id ?? null, student_id: student!, visitor_name: name!, relation: str(f, "relation", 40), phone: str(f, "phone", 20), note: str(f, "note", 200), by_name: myName || null,
  });
  done();
  go(back, error ? { error: errMsg(error) } : { ok: "Visitor signed in." });
}

export async function visitorOut(f: FormData) {
  const { supabase, school } = await requirePerm("hostel.mess.edit");
  const back = backTo(f, "/app/hostel/outpass");
  const { error } = await supabase.from("hostel_visitors").update({ out_at: new Date().toISOString() }).eq("id", uuid(f, "id")!).eq("school_id", school.id).is("out_at", null);
  done();
  go(back, error ? { error: errMsg(error) } : { ok: "Visitor signed out." });
}

/* ───────── Mess menu ───────── */

export async function saveMess(f: FormData) {
  const { supabase, school } = await requirePerm("hostel.mess.edit");
  const hostel = uuid(f, "hostel_id");
  const back = `/app/hostel/mess${hostel ? `?hostel=${hostel}` : ""}`;
  const keep: { school_id: string; hostel_id: string | null; weekday: number; meal: string; items: string }[] = [];
  for (let d = 1; d <= 7; d++) for (const meal of ["breakfast", "lunch", "snacks", "dinner"]) {
    const v = str(f, `m_${d}_${meal}`, 200);
    if (v) keep.push({ school_id: school.id, hostel_id: hostel, weekday: d, meal, items: v });
  }
  // the unique index uses coalesce(hostel_id, …), so rows are replaced rather than upserted
  let del = supabase.from("mess_menu").delete().eq("school_id", school.id);
  del = hostel ? del.eq("hostel_id", hostel) : del.is("hostel_id", null);
  const { error: e1 } = await del;
  if (e1) go(back, { error: errMsg(e1) });
  if (keep.length) {
    const { error: e2 } = await supabase.from("mess_menu").insert(keep);
    if (e2) go(back, { error: errMsg(e2) });
  }
  done();
  go(back, { ok: "Mess menu saved." });
}
