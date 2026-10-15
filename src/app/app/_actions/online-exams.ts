"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";

const back = (f: FormData, fallback: string) => {
  const b = str(f, "back", 300);
  return b && b.startsWith("/app/exams") ? b : fallback;
};
const KINDS = ["single", "multi", "truefalse"] as const;
const DIFF = ["easy", "medium", "hard"] as const;
const LETTERS = "abcdefghij";

/** IST wall-clock "2026-10-20" + "09:30" → ISO instant */
const at = (d: string | null, t: string | null) => (d && t && /^\d{2}:\d{2}$/.test(t) ? new Date(`${d}T${t}:00+05:30`).toISOString() : null);

/* ───────────── Question bank ───────────── */
export async function saveQuestion(f: FormData) {
  const { supabase, school, myName } = await requirePerm("exams.marks.create", "exams.setup.create");
  const id = uuid(f, "id");
  const dest = back(f, "/app/exams/questions");
  const kind = oneOf(f, "kind", KINDS, "single");
  const text = str(f, "text", 2000);
  const cls = uuid(f, "class_id"), sub = uuid(f, "subject_id");
  if (!text || !cls || !sub) go(dest, { error: "Class, subject and the question are required." });
  let options: { id: string; text: string }[] = [];
  let answer: string[] = [];
  if (kind === "truefalse") {
    options = [{ id: "t", text: "True" }, { id: "f", text: "False" }];
    answer = [f.get("tf") === "f" ? "f" : "t"];
  } else {
    for (let i = 0; i < 8; i++) {
      const t = str(f, `opt_${i}`, 300);
      if (t) options.push({ id: LETTERS[i], text: t });
    }
    answer = f.getAll("correct").map(String).filter((c) => options.some((o) => o.id === c));
    if (options.length < 2) go(dest, { error: "Give at least two options." });
    if (!answer.length) go(dest, { error: "Tick the correct option." });
    if (kind === "single" && answer.length > 1) go(dest, { error: "A single-answer question has one correct option; choose “multiple answers” otherwise." });
    if (kind === "multi" && answer.length < 2) go(dest, { error: "A multiple-answer question needs two or more correct options." });
  }
  const row = {
    class_id: cls, subject_id: sub, kind, text, options, answer, marks: Math.max(0.5, num(f, "marks") ?? 1), negative_marks: Math.max(0, num(f, "negative_marks") ?? 0),
    difficulty: oneOf(f, "difficulty", DIFF, "medium"), chapter: str(f, "chapter", 80), explanation: str(f, "explanation", 600), active: f.get("inactive") !== "1",
  };
  const { error } = id
    ? await supabase.from("question_bank").update(row).eq("id", id).eq("school_id", school.id)
    : await supabase.from("question_bank").insert({ ...row, school_id: school.id, created_by_name: myName || null });
  go(dest, error ? { error: errMsg(error) } : { ok: id ? "Question updated." : "Question added to the bank." });
}

export async function deleteQuestion(f: FormData) {
  const { supabase, school } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const { error } = await supabase.from("question_bank").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back(f, "/app/exams/questions"), error ? { error: /foreign key|violates/i.test(error.message) ? "This question is on an exam paper. Switch it off (inactive) instead of deleting." : errMsg(error) } : { ok: "Question deleted." });
}

export async function toggleQuestion(f: FormData) {
  const { supabase, school } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const { error } = await supabase.from("question_bank").update({ active: f.get("active") === "1" }).eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back(f, "/app/exams/questions"), error ? { error: errMsg(error) } : { ok: "Question updated." });
}

/**
 * Paste questions, one per line:  question | option A | option B | option C | option D | correct | marks | difficulty | chapter
 * correct = A, or AC for several, or T / F for true-false lines (two options not needed).
 */
