import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { fmtDate, money, todayIST } from "@/lib/format";
import { addAdvance, cancelAdvance } from "../../_actions/payroll2";

type Row = { id: string; amount: number; monthly_emi: number; balance: number; taken_on: string; reason: string | null; status: string; created_by_name: string | null;
  staff: { name: string; emp_code: string | null } | { name: string; emp_code: string | null }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function Advances({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("hr.payroll.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const status = ["active", "closed", "cancelled"].includes(sp.status ?? "") ? sp.status! : "active";
  const [{ data, count }, { data: staff }, { data: act }] = await Promise.all([
    supabase.from("staff_advances").select("*,staff(name,emp_code)", { count: "exact" }).eq("school_id", school.id).eq("status", status).order("taken_on", { ascending: false }).range(offset, offset + size - 1),
    can("hr.payroll.create") ? supabase.from("staff").select("id,name,emp_code").eq("school_id", school.id).eq("status", "active").order("name") : Promise.resolve({ data: [] }),
    supabase.from("staff_advances").select("balance,monthly_emi").eq("school_id", school.id).eq("status", "active"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const outstanding = (act ?? []).reduce((t, a) => t + Number(a.balance), 0);
  const monthly = (act ?? []).reduce((t, a) => t + Math.min(Number(a.monthly_emi), Number(a.balance)), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="payroll" title="Salary advances" subtitle="Given now, recovered in monthly instalments through payroll" back={{ href: "/app/hr/payroll", label: "Payroll" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Outstanding" value={money(outstanding)} icon="payroll" tone="amber" />
        <Stat label="Next month's recovery" value={money(monthly)} icon="payroll" tone="blue" />
        <Stat label="Open advances" value={(act ?? []).length} icon="payroll" tone="violet" />
      </div>
      {can("hr.payroll.create") && (
        <Card title="Record an advance">
          <form action={addAdvance} className="grid gap-3 sm:grid-cols-5">
            <Select label="Staff" name="staff_id" options={(staff ?? []).map((s) => [s.id, `${s.name}${s.emp_code ? ` (${s.emp_code})` : ""}`] as [string, string])} />
            <Input label="Amount ₹" name="amount" type="number" min={1} step="0.01" required />
            <Input label="Monthly recovery ₹" name="monthly_emi" type="number" min={1} step="0.01" required />
            <Input label="Given on" name="taken_on" type="date" defaultValue={todayIST()} />
            <Input label="Reason" name="reason" />
            <div className="sm:col-span-5"><Submit>Save advance</Submit></div>
          </form>
        </Card>
      )}
      <form className="flex items-end gap-2">
        <Select label="Show" name="status" defaultValue={status} options={[["active", "Open"], ["closed", "Fully recovered"], ["cancelled", "Cancelled"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {rows.length ? (
        <Table head={["Staff", "Given", "Advance", "Instalment", "Balance", "Status", ""]} minWidth={780}>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className={td}><b className="text-ink">{one(a.staff)?.name}</b><div className="text-[12px] text-muted">{one(a.staff)?.emp_code ?? ""}</div></td>
              <td className={`${td} whitespace-nowrap`}>{fmtDate(a.taken_on)}<div className="text-[12px] text-muted">{a.reason ?? ""}</div></td>
              <td className={td}>{money(a.amount)}</td>
              <td className={td}>{money(a.monthly_emi)}</td>
              <td className={td}><b>{money(a.balance)}</b></td>
              <td className={td}><Badge value={a.status === "active" ? "pending" : a.status === "closed" ? "paid" : "cancelled"} text={a.status === "active" ? "Open" : a.status === "closed" ? "Recovered" : "Cancelled"} /></td>
              <td className={td}>{a.status === "active" && Number(a.balance) === Number(a.amount) && can("hr.payroll.edit") && (
                <form action={cancelAdvance}><input type="hidden" name="id" value={a.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Cancel</button></form>
              )}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No advances here.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/hr/advances" params={{ status }} />
    </div>
  );
}
