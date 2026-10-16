import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { fmtDate, money, todayIST } from "@/lib/format";
import { monthName } from "@/lib/hr";
import { deleteRun, markPaid, setRunStatus, updatePayslip } from "../../../_actions/hr";

type Slip = {
  id: string; staff_id: string; working_days: number; lop_days: number; gross: number; total_deductions: number; adjustment: number; adjustment_note: string | null;
  net: number; paid_on: string | null; pay_mode: string | null; pay_ref: string | null;
  att_lop: number; advance_recovery: number; pf_employee: number; esi_employee: number; prof_tax: number; employer_pf: number; employer_esi: number;
  staff: { name: string; emp_code: string | null; designation: string | null; bank_account: string | null; ifsc: string | null } | null;
};
const MODES: [string, string][] = [["bank_transfer", "Bank transfer"], ["cash", "Cash"], ["cheque", "Cheque"], ["upi", "UPI"]];

export default async function PayrollRun({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("hr.payroll.view");
  const sp = await searchParams;
  const { data: run } = await supabase.from("payroll_runs").select("id,month,status,approved_at").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!run) notFound();
  // totals and the staff-name order come from a light list of the whole run; only one page of full rows is loaded
  const { page, size, offset } = pageParams(sp, 25, [25, 50, 100]);
  const { data: light } = await supabase.from("payslips").select("id,gross,total_deductions,net,paid_on,staff(name)").eq("run_id", id).eq("school_id", school.id).limit(5000);
  const L = ((light ?? []) as unknown as { id: string; gross: number; total_deductions: number; net: number; paid_on: string | null; staff: { name: string } | { name: string }[] | null }[])
    .map((x) => ({ ...x, name: (Array.isArray(x.staff) ? x.staff[0]?.name : x.staff?.name) ?? "" })).sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
  const pageIds = L.slice(offset, offset + size).map((x) => x.id);
  const { data } = pageIds.length ? await supabase.from("payslips")
    .select("id,staff_id,working_days,lop_days,gross,total_deductions,adjustment,adjustment_note,net,paid_on,pay_mode,pay_ref,att_lop,advance_recovery,pf_employee,esi_employee,prof_tax,employer_pf,employer_esi,staff(name,emp_code,designation,bank_account,ifsc)")
    .in("id", pageIds) : { data: [] };
  const order = new Map(pageIds.map((x, i) => [x, i]));
  const P = ((data ?? []) as unknown as Slip[]).sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
  const draft = run.status === "draft";
  const editable = draft && can("hr.payroll.edit");
  const sum = (k: "gross" | "total_deductions" | "net") => L.reduce((t, p) => t + Number(p[k]), 0);
  const unpaid = L.filter((p) => !p.paid_on);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="payroll" title={`Payroll · ${monthName(run.month)}`} back={{ href: "/app/hr/payroll", label: "Payroll" }}
        subtitle={<><Badge value={draft ? "draft" : "paid"} text={draft ? "Draft — can be changed" : `Approved ${fmtDate(run.approved_at)} — locked`} /> {L.length} payslips</>}
        actions={<>
          {can("hr.payroll.export") && <a href={`/app/hr/payroll/${id}/export`} className="btn btn-sm btn-secondary">Bank sheet (CSV)</a>}
          {can("hr.payroll.export") && <a href={`/app/hr/payroll/${id}/statutory`} className="btn btn-sm btn-secondary">PF / ESI / PT (CSV)</a>}
          {can("hr.payroll.approve") && (
            <form action={setRunStatus}>
              <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={draft ? "approved" : "draft"} />
              <Submit>{draft ? "Approve & lock" : "Reopen"}</Submit>
            </form>
          )}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross" value={money(sum("gross"))} icon="payroll" />
        <Stat label="Deductions" value={money(sum("total_deductions"))} icon="payroll" tone="amber" />
        <Stat label="Net payable" value={money(sum("net"))} icon="payroll" tone="green" />
        <Stat label="Still to pay" value={money(unpaid.reduce((t, p) => t + Number(p.net), 0))} hint={`${unpaid.length} people`} icon="payroll" tone={unpaid.length ? "rose" : "green"} />
      </div>

      <form id="paid" action={markPaid} />
      <Table head={["", "Staff", "Days paid", "Gross", "Deductions", "Adjustment", "Net pay", "Paid", ""]} minWidth={980}>
        {P.map((p) => (
          <tr key={p.id}>
            <td className={td}>{!draft && !p.paid_on && can("hr.payroll.edit") && <input type="checkbox" name="ids" value={p.id} form="paid" defaultChecked aria-label={`Paid ${p.staff?.name}`} className="h-4 w-4" />}</td>
            <td className={td}><Link href={`/app/hr/staff/${p.staff_id}`} className="font-semibold">{p.staff?.name}</Link><div className="text-[12px] text-muted">{[p.staff?.emp_code, p.staff?.designation].filter(Boolean).join(" · ")}</div></td>
            <td className={td}>{Number(p.working_days) - Number(p.lop_days)}/{p.working_days}{Number(p.lop_days) > 0 && <div className="text-[12px] text-error">{Number(p.lop_days)} unpaid{Number(p.att_lop) > 0 ? ` (${Number(p.att_lop)} from attendance)` : ""}</div>}</td>
            <td className={td}>{money(p.gross)}</td>
            <td className={td}>{money(p.total_deductions)}
              {(Number(p.pf_employee) > 0 || Number(p.esi_employee) > 0 || Number(p.prof_tax) > 0 || Number(p.advance_recovery) > 0) && (
                <div className="text-[11px] text-muted">{[Number(p.pf_employee) > 0 && `PF ${p.pf_employee}`, Number(p.esi_employee) > 0 && `ESI ${p.esi_employee}`, Number(p.prof_tax) > 0 && `PT ${p.prof_tax}`, Number(p.advance_recovery) > 0 && `Adv ${p.advance_recovery}`].filter(Boolean).join(" · ")}</div>
              )}
            </td>
            <td className={td}>{Number(p.adjustment) ? money(p.adjustment) : "—"}{p.adjustment_note && <div className="text-[12px] text-muted">{p.adjustment_note}</div>}</td>
            <td className={`${td} font-bold text-ink`}>{money(p.net)}</td>
            <td className={`${td} text-[13px]`}>{p.paid_on ? <>{fmtDate(p.paid_on)}<div className="text-muted">{MODES.find((m) => m[0] === p.pay_mode)?.[1]}{p.pay_ref ? ` · ${p.pay_ref}` : ""}</div></> : <span className="text-muted">—</span>}</td>
            <td className={`${td} whitespace-nowrap`}>
              <Link href={`/app/hr/payroll/slip/${p.id}`} className="text-[13px]">Payslip</Link>
              {editable && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[13px] text-blue">Change</summary>
                  <form action={updatePayslip} className="mt-2 grid w-56 gap-2">
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="run_id" value={id} />
                    <Input label="Unpaid days" name="lop_days" type="number" step="0.5" min={0} max={p.working_days} defaultValue={Number(p.lop_days)} />
                    <Input label="Adjustment ₹ (+ bonus / − recovery)" name="adjustment" type="number" step="0.01" defaultValue={Number(p.adjustment)} />
                    <Input label="Adjustment note" name="adjustment_note" defaultValue={p.adjustment_note} />
                    <Submit>Save</Submit>
                  </form>
                </details>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <Pagination total={L.length} page={page} size={size} basePath={`/app/hr/payroll/${id}`} params={{}} />

      {!draft && unpaid.length > 0 && can("hr.payroll.edit") && (
        <Card title="Record salary payment" description="For the ticked rows on this page — or tick the box below for every unpaid payslip of the month (all pages).">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Paid on<input form="paid" name="paid_on" type="date" defaultValue={todayIST()} className="input !min-h-10 !py-2 text-[15px] font-normal" /></label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Mode
              <select form="paid" name="pay_mode" defaultValue="bank_transfer" className="input !min-h-10 !py-2 text-[15px] font-normal">{MODES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Reference (UTR / cheque no.)<input form="paid" name="pay_ref" className="input !min-h-10 !py-2 text-[15px] font-normal" /></label>
            <label className="flex items-center gap-2 text-[14px] sm:col-span-4"><input form="paid" type="checkbox" name="all_unpaid" value="1" /> Mark all {unpaid.length} unpaid payslips of this month as paid (ignores the ticks)</label>
            <div className="flex items-end"><button form="paid" name="run_id" value={id} className="btn btn-sm btn-primary cursor-pointer">Mark paid</button></div>
          </div>
        </Card>
      )}
      {draft && can("hr.payroll.approve") && <p className="m-0 text-[13px] text-muted">Check the payslips, then <b>Approve &amp; lock</b>. After approval staff see their payslip and you can record the payment.</p>}
      {draft && can("hr.payroll.edit") && (
        <form action={deleteRun}><input type="hidden" name="id" value={id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Delete this draft</button></form>
      )}
      {!L.length && <p className="m-0 text-[14px] text-muted">No payslips — set salary structures on staff records and run the payroll again.</p>}
    </div>
  );
}
