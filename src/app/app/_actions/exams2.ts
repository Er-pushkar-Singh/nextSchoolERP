"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, str, uuid } from "@/lib/action-util";

const time = (f: FormData, k: string) => { const v = str(f, k, 5); return v && /^\d{2}:\d{2}$/.test(v) ? v : null; };
const back = (f: FormData, fallback: string) => {
  const b = str(f, "back", 300);
  return b && b.startsWith("/app/exams") ? b : fallback;
};

/** Date sheet and pass mark of one class-subject of an exam. */
export async function saveExamSubject(f: FormData) {
  const { supabase, school } = await requirePerm("exams.setup.edit", "exams.setup.create");
  const exam = uuid(f, "exam_id");
  const dest = back(f, `/app/exams/${exam}`);
  const max = num(f, "max_marks");
  const pass = num(f, "pass_marks");
  const patch: Record<string, unknown> = { exam_date: date(f, "exam_date"), start_time: time(f, "start_time"), end_time: time(f, "end_time"), room: str(f, "room", 30), pass_marks: pass };
  if (max !== null && max > 0) patch.max_marks = max;
  if (pass !== null && max !== null && pass > max) go(dest, { error: "The pass mark cannot be more than the maximum marks." });
  const { error } = await supabase.from("exam_subjects").update(patch).eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(dest, error ? { error: errMsg(error) } : { ok: "Subject schedule saved." });
}

export async function copyExamSubjects(f: FormData) {
  const { supabase, school } = await requirePerm("exams.setup.create");
  const to = uuid(f, "exam_id");
  const { data, error } = await supabase.rpc("copy_exam_subjects", { sid: school.id, from_exam: uuid(f, "from"), to_exam: to });
  go(`/app/exams/${to}`, error ? { error: errMsg(error) } : { ok: `Copied ${data ?? 0} class-subject(s).` });
}

export async function setMarksLock(f: FormData) {
  const { supabase, school } = await requirePerm("exams.results.publish", "exams.setup.edit");
  const exam = uuid(f, "exam_id");
  const { error } = await supabase.rpc("set_marks_lock", { sid: school.id, p_exam: exam, p_class: uuid(f, "class_id"), p_lock: f.get("lock") === "1" });
  go(back(f, `/app/exams/${exam}`), error ? { error: errMsg(error) } : { ok: f.get("lock") === "1" ? "Marks entry locked for the class." : "Marks entry opened again." });
}

/** One button: totals, percentage, grade, rank and pass / fail for a class (or every class of the exam). */
export async function declareResult(f: FormData) {
  const { supabase, school } = await requirePerm("exams.results.publish");
  const exam = uuid(f, "exam_id");
  const cls = uuid(f, "class_id");
  const { data, error } = await supabase.rpc("declare_exam_result", { sid: school.id, p_exam: exam, p_class: cls, p_force: f.get("force") === "1" });
  revalidatePath(`/app/exams/${exam}`);
  const r = data as { classes: number; students: number; passed: number; failed: number } | null;
  go(back(f, `/app/exams/${exam}`), error ? { error: errMsg(error) } : { ok: `Result declared for ${r?.classes} class(es): ${r?.students} students, ${r?.passed} passed, ${r?.failed} failed. Publish it to let parents see it.` });
}

export async function undoDeclaration(f: FormData) {
  const { supabase, school } = await requirePerm("exams.results.publish");
  const exam = uuid(f, "exam_id");
  const { error } = await supabase.rpc("undo_exam_declaration", { sid: school.id, p_exam: exam, p_class: uuid(f, "class_id") });
  go(back(f, `/app/exams/${exam}`), error ? { error: errMsg(error) } : { ok: "Declaration withdrawn. Marks are open for correction." });
}

export async function withholdResult(f: FormData) {
  const { supabase, school } = await requirePerm("exams.results.publish");
  const exam = uuid(f, "exam_id");
  const { error } = await supabase.rpc("withhold_result", { sid: school.id, p_exam: exam, p_student: uuid(f, "student_id"), p_reason: str(f, "reason", 200), p_release: f.get("release") === "1" });
  go(back(f, `/app/exams/${exam}/results`), error ? { error: errMsg(error) } : { ok: f.get("release") === "1" ? "Result released." : "Result withheld." });
}

export async function saveRemark(f: FormData) {
  const { supabase, school } = await requirePerm("exams.results.publish", "exams.marks.edit");
  const exam = uuid(f, "exam_id");
  const { error } = await supabase.rpc("set_result_remark", { sid: school.id, p_exam: exam, p_student: uuid(f, "student_id"), p_remark: str(f, "remark", 300) });
  go(back(f, `/app/exams/${exam}/results`), error ? { error: errMsg(error) } : { ok: "Remark saved." });
}
