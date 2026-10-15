import { requirePerm } from "@/lib/school";
import { Card, Empty, PageHeader, Stat, td } from "@/components/ui/ui";
import { LineChart, HBars } from "@/components/ui/charts";
import { ReportBar } from "@/components/ui/ReportBar";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, todayIST } from "@/lib/format";
import { reportRange } from "@/lib/report-range";

type C = { class_id: string; class_name: string; students: number; marked: number; present: number; absent: number; pct: number | null; low_students: number };
type T = { day: string; present: number; absent: number; marked: number; pct: number };

export default async function AttendanceReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, session, can } = await requirePerm("reports.overview.view", "reports.academic.view");
  const sp = await searchParams;
  const range = reportRange(sp, todayIST(), session?.start_date);
  const [{ data: byClass }, { data: trend }] = await Promise.all([
    supabase.rpc("report_attendance_by_class", { sid: school.id, d1: range.d1, d2: range.d2 }),
    supabase.rpc("report_attendance_trend", { sid: school.id, d1: range.d1, d2: range.d2 }),
  ]);
  const C = (byClass ?? []) as C[];
  const T = (trend ?? []) as T[];
  const present = C.reduce((t, c) => t + Number(c.present), 0), marked = C.reduce((t, c) => t + Number(c.marked), 0);
  const low = C.reduce((t, c) => t + Number(c.low_students), 0);
  const worstDay = [...T].sort((a, b) => Number(a.pct) - Number(b.pct))[0];
  const d = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
  const cell = "border-t border-line px-3 py-2 text-right tabular-nums";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="reports" title="Attendance report" subtitle={`${fmtDate(range.d1)} – ${fmtDate(range.d2)}`} back={{ href: "/app/reports", label: "Reports" }} actions={<PrintButton label="Print" />} />
      <ReportBar basePath="/app/reports/attendance" range={range} exportKind={can("reports.overview.export") ? "attendance" : undefined} />
      {marked === 0 ? <Empty>No attendance was marked in this period.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Overall attendance" value={`${marked ? Math.round((1000 * present) / marked) / 10 : 0}%`} icon="attendance" tone="green" />
            <Stat label="Days marked" value={T.length} icon="layers" />
            <Stat label="Students below 75%" value={low} icon="notifications" tone={low ? "rose" : "green"} href="/app/attendance/low" />
            <Stat label="Weakest day" value={worstDay ? `${worstDay.pct}%` : "—"} hint={worstDay ? fmtDate(worstDay.day) : undefined} icon="attendance" tone="amber" />
          </div>
          <Card title="Present % by day"><LineChart data={T.map((t) => ({ label: d(t.day), value: Number(t.pct) }))} min={0} max={100} format={(n) => `${Math.round(n)}%`} color="#16a34a" /></Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Classes, best to weakest" className="lg:col-span-1">
              <HBars data={[...C].filter((c) => c.pct !== null).sort((a, b) => Number(b.pct) - Number(a.pct)).map((c) => ({ label: `Class ${c.class_name}`, value: Number(c.pct) }))} format={(n) => `${n}%`} max={100} color="#2563eb" />
            </Card>
            <div className="overflow-x-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)] lg:col-span-2">
              <table className="w-full border-collapse text-[14px]" style={{ minWidth: 520 }}>
                <thead><tr className="bg-blue-soft text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase">
                  {["Class", "Students", "Present", "Absent", "%", "Below 75%"].map((h, i) => <th key={h} className={`px-3 py-3 font-bold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {C.map((c) => (
                    <tr key={c.class_id}>
                      <td className={`${td} font-bold text-ink`}>{c.class_name}</td><td className={cell}>{c.students}</td><td className={cell}>{c.present}</td><td className={cell}>{c.absent}</td>
                      <td className={`${cell} font-bold ${c.pct !== null && Number(c.pct) < 75 ? "text-error" : "text-ink"}`}>{c.pct === null ? "—" : `${c.pct}%`}</td><td className={cell}>{c.low_students || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
