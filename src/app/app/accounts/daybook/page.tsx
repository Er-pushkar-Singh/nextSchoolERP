import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Empty, Flash, Input, PageHeader, Select, Stat, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { PrintButton } from "@/components/ui/PrintButton";
import { cleanSearch, fmtDate, money } from "@/lib/format";
import { SOURCE_LABEL, period, sourceHref } from "@/lib/accounts";

type Row = { entry_key: string; on_date: string; dir: string; head: string; book_name: string | null; amount: number; party: string | null; mode: string | null; ref: string | null;
  narration: string | null; source: string; source_id: string | null; voucher_no: string | null; by_name: string | null; total: number; sum_in: number; sum_out: number };
const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function DayBook({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school } = await requirePerm("accounts.books.view", "accounts.vouchers.view");
  const sp = await searchParams;
  await supabase.rpc("ensure_account_defaults", { sid: school.id });
  const { from, to } = period(sp);
  const { page, size, offset } = pageParams(sp, 50);
  const book = uid(sp.book);
  const dir = sp.dir === "in" || sp.dir === "out" ? sp.dir : null;
  const source = ["voucher", "fee", "refund", "payroll"].includes(sp.source ?? "") ? sp.source! : null;
  const head = sp.head?.slice(0, 60) || null;
  const q = cleanSearch(sp.q ?? "").trim();
  const [{ data, error }, { data: books }, { data: heads }] = await Promise.all([
    supabase.rpc("account_daybook", { sid: school.id, d1: from, d2: to, p_book: book, p_dir: dir, p_head: head, p_source: source, p_q: q || null, p_limit: size, p_offset: offset }),
    supabase.from("account_books").select("id,name").eq("school_id", school.id).order("created_at"),
    supabase.rpc("account_head_summary", { sid: school.id, d1: "2000-01-01", d2: to }),
  ]);
  const rows = (data ?? []) as Row[];
  const total = rows[0] ? Number(rows[0].total) : 0;
  const sin = rows[0] ? Number(rows[0].sum_in ?? 0) : 0, sout = rows[0] ? Number(rows[0].sum_out ?? 0) : 0;
  const headNames = [...new Set(((heads ?? []) as { head: string }[]).map((h) => h.head))];
  const params = { from, to, book: book ?? undefined, dir: dir ?? undefined, source: source ?? undefined, head: head ?? undefined, q: q || undefined };
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 print:hidden">
        <PageHeader icon="revenue" title="Day book" subtitle={`${fmtDate(from)} to ${fmtDate(to)} · every rupee in and out`} back={{ href: "/app/accounts", label: "Accounts" }}
          actions={<><PrintButton /><Link href={`/app/accounts/daybook/export?${exportQs}`} className="btn btn-sm btn-secondary">Download CSV</Link></>} />
        <Flash ok={sp.ok} error={sp.error} />
        <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-8">
          <Input label="From" name="from" type="date" defaultValue={from} />
          <Input label="To" name="to" type="date" defaultValue={to} />
          <Select label="Book" name="book" blank="All" defaultValue={book} options={(books ?? []).map((b) => [b.id, b.name] as [string, string])} />
          <Select label="Direction" name="dir" blank="Both" defaultValue={dir} options={[["in", "Money in"], ["out", "Money out"]]} />
          <Select label="Source" name="source" blank="All" defaultValue={source} options={[["voucher", "Vouchers"], ["fee", "Fee receipts"], ["refund", "Fee refunds"], ["payroll", "Payroll"]]} />
          <Select label="Head" name="head" blank="All" defaultValue={head} options={headNames} />
          <Input label="Search" name="q" defaultValue={sp.q} placeholder="Party, ref, note" />
          <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Show</button></div>
        </form>
        <div className="grid grid-cols-3 gap-3">
          <Stat icon="revenue" tone="green" label="Money in" value={money(sin)} hint={`${total} entries match`} />
          <Stat icon="fees" tone="rose" label="Money out" value={money(sout)} />
          <Stat icon="card" tone="blue" label="Net" value={money(sin - sout)} />
        </div>
      </div>
      <h1 className="hidden text-[18px] font-bold print:block">{school.name} — Day book {fmtDate(from)} to {fmtDate(to)}</h1>

      {error && <Flash error={`Could not load the day book: ${error.message}`} />}
      {rows.length ? (
        <Table head={["Date", "Particulars", "Book", "Mode / ref", "Money in", "Money out"]} minWidth={860}>
          {rows.map((r, i) => {
            const href = sourceHref(r.source, r.source_id);
            const newDay = i === 0 || rows[i - 1].on_date !== r.on_date;
            return (
              <tr key={r.entry_key} className={newDay ? "border-t-2 border-line" : ""}>
                <td className={`${td} whitespace-nowrap text-[13px]`}>{newDay ? fmtDate(r.on_date) : ""}</td>
                <td className={td}>
                  <b className="text-ink">{r.head}</b>{r.party ? <span className="text-muted"> · {r.party}</span> : null}
                  <div className="text-[12px] text-muted">
                    {href ? <Link href={href}>{SOURCE_LABEL[r.source]}{r.voucher_no ? ` ${r.voucher_no}` : ""}</Link> : <>{SOURCE_LABEL[r.source] ?? r.source}{r.voucher_no ? ` ${r.voucher_no}` : ""}</>}
                    {r.narration ? ` · ${r.narration}` : ""}
                  </div>
                </td>
                <td className={`${td} text-[13px]`}>{r.book_name ?? "—"}</td>
                <td className={`${td} text-[13px] capitalize`}>{(r.mode ?? "").replace(/_/g, " ")}{r.ref ? <div className="text-[12px] normal-case text-muted">{r.ref}</div> : null}</td>
                <td className={`${td} text-right text-[#15803d]`}>{r.dir === "in" ? money(r.amount) : ""}</td>
                <td className={`${td} text-right text-error`}>{r.dir === "out" ? money(r.amount) : ""}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{error ? "—" : "No entries match."}</Empty>}
      <div className="print:hidden">
        <Pagination total={total} page={page} size={size} basePath="/app/accounts/daybook" params={params} />
      </div>
    </div>
  );
}
