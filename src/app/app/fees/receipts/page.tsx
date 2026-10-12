import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, PageHeader, Table, td } from "@/components/ui/ui";
import { fmtDate, fullName, money, todayIST } from "@/lib/format";

const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
type R = { id: string; receipt_no: string; paid_on: string; amount: number; mode: string; reference: string | null; collected_by: string | null; cancelled: boolean; students: { first_name: string; last_name: string | null; admission_no: string; classes: { name: string } | null } | null };

export default async function Receipts({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; mode?: string }> }) {
  const { supabase, school } = await requirePerm("fees.receipts.view");
  const sp = await searchParams;
  const today = todayIST();
  const from = valid(sp.from) ?? today.slice(0, 8) + "01";
  const to = valid(sp.to) ?? today;
  let q = supabase.from("fee_receipts").select("id,receipt_no,paid_on,amount,mode,reference,collected_by,cancelled,students(first_name,last_name,admission_no,classes(name))")
    .eq("school_id", school.id).gte("paid_on", from).lte("paid_on", to);
  if (sp.mode) q = q.eq("mode", sp.mode);
  const { data } = await q.order("paid_on", { ascending: false }).order("receipt_no", { ascending: false }).limit(1000);
  const rows = (data ?? []) as unknown as R[];
  const live = rows.filter((r) => !r.cancelled);
  const byMode = live.reduce<Record<string, number>>((m, r) => ({ ...m, [r.mode]: (m[r.mode] ?? 0) + Number(r.amount) }), {});
  const byDay = live.reduce<Record<string, number>>((m, r) => ({ ...m, [r.paid_on]: (m[r.paid_on] ?? 0) + Number(r.amount) }), {});
  const total = live.reduce((s, r) => s + Number(r.amount), 0);
  const qs = new URLSearchParams({ from, to, ...(sp.mode ? { mode: sp.mode } : {}) });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="billing" title="Receipts & collection report" subtitle={`${fmtDate(from)} – ${fmtDate(to)}`} back={{ href: "/app/fees", label: "Fees" }}
        actions={<a href={`/app/fees/receipts/export?${qs}`} className="btn btn-sm btn-secondary">Download CSV</a>} />
      <form className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-[13px] font-semibold">From<input type="date" name="from" defaultValue={from} className="input !min-h-10 !py-2" /></label>
        <label className="text-[13px] font-semibold">To<input type="date" name="to" defaultValue={to} className="input !min-h-10 !py-2" /></label>
        <label className="text-[13px] font-semibold">Mode
          <select name="mode" defaultValue={sp.mode ?? ""} className="input !min-h-10 !py-2"><option value="">All</option>{["cash", "upi", "cheque", "bank_transfer", "card", "online", "mixed", "wallet"].map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}</select>
        </label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        <Link href={`/app/fees/receipts?from=${today}&to=${today}`} className="text-[14px]">Today</Link>
      </form>
      <Card title={`Total ${money(total)} · ${live.length} receipts`}>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
          {Object.entries(byMode).map(([m, a]) => <span key={m}>{m.replace("_", " ").toUpperCase()}: <b className="text-ink">{money(a)}</b></span>)}
        </div>
        {Object.keys(byDay).length > 1 && (
          <details className="mt-2 text-[14px]"><summary className="cursor-pointer text-blue">Day-wise</summary>
            <ul className="m-0 mt-2 list-none p-0">{Object.entries(byDay).map(([d, a]) => <li key={d}>{fmtDate(d)}: <b>{money(a)}</b></li>)}</ul>
          </details>
        )}
      </Card>
      {rows.length ? (
        <Table head={["Receipt", "Date", "Student", "Class", "Mode", "Ref.", "By", "Amount"]}>
          {rows.map((r) => (
            <tr key={r.id} className={r.cancelled ? "opacity-60" : ""}>
              <td className={td}><Link href={`/app/fees/receipts/${r.id}`} className="font-mono text-[13px]">{r.receipt_no}</Link></td>
              <td className={td}>{fmtDate(r.paid_on)}</td>
              <td className={td}>{r.students ? fullName(r.students) : "—"}<div className="text-[12px] text-muted">{r.students?.admission_no}</div></td>
              <td className={td}>{r.students?.classes?.name ?? "—"}</td>
              <td className={td}>{r.mode.replace("_", " ")}</td>
              <td className={td}>{r.reference ?? ""}</td>
              <td className={td}>{r.collected_by ?? ""}</td>
              <td className={`${td} font-semibold text-ink`}>{r.cancelled ? <Badge value="cancelled" /> : money(r.amount)}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No receipts in this period.</Empty>}
    </div>
  );
}
