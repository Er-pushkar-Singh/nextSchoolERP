"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const STATUSES = ["P", "A", "L", "H", "LV"];

export async function saveAttendance(f: FormData) {
  const { supabase, school, myName } = await requirePerm("attendance.students.create", "attendance.students.edit");
  const class_id = uuid(f, "class_id");
  const section_id = uuid(f, "section_id");
  const day = date(f, "date") ?? todayIST();
  const back = `/app/attendance?class_id=${class_id}&section_id=${section_id}&date=${day}`;
  if (day > todayIST()) go(back, { error: "Can't mark attendance for a future date." });
  const by = myName || null;
  const rows: Record<string, unknown>[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("st_")) continue;
    const student_id = k.slice(3);
    if (!/^[0-9a-f-]{36}$/.test(student_id) || !STATUSES.includes(String(v))) continue;
    rows.push({ school_id: school.id, student_id, class_id, section_id, date: day, status: String(v), marked_by: by, marked_at: new Date().toISOString(), source: "manual" });
  }
  if (!rows.length) go(back, { error: "No students to mark." });
  const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "student_id,date" });
  revalidatePath("/app");
  go(`${back}&saved=1`, error ? { error: errMsg(error) } : { ok: `Attendance saved for ${rows.length} students.` });
}

/* ───────── Exams ───────── */

export async function createExam(f: FormData) {
  const { supabase, school, session } = await requirePerm("exams.setup.create");
  const name = str(f, "name", 60);
  if (!name || !session) go("/app/exams", { error: "Exam name is required (and a current session)." });
  const { data, error } = await supabase.from("exams").insert({ school_id: school.id, session_id: session!.id, name, start_date: date(f, "start_date"), sort: num(f, "sort") ?? 0 }).select("id").single();
  if (error) go("/app/exams", { error: /unique/i.test(error.message) ? "An exam with this name already exists." : errMsg(error) });
  go(`/app/exams/${data!.id}`, { ok: "Exam created. Now add subjects and maximum marks for each class." });
}

export async function togglePublish(f: FormData) {
  const { supabase, school } = await requirePerm("exams.results.publish");
  const id = uuid(f, "id");
  const published = f.get("published") === "1";
  const { error } = await supabase.from("exams").update({ published }).eq("id", id!).eq("school_id", school.id);
  go(`/app/exams/${id}`, error ? { error: errMsg(error) } : { ok: published ? "Results published — parents can see them on their page." : "Results hidden from parents." });
}

export async function deleteExam(f: FormData) {
  const { supabase, school } = await requirePerm("exams.setup.delete");
  const { error } = await supabase.from("exams").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go("/app/exams", error ? { error: errMsg(error) } : { ok: "Exam deleted." });
}

/** Set subjects + max marks for one or more classes. */
export async function setExamSubjects(f: FormData) {
  const { supabase, school } = await requirePerm("exams.setup.create");
  const exam_id = uuid(f, "exam_id");
  const back = `/app/exams/${exam_id}`;
  const classIds = f.getAll("class_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const subjects = f.getAll("subject_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const max = num(f, "max_marks") ?? 100;
  if (!classIds.length || !subjects.length || max <= 0) go(back, { error: "Pick classes, subjects and max marks." });
  const rows = classIds.flatMap((class_id) => subjects.map((subject_id) => ({ school_id: school.id, exam_id, class_id, subject_id, max_marks: max })));
  const { error } = await supabase.from("exam_subjects").upsert(rows, { onConflict: "exam_id,class_id,subject_id" });
  go(back, error ? { error: errMsg(error) } : { ok: `Saved ${rows.length} class-subject(s).` });
}

export async function removeExamSubject(f: FormData) {
  const { supabase, school } = await requirePerm("exams.setup.delete");
  const { error } = await supabase.from("exam_subjects").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(`/app/exams/${uuid(f, "exam_id")}`, error ? { error: errMsg(error) } : { ok: "Removed." });
}

export async function saveMarks(f: FormData) {
  const { supabase, school, myName } = await requirePerm("exams.marks.create", "exams.marks.edit");
  const exam_id = uuid(f, "exam_id");
  const class_id = uuid(f, "class_id");
  const section_id = uuid(f, "section_id");
  const back = `/app/exams/${exam_id}/marks?class_id=${class_id}${section_id ? `&section_id=${section_id}` : ""}`;
  const { data: es } = await supabase.from("exam_subjects").select("subject_id,max_marks").eq("exam_id", exam_id!).eq("class_id", class_id!);
  const maxOf = new Map((es ?? []).map((e) => [e.subject_id, Number(e.max_marks)]));
  const by = myName || null;
  const rows: Record<string, unknown>[] = [];
  const bad: string[] = [];
  for (const [k, v] of f.entries()) {
    const m = k.match(/^m_([0-9a-f-]{36})_([0-9a-f-]{36})$/);
    if (!m) continue;
    const [, student_id, subject_id] = m;
    if (!maxOf.has(subject_id)) continue;
    const raw = String(v).trim().toUpperCase();
    if (raw === "") { rows.push({ school_id: school.id, exam_id, student_id, subject_id, marks: null, absent: false, entered_by: by, updated_at: new Date().toISOString() }); continue; }
    if (raw === "AB" || raw === "A") { rows.push({ school_id: school.id, exam_id, student_id, subject_id, marks: null, absent: true, entered_by: by, updated_at: new Date().toISOString() }); continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > maxOf.get(subject_id)!) { bad.push(raw); continue; }
    rows.push({ school_id: school.id, exam_id, student_id, subject_id, marks: n, absent: false, entered_by: by, updated_at: new Date().toISOString() });
  }
  const { error } = rows.length ? await supabase.from("marks").upsert(rows, { onConflict: "exam_id,student_id,subject_id" }) : { error: null };
  if (error) go(back, { error: errMsg(error) });
  go(back, bad.length ? { error: `Saved, but skipped ${bad.length} invalid value(s): ${bad.slice(0, 5).join(", ")}. Marks must be 0–max, or AB for absent.` } : { ok: "Marks saved." });
}

/* ───────── Notices ───────── */

export async function saveNotice(f: FormData) {
  const { supabase, school, myName } = await requirePerm("comms.notices.create");
  const title = str(f, "title", 150);
  if (!title) go("/app/notices", { error: "Title is required." });
  const { error } = await supabase.from("notices").insert({
    school_id: school.id, title, body: str(f, "body", 4000), class_id: uuid(f, "class_id"),
    published_on: date(f, "published_on") ?? todayIST(),
    created_by: myName || null,
  });
  go("/app/notices", error ? { error: errMsg(error) } : { ok: "Notice published. Parents see it on their page." });
}

export async function deleteNotice(f: FormData) {
  const { supabase, school } = await requirePerm("comms.notices.delete");
  const { error } = await supabase.from("notices").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go("/app/notices", error ? { error: errMsg(error) } : { ok: "Notice deleted." });
}
