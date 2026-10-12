import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, PageHeader, Table, td } from "@/components/ui/ui";
import { fmtDate, money, todayIST } from "@/lib/format";
import { MODE_LABEL } from "@/lib/fees";

const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const GROUPS: [string, string][] = [["day", "By day"], ["month", "By month"], ["head", "By fee head"], ["class", "By class"], ["mode", "By payment mode"], ["collector", "By collector"]];

export default async function Reports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; by?: string }> }) {
  const { supabase, school, session } = await requirePerm("fees.collection.view", "fees.receipts.view");
  const sp = await searchParams;
  const today = todayIST();
  const from = valid(sp.from) ?? `${today.slice(0, 8)}01`;
  const to = valid(sp.to) ?? today;
  const by = GROUPS.some(([k]) => k === sp.by) ? sp.by! : "head";
  const [{ data: rep }, aging, { data: cons }] = await Promise.all([
    supabase.rpc("fee_report", { sid: school.id, d1: from, d2: to, by }),
    session ? supabase.rpc("fee_aging", { sid: school.id, sess: session.id }) : Promise.resolve({ data: [] }),
    supabase.from("student_concessions").select("category,kind,value,status").eq("school_id", school.id).eq("status", "approved"),
  ]);
  const rows = (rep ?? []) as { key: string; label: string; receipts: number; amount: number }[];
  const total = rows.reduce((t, r) => t + Number(r.amount), 0);
  const age = (aging.data ?? []) as { bucket: string; students: number; amount: number }[];
  const ageTotal = age.reduce((t, r) => t + Number(r.amount), 0);
  const byCat = Object.entries(((cons ?? []) as { category: string }[]).reduce<Record<string, number>>((m, c) => ({ ...m, [c.category]: (m[c.category] ?? 0) + 1 }), {}));
  const qs = (b: string) => new URLSearchParams({ from, to, by: b }).toString();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Fee reports" subtitle={`${fmtDate(from)} – ${fmtDate(to)}`} back={{ href: "/app/fees", label: "Fees" }}
        actions={<a href={`/app/fees/receipts/export?from=${from}&to=${to}`} className="btn btn-sm btn-secondary">Receipts CSV</a>} />
      <form className="flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-[13px] font-semibold">From<input type="date" name="from" defaultValue={from} className="input !min-h-10 !py-2" /></label>
        <label className="text-[13px] font-semibold">To<input type="date" name="to" defaultValue={to} className="input !min-h-10 !py-2" /></label>
        <input type="hidden" name="by" value={by} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      <nav className="flex flex-wrap gap-3 text-[14px] print:hidden">
        {GROUPS.map(([k, l]) => <Link key={k} href={`/app/fees/reports?${qs(k)}`} className={k === by ? "font-bold" : ""}>{l}</Link>)}
      </nav>

      <Card title={`Collected ${money(total)}`}>
        {rows.length ? (
          <Table head={[GROUPS.find(([k]) => k === by)![1].replace("By ", ""), "Receipts", "Amount", "Share"]} minWidth={480}>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={`${td} font-semibold text-ink`}>{MODE_LABEL[r.label] ?? r.label}</td>
                <td className={td}>{r.receipts}</td>
                <td className={td}>{money(r.amount)}</td>
                <td className={td}>{total ? Math.round((Number(r.amount) / total) * 100) : 0}%</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>Nothing collected in this period.</Empty>}
      </Card>

      <Card title="Outstanding — how old" description={`Unpaid balances of session ${session?.name ?? ""} as of today · ${money(ageTotal)}`}>
        {age.length ? (
          <Table head={["Overdue by", "Students", "Amount"]} minWidth={420}>
            {age.map((a) => (
              <tr key={a.bucket}><td className={`${td} font-semibold text-ink`}>{a.bucket.slice(4)}</td><td className={td}>{a.students}</td><td className={td}>{money(a.amount)}</td></tr>
            ))}
          </Table>
        ) : <Empty>Nothing is outstanding.</Empty>}
        <p className="mt-3 mb-0 text-[13px]"><Link href="/app/fees/defaulters">Defaulter list with reminders →</Link></p>
      </Card>

      {byCat.length > 0 && (
        <Card title="Active concessions by category">
          <p className="m-0 text-[14px]">{byCat.map(([c, n]) => `${c.replace("_", " ")}: ${n}`).join(" · ")} · <Link href="/app/fees/concessions?status=approved">see all</Link></p>
        </Card>
      )}
    </div>
  );
}
