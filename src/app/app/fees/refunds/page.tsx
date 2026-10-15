import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { cleanSearch, fmtDate, fullName, money } from "@/lib/format";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { decideRefund, payRefund, requestRefund } from "../../_actions/fees2";

type R = { id: string; amount: number; reason: string; status: string; mode: string | null; paid_on: string | null; decision_note: string | null; created_at: string;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string } | null };

export default async function Refunds({ searchParams }: { searchParams: Promise<{ find?: string; ok?: string; error?: string; page?: string; size?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.refunds.view");
  const sp = await searchParams;
  const q = cleanSearch(sp.find ?? "").trim();
  const { page, size, offset } = pageParams(sp);
  const [{ data, count }, found] = await Promise.all([
    supabase.from("fee_refunds").select("id,amount,reason,status,mode,paid_on,decision_note,created_at,students(id,first_name,last_name,admission_no)", { count: "exact" }).eq("school_id", school.id).order("created_at", { ascending: false }).range(offset, offset + size - 1),
    q && can("fees.refunds.create")
      ? supabase.from("students").select("id,first_name,last_name,admission_no").eq("school_id", school.id).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,admission_no.ilike.${q}%`).order("first_name").limit(8)
      : Promise.resolve({ data: null }),
  ]);
  const rows = (data ?? []) as unknown as R[];
  const people = (found.data ?? []) as { id: string; first_name: string; last_name: string | null; admission_no: string }[];
  const bal = new Map<string, number>();
  if (people.length) {
    const { data: w } = await supabase.from("fee_wallet_entries").select("student_id,amount").in("student_id", people.map((p) => p.id));
    for (const e of (w ?? []) as { student_id: string; amount: number }[]) bal.set(e.student_id, (bal.get(e.student_id) ?? 0) + Number(e.amount));
  }
  const canApprove = can("fees.refunds.approve");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Refunds" subtitle="Paid back from the student's advance balance" back={{ href: "/app/fees", label: "Fees" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {rows.length ? (
        <Table head={["Student", "Amount", "Reason", "Status", ""]} minWidth={760}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{r.students ? <Link href={`/app/fees/collect?student=${r.students.id}`}>{fullName(r.students)}</Link> : "—"}<div className="text-[12px] text-muted">{r.students?.admission_no} · {fmtDate(r.created_at.slice(0, 10))}</div></td>
              <td className={`${td} font-semibold text-ink`}>{money(r.amount)}</td>
              <td className={td}>{r.reason}{r.decision_note && <div className="text-[12px] text-muted">{r.decision_note}</div>}</td>
              <td className={td}><Badge value={r.status === "paid" ? "paid" : r.status === "rejected" ? "cancelled" : "pending"} text={r.status === "paid" ? `paid · ${(r.mode ?? "").replace("_", " ")}${r.paid_on ? ` · ${fmtDate(r.paid_on)}` : ""}` : r.status} /></td>
              <td className={td}>
                {r.status === "requested" && canApprove && (
                  <form action={decideRefund} className="flex flex-col gap-1">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="note" placeholder="Note (needed to reject)" className="input !min-h-9 !py-1 text-[13px]" />
                    <span className="flex gap-2"><button name="decision" value="approve" className="btn btn-sm btn-primary cursor-pointer border-0">Approve</button><button name="decision" value="reject" className="btn btn-sm btn-secondary cursor-pointer">Reject</button></span>
                  </form>
                )}
                {r.status === "approved" && (
                  <form action={payRefund} className="flex flex-wrap items-end gap-1">
                    <input type="hidden" name="id" value={r.id} />
                    <Select label="Paid by" name="mode" options={[["cash", "Cash"], ["upi", "UPI"], ["cheque", "Cheque"], ["bank_transfer", "Bank transfer"]]} />
                    <Input label="Reference" name="reference" />
                    <Submit>Mark paid</Submit>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No refunds yet.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/fees/refunds" params={{}} />

      {can("fees.refunds.create") && (
        <Card title="Request a refund" description="Only money held as advance can be refunded. To refund a fee already paid, first use “Move a payment back to advance” on the collect screen.">
          <form className="flex flex-wrap items-end gap-2"><Input label="Find student" name="find" defaultValue={sp.find} placeholder="Name or admission no." /><button className="btn btn-sm btn-secondary cursor-pointer">Find</button></form>
          {q && !people.length && <p className="mt-3 mb-0 text-[14px] text-muted">Nobody matches “{q}”.</p>}
          {people.length > 0 && (
            <form action={requestRefund} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select label="Student" name="student_id" options={people.map((p) => [p.id, `${fullName(p)} · ${p.admission_no} · advance ${money(bal.get(p.id) ?? 0)}`] as [string, string])} />
              <Input label="Amount (₹)" name="amount" type="number" step="0.01" min={0} required />
              <Input label="Reason" name="reason" required />
              <div className="flex items-end"><Submit>Request refund</Submit></div>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
