import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Card, Empty, PageHeader, Table, td } from "@/components/ui/ui";
import { fmtDate, fullName, money } from "@/lib/format";
import { balance } from "@/lib/erp";
import { MODE_LABEL } from "@/lib/fees";
import { PrintButton } from "@/components/ui/PrintButton";

type Due = { id: string; label: string; due_date: string; amount: number; concession: number; fine: number; paid: number; status: string; kind: string; session_id: string };
type Rec = { id: string; receipt_no: string; paid_on: string; amount: number; mode: string; cancelled: boolean; advance_amount: number; wallet_used: number };

export default async function Ledger({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school } = await requirePerm("fees.collection.view", "fees.receipts.view");
  const { data: s } = await supabase.from("students").select("id,admission_no,first_name,middle_name,last_name,father_name,classes(name),sections(name)").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!s) notFound();
  const [{ data: dues }, { data: recs }, { data: adj }, { data: wal }] = await Promise.all([
    supabase.from("fee_dues").select("id,label,due_date,amount,concession,fine,paid,status,kind,session_id").eq("student_id", id).order("due_date"),
    supabase.from("fee_receipts").select("id,receipt_no,paid_on,amount,mode,cancelled,advance_amount,wallet_used").eq("student_id", id).order("paid_on").order("receipt_no"),
    supabase.from("fee_adjustments").select("id,kind,amount,reason,created_at,old_value,new_value").eq("student_id", id).order("created_at"),
    supabase.from("fee_wallet_entries").select("amount").eq("student_id", id),
  ]);
  const D = (dues ?? []) as Due[];
  const R = (recs ?? []) as Rec[];
  const billed = D.reduce((t, d) => t + Number(d.amount) + Number(d.fine), 0);
  const waived = D.reduce((t, d) => t + Number(d.concession), 0);
  const paid = D.reduce((t, d) => t + Number(d.paid), 0);
  const owed = D.reduce((t, d) => t + balance(d), 0);
  const wallet = ((wal ?? []) as { amount: number }[]).reduce((t, w) => t + Number(w.amount), 0);
  const stu = s as unknown as { first_name: string; middle_name: string | null; last_name: string | null; admission_no: string; father_name: string | null; classes: { name: string } | null; sections: { name: string } | null };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Fee statement" subtitle={`${fullName(stu)} · Adm. ${stu.admission_no} · Class ${stu.classes?.name ?? ""}${stu.sections ? `-${stu.sections.name}` : ""}`}
        back={{ href: `/app/fees/collect?student=${id}`, label: "Collect fee" }} actions={<PrintButton />} />
      <p className="m-0 hidden text-[14px] print:block">{school.name} — fee statement of {fullName(stu)}, father {stu.father_name ?? "—"}</p>
      <div className="grid grid-cols-2 gap-3 text-[14px] lg:grid-cols-5">
        <Card><p className="m-0 text-muted">Billed (with fine)</p><b className="text-[18px] text-ink">{money(billed)}</b></Card>
        <Card><p className="m-0 text-muted">Concession / waived</p><b className="text-[18px] text-ink">{money(waived)}</b></Card>
        <Card><p className="m-0 text-muted">Paid</p><b className="text-[18px] text-[#0b4f2c]">{money(paid)}</b></Card>
        <Card><p className="m-0 text-muted">Balance</p><b className="text-[18px] text-error">{money(owed)}</b></Card>
        <Card><p className="m-0 text-muted">Advance held</p><b className="text-[18px] text-ink">{money(wallet)}</b></Card>
      </div>
      <Card title="Instalments">
        {D.length ? (
          <Table head={["Instalment", "Due", "Amount", "Concession", "Fine", "Paid", "Balance"]} minWidth={680}>
            {D.map((d) => (
              <tr key={d.id}>
                <td className={td}>{d.label}</td><td className={td}>{fmtDate(d.due_date)}</td><td className={td}>{money(d.amount)}</td>
                <td className={td}>{Number(d.concession) ? money(d.concession) : "—"}</td><td className={td}>{Number(d.fine) ? money(d.fine) : "—"}</td>
                <td className={td}>{money(d.paid)}</td><td className={`${td} font-semibold text-ink`}>{money(balance(d))}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No fees billed.</Empty>}
      </Card>
      <Card title="Receipts">
        {R.length ? (
          <Table head={["Receipt", "Date", "Mode", "Amount", ""]} minWidth={520}>
            {R.map((r) => (
              <tr key={r.id} className={r.cancelled ? "opacity-60" : ""}>
                <td className={`${td} font-mono text-[13px]`}>{r.receipt_no}</td><td className={td}>{fmtDate(r.paid_on)}</td><td className={td}>{MODE_LABEL[r.mode] ?? r.mode}</td>
                <td className={`${td} font-semibold text-ink ${r.cancelled ? "line-through" : ""}`}>{money(r.amount)}</td>
                <td className={td}>{r.cancelled ? "cancelled" : Number(r.advance_amount) > 0 ? `+ ${money(r.advance_amount)} advance` : ""}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No receipts.</Empty>}
      </Card>
      {(adj ?? []).length > 0 && (
        <Card title="Changes made">
          <ul className="m-0 list-none p-0 text-[14px]">
            {(adj as { id: string; kind: string; amount: number; reason: string; created_at: string; old_value: string | null; new_value: string | null }[]).map((a) => (
              <li key={a.id} className="border-t border-line py-1.5 first:border-0">
                <b className="text-ink">{a.kind.replace("_", " ")}</b>{Number(a.amount) ? ` ${money(Math.abs(Number(a.amount)))}` : ""}{a.old_value ? ` (${a.old_value} → ${a.new_value})` : ""} <span className="text-muted">· {a.reason} · {fmtDate(a.created_at.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
