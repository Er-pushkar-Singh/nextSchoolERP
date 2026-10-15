import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { fmtDate, money, todayIST, addDays } from "@/lib/format";
import { cancelSale } from "../../_actions/inventory";

type Row = { id: string; no: string; on_date: string; kind: string; customer_name: string | null; student_id: string | null; admission_no: string | null; class_name: string | null; total: number;
  mode: string; status: string; items: string | null; fee_paid: number | null; by_name: string | null; cancelled_reason: string | null; total_rows: number };
const MODE: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", cheque: "Cheque", bank_transfer: "Bank transfer", fee_account: "Fee account" };

export default async function Sales({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("inventory.sales.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const today = todayIST();
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const from = ok(sp.from) ?? addDays(today, -29), to = ok(sp.to) ?? today;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const status = ["paid", "on_fee_account", "cancelled"].includes(sp.status ?? "") ? sp.status! : null;
  const { data } = await supabase.rpc("inventory_sale_list", { sid: school.id, p_q: q || null, p_from: from, p_to: to, p_status: status, p_limit: size, p_offset: offset });
  const R = (data ?? []) as Row[];
  const total = R[0] ? Number(R[0].total_rows) : 0;
  const sum = R.filter((r) => r.status !== "cancelled").reduce((t, r) => t + Number(r.total), 0);
  const params = { from: from === addDays(today, -29) ? undefined : from, to: to === today ? undefined : to, q: q || undefined, status: status ?? undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `/app/inventory/sales${qs ? `?${qs}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Sales" subtitle={`${total} bill${total === 1 ? "" : "s"} · ${money(sum)} on this page`} back={{ href: "/app/inventory", label: "Inventory" }}
        actions={can("inventory.sales.create") ? <Link href="/app/inventory/sell" className="btn btn-sm btn-primary">+ New bill</Link> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <Input label="From" name="from" type="date" defaultValue={from} /><Input label="To" name="to" type="date" defaultValue={to} />
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Bill no., student, admission no., phone" className="input !min-h-10 w-64 !py-2 text-[15px] font-normal" /></label>
        <Select label="Status" name="status" blank="Any" defaultValue={status} options={[["paid", "Paid"], ["on_fee_account", "On fee account"], ["cancelled", "Cancelled"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {R.length ? (
        <Table head={["Bill", "Customer", "Items", "Total", "Paid by", "Status", ""]} minWidth={980}>
          {R.map((s) => (
            <tr key={s.id} className={s.status === "cancelled" ? "opacity-60" : ""}>
              <td className={td}><Link href={`/app/inventory/sales/${s.id}`} className="font-mono text-[13px] font-semibold">{s.no}</Link><div className="text-[12px] text-muted">{fmtDate(s.on_date)}</div></td>
              <td className={td}>{s.student_id ? <Link href={`/app/students/${s.student_id}`} className="font-semibold">{s.customer_name}</Link> : <b className="text-ink">{s.customer_name ?? "Walk-in"}</b>}
                <div className="text-[12px] text-muted">{s.admission_no ? `${s.admission_no} · ${s.class_name ?? ""}` : s.kind === "staff" ? "Staff" : "Walk-in"}</div></td>
              <td className={`${td} max-w-[300px] text-[13.5px]`}>{s.items}</td>
              <td className={`${td} font-semibold text-ink`}>{money(s.total)}</td>
              <td className={td}>{MODE[s.mode] ?? s.mode}</td>
              <td className={td}>
                {s.status === "cancelled" ? <><Badge value="cancelled" text="Cancelled" /><div className="mt-1 text-[12px] text-muted">{s.cancelled_reason}</div></>
                  : s.status === "on_fee_account" ? <><Badge value={Number(s.fee_paid ?? 0) >= Number(s.total) ? "paid" : "pending"} text={Number(s.fee_paid ?? 0) >= Number(s.total) ? "Paid via fees" : "On fee account"} />
                    {Number(s.fee_paid ?? 0) > 0 && Number(s.fee_paid) < Number(s.total) && <div className="mt-1 text-[12px] text-muted">{money(s.fee_paid)} paid</div>}</>
                  : <Badge value="paid" text="Paid" />}
              </td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>
                <div className="flex flex-col items-start gap-1">
                  <Link href={`/app/inventory/sales/${s.id}`}>Receipt</Link>
                  {s.status !== "cancelled" && can("inventory.sales.edit") && (
                    <Modal label="Cancel" variant="link" title={`Cancel ${s.no}`} size="sm">
                      <p className="mt-0 text-[13px] text-muted">The items go back into stock{s.status === "on_fee_account" ? " and the charge is removed from the student's fees" : " and the day-book entry is cancelled"}.</p>
                      <form action={cancelSale} className="flex flex-col gap-3">
                        <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={s.id} />
                        <Textarea label="Reason" name="reason" rows={2} />
                        <Submit>Cancel this sale</Submit>
                      </form>
                    </Modal>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No bills in this period.</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/inventory/sales" params={params} />
    </div>
  );
}
