import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";

/** The declared result of an exam (same filters as the screen) as CSV. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Bad id", { status: 400 });
  const { supabase, school } = await requirePerm("exams.results.print", "exams.results.view");
  const u = new URL(req.url);
  const uuidOk = (v: string | null) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const cls = uuidOk(u.searchParams.get("class_id"));
  const result = ["pass", "fail", "absent", "withheld"].includes(u.searchParams.get("result") ?? "") ? u.searchParams.get("result") : null;
  const { data: exam } = await supabase.from("exams").select("name").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!exam) return new Response("Not found", { status: 404 });
  const { data: classes } = await supabase.from("classes").select("id,name").eq("school_id", school.id);
  const cn = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const rows: string[][] = [["Class", "Rank", "Admission no", "Name", "Roll", "Total", "Max", "Percent", "Grade", "Result", "Failed subjects", "Remark"]];
  for (let p = 0; p < 40; p++) {
    let q = supabase.from("exam_results").select("class_id,rank,total,max_total,percent,grade,result,failed_subjects,remark,students(first_name,middle_name,last_name,admission_no,roll_no)")
      .eq("exam_id", id).eq("school_id", school.id).order("class_id").order("rank", { nullsFirst: false }).range(p * 500, p * 500 + 499);
    if (cls) q = q.eq("class_id", cls);
    if (result) q = q.eq("result", result);
    const { data } = await q;
    const list = (data ?? []) as unknown as { class_id: string; rank: number | null; total: number; max_total: number; percent: number; grade: string | null; result: string; failed_subjects: number; remark: string | null;
      students: { first_name: string; middle_name: string | null; last_name: string | null; admission_no: string; roll_no: number | null } | { first_name: string; middle_name: string | null; last_name: string | null; admission_no: string; roll_no: number | null }[] | null }[];
    for (const r of list) {
      const s = Array.isArray(r.students) ? r.students[0] : r.students;
      rows.push([cn.get(r.class_id) ?? "", r.rank === null ? "" : String(r.rank), s?.admission_no ?? "", [s?.first_name, s?.middle_name, s?.last_name].filter(Boolean).join(" "), s?.roll_no ? String(s.roll_no) : "",
        String(r.total), String(r.max_total), String(r.percent), r.grade ?? "", r.result, String(r.failed_subjects), r.remark ?? ""]);
    }
    if (list.length < 500) break;
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="result-${exam.name.replace(/[^A-Za-z0-9]+/g, "-")}.csv"`, "Cache-Control": "no-store" } });
}