export async function importQuestions(f: FormData) {
  const { supabase, school, myName } = await requirePerm("exams.marks.create", "exams.setup.create");
  const dest = back(f, "/app/exams/questions");
  const cls = uuid(f, "class_id"), sub = uuid(f, "subject_id");
  if (!cls || !sub) go(dest, { error: "Choose the class and subject the questions are for." });
  const lines = String(f.get("lines") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 300);
  const rows: Record<string, unknown>[] = [];
  const bad: number[] = [];
  lines.forEach((line, i) => {
    const p = line.split("|").map((x) => x.trim());
    const text = p[0];
    const correct = (p[5] ?? "").toUpperCase().replace(/[^A-J TF]/g, "").replace(/\s/g, "");
    if (!text) { bad.push(i + 1); return; }
    const tfLine = /^[TF]$/.test(correct) && !p[1];
    let options: { id: string; text: string }[] = [], answer: string[] = [], kind: string = "single";
    if (tfLine) { options = [{ id: "t", text: "True" }, { id: "f", text: "False" }]; answer = [correct.toLowerCase()]; kind = "truefalse"; }
    else {
      options = p.slice(1, 5).map((t, k) => ({ id: LETTERS[k], text: t })).filter((o) => o.text);
      answer = [...correct.toLowerCase()].filter((c) => options.some((o) => o.id === c));
      kind = answer.length > 1 ? "multi" : "single";
      if (options.length < 2 || !answer.length) { bad.push(i + 1); return; }
    }
    rows.push({ school_id: school.id, class_id: cls, subject_id: sub, kind, text: text.slice(0, 2000), options, answer, marks: Math.max(0.5, Number(p[6]) || 1),
      difficulty: DIFF.includes(p[7] as (typeof DIFF)[number]) ? p[7] : "medium", chapter: p[8] ? p[8].slice(0, 80) : null, created_by_name: myName || null });
  });
  if (!rows.length) go(dest, { error: `Nothing could be imported${bad.length ? ` (check line ${bad.slice(0, 5).join(", ")})` : ""}.` });
  const { error } = await supabase.from("question_bank").insert(rows);
  go(dest, error ? { error: errMsg(error) } : { ok: `Imported ${rows.length} question(s)${bad.length ? `; skipped line ${bad.slice(0, 8).join(", ")}` : ""}.` });
}

/* ───────────── Online exams ───────────── */
export async function createOnlineExam(f: FormData) {
  const { supabase, school, session, myName } = await requirePerm("exams.marks.create", "exams.setup.create");
  const title = str(f, "title", 120), cls = uuid(f, "class_id"), sub = uuid(f, "subject_id");
  if (!title || !cls || !sub) go("/app/exams/online", { error: "Title, class and subject are required." });
  const { data, error } = await supabase.from("online_exams").insert({
    school_id: school.id, session_id: session?.id ?? null, class_id: cls, subject_id: sub, title, exam_id: uuid(f, "exam_id"), duration_min: Math.min(360, Math.max(1, Math.round(num(f, "duration_min") ?? 30))),
    pool_mode: oneOf(f, "pool_mode", ["fixed", "random"] as const, "fixed"), created_by_name: myName || null,
  }).select("id").single();
  if (error) go("/app/exams/online", { error: errMsg(error) });
  go(`/app/exams/online/${data!.id}`, { ok: "Exam created. Choose the questions, then schedule it." });
}

export async function updateOnlineExam(f: FormData) {
  const { supabase, school } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const id = uuid(f, "id");
  const dest = `/app/exams/online/${id}`;
  const rc = num(f, "random_count");
  const patch = {
    title: str(f, "title", 120) ?? "Online exam", instructions: str(f, "instructions", 2000), exam_id: uuid(f, "exam_id"),
    duration_min: Math.min(360, Math.max(1, Math.round(num(f, "duration_min") ?? 30))), pool_mode: oneOf(f, "pool_mode", ["fixed", "random"] as const, "fixed"),
    random_count: rc && rc > 0 ? Math.min(300, Math.round(rc)) : null,
    pool_filter: { chapter: str(f, "pool_chapter", 80) ?? "", difficulty: oneOf(f, "pool_difficulty", ["", "easy", "medium", "hard"] as const, "") },
    shuffle_questions: f.get("shuffle_questions") === "1", shuffle_options: f.get("shuffle_options") === "1", negative_marking: f.get("negative_marking") === "1",
    pass_percent: Math.min(100, Math.max(0, num(f, "pass_percent") ?? 33)), max_tab_switches: Math.min(20, Math.max(0, Math.round(num(f, "max_tab_switches") ?? 3))),
    require_fullscreen: f.get("require_fullscreen") === "1", access_code: str(f, "access_code", 20), show_result: oneOf(f, "show_result", ["immediately", "after_declare", "never"] as const, "after_declare"),
    show_answers: f.get("show_answers") === "1",
  };
  const { error } = await supabase.from("online_exams").update(patch).eq("id", id!).eq("school_id", school.id).eq("status", "draft");
  go(dest, error ? { error: errMsg(error) } : { ok: "Settings saved." });
}

