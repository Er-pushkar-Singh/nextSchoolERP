import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, PageHeader, Select, Stat, td } from "@/components/ui/ui";
import { BarChart } from "@/components/ui/charts";
import { PrintButton } from "@/components/ui/PrintButton";

type Cl = { class_id: string; class_name: string; students: number; avg_percent: number | null; pass_percent: number | null; topper: string | null; topper_percent: number | null; failed: number; absent: number };
type Sb = { class_name: string; subject_name: string; students: number; avg_percent: number | null; below_pass: number; highest: number | null };

export default async function AcademicReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("reports.academic.view");
  const sp = await searchParams;
  const { data: ex } = await supabase.from("exams").select("id,name,sort,start_date").eq("school_id", school.id).order("sort", { ascending: false }).order("start_date", { ascending: false, nullsFirst: false }).limit(40);
  const { data: withResults } = ex?.length
    ? await supabase.from("exam_results").select("exam_id").eq("school_id", school.id).in("exam_id", ex.map((e) => e.id)).limit(5000)
    : { data: [] };
  const done = new Set((withResults ?? []).map((r) => r.exam_id));
  const exams = (ex ?? []).filter((e) => done.has(e.id));
  const cur = exams.find((e) => e.id === sp.exam) ?? exams[0] ?? null;
  const [{ data: cl }, { data: sb }] = cur
    ? await Promise.all([supabase.rpc("report_exam_by_class", { sid: school.id, p_exam: cur.id }), supabase.rpc("report_exam_by_subject", { sid: school.id, p_exam: cur.id })])
    : [{ data: [] }, { data: [] }];
  const C = (cl ?? []) as Cl[], S = (sb ?? []) as Sb[];
  const total = C.reduce((t, c) => t + Number(c.students), 0);
  const avg = total ? C.reduce((t, c) => t + Number(c.avg_percent ?? 0) * Number(c.students), 0) / total : 0;
  const passRate = total ? C.reduce((t, c) => t + Number(c.pass_percent ?? 0) * Number(c.students), 0) / total : 0;
  const weak = [...S].filter((s) => s.avg_percent !== null).sort((a, b) => Number(a.avg_percent) - Number(b.avg_percent)).slice(0, 8);
  const cell = "border-t border-line px-3 py-2 text-right tabular-nums";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="reports" title="Exam results analysis" subtitle={cur ? `${cur.name}` : "Declared results only"} back={{ href: "/app/reports", label: "Reports" }}
        actions={<>{cur && can("reports.academic.export") && <a href={`/app/reports/export?kind=exam&exam=${cur.id}`} className="btn btn-sm btn-secondary">Download CSV</a>}<PrintButton label="Print" /></>} />
      {exams.length === 0 ? <Empty>No exam result has been declared yet. <Link href="/app/exams">Open Exams</Link> and declare a result to see the analysis here.</Empty> : (
        <>
          <form className="flex flex-wrap items-end gap-2 print:hidden">
            <Select label="Exam" name="exam" defaultValue={cur?.id} options={exams.map((e) => [e.id, e.name] as [string, string])} />
            <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
          </form>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Students with results" value={total} icon="students" />
            <Stat label="Average" value={`${Math.round(avg * 10) / 10}%`} icon="exams" tone="blue" />
            <Stat label="Pass rate" value={`${Math.round(passRate * 10) / 10}%`} icon="attendance" tone="green" />
            <Stat label="Failed" value={C.reduce((t, c) => t + Number(c.failed), 0)} hint={`${C.reduce((t, c) => t + Number(c.absent), 0)} absent`} icon="notifications" tone="rose" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Average % by class"><BarChart data={C.map((c) => ({ label: c.class_name, value: Number(c.avg_percent ?? 0) }))} format={(n) => `${Math.round(n)}%`} /></Card>
            <Card title="Pass % by class"><BarChart data={C.map((c) => ({ label: c.class_name, value: Number(c.pass_percent ?? 0) }))} colors={["#16a34a"]} format={(n) => `${Math.round(n)}%`} /></Card>
          </div>
          <div className="overflow-x-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
            <table className="w-full border-collapse text-[14px]" style={{ minWidth: 720 }}>
              <thead><tr className="bg-blue-soft text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase">
                {["Class", "Students", "Average", "Pass %", "Failed", "Absent", "Topper"].map((h, i) => <th key={h} className={`px-3 py-3 font-bold ${i === 0 || i === 6 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
              <tbody>
                {C.map((c) => (
                  <tr key={c.class_id}>
                    <td className={`${td} font-bold text-ink`}>{c.class_name}</td><td className={cell}>{c.students}</td><td className={cell}>{c.avg_percent ?? "—"}%</td>
                    <td className={`${cell} font-bold ${Number(c.pass_percent) < 60 ? "text-error" : "text-ink"}`}>{c.pass_percent ?? "—"}%</td><td className={cell}>{c.failed}</td><td className={cell}>{c.absent}</td>
                    <td className={td}>{c.topper ? <>{c.topper} <span className="text-muted">({c.topper_percent}%)</span></> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {weak.length > 0 && (
            <Card title="Subjects needing attention" description="Lowest class average — a reason to review teaching, not to blame students">
              <ul className="m-0 grid list-none gap-x-8 gap-y-2 p-0 text-[14px] sm:grid-cols-2">
                {weak.map((s) => (
                  <li key={`${s.class_name}-${s.subject_name}`} className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                    <span><b className="text-ink">{s.subject_name}</b> <span className="text-muted">· Class {s.class_name}</span></span>
                    <span><b className={Number(s.avg_percent) < 45 ? "text-error" : "text-ink"}>{s.avg_percent}%</b><span className="text-muted"> · {s.below_pass} below pass</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
