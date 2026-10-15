import { requirePerm } from "@/lib/school";
import { Card, Empty, PageHeader, Stat, td } from "@/components/ui/ui";
import { BarChart, Donut } from "@/components/ui/charts";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, todayIST } from "@/lib/format";

type R = { class_id: string; class_name: string; sections: number; seats: number | null; boys: number; girls: number; other: number; total: number;
  general: number; obc: number; sc: number; st: number; ews: number; rte: number; new_this_session: number };

export default async function Enrolment() {
  const { supabase, school, can } = await requirePerm("reports.overview.view", "reports.academic.view");
  const { data } = await supabase.rpc("report_enrolment", { sid: school.id });
  const R = (data ?? []) as R[];
  const sum = (k: keyof R) => R.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const total = sum("total");
  const cell = "border-t border-line px-3 py-2 text-right tabular-nums";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="reports" title="Enrolment" subtitle={`Class-wise strength as on ${fmtDate(todayIST())}`} back={{ href: "/app/reports", label: "Reports" }}
        actions={<>{can("reports.overview.export") && <a href="/app/reports/export?kind=enrolment" className="btn btn-sm btn-secondary">Download CSV</a>}<PrintButton label="Print" /></>} />
      {R.length === 0 || total === 0 ? <Empty>No active students yet.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Students" value={total} icon="students" />
            <Stat label="Boys" value={sum("boys")} hint={`${Math.round((100 * sum("boys")) / total)}%`} icon="students" tone="cyan" />
            <Stat label="Girls" value={sum("girls")} hint={`${Math.round((100 * sum("girls")) / total)}%`} icon="students" tone="rose" />
            <Stat label="New this session" value={sum("new_this_session")} icon="admissions" tone="green" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Students per class" className="lg:col-span-2"><BarChart data={R.map((r) => ({ label: r.class_name, value: Number(r.total) }))} /></Card>
            <Card title="By category">
              <Donut size={120} data={[{ label: "General", value: sum("general") }, { label: "OBC", value: sum("obc") }, { label: "SC", value: sum("sc") }, { label: "ST", value: sum("st") }, { label: "EWS", value: sum("ews") }].filter((d) => d.value > 0)} />
              <p className="m-0 mt-3 text-[13px] text-muted">{sum("rte")} admitted under RTE (25% quota)</p>
            </Card>
          </div>
          <div className="overflow-x-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
            <table className="w-full border-collapse text-[14px]" style={{ minWidth: 860 }}>
              <thead><tr className="bg-blue-soft text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase">
                {["Class", "Sections", "Boys", "Girls", "Total", "Seats", "General", "OBC", "SC", "ST", "EWS", "RTE"].map((h, i) => <th key={h} className={`px-3 py-3 font-bold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
              <tbody>
                {R.map((r) => (
                  <tr key={r.class_id}>
                    <td className={`${td} font-bold text-ink`}>{r.class_name}</td>
                    <td className={cell}>{r.sections}</td><td className={cell}>{r.boys}</td><td className={cell}>{r.girls}</td><td className={`${cell} font-bold text-ink`}>{r.total}</td>
                    <td className={cell}>{r.seats ? <span className={r.total > r.seats ? "font-bold text-error" : ""}>{r.seats}</span> : "—"}</td>
                    <td className={cell}>{r.general}</td><td className={cell}>{r.obc}</td><td className={cell}>{r.sc}</td><td className={cell}>{r.st}</td><td className={cell}>{r.ews}</td><td className={cell}>{r.rte}</td>
                  </tr>
                ))}
                <tr className="bg-[#f6f8fc] font-bold text-ink">
                  <td className={td}>Total</td><td className={cell}>{sum("sections")}</td><td className={cell}>{sum("boys")}</td><td className={cell}>{sum("girls")}</td><td className={cell}>{total}</td><td className={cell}>{sum("seats") || "—"}</td>
                  <td className={cell}>{sum("general")}</td><td className={cell}>{sum("obc")}</td><td className={cell}>{sum("sc")}</td><td className={cell}>{sum("st")}</td><td className={cell}>{sum("ews")}</td><td className={cell}>{sum("rte")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
