import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { fmtDate, money } from "@/lib/format";
import { SOURCE_LABEL, period } from "@/lib/accounts";

type Book = { book_id: string; name: string; kind: string; active: boolean; opening: number; receipts: number; payments: number; closing: number };
type Head = { dir: string; head: string; entries: number; total: number };
type Row = { entry_key: string; on_date: string; dir: string; head: string; book_name: string | null; amount: number; party: string | null; source: string; voucher_no: string | null };

export default async function Accounts({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("accounts.vouchers.view", "accounts.books.view");
  const sp = await searchParams;
  const { from, to } = period(sp);
  await supabase.rpc("ensure_account_defaults", { sid: school.id });
  const [{ data: books }, { data: heads }, { data: recent }, { count: pending }] = await Promise.all([
    supabase.rpc("account_books_summary", { sid: school.id, d1: from, d2: to }),
    supabase.rpc("account_head_summary", { sid: school.id, d1: from, d2: to }),
    supabase.rpc("account_daybook", { sid: school.id, d1: from, d2: to, p_limit: 500, p_offset: 0 }),
    supabase.from("vouchers").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("status", "pending"),
  ]);
  const B = (books ?? []) as Book[];
  const H = (heads ?? []) as Head[];
  const income = H.filter((h) => h.dir === "in"), expense = H.filter((h) => h.dir === "out");
  const tin = income.reduce((t, h) => t + Number(h.total), 0), tout = expense.reduce((t, h) => t + Number(h.total), 0);
  const last = ((recent ?? []) as Row[]).slice(-8).reverse();
  const cash = B.filter((b) => b.kind === "cash" && b.active).reduce((t, b) => t + Number(b.closing), 0);
  const bank = B.filter((b) => b.kind === "bank" && b.active).reduce((t, b) => t + Number(b.closing), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="revenue" title="Accounts" subtitle={`${fmtDate(from)} to ${fmtDate(to)}`}
        actions={<>
          {can("accounts.vouchers.create") && <Link href="/app/accounts/vouchers?new=1" className="btn btn-sm btn-primary">New voucher</Link>}
          <Link href={`/app/accounts/daybook?from=${from}&to=${to}`} className="btn btn-sm btn-secondary">Day book</Link>
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <Input label="From" name="from" type="date" defaultValue={from} />
        <Input label="To" name="to" type="date" defaultValue={to} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon="revenue" tone="green" label="Income" value={money(tin)} />
        <Stat icon="fees" tone="rose" label="Expense" value={money(tout)} />
        <Stat icon="card" tone={tin - tout >= 0 ? "blue" : "amber"} label="Surplus / deficit" value={money(tin - tout)} />
        <Stat icon="fees" tone="violet" label="Cash in hand" value={money(cash)} />
        <Stat icon="card" tone="cyan" label="In bank" value={money(bank)} />
      </div>

      {Number(pending) > 0 && can("accounts.vouchers.approve") && (
        <p className="m-0 rounded-[12px] border border-[#e0b44a] bg-[#fff8e6] px-4 py-3 text-[14px]">
          <b>{pending}</b> voucher{Number(pending) === 1 ? " is" : "s are"} waiting for your approval. <Link href="/app/accounts/vouchers?status=pending">Review</Link>
        </p>
      )}

      <Card title="Cash & bank books" description="Opening balance of the period, money in, money out, closing balance.">
        {B.length ? (
          <Table head={["Book", "Opening", "Money in", "Money out", "Closing"]} minWidth={560}>
            {B.map((b) => (
              <tr key={b.book_id}>
                <td className={td}><Link href={`/app/accounts/daybook?from=${from}&to=${to}&book=${b.book_id}`}><b>{b.name}</b></Link><div className="text-[12px] capitalize text-muted">{b.kind}{b.active ? "" : " · closed"}</div></td>
                <td className={td}>{money(b.opening)}</td>
                <td className={`${td} text-[#15803d]`}>{money(b.receipts)}</td>
                <td className={`${td} text-error`}>{money(b.payments)}</td>
                <td className={td}><b className={Number(b.closing) < 0 ? "text-error" : "text-ink"}>{money(b.closing)}</b></td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No books yet.</Empty>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Income · ${money(tin)}`}>
          {income.length ? <HeadList rows={income} total={tin} tone="#16a34a" /> : <p className="m-0 text-[14px] text-muted">No income in this period.</p>}
        </Card>
        <Card title={`Expense · ${money(tout)}`}>
          {expense.length ? <HeadList rows={expense} total={tout} tone="#dc2626" /> : <p className="m-0 text-[14px] text-muted">No expense in this period.</p>}
        </Card>
      </div>

      <Card title="Latest entries" actions={<Link href={`/app/accounts/daybook?from=${from}&to=${to}`} className="text-[13px]">Open day book</Link>}>
        {last.length ? (
          <ul className="m-0 list-none divide-y divide-line p-0 text-[14px]">
            {last.map((r) => (
              <li key={r.entry_key} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <b className="text-ink">{r.head}</b> <span className="text-muted">· {r.party ?? "—"}</span>
                  <span className="block text-[12px] text-muted">{fmtDate(r.on_date)} · {SOURCE_LABEL[r.source] ?? r.source}{r.voucher_no ? ` ${r.voucher_no}` : ""} · {r.book_name ?? ""}</span>
                </span>
                <b className={r.dir === "in" ? "text-[#15803d]" : "text-error"}>{r.dir === "in" ? "+" : "−"}{money(r.amount)}</b>
              </li>
            ))}
          </ul>
        ) : <Empty>Nothing recorded in this period yet.</Empty>}
      </Card>
      <p className="m-0 text-[12px] text-muted">
        Fee receipts, paid refunds and approved payroll appear here by themselves — do not enter them again as vouchers. <Badge value="neutral" text="Transfers" /> between cash and bank do not count as income or expense.
      </p>
    </div>
  );
}

function HeadList({ rows, total, tone }: { rows: Head[]; total: number; tone: string }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((h) => (
        <li key={h.head} className="text-[14px]">
          <span className="flex justify-between gap-2"><span>{h.head} <span className="text-[12px] text-muted">({h.entries})</span></span><b>{money(h.total)}</b></span>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[#eef1f6]"><span className="block h-full rounded-full" style={{ width: `${Math.max(2, (Number(h.total) / (total || 1)) * 100)}%`, background: tone }} /></span>
        </li>
      ))}
    </ul>
  );
}