export async function deleteOnlineExam(f: FormData) {
  const { supabase, school } = await requirePerm("exams.setup.delete");
  const { error } = await supabase.from("online_exams").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go("/app/exams/online", error ? { error: errMsg(error) } : { ok: "Online exam deleted." });
}

export async function addPaperQuestions(f: FormData) {
  const { supabase } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const exam = uuid(f, "exam_id");
  const dest = back(f, `/app/exams/online/${exam}`);
  const picked = f.getAll("question_id").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!picked.length) go(dest, { error: "Tick the questions to add." });
  const { data: mine } = await supabase.from("online_exam_questions").select("sort").eq("exam_id", exam!).order("sort", { ascending: false }).limit(1);
  let sort = mine?.[0]?.sort ?? 0;
  const { data: qs } = await supabase.from("question_bank").select("id,marks").in("id", picked);
  const rows = (qs ?? []).map((q) => ({ exam_id: exam, question_id: q.id, marks: q.marks, sort: ++sort }));
  const { error } = await supabase.from("online_exam_questions").upsert(rows, { onConflict: "exam_id,question_id", ignoreDuplicates: true });
  go(dest, error ? { error: errMsg(error) } : { ok: `${rows.length} question(s) added to the paper.` });
}

export async function removePaperQuestion(f: FormData) {
  const { supabase } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const exam = uuid(f, "exam_id");
  const { error } = await supabase.from("online_exam_questions").delete().eq("exam_id", exam!).eq("question_id", uuid(f, "question_id")!);
  go(back(f, `/app/exams/online/${exam}`), error ? { error: errMsg(error) } : { ok: "Removed from the paper." });
}

export async function setPaperMarks(f: FormData) {
  const { supabase } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const exam = uuid(f, "exam_id");
  const { error } = await supabase.from("online_exam_questions").update({ marks: Math.max(0.5, num(f, "marks") ?? 1) }).eq("exam_id", exam!).eq("question_id", uuid(f, "question_id")!);
  go(back(f, `/app/exams/online/${exam}`), error ? { error: errMsg(error) } : { ok: "Marks updated." });
}

export async function scheduleOnlineExam(f: FormData) {
  const { supabase, school } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const id = uuid(f, "id");
  const starts = at(date(f, "start_date"), str(f, "start_time", 5)), ends = at(date(f, "end_date") ?? date(f, "start_date"), str(f, "end_time", 5));
  const { error } = await supabase.rpc("online_exam_schedule", { sid: school.id, p_exam: id, p_starts: starts, p_ends: ends });
  revalidatePath("/app/exams/online");
  go(`/app/exams/online/${id}`, error ? { error: errMsg(error) } : { ok: "Exam scheduled. Share the student link; students sign in with admission number and date of birth." });
}

export async function unscheduleOnlineExam(f: FormData) {
  const { supabase, school } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const id = uuid(f, "id");
  const { error } = await supabase.rpc("online_exam_unschedule", { sid: school.id, p_exam: id });
  go(`/app/exams/online/${id}`, error ? { error: errMsg(error) } : { ok: "Back to draft." });
}

export async function closeOnlineExam(f: FormData) {
  const { supabase, school } = await requirePerm("exams.marks.edit", "exams.setup.edit");
  const id = uuid(f, "id");
  const { data, error } = await supabase.rpc("online_exam_close", { sid: school.id, p_exam: id });
  go(`/app/exams/online/${id}`, error ? { error: errMsg(error) } : { ok: `Exam closed${Number(data) ? `; ${data} running attempt(s) were submitted` : ""}.` });
}

export async function declareOnlineExam(f: FormData) {
  const { supabase, school } = await requirePerm("exams.results.publish");
  const id = uuid(f, "id");
  const { data, error } = await supabase.rpc("online_exam_declare", { sid: school.id, p_exam: id, p_push: f.get("push") === "1" });
  const r = data as { graded: number; pushed: number; absent: number } | null;
  go(`/app/exams/online/${id}`, error ? { error: errMsg(error) } : { ok: `Result declared for ${r?.graded} attempt(s)${r?.pushed ? `; ${r.pushed} marks written to the exam` : ""}${r?.absent ? `; ${r.absent} absentees marked AB` : ""}.` });
}
