import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gradeFor } from "./erp";

export type ExamResult = {
  exam: { id: string; name: string };
  rows: { subject: string; marks: number | null; absent: boolean; max: number; grade: string }[];
  total: number; max: number; percent: number; grade: string; rank: number | null;
};

/** Results for students of one class across the given exams (marks, totals, %, grade, rank in class). */
export async function classResults(supabase: SupabaseClient, classId: string, exams: { id: string; name: string }[], studentIds: string[], scale: { min: number; grade: string }[]) {
  const out = new Map<string, ExamResult[]>(studentIds.map((s) => [s, []]));
  if (!exams.length || !studentIds.length) return out;
  const examIds = exams.map((e) => e.id);
  const [{ data: es }, { data: marks }] = await Promise.all([
    supabase.from("exam_subjects").select("exam_id,subject_id,max_marks,subjects(name,sort)").in("exam_id", examIds).eq("class_id", classId),
    supabase.from("marks").select("exam_id,student_id,subject_id,marks,absent").in("exam_id", examIds).in("student_id", studentIds).limit(20000),
  ]);
  const subj = ((es ?? []) as unknown as { exam_id: string; subject_id: string; max_marks: number; subjects: { name: string; sort: number } }[]).sort((a, b) => a.subjects.sort - b.subjects.sort);
  const mk = new Map((marks ?? []).map((m) => [`${m.exam_id}|${m.student_id}|${m.subject_id}`, m]));
  for (const exam of exams) {
    const subs = subj.filter((s) => s.exam_id === exam.id);
    if (!subs.length) continue;
    const per = studentIds.map((sid) => {
      const rows = subs.map((s) => {
        const m = mk.get(`${exam.id}|${sid}|${s.subject_id}`);
        const v = m && !m.absent && m.marks !== null ? Number(m.marks) : null;
        return { subject: s.subjects.name, marks: v, absent: Boolean(m?.absent), max: Number(s.max_marks), grade: v === null ? "—" : gradeFor((v / Number(s.max_marks)) * 100, scale) };
      });
      const total = rows.reduce((t, r) => t + (r.marks ?? 0), 0);
      const max = rows.reduce((t, r) => t + r.max, 0);
      const percent = max ? Math.round((total / max) * 1000) / 10 : 0;
      const entered = rows.some((r) => r.marks !== null || r.absent);
      return { sid, res: { exam, rows, total, max, percent, grade: entered ? gradeFor(percent, scale) : "—", rank: null as number | null }, entered };
    });
    const ranked = per.filter((p) => p.entered).sort((a, b) => b.res.total - a.res.total);
    ranked.forEach((p, i) => { p.res.rank = i > 0 && ranked[i - 1].res.total === p.res.total ? ranked[i - 1].res.rank : i + 1; });
    for (const p of per) if (p.entered) out.get(p.sid)!.push(p.res);
  }
  return out;
}
