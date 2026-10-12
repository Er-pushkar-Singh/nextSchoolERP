import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Flash, Input, PageHeader, Submit } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { amountInWords, fmtDate, fullName, money, waLink } from "@/lib/format";
import { balance } from "@/lib/erp";
import { appUrl } from "@/lib/brand";
import { cancelReceipt } from "../../../_actions/fees";

export default async function Receipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("fees.receipts.view", "fees.collection.view");
  const { data: r } = await supabase.from("fee_receipts")
    .select("*, students(id,admission_no,first_name,last_name,father_name,guardian_phone,portal_token,classes(name),sections(name)), fee_receipt_lines(amount, fee_dues(label,due_date))")
    .eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!r) notFound();
  const s = r.students as { id: string; admission_no: string; first_name: string; last_name: string | null; father_name: string | null; guardian_phone: string | null; portal_token: string; classes: { name: string } | null; sections: { name: string } | null };
  const lines = (r.fee_receipt_lines as { amount: number; fee_dues: { label: string; due_date: string } | null }[]).sort((a, b) => (a.fee_dues?.due_date ?? "").localeCompare(b.fee_dues?.due_date ?? ""));
  const { data: rest } = await supabase.from("fee_dues").select("amount,concession,fine,paid").eq("student_id", s.id).neq("status", "paid");
  const remaining = (rest ?? []).reduce((t, d) => t + balance(d), 0);
  const name = fullName(s);
  const wa = waLink(s.guardian_phone, `Dear Parent, we have received ${money(r.amount)} for ${name} (Adm. ${s.admission_no}). Receipt no. ${r.receipt_no} dated ${fmtDate(r.paid_on)}.${remaining > 0 ? ` Balance for the session: ${money(remaining)}.` : ""}\nView receipts: ${appUrl(`/p/${s.portal_token}`)}\n— ${school.name}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <PageHeader title={`Receipt ${r.receipt_no}`} back={{ href: "/app/fees/receipts", label: "Receipts" }} actions={<>
          <PrintButton />
          {wa && !r.cancelled && <a href={wa} target="_blank" rel="noopener" className="btn btn-sm btn-wa">Send on WhatsApp</a>}
        </>} />
        <div className="mt-3"><Flash ok={sp.ok} error={sp.error} /></div>
      </div>

      <article className="mx-auto w-full max-w-[720px] rounded-[12px] border border-line bg-white p-6 text-[14px] text-ink print:max-w-none print:border-0 print:p-0">
        <header className="border-b-2 border-ink pb-3 text-center">
          <h1 className="m-0 text-[22px] font-extrabold">{school.name}</h1>
          <p className="m-0 text-[13px] text-body">{[school.address, school.city, school.pincode].filter(Boolean).join(", ")}{school.phone ? ` · ${school.phone}` : ""}</p>
          {school.affiliation_no && <p className="m-0 text-[12px] text-muted">{school.board} Affiliation No. {school.affiliation_no}</p>}
          <p className="mt-2 mb-0 text-[15px] font-bold tracking-wide">FEE RECEIPT {r.cancelled && <span className="text-error">— CANCELLED</span>}</p>
        </header>
        <dl className="my-4 grid grid-cols-2 gap-x-6 gap-y-1">
          <div><dt className="inline text-muted">Receipt no.: </dt><dd className="inline font-mono font-semibold">{r.receipt_no}</dd></div>
          <div className="text-right"><dt className="inline text-muted">Date: </dt><dd className="inline font-semibold">{fmtDate(r.paid_on)}</dd></div>
          <div><dt className="inline text-muted">Student: </dt><dd className="inline font-semibold">{name}</dd></div>
          <div className="text-right"><dt className="inline text-muted">Adm. no.: </dt><dd className="inline">{s.admission_no}</dd></div>
          <div><dt className="inline text-muted">Father: </dt><dd className="inline">{s.father_name ?? "—"}</dd></div>
          <div className="text-right"><dt className="inline text-muted">Class: </dt><dd className="inline">{s.classes ? `${s.classes.name}-${s.sections?.name ?? ""}` : "—"}</dd></div>
        </dl>
        <table className="w-full border-collapse">
          <thead><tr className="border-y border-ink text-left"><th className="py-1.5">Particulars</th><th className="py-1.5 text-right">Amount</th></tr></thead>
          <tbody>
            {lines.map((l, i) => <tr key={i} className="border-b border-line"><td className="py-1.5">{l.fee_dues?.label ?? "Fee"}</td><td className="py-1.5 text-right">{money(l.amount)}</td></tr>)}
          </tbody>
          <tfoot><tr className="border-b-2 border-ink font-bold"><td className="py-2">Total received</td><td className="py-2 text-right">{money(r.amount)}</td></tr></tfoot>
        </table>
        <p className="my-3"><span className="text-muted">In words:</span> <b>{amountInWords(Number(r.amount))}</b></p>
        <p className="my-1">Mode: <b>{r.mode.replace("_", " ").toUpperCase()}</b>{r.reference ? ` · Ref. ${r.reference}` : ""}{r.note ? ` · ${r.note}` : ""}</p>
        {!r.cancelled && <p className="my-1">Balance for the session after this receipt: <b>{money(remaining)}</b></p>}
        {r.cancelled && <p className="my-1 text-error">Cancelled: {r.cancelled_reason}</p>}
        <footer className="mt-10 flex justify-between text-[13px]">
          <span className="text-muted">Received by: {r.collected_by ?? ""}</span>
          <span className="border-t border-ink px-6 pt-1">Authorised signatory</span>
        </footer>
        <p className="mt-6 mb-0 text-center text-[11px] text-muted">Computer-generated receipt. Fees once paid are not refundable except as per school policy.</p>
      </article>

      {!r.cancelled && can("fees.receipts.approve") && (
        <details className="mx-auto w-full max-w-[720px] print:hidden">
          <summary className="cursor-pointer text-[14px] text-error">Cancel this receipt</summary>
          <form action={cancelReceipt} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={r.id} />
            <Input label="Reason" name="reason" required placeholder="Wrong amount / cheque bounced…" />
            <Submit variant="danger">Cancel receipt</Submit>
          </form>
        </details>
      )}
    </div>
  );
}
