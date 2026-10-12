import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Stat, Submit, Table, td } from "@/components/ui/ui";
import { addDays, fmtDate, fullName, money, todayIST } from "@/lib/format";
import { MODE_LABEL } from "@/lib/fees";
import { closeDay } from "../../_actions/fees2";

type R = { id: string; receipt_no: string; amount: number; mode: string; collected_by: string | null; cancelled: boolean; students: { first_name: string; last_name: string | null; admission_no: string } | null };
type Pay = { mode: string; amount: number; receipt_id: string };

export default async function DayBook({ searchParams }: { searchParams: Promise<{ day?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.collection.view");
  const sp = await searchParams;
  const today = todayIST();
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : today;
  const [{ data: rec }, { data: closes }, { data: refunds }] = await Promise.all([
    supabase.from("fee_receipts").select("id,receipt_no,amount,mode,collected_by,cancelled,students(first_name,last_name,admission_no)").eq("school_id", school.id).eq("paid_on", day).order("receipt_no").limit(1000),
    supabase.from("fee_day_close").select("collector,expected_cash,counted_cash,difference,note").eq("school_id", school.id).eq("day", day),
    supabase.from("fee_refunds").select("amount,mode").eq("school_id", school.id).eq("paid_on", day).eq("status", "paid"),
  ]);
  const R = (rec ?? []) as unknown as R[];
  const live = R.filter((r) => !r.cancelled);
  const ids = live.map((r) => r.id);
  const { data: pays } = ids.length ? await supabase.from("fee_receipt_payments").select("mode,amount,receipt_id").in("receipt_id", ids) : { data: [] };
  const P = (pays ?? []) as Pay[];
  const byMode = P.reduce<Record<string, number>>((m, p) => ({ ...m, [p.mode]: (m[p.mode] ?? 0) + Number(p.amount) }), {});
  const total = live.reduce((t, r) => t + Number(r.amount), 0);
  const advance = total - Object.values(byMode).reduce((t, a) => t + a, 0);
  const refunded = ((refunds ?? []) as { amount: number }[]).reduce((t, r) => t + Number(r.amount), 0);
  const collectors = [...new Set(live.map((r) => r.collected_by ?? ""))];
  const cashBy = new Map<string, number>();
  for (const r of live) {
    const cash = P.filter((p) => p.receipt_id === r.id && p.mode === "cash").reduce((t, p) => t + Number(p.amount), 0);
    cashBy.set(r.collected_by ?? "", (cashBy.get(r.collected_by ?? "") ?? 0) + cash);
  }
  const closed = new Map(((closes ?? []) as { collector: string; expected_cash: number; counted_cash: number; difference: number; note: string | null }[]).map((c) => [c.collector, c]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Day book" subtitle={fmtDate(day)} back={{ href: "/app/fees", label: "Fees" }}
        actions={<><Link href={`/app/fees/daybook?day=${addDays(day, -1)}`} className="btn btn-sm btn-secondary">← Previous</Link>{day < today && <Link href={`/app/fees/daybook?day=${addDays(day, 1)}`} className="btn btn-sm btn-secondary">Next →</Link>}</>} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex items-end gap-2 print:hidden"><Input label="Date" name="day" type="date" defaultValue={day} /><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></form>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="revenue" tone="green" label="Collected" value={money(total)} hint={`${live.length} receipts${R.length > live.length ? ` · ${R.length - live.length} cancelled` : ""}`} />
        <Stat icon="fees" tone="blue" label="Cash" value={money(byMode.cash ?? 0)} />
        <Stat icon="card" tone="violet" label="Other modes" value={money(Object.entries(byMode).filter(([m]) => m !== "cash").reduce((t, [, a]) => t + a, 0))} hint={advance > 0 ? `+ ${money(advance)} from advance` : undefined} />
        <Stat icon="notifications" tone="rose" label="Refunded" value={money(refunded)} />
      </div>

      <Card title="By mode">
        {Object.keys(byMode).length ? <p className="m-0 text-[14px]">{Object.entries(byMode).map(([m, a]) => `${MODE_LABEL[m] ?? m} ${money(a)}`).join(" · ")}</p> : <p className="m-0 text-[14px] text-muted">No payments.</p>}
      </Card>

      {can("fees.collection.create") && collectors.length > 0 && (
        <Card title="Close the day (cash)" description="Count the cash drawer and record it against the collector. Differences are kept for the audit.">
          <div className="grid gap-3">
            {collectors.map((c) => {
              const done = closed.get(c);
              const expected = (cashBy.get(c) ?? 0);
              return (
                <form key={c || "none"} action={closeDay} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <input type="hidden" name="day" value={day} /><input type="hidden" name="collector" value={c} />
                  <p className="m-0 self-end text-[14px]"><b className="text-ink">{c || "Unnamed"}</b><br /><span className="text-muted">cash to hand over {money(expected)}</span></p>
                  <Input label="Counted (₹)" name="counted" type="number" step="0.01" min={0} defaultValue={done?.counted_cash ?? expected} />
                  <Input label="Note" name="note" defaultValue={done?.note} />
                  <div className="flex items-end"><Submit>{done ? "Update" : "Close"}</Submit></div>
                  {done && <p className="m-0 self-end text-[13px] text-muted">Closed · difference <b className={Number(done.difference) === 0 ? "text-[#0b4f2c]" : "text-error"}>{money(done.difference)}</b></p>}
                </form>
              );
            })}
          </div>
        </Card>
      )}

      {R.length ? (
        <Table head={["Receipt", "Student", "Mode", "Collected by", "Amount"]} minWidth={640}>
          {R.map((r) => (
            <tr key={r.id} className={r.cancelled ? "opacity-60" : ""}>
              <td className={`${td} font-mono text-[13px]`}><Link href={`/app/fees/receipts/${r.id}`}>{r.receipt_no}</Link></td>
              <td className={td}>{r.students ? fullName(r.students) : "—"}<div className="text-[12px] text-muted">{r.students?.admission_no}</div></td>
              <td className={td}>{MODE_LABEL[r.mode] ?? r.mode}</td>
              <td className={td}>{r.collected_by ?? "—"}</td>
              <td className={`${td} font-semibold text-ink ${r.cancelled ? "line-through" : ""}`}>{money(r.amount)}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No receipts on this day.</Empty>}
    </div>
  );
}
