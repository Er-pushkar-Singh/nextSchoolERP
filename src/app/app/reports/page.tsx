import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader, Stat } from "@/components/ui/ui";
import { BarChart, Donut, HBars, LineChart } from "@/components/ui/charts";
import { ReportBar } from "@/components/ui/ReportBar";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, money, todayIST } from "@/lib/format";
import { reportRange } from "@/lib/report-range";

type O = {
  students: number; boys: number; girls: number; admitted: number; left: number; staff: number; teaching: number; student_att_pct: number | null; staff_att_pct: number | null;
  fee_billed: number; fee_collected: number; fee_outstanding: number; fee_collection_pct: number | null; defaulters: number; last_exam: string | null; last_exam_avg: number | null; last_exam_pass: number | null;
  library_issues: number; library_overdue: number; health_visits: number; incidents: number; hostel_beds: number; hostel_occupied: number; transport_riders: number; visitors: number;
};
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]}`;

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, session, can } = await requirePerm("reports.overview.view");
  const sp = await searchParams;
  const today = todayIST();
  const range = reportRange(sp, today, session?.start_date);
  const [{ data: ov }, { data: trend }, { data: monthly }, { data: ageing }, { data: byClass }] = await Promise.all([
    supabase.rpc("report_overview", { sid: school.id, d1: range.d1, d2: range.d2 }),
    supabase.rpc("report_attendance_trend", { sid: school.id, d1: range.d1, d2: range.d2 }),
    supabase.rpc("report_fee_monthly", { sid: school.id, p_months: 6 }),
    supabase.rpc("report_defaulter_ageing", { sid: school.id }),
    supabase.rpc("report_attendance_by_class", { sid: school.id, d1: range.d1, d2: range.d2 }),
  ]);
  const o = (ov ?? {}) as O;
  const T = (trend ?? []) as { day: string; pct: number }[];
  const M = (monthly ?? []) as { month: string; billed: number; collected: number }[];
  const G = (ageing ?? []) as { bucket: string; students: number; amount: number }[];
  const C = ((byClass ?? []) as { class_name: string; pct: number | null; low_students: number }[]).filter((c) => c.pct !== null);
  const lowest = [...C].sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="reports" title="Principal dashboard" subtitle={`${fmtDate(range.d1)} – ${fmtDate(range.d2)} · ${school.name}`}
        actions={<PrintButton label="Print" />} />
      <Flash ok={sp.ok} error={sp.error} />
      <ReportBar basePath="/app/reports" range={range} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Students on roll" value={o.students ?? 0} hint={`${o.boys ?? 0} boys · ${o.girls ?? 0} girls`} icon="students" href="/app/reports/enrolment" />
        <Stat label="Attendance" value={pct(o.student_att_pct)} hint={o.staff_att_pct !== null && o.staff_att_pct !== undefined ? `Staff ${o.staff_att_pct}%` : undefined} icon="attendance" tone="green" href="/app/reports/attendance" />
        <Stat label="Fees collected" value={money(o.fee_collected ?? 0)} hint={`${pct(o.fee_collection_pct)} of this session's bills`} icon="fees" tone="violet" href="/app/reports/fees" />
        <Stat label="Overdue fees" value={money(o.fee_outstanding ?? 0)} hint={`${o.defaulters ?? 0} students`} icon="notifications" tone={o.fee_outstanding ? "rose" : "green"} href="/app/reports/fees" />
        <Stat label="New admissions" value={o.admitted ?? 0} hint={`${o.left ?? 0} left`} icon="admissions" tone="cyan" />
        <Stat label="Staff" value={o.staff ?? 0} hint={`${o.teaching ?? 0} teaching`} icon="hr" tone="amber" />
        <Stat label={o.last_exam ? `Last exam: ${o.last_exam}` : "Last exam"} value={pct(o.last_exam_avg)} hint={o.last_exam_pass !== null && o.last_exam_pass !== undefined ? `${o.last_exam_pass}% passed` : "No result declared yet"}
          icon="exams" tone="blue" href={can("reports.academic.view") ? "/app/reports/academics" : undefined} />
        <Stat label="Visitors" value={o.visitors ?? 0} icon="admissions" tone="cyan" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Student attendance" description="Present % each day in the period" className="lg:col-span-2">
          {T.length ? <LineChart data={T.map((t) => ({ label: short(t.day), value: Number(t.pct) }))} min={0} max={100} format={(n) => `${Math.round(n)}%`} color="#16a34a" /> : <p className="m-0 text-[13px] text-muted">No attendance was marked in this period.</p>}
        </Card>
        <Card title="Lowest attendance classes" description="Needs a conversation with the class teacher">
          <HBars data={lowest.map((c) => ({ label: `Class ${c.class_name}`, value: Number(c.pct), hint: c.low_students ? `${c.low_students} below 75%` : undefined }))} format={(n) => `${n}%`} max={100} color="#e11d48" />
        </Card>
        <Card title="Billed vs collected" description="Last 6 months" className="lg:col-span-2">
          <BarChart data={M.map((m) => ({ label: new Date(m.month).toLocaleString("en-IN", { month: "short", timeZone: "UTC" }), value: Number(m.billed), value2: Number(m.collected) }))} names={["Billed", "Collected"]} format={(n) => (n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))} colors={["#94a3b8", "#16a34a"]} />
        </Card>
        <Card title="Overdue by age" description="Fees past their due date">
          {G.length ? <HBars data={G.map((g) => ({ label: g.bucket, value: Number(g.amount), hint: `${g.students} students` }))} format={(n) => money(n)} color="#d97706" /> : <p className="m-0 text-[13px] text-muted">Nothing is overdue.</p>}
        </Card>
        <Card title="Boys and girls">
          <Donut size={120} data={[{ label: "Boys", value: o.boys ?? 0, color: "#2563eb" }, { label: "Girls", value: o.girls ?? 0, color: "#ec4899" }, { label: "Other", value: Math.max(0, (o.students ?? 0) - (o.boys ?? 0) - (o.girls ?? 0)), color: "#94a3b8" }].filter((d) => d.value > 0)} />
        </Card>
        <Card title="Around the school" description="In the period" className="lg:col-span-2">
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-3">
            {([
              ["Library issues", o.library_issues, "/app/library"], ["Books overdue now", o.library_overdue, "/app/library?state=overdue"], ["Medical-room visits", o.health_visits, "/app/health"],
              ["Discipline incidents", o.incidents, "/app/discipline"], ["Hostel beds used", o.hostel_beds ? `${o.hostel_occupied} / ${o.hostel_beds}` : "—", "/app/hostel"], ["Transport riders", o.transport_riders, "/app/transport/students"],
            ] as [string, number | string, string][]).map(([k, v, h]) => (
              <div key={k}><dt className="text-[12.5px] text-muted">{k}</dt><dd className="m-0 text-[20px] font-extrabold text-ink"><Link href={h} className="no-underline">{v ?? 0}</Link></dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
