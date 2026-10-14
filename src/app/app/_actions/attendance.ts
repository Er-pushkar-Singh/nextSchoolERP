"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireSchool } from "@/lib/school";
import { date, errMsg, go, num, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";
import type { ScanResult } from "@/components/attendance/QrScanner";

const fail = (m: string): ScanResult => ({ ok: false, result: "error", message: m.replace(/^.*?:\s*/, "").slice(0, 160) });

/** A teacher or the office scans a student's (or staff member's) QR with the ERP's own scanner page. */
export async function scanCode(code: string): Promise<ScanResult> {
  const { supabase, school } = await requirePerm("attendance.students.create", "attendance.staff.create");
  const c = String(code ?? "").trim().slice(0, 60);
  if (!c) return fail("Nothing was scanned.");
  const { data, error } = await supabase.rpc("scan_attendance", { sid: school.id, p_code: c });
  if (error) return fail(error.message);
  revalidatePath("/app/attendance");
  return data as ScanResult;
}

/** A staff member taps "I have reached school" on their phone; the database checks the distance. */
export async function staffCheckIn(lat: number, lng: number): Promise<ScanResult> {
  const { supabase, school } = await requireSchool();
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail("Your location could not be read.");
  const { data, error } = await supabase.rpc("staff_check_in", { sid: school.id, p_lat: lat, p_lng: lng });
  if (error) return fail(error.message);
  revalidatePath("/app/attendance");
  return data as ScanResult;
}

export async function saveAttendanceSettings(f: FormData) {
  const { supabase, school } = await requirePerm("attendance.students.edit");
  const time = (k: string, d: string) => { const v = String(f.get(k) ?? ""); return /^\d{2}:\d{2}$/.test(v) ? v : d; };
  const { error } = await supabase.from("attendance_settings").upsert({
    school_id: school.id, school_start: time("school_start", "08:00"), late_after: time("late_after", "08:15"),
    geofence_m: Math.min(2000, Math.max(30, Math.round(num(f, "geofence_m") ?? 150))), updated_at: new Date().toISOString(),
  });
  go("/app/attendance/devices", error ? { error: errMsg(error) } : { ok: "Attendance timings saved." });
}

export async function addDevice(f: FormData) {
  const { supabase, school } = await requirePerm("attendance.students.edit");
  const { error } = await supabase.rpc("add_device", { sid: school.id, p_name: str(f, "name", 60), p_kind: str(f, "kind", 20) || "qr_kiosk", p_location: str(f, "location", 80) });
  go("/app/attendance/devices", error ? { error: errMsg(error) } : { ok: "Device added. Open its link on the tablet, or give the link and token to the machine's installer." });
}

export async function rotateDevice(f: FormData) {
  const { supabase } = await requirePerm("attendance.students.edit");
  const { error } = await supabase.rpc("rotate_device_token", { did: uuid(f, "id") });
  go("/app/attendance/devices", error ? { error: errMsg(error) } : { ok: "A new link was created. The old one no longer works." });
}

export async function toggleDevice(f: FormData) {
  const { supabase, school } = await requirePerm("attendance.students.edit");
  const { error } = await supabase.from("attendance_devices").update({ active: f.get("active") === "1" }).eq("id", uuid(f, "id")).eq("school_id", school.id);
  go("/app/attendance/devices", error ? { error: errMsg(error) } : { ok: "Device updated." });
}

export async function removeDevice(f: FormData) {
  const { supabase, school } = await requirePerm("attendance.students.edit");
  const { error } = await supabase.from("attendance_devices").delete().eq("id", uuid(f, "id")).eq("school_id", school.id);
  go("/app/attendance/devices", error ? { error: errMsg(error) } : { ok: "Device removed. Its past punches are kept." });
}

const STAFF_STATUS = ["P", "A", "L", "H", "LV", "OD"];

/** Mark the whole staff list for a day (or fix a few people). */
export async function saveStaffAttendance(f: FormData) {
  const { supabase, school, myName } = await requirePerm("attendance.staff.create", "attendance.staff.edit");
  const day = date(f, "date") ?? todayIST();
  const back = `/app/attendance/staff?date=${day}`;
  if (day > todayIST()) go(back, { error: "Can't mark attendance for a future date." });
  const rows: Record<string, unknown>[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("sf_")) continue;
    const staff_id = k.slice(3);
    const status = String(v);
    if (!/^[0-9a-f-]{36}$/.test(staff_id) || !STAFF_STATUS.includes(status)) continue;
    if (status === "") continue;
    rows.push({ school_id: school.id, staff_id, date: day, status, marked_by: myName || null, marked_at: new Date().toISOString(), source: "manual" });
  }
  if (!rows.length) go(back, { error: "Nothing to save." });
  const { error } = await supabase.from("staff_attendance").upsert(rows, { onConflict: "staff_id,date" });
  revalidatePath("/app/attendance");
  go(back, error ? { error: errMsg(error) } : { ok: `Attendance saved for ${rows.length} staff.` });
}

/**
 * Import a biometric machine's export. One punch per line: `code,2026-04-01 08:12` (comma, semicolon or tab).
 * Each line goes through the same rules as a live scan (late, out-time, duplicates).
 */
export async function importPunches(f: FormData) {
  const { supabase, school } = await requirePerm("attendance.students.edit", "attendance.staff.create");
  const text = String(f.get("punches") ?? "").slice(0, 200_000);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2000);
  if (!lines.length) go("/app/attendance/devices", { error: "Paste the punches first." });
  let ok = 0, bad = 0;
  for (const line of lines) {
    const m = line.split(/[,;\t]/).map((x) => x.trim());
    const t = new Date(`${(m[1] ?? "").replace(" ", "T")}${(m[1] ?? "").length <= 16 ? ":00" : ""}+05:30`);
    if (!m[0] || Number.isNaN(t.getTime()) || t.getTime() > Date.now() + 60_000) { bad++; continue; }
    const { data, error } = await supabase.rpc("import_punch", { sid: school.id, p_code: m[0], p_at: t.toISOString() });
    if (error || !(data as { ok?: boolean })?.ok) bad++; else ok++;
  }
  revalidatePath("/app/attendance");
  go("/app/attendance/devices", { ok: `Imported ${ok} punch${ok === 1 ? "" : "es"}${bad ? `; ${bad} line${bad === 1 ? "" : "s"} could not be used (unknown code, left student or bad time)` : ""}.` });
}
