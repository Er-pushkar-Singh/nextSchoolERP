import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";

/** Every attempt of an online exam as CSV (score, counts, tab switches, times, address). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Bad id", { status: 400 });
  const { supabase, school } = await requirePerm("exams.results.print", "exams.results.view");
  const { data: exam } = await supabase.from("online_exams").select("title").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!exam) return new Response("Not found", { status: 404 });
  const rows: string[][] = [["Rank", "Admission no", "Name", "Section", "Status", "Score", "Max", "Correct", "Wrong", "Skipped", "Tab switches", "Started", "Submitted", "IP"]];
  for (let p = 0; p < 40; p++) {
    const { data } = await supabase.rpc("online_attempt_list", { sid: school.id, p_exam: id, p_q: null, p_status: null, p_limit: 200, p_offset: p * 200 });
    const list = (data ?? []) as { rank: number | null; admission_no: string; student_name: string; section_name: string | null; status: string; score: number | null; max_score: number | null;
      correct: number | null; wrong: number | null; skipped: number | null; tab_switches: number; started_at: string; submitted_at: string | null; ip: string | null }[];
    for (const a of list) rows.push([a.rank === null ? "" : String(a.rank), a.admission_no, a.student_name, a.section_name ?? "", a.status, a.score === null ? "" : String(a.score), a.max_score === null ? "" : String(a.max_score),
      a.correct === null ? "" : String(a.correct), a.wrong === null ? "" : String(a.wrong), a.skipped === null ? "" : String(a.skipped), String(a.tab_switches), a.started_at, a.submitted_at ?? "", a.ip ?? ""]);
    if (list.length < 200) break;
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="online-exam-${exam.title.replace(/[^A-Za-z0-9]+/g, "-")}.csv"`, "Cache-Control": "no-store" } });
}
