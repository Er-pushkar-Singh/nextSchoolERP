import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { fmtDate, money, todayIST } from "@/lib/format";
import { monthName } from "@/lib/hr";
import { generatePayroll } from "../../_actions/hr";
import { savePayrollSettings } from "../../_actions/payroll2";

type Run = { id: string; month: string; status: string; approved_at: string | null; payslips: { net: number; paid_on: string | null }[] };

export default async function Payroll({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("hr.payroll.view");
  const sp = await searchParams;
  const [{ data }, { count: unset }, { data: cfg }] = await Promise.all([
    supabase.from("payroll_runs").select("id,month,status,approved_at,payslips(net,paid_on)").eq("school_id", school.id).order("month", { ascending: false }).limit(36),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("status", "active").eq("earnings", "[]"),
    supabase.from("payroll_settings").select("*").eq("school_id", school.id).maybeSingle(),
  ]);
  const slabs = ((cfg?.pt_slabs ?? [{ upto: 15000, amount: 0 }, { upto: null, amount: 200 }]) as { upto: number | null; amount: number }[]).slice(0, 4);
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
      {can("hr.payroll.view") && (
        <Card title="Rules" icon="payroll" description="Unpaid days from staff attendance, PF, ESI and professional tax are applied automatically on every payslip."
          actions={<Link href="/app/hr/advances" className="text-[13px] font-semibold">Salary advances →</Link>}>
          <form action={savePayrollSettings} className="flex flex-col gap-4">
            <fieldset disabled={!can("hr.payroll.edit")} className="m-0 flex flex-col gap-4 border-0 p-0">
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="use_attendance" value="1" defaultChecked={cfg?.use_attendance ?? true} />
                Take unpaid days from staff attendance (absent = 1 day, half day = 0.5; holidays are not working days)</label>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="grid gap-2 rounded-lg border border-line p-3">
                  <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" name="pf_on" value="1" defaultChecked={cfg?.pf_on ?? false} />Provident fund (PF)</label>
                  <Input label="Employee rate %" name="pf_rate" type="number" step="0.01" defaultValue={String(cfg?.pf_rate ?? 12)} />
                  <Input label="Wage ceiling ₹" name="pf_ceiling" type="number" defaultValue={String(cfg?.pf_ceiling ?? 15000)} hint="On basic pay; same rate for employer" />
                </div>
                <div className="grid gap-2 rounded-lg border border-line p-3">
                  <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" name="esi_on" value="1" defaultChecked={cfg?.esi_on ?? false} />ESI</label>
                  <Input label="Employee %" name="esi_rate" type="number" step="0.01" defaultValue={String(cfg?.esi_rate ?? 0.75)} />
                  <Input label="Employer %" name="esi_employer_rate" type="number" step="0.01" defaultValue={String(cfg?.esi_employer_rate ?? 3.25)} />
                  <Input label="Applies up to gross ₹" name="esi_ceiling" type="number" defaultValue={String(cfg?.esi_ceiling ?? 21000)} />
                </div>
                <div className="grid gap-2 rounded-lg border border-line p-3">
                  <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" name="pt_on" value="1" defaultChecked={cfg?.pt_on ?? false} />Professional tax</label>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="grid grid-cols-2 gap-2">
                      <Input label={i === 0 ? "Gross up to ₹" : "…up to ₹"} name={`slab_upto_${i}`} type="number" defaultValue={slabs[i]?.upto ?? ""} placeholder={i === slabs.length - 1 ? "(rest)" : ""} />
                      <Input label="Tax ₹" name={`slab_amount_${i}`} type="number" defaultValue={slabs[i]?.amount ?? ""} />
                    </div>
                  ))}
                  <p className="m-0 text-[11px] text-muted">Leave “up to” empty on the last slab for everyone above.</p>
                </div>
              </div>
              {can("hr.payroll.edit") && <div><Submit variant="secondary">Save rules</Submit></div>}
            </fieldset>
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
