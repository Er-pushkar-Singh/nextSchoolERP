"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const time = (f: FormData, k: string) => {
  const v = str(f, k, 8);
  return v && /^\d{2}:\d{2}(:\d{2})?$/.test(v) ? v : null;
};

/* ───────── Vehicles ───────── */

export async function saveVehicle(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "transport.routes.edit" : "transport.routes.create");
  const reg_no = str(f, "reg_no", 20)?.toUpperCase();
  if (!reg_no) go("/app/transport/vehicles", { error: "Registration number is required." });
  const capacity = num(f, "capacity");
  const row = {
    reg_no, kind: oneOf(f, "kind", ["bus", "van", "auto", "other"] as const, "bus"), capacity: capacity && capacity > 0 ? Math.round(capacity) : null,
    driver_name: str(f, "driver_name", 80), driver_phone: str(f, "driver_phone", 20), driver_licence: str(f, "driver_licence", 30),
    attendant_name: str(f, "attendant_name", 80), attendant_phone: str(f, "attendant_phone", 20),
    insurance_upto: date(f, "insurance_upto"), fitness_upto: date(f, "fitness_upto"), permit_upto: date(f, "permit_upto"), puc_upto: date(f, "puc_upto"),
    active: f.get("active") !== "0", notes: str(f, "notes", 500),
  };
  const { error } = id
    ? await supabase.from("transport_vehicles").update(row).eq("id", id).eq("school_id", school.id)
    : await supabase.from("transport_vehicles").insert({ ...row, school_id: school.id });
  revalidatePath("/app/transport");
  if (error) go(`/app/transport/vehicles${id ? `?edit=${id}` : ""}`, { error: /unique/i.test(error.message) ? "A vehicle with this number already exists." : errMsg(error) });
  go("/app/transport/vehicles", { ok: id ? "Vehicle updated." : "Vehicle added." });
}

export async function deleteVehicle(f: FormData) {
  const { supabase, school } = await requirePerm("transport.routes.delete");
  const { error } = await supabase.from("transport_vehicles").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go("/app/transport/vehicles", error ? { error: errMsg(error) } : { ok: "Vehicle removed." });
}

/* ───────── Routes & stops ───────── */

export async function saveRoute(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "transport.routes.edit" : "transport.routes.create");
  const name = str(f, "name", 60);
  const back = id ? `/app/transport/routes/${id}` : "/app/transport";
  if (!name) go(back, { error: "Route name is required." });
  const row = { name, vehicle_id: uuid(f, "vehicle_id"), notes: str(f, "notes", 500), active: f.get("active") !== "0" };
  const { data, error } = id
    ? await supabase.from("transport_routes").update(row).eq("id", id).eq("school_id", school.id).select("id").single()
    : await supabase.from("transport_routes").insert({ ...row, school_id: school.id }).select("id").single();
  revalidatePath("/app/transport");
  if (error) go(back, { error: /unique/i.test(error.message) ? "A route with this name already exists." : errMsg(error) });
  go(`/app/transport/routes/${data!.id}`, { ok: id ? "Route saved." : "Route created. Now add its stops in order." });
}

export async function deleteRoute(f: FormData) {
  const { supabase, school } = await requirePerm("transport.routes.delete");
  const id = uuid(f, "id");
  const { error } = await supabase.from("transport_routes").delete().eq("id", id!).eq("school_id", school.id);
  if (error) go(`/app/transport/routes/${id}`, { error: /foreign key|violates/i.test(error.message) ? "Students are still allocated to this route. Move or remove them first." : errMsg(error) });
  go("/app/transport", { ok: "Route deleted." });
}

export async function saveStop(f: FormData) {
  const route_id = uuid(f, "route_id");
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "transport.routes.edit" : "transport.routes.create");
  const back = `/app/transport/routes/${route_id}`;
  const name = str(f, "name", 80);
  const fee = num(f, "monthly_fee") ?? 0;
  if (!route_id || !name) go(back, { error: "Stop name is required." });
  if (fee < 0) go(back, { error: "Fee can't be negative." });
  const lat = num(f, "lat"), lng = num(f, "lng");
  if ((lat === null) !== (lng === null) || (lat !== null && (lat < -90 || lat > 90 || lng! < -180 || lng! > 180))) go(back, { error: "Give both latitude and longitude (or leave both empty)." });
  const row = { name, sort: Math.round(num(f, "sort") ?? 0), pickup_time: time(f, "pickup_time"), drop_time: time(f, "drop_time"), monthly_fee: fee, lat, lng };
  const { error } = id
    ? await supabase.from("transport_stops").update(row).eq("id", id).eq("school_id", school.id)
    : await supabase.from("transport_stops").insert({ ...row, route_id, school_id: school.id });
  go(back, error ? { error: /unique/i.test(error.message) ? "This route already has a stop with that name." : errMsg(error) } : { ok: id ? "Stop updated." : "Stop added." });
}

