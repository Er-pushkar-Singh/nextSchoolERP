"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, str, uuid } from "@/lib/action-util";
import { signedPhotoUrls } from "@/lib/doc-photo";
import { notifyAbsent } from "@/lib/message-events";
import { processOutbox } from "@/lib/messages";
import { todayIST } from "@/lib/format";

export type ScanResult = {
  ok: boolean; result: string; kind?: "student" | "staff"; name?: string; class?: string; status?: string; time?: string; late?: boolean; message?: string;
  id?: string | null; photo?: string | null; admission_no?: string | null; at: string;
};

/** One scan from the barcode station (a USB / Bluetooth scanner types the code and Enter, or the camera reads it). */
export async function scanBarcode(raw: string): Promise<ScanResult> {
  const { supabase, school } = await requirePerm("attendance.students.create", "attendance.staff.create");
  const code = String(raw ?? "").trim().slice(0, 60);
  const at = new Date().toISOString();
  if (!code) return { ok: false, result: "empty", message: "Nothing was scanned.", at };
  const { data, error } = await supabase.rpc("scan_attendance", { sid: school.id, p_code: code });
  if (error) return { ok: false, result: "error", message: errMsg(error).replace(/^not allowed — /, ""), at };
  const r = data as Omit<ScanResult, "at">;
  if (!r?.ok || r.kind !== "student") return { ...r, at };
  // the student's photo and admission number, so the person at the gate can see it is the right child
  const low = code.toLowerCase();
  const { data: s } = await supabase.from("students").select("id,admission_no").eq("school_id", school.id).or(`att_code.eq.${low.replace(/[^0-9a-z-]/g, "")},admission_no.eq.${code.replace(/[,()]/g, "")}`).limit(1).maybeSingle();
  const photo = s ? (await signedPhotoUrls(school.id, [s.id])).get(s.id) ?? null : null;
  return { ...r, id: s?.id ?? null, admission_no: s?.admission_no ?? null, photo, at };
}

/** "Finish the day": everyone not scanned is marked absent and their parents are told. */
export async function closeAttendanceDay(f: FormData) {
  const { supabase, school, myName } = await requirePerm("attendance.students.create");
  const sec = uuid(f, "section_id");
  const day = date(f, "date") ?? todayIST();
  const back = "/app/attendance/barcode";
  const { data, error } = await supabase.rpc("attendance_close_day", { sid: school.id, p_date: day, p_section: sec });
  if (error) go(back, { error: errMsg(error) });
  const r = data as { marked: number; student_ids: string[] };
  if (r.marked && f.get("notify") === "on") after(async () => { await notifyAbsent(school.id, r.student_ids, day, myName || null); await processOutbox({ schoolId: school.id, limit: 50 }); });
  revalidatePath("/app/attendance");
  go(back, { ok: r.marked ? `${r.marked} student${r.marked === 1 ? "" : "s"} marked absent${f.get("notify") === "on" ? " — parents are being told" : ""}.` : "Everyone already has a mark for the day." });
}

export async function clearAttendanceMark(f: FormData) {
  const { supabase, school } = await requirePerm("attendance.students.edit", "attendance.students.create");
  const { error } = await supabase.rpc("attendance_clear", { sid: school.id, p_student: uuid(f, "student_id")!, p_date: date(f, "date") ?? todayIST() });
  revalidatePath("/app/attendance");
  go(str(f, "back", 200)?.startsWith("/app/attendance") ? str(f, "back", 200)! : "/app/attendance/barcode", error ? { error: errMsg(error) } : { ok: "The mark was removed — scan again or mark by hand." });
}
