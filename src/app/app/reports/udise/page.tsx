import { requirePerm } from "@/lib/school";
import { Empty, PageHeader, td } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, todayIST } from "@/lib/format";

type U = { class_name: string; class_sort: number; category: string; boys: number; girls: number; total: number };

/** Class × category × gender — the table UDISE+ and the education office ask for. */
export default async function Udise() {
  const { supabase, school, can } = await requirePerm("reports.overview.view", "reports.udise.export");
  const { data } = await supabase.rpc("report_udise_strength", { sid: school.id });
  const U = (data ?? []) as U[];
  const classes = [...new Map(U.map((u) => [u.class_name, u.class_sort])).entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
  const cats = ["General", "Obc", "Sc", "St", "Ews", "Not stated"].filter((c) => U.some((u) => u.category === c)).concat([...new Set(U.map((u) => u.category))].filter((c) => !["General", "Obc", "Sc", "St", "Ews", "Not stated"].includes(c)));
  const get = (cl: string, cat: string, k: "boys" | "girls" | "total") => U.filter((u) => u.class_name === cl && u.category === cat).reduce((t, u) => t + Number(u[k]), 0);
  const nice = (c: string) => (["Obc", "Sc", "St", "Ews"].includes(c) ? c.toUpperCase() : c);
  const cell = "border-t border-line px-2.5 py-2 text-center tabular-nums";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="reports" title="UDISE+ strength" subtitle={`Enrolment by class, social category and gender — ${fmtDate(todayIST())}`} back={{ href: "/app/reports", label: "Reports" }}
        actions={<>{can("reports.udise.export") || can("reports.overview.export") ? <><a href="/app/reports/export?kind=udise" className="btn btn-sm btn-secondary">Strength CSV</a><a href="/app/reports/udise/students" className="btn btn-sm btn-secondary">Student-level sheet (CSV)</a></> : null}<PrintButton label="Print" /></>} />
      {U.length === 0 ? <Empty>No active students yet.</Empty> : (
        <div className="overflow-x-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse text-[13.5px]" style={{ minWidth: 640 + cats.length * 90 }}>
            <thead>
              <tr className="bg-blue-soft text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase">
                <th rowSpan={2} className="px-3 py-3 text-left font-bold">Class</th>
                {cats.map((c) => <th key={c} colSpan={2} className="border-l border-line px-2 py-2 text-center font-bold">{nice(c)}</th>)}
                <th colSpan={3} className="border-l border-line px-2 py-2 text-center font-bold">Total</th>
              </tr>
              <tr className="bg-blue-soft text-[11.5px] text-[#3d4f7a]">
                {cats.flatMap((c) => [<th key={`${c}b`} className="border-l border-line px-2 py-1.5 text-center">Boys</th>, <th key={`${c}g`} className="px-2 py-1.5 text-center">Girls</th>])}
                <th className="border-l border-line px-2 py-1.5 text-center">Boys</th><th className="px-2 py-1.5 text-center">Girls</th><th className="px-2 py-1.5 text-center">All</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((cl) => {
                const b = U.filter((u) => u.class_name === cl).reduce((t, u) => t + Number(u.boys), 0), g = U.filter((u) => u.class_name === cl).reduce((t, u) => t + Number(u.girls), 0);
                return (
                  <tr key={cl}>
                    <td className={`${td} font-bold text-ink`}>{cl}</td>
                    {cats.flatMap((c) => [<td key={`${c}b`} className={`${cell} border-l`}>{get(cl, c, "boys") || "–"}</td>, <td key={`${c}g`} className={cell}>{get(cl, c, "girls") || "–"}</td>])}
                    <td className={`${cell} border-l`}>{b}</td><td className={cell}>{g}</td><td className={`${cell} font-bold text-ink`}>{b + g}</td>
                  </tr>
                );
              })}
              <tr className="bg-[#f6f8fc] font-bold text-ink">
                <td className={td}>Total</td>
                {cats.flatMap((c) => [<td key={`${c}b`} className={`${cell} border-l`}>{classes.reduce((t, cl) => t + get(cl, c, "boys"), 0)}</td>, <td key={`${c}g`} className={cell}>{classes.reduce((t, cl) => t + get(cl, c, "girls"), 0)}</td>])}
                <td className={`${cell} border-l`}>{U.reduce((t, u) => t + Number(u.boys), 0)}</td><td className={cell}>{U.reduce((t, u) => t + Number(u.girls), 0)}</td><td className={cell}>{U.reduce((t, u) => t + Number(u.total), 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-[12.5px] text-muted print:hidden">Students whose gender is not recorded are counted only in the “All” column of the class they belong to.</p>
    </div>
  );
}
