import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { fmtDate, money, todayIST } from "@/lib/format";
import { monthName } from "@/lib/hr";
import { generatePayroll } from "../../_actions/hr";

type Run = { id: string; month: string; status: string; approved_at: string | null; payslips: { net: number; paid_on: string | null }[] };

export default async function Payroll({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("hr.payroll.view");
  const sp = await searchParams;
  const [{ data }, { count: unset }] = await Promise.all([
    supabase.from("payroll_runs").select("id,month,status,approved_at,payslips(net,paid_on)").eq("school_id", school.id).order("month", { ascending: false }).limit(36),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("status", "active").eq("earnings", "[]"),
  ]);
  const R = (data ?? []) as Run[];
  const thisMonth = todayIST().slice(0, 7);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="payroll" title="Payroll" subtitle="Monthly salaries from each person's salary structure, minus unpaid leave" back={{ href: "/app/hr", label: "Staff" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {(unset ?? 0) > 0 && (
        <p role="note" className="m-0 rounded-[12px] border border-[#f1d39a] bg-[#fff4e0] px-4 py-3 text-[14px] text-[#7a4b00]">
          {unset} working staff member{unset === 1 ? " has" : "s have"} no salary structure and will be left out. <Link href="/app/hr">Open the staff list</Link> to set it.
        </p>
      )}
      {can("hr.payroll.create") && (
        <Card title="Run payroll" icon="payroll" description="Creates a payslip for every working staff member. Running it again for a draft month recalculates the unpaid payslips.">
          <form action={generatePayroll} className="grid gap-3 sm:grid-cols-4">
            <Input label="Month" name="month" type="month" required defaultValue={thisMonth} />
            <Input label="Working days" name="working_days" type="number" min={1} max={31} hint="Blank = days in the month" />
            <div className="flex items-end"><Submit>Calculate payslips</Submit></div>
          </form>
        </Card>
      )}
      {R.length ? (
        <Table head={["Month", "Staff", "Net payable", "Paid", "Status", ""]} minWidth={640}>
          {R.map((r) => {
            const net = r.payslips.reduce((t, p) => t + Number(p.net), 0);
            const paid = r.payslips.filter((p) => p.paid_on);
            return (
              <tr key={r.id}>
                <td className={td}><Link href={`/app/hr/payroll/${r.id}`} className="font-semibold">{monthName(r.month)}</Link></td>
                <td className={td}>{r.payslips.length}</td>
                <td className={td}>{money(net)}</td>
                <td className={td}>{paid.length}/{r.payslips.length}</td>
                <td className={td}><Badge value={r.status === "approved" ? (paid.length === r.payslips.length ? "paid" : "sent") : "draft"} text={r.status === "approved" ? (paid.length === r.payslips.length ? "Paid" : "Approved") : "Draft"} /></td>
                <td className={`${td} text-[13px] text-muted`}>{r.approved_at ? `approved ${fmtDate(r.approved_at)}` : ""}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No payroll yet.</Empty>}
    </div>
  );
}
