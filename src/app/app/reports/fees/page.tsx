import { requirePerm } from "@/lib/school";
import { Card, Empty, PageHeader, Stat, td } from "@/components/ui/ui";
import { BarChart, Donut, HBars } from "@/components/ui/charts";
import { ReportBar } from "@/components/ui/ReportBar";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, label, money, todayIST } from "@/lib/format";
import { reportRange } from "@/lib/report-range";

type Cl = { class_id: string; class_name: string; students: number; billed: number; paid: number; outstanding: number; overdue: number; pct: number | null };
type Mo = { month: string; billed: number; collected: number; receipts: number };
type Ag = { bucket: string; students: number; amount: number };
type Md = { mode: string; amount: number; payments: number };

export default async function FeeReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, session, can } = await requirePerm("reports.fees.view", "reports.overview.view");
  const sp = await searchParams;
  const range = reportRange(sp, todayIST(), session?.start_date);
  const [{ data: cl }, { data: mo }, { data: ag }, { data: md }] = await Promise.all([
    supabase.rpc("report_fee_by_class", { sid: school.id }),
    supabase.rpc("report_fee_monthly", { sid: school.id, p_months: 12 }),
    supabase.rpc("report_defaulter_ageing", { sid: school.id }),
    supabase.rpc("report_collection_by_mode", { sid: school.id, d1: range.d1, d2: range.d2 }),
  ]);
  const C = (cl ?? []) as Cl[], M = (mo ?? []) as Mo[], A = (ag ?? []) as Ag[], P = (md ?? []) as Md[];
  const billed = C.reduce((t, c) => t + Number(c.billed), 0), paid = C.reduce((t, c) => t + Number(c.paid), 0);
  const overdue = C.reduce((t, c) => t + Number(c.overdue), 0), out = C.reduce((t, c) => t + Number(c.outstanding), 0);
  const collected = P.reduce((t, p) => t + Number(p.amount), 0);
  const cell = "border-t border-line px-3 py-2 text-right tabular-nums";
  const month = (m: string) => new Date(m).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="reports" title="Fee collection" subtitle={`This session's bills, and collection ${fmtDate(range.d1)} – ${fmtDate(range.d2)}`} back={{ href: "/app/reports", label: "Reports" }}
        actions={<><PrintButton label="Print" /></>} />
      <ReportBar basePath="/app/reports/fees" range={range} exportKind={can("reports.fees.export") ? "fees" : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Billed this session" value={money(billed)} icon="fees" />
        <Stat label="Received against bills" value={money(paid)} hint={billed ? `${Math.round((100 * paid) / billed)}% of billed` : undefined} icon="revenue" tone="green" />
        <Stat label="Outstanding" value={money(out)} hint={`${money(overdue)} past due date`} icon="notifications" tone={overdue ? "rose" : "green"} href="/app/fees/defaulters" />
        <Stat label="Collected in the period" value={money(collected)} hint={`${P.reduce((t, p) => t + Number(p.payments), 0)} payments`} icon="card" tone="violet" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Billed vs collected by month" description="Last 12 months" className="lg:col-span-2">
          <BarChart data={M.map((m) => ({ label: month(m.month), value: Number(m.billed), value2: Number(m.collected) }))} names={["Billed (due that month)", "Collected"]} colors={["#94a3b8", "#16a34a"]}
            format={(n) => (n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))} />
        </Card>
        <Card title="How parents paid" description="In the period">
          {P.length ? <Donut size={120} data={P.map((p) => ({ label: label(p.mode), value: Math.round(Number(p.amount)) }))} /> : <p className="m-0 text-[13px] text-muted">No payments in this period.</p>}
        </Card>
        <Card title="Overdue by age">
          {A.length ? <HBars data={A.map((a) => ({ label: a.bucket, value: Number(a.amount), hint: `${a.students} students` }))} format={(n) => money(n)} color="#d97706" /> : <p className="m-0 text-[13px] text-muted">Nothing is overdue.</p>}
        </Card>
      </div>
      {C.length === 0 ? <Empty>No fee has been billed this session.</Empty> : (
        <div className="overflow-x-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse text-[14px]" style={{ minWidth: 760 }}>
            <thead><tr className="bg-blue-soft text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase">
              {["Class", "Students", "Billed", "Received", "Outstanding", "Past due", "Collected %"].map((h, i) => <th key={h} className={`px-3 py-3 font-bold ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr></thead>
            <tbody>
              {C.map((c) => (
                <tr key={c.class_id}>
                  <td className={`${td} font-bold text-ink`}>{c.class_name}</td><td className={cell}>{c.students}</td><td className={cell}>{money(c.billed)}</td><td className={cell}>{money(c.paid)}</td>
                  <td className={cell}>{money(c.outstanding)}</td><td className={`${cell} ${Number(c.overdue) > 0 ? "font-bold text-error" : ""}`}>{money(c.overdue)}</td>
                  <td className={cell}>{c.pct === null ? "—" : `${c.pct}%`}</td>
                </tr>
              ))}
              <tr className="bg-[#f6f8fc] font-bold text-ink">
                <td className={td}>Total</td><td className={cell}>{C.reduce((t, c) => t + Number(c.students), 0)}</td><td className={cell}>{money(billed)}</td><td className={cell}>{money(paid)}</td>
                <td className={cell}>{money(out)}</td><td className={cell}>{money(overdue)}</td><td className={cell}>{billed ? `${Math.round((1000 * paid) / billed) / 10}%` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
