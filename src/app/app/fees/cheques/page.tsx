import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { fmtDate, fullName, money, todayIST } from "@/lib/format";
import { chequeStatus } from "../../_actions/fees2";

type Q = { id: string; cheque_no: string; bank: string | null; cheque_date: string | null; amount: number; status: string; bounce_reason: string | null; receipt_id: string;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string } | null; fee_receipts: { receipt_no: string } | null };

export default async function Cheques({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.collection.view");
  const sp = await searchParams;
  const status = ["cleared", "bounced"].includes(sp.status ?? "") ? sp.status! : "open";
  let q = supabase.from("fee_cheques").select("id,cheque_no,bank,cheque_date,amount,status,bounce_reason,receipt_id,students(id,first_name,last_name,admission_no),fee_receipts(receipt_no)")
    .eq("school_id", school.id).order("created_at", { ascending: false }).limit(300);
  q = status === "open" ? q.in("status", ["received", "deposited"]) : q.eq("status", status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Q[];
  const canWrite = can("fees.collection.create");
  const canBounce = can("fees.receipts.approve");
  const today = todayIST();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Cheque register" subtitle={`${rows.length} shown · ${money(rows.reduce((t, r) => t + Number(r.amount), 0))}`} back={{ href: "/app/fees", label: "Fees" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="flex gap-3 text-[14px]">
        {[["open", "In hand / deposited"], ["cleared", "Cleared"], ["bounced", "Bounced"]].map(([s, l]) => <Link key={s} href={`/app/fees/cheques?status=${s}`} className={s === status ? "font-bold" : ""}>{l}</Link>)}
      </nav>
      {rows.length ? (
        <Table head={["Cheque", "Student", "Receipt", "Amount", "Status", "Action"]} minWidth={820}>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className={td}><b className="text-ink">{c.cheque_no}</b><div className="text-[12px] text-muted">{c.bank ?? ""}{c.cheque_date ? ` · ${fmtDate(c.cheque_date)}` : ""}</div></td>
              <td className={td}>{c.students ? <Link href={`/app/fees/collect?student=${c.students.id}`}>{fullName(c.students)}</Link> : "—"}<div className="text-[12px] text-muted">{c.students?.admission_no}</div></td>
              <td className={td}><Link href={`/app/fees/receipts/${c.receipt_id}`} className="font-mono text-[13px]">{c.fee_receipts?.receipt_no}</Link></td>
              <td className={`${td} font-semibold text-ink`}>{money(c.amount)}</td>
              <td className={td}><Badge value={c.status === "cleared" ? "paid" : c.status === "bounced" ? "overdue" : "pending"} text={c.status} />
                {c.bounce_reason && <div className="text-[12px] text-muted">{c.bounce_reason}</div>}
              </td>
              <td className={td}>
                {["received", "deposited"].includes(c.status) && canWrite && (
                  <form action={chequeStatus} className="flex flex-wrap items-center gap-1">
                    <input type="hidden" name="id" value={c.id} /><input type="hidden" name="day" value={today} />
                    {c.status === "received" && <button name="status" value="deposited" className="btn btn-sm btn-secondary cursor-pointer">Deposited</button>}
                    <button name="status" value="cleared" className="btn btn-sm btn-primary cursor-pointer border-0">Cleared</button>
                    {canBounce && (<><input name="reason" placeholder="Bounce reason" className="input !min-h-9 !py-1 text-[13px]" /><button name="status" value="bounced" className="btn btn-sm btn-secondary cursor-pointer">Bounced</button></>)}
                  </form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No cheques here.</Empty>}
      <p className="m-0 text-[12px] text-muted">A bounced cheque cancels its receipt, brings the dues back and bills the school&apos;s bounce charge (Fee settings). Only the principal can mark a cheque bounced.</p>
    </div>
  );
}
