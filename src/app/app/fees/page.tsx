import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { money, todayIST } from "@/lib/format";
import { pct } from "@/lib/erp";

export default async function Fees() {
  const { supabase, school, session, can } = await requirePerm("fees.collection.view", "fees.structure.view", "fees.defaulters.view", "fees.receipts.view");
  const today = todayIST();
  if (!session) return <Empty>No current session. Set one in Settings.</Empty>;
  const [{ data: s }, { data: byClass }, { data: todays }, pendCon, pendRef, chq, { data: wal }] = await Promise.all([
    supabase.rpc("fee_summary", { sid: school.id, sess: session.id, on_day: today }),
    supabase.rpc("class_fee_summary", { sid: school.id, sess: session.id, on_day: today }),
    supabase.from("fee_receipts").select("amount,mode").eq("school_id", school.id).eq("paid_on", today).eq("cancelled", false),
    supabase.from("student_concessions").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("status", "pending"),
    supabase.from("fee_refunds").select("id", { count: "exact", head: true }).eq("school_id", school.id).in("status", ["requested", "approved"]),
    supabase.from("fee_cheques").select("id", { count: "exact", head: true }).eq("school_id", school.id).in("status", ["received", "deposited"]),
    supabase.from("fee_wallet_entries").select("amount").eq("school_id", school.id).limit(5000),
  ]);
  const advance = ((wal ?? []) as { amount: number }[]).reduce((t, w) => t + Number(w.amount), 0);
  const f = s as { billed: number; collected: number; concession: number; overdue: number; overdue_students: number; outstanding: number; today: number; today_count: number; month: number };
  const modes = Object.entries(((todays ?? []) as { amount: number; mode: string }[]).reduce<Record<string, number>>((m, r) => ({ ...m, [r.mode]: (m[r.mode] ?? 0) + Number(r.amount) }), {}));
  const rows = (byClass ?? []) as { class_id: string; class_name: string; students: number; billed: number; collected: number; overdue: number }[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Fees" subtitle={`Session ${session.name}`} actions={<>
        {can("fees.collection.create") && <Link href="/app/fees/collect" className="btn btn-sm btn-primary">Collect fee</Link>}
        {can("fees.defaulters.view") && <Link href="/app/fees/defaulters" className="btn btn-sm btn-secondary">Defaulters</Link>}
        <Link href="/app/fees/reports" className="btn btn-sm btn-secondary">Reports</Link>
      </>} />
      {((pendCon.count ?? 0) > 0 || (pendRef.count ?? 0) > 0 || (chq.count ?? 0) > 0 || advance > 0) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-[12px] border border-line bg-white px-4 py-3 text-[14px]">
          {(pendCon.count ?? 0) > 0 && <Link href="/app/fees/concessions">{pendCon.count} concession(s) waiting for approval</Link>}
          {(pendRef.count ?? 0) > 0 && <Link href="/app/fees/refunds">{pendRef.count} refund(s) open</Link>}
          {(chq.count ?? 0) > 0 && <Link href="/app/fees/cheques">{chq.count} cheque(s) not yet cleared</Link>}
          {advance > 0 && <span className="text-muted">Advance held for students: <b className="text-ink">{money(advance)}</b></span>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="fees" tone="green" label="Collected today" value={money(f.today)} hint={modes.length ? modes.map(([m, a]) => `${m.replace("_", " ")} ${money(a)}`).join(" · ") : `${f.today_count} receipts`} href={`/app/fees/receipts?from=${today}&to=${today}`} />
        <Stat icon="revenue" tone="blue" label="This month" value={money(f.month)} href="/app/fees/receipts" />
        <Stat icon="notifications" tone="rose" label="Overdue now" value={money(f.overdue)} hint={`${f.overdue_students} students`} href="/app/fees/defaulters" />
        <Stat icon="layers" tone="violet" label="Session collected" value={`${pct(Number(f.collected), Number(f.billed))}%`} hint={`${money(f.collected)} of ${money(f.billed)} · concessions ${money(f.concession)}`} />
      </div>
      <Card title="By class">
        {rows.length ? (
          <Table head={["Class", "Students billed", "Billed", "Collected", "%", "Overdue", ""]} minWidth={640}>
            {rows.map((r) => (
              <tr key={r.class_id}>
                <td className={`${td} font-semibold text-ink`}>{r.class_name}</td>
                <td className={td}>{r.students}</td>
                <td className={td}>{money(r.billed)}</td>
                <td className={td}>{money(r.collected)}</td>
                <td className={td}>{pct(Number(r.collected), Number(r.billed))}%</td>
                <td className={`${td} ${Number(r.overdue) > 0 ? "font-semibold text-error" : ""}`}>{money(r.overdue)}</td>
                <td className={td}>{Number(r.overdue) > 0 && <Link href={`/app/fees/defaulters?class_id=${r.class_id}`}>Defaulters</Link>}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No dues yet. Set the <Link href="/app/fees/structure">fee structure</Link> and click “Generate dues”.</Empty>}
      </Card>
    </div>
  );
}