export async function deleteStop(f: FormData) {
  const { supabase, school } = await requirePerm("transport.routes.delete");
  const back = `/app/transport/routes/${uuid(f, "route_id")}`;
  const { error } = await supabase.from("transport_stops").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back, error ? { error: /foreign key|violates/i.test(error.message) ? "Students use this stop. Move them to another stop first." : errMsg(error) } : { ok: "Stop removed." });
}

/* ───────── Students on transport ───────── */

export async function allocateStudent(f: FormData) {
  const { supabase, school, session } = await requirePerm("transport.allocation.create", "transport.allocation.edit");
  const student_id = uuid(f, "student_id");
  const stop_id = uuid(f, "stop_id");
  const back = "/app/transport/students";
  if (!session) go(back, { error: "Set a current session first (Settings → Classes & sessions)." });
  if (!student_id || !stop_id) go(`${back}?student=${student_id ?? ""}`, { error: "Pick a student and a stop." });
  const { data: stop } = await supabase.from("transport_stops").select("route_id").eq("id", stop_id!).eq("school_id", school.id).maybeSingle();
  if (!stop) go(back, { error: "Stop not found." });
  const fee = num(f, "monthly_fee");
  const row = {
    school_id: school.id, session_id: session!.id, student_id, route_id: stop!.route_id, stop_id,
    trip: oneOf(f, "trip", ["both", "pickup", "drop"] as const, "both"), monthly_fee: fee !== null && fee >= 0 ? fee : null,
    start_date: date(f, "start_date") ?? todayIST(), end_date: null,
  };
  const { error } = await supabase.from("transport_allocations").upsert(row, { onConflict: "session_id,student_id" });
  revalidatePath("/app/transport");
  go(back, error ? { error: errMsg(error) } : { ok: "Transport saved for the student." });
}

export async function endAllocation(f: FormData) {
  const { supabase, school } = await requirePerm("transport.allocation.edit");
  const end = date(f, "end_date") ?? todayIST();
  const { data, error } = await supabase.from("transport_allocations").update({ end_date: end }).eq("id", uuid(f, "id")!).eq("school_id", school.id).select("start_date").maybeSingle();
  revalidatePath("/app/transport");
  go("/app/transport/students", error ? { error: /check/i.test(error.message) ? "The end date can't be before the start date." : errMsg(error) } : data ? { ok: "Transport stopped. Fees are not billed for dates after this." } : { error: "Not found." });
}

export async function removeAllocation(f: FormData) {
  const { supabase, school } = await requirePerm("transport.allocation.delete");
  const { error } = await supabase.from("transport_allocations").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  revalidatePath("/app/transport");
  go("/app/transport/students", error ? { error: errMsg(error) } : { ok: "Removed from transport." });
}

export async function billTransport(f: FormData) {
  const { supabase, school, session } = await requirePerm("fees.dues.create");
  const back = "/app/transport/students";
  if (!session) go(back, { error: "Set a current session first." });
  const label = str(f, "label", 40);
  const due = date(f, "due_date");
  const months = num(f, "months") ?? 1;
  if (!label || !due) go(back, { error: "Period label and due date are required." });
  const { data, error } = await supabase.rpc("generate_transport_dues", { sid: school.id, sess: session!.id, p_label: label, p_due: due, p_months: months });
  revalidatePath("/app/fees");
  go(back, error ? { error: errMsg(error) } : { ok: data ? `Billed transport fee “${label}” to ${data} student(s). It now shows in Collect fee, Defaulters and the parent page.` : `Nothing new to bill — “${label}” was already billed to every student on transport.` });
}

/** The driver's private link is replaced; the old one stops working at once. */
export async function rotateDriverLink(f: FormData) {
  const { supabase } = await requirePerm("transport.routes.edit");
  const { error } = await supabase.rpc("rotate_driver_token", { vid: uuid(f, "id") });
  go("/app/transport/vehicles", error ? { error: errMsg(error) } : { ok: "A new driver link was created. Send it to the driver; the old one no longer works." });
}

export async function setSchoolLocation(f: FormData) {
  const { supabase, school } = await requirePerm("transport.routes.edit");
  const lat = num(f, "lat"), lng = num(f, "lng");
  if (lat === null || lng === null) go("/app/transport/live", { error: "Click the map or enter the latitude and longitude." });
  const { error } = await supabase.rpc("set_school_location", { sid: school.id, p_lat: lat, p_lng: lng });
  go("/app/transport/live", error ? { error: errMsg(error) } : { ok: "School location saved." });
}
