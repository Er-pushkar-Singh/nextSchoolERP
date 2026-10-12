import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { PageHeader } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { amountInWords, fmtDate, money } from "@/lib/format";
import type { SubInvoice } from "@/lib/billing";

/** GST tax invoice from CodersDuniya to the school. Seller details come from platform settings. */
export default async function SubInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school } = await requirePerm("settings.billing.view");
  const { data } = await supabase.from("subscription_invoices").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!data) notFound();
  const i = data as SubInvoice;
  const { data: seller } = await supabase.rpc("billing_seller");
  const s = (seller ?? {}) as { seller_name?: string; seller_gstin?: string; seller_address?: string; seller_state?: string };
  const intra = (s.seller_state ?? "09") === "09" && (school.state ?? "Uttar Pradesh") === "Uttar Pradesh";
  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden"><PageHeader title={`Invoice ${i.number}`} back={{ href: "/app/settings/billing", label: "Plan & billing" }} actions={<PrintButton />} /></div>
      <article className="mx-auto w-full max-w-[760px] rounded-[12px] border border-line bg-white p-6 text-[14px] text-ink print:border-0 print:p-0">
        <header className="flex flex-wrap justify-between gap-4 border-b-2 border-ink pb-3">
          <div><h1 className="m-0 text-[20px] font-extrabold">{s.seller_name || "CodersDuniya"}</h1><p className="m-0 text-[12px]">{s.seller_address}</p>{s.seller_gstin && <p className="m-0 text-[12px]">GSTIN {s.seller_gstin}</p>}</div>
          <div className="text-right"><p className="m-0 font-bold">TAX INVOICE</p><p className="m-0 font-mono">{i.number}</p><p className="m-0 text-[12px]">Date {fmtDate(i.created_at)} · Due {fmtDate(i.due_date)}</p></div>
        </header>
        <p className="my-3"><span className="text-muted">Bill to:</span> <b>{school.name}</b>, {[school.address, school.city, school.state].filter(Boolean).join(", ")}</p>
        <table className="w-full border-collapse">
          <thead><tr className="border-y border-ink text-left"><th className="py-1.5">Description</th><th className="py-1.5">SAC</th><th className="py-1.5 text-right">Amount</th></tr></thead>
          <tbody>
            <tr className="border-b border-line"><td className="py-2">School ERP subscription — {i.plan_code} plan, {i.billing_cycle}<br /><span className="text-[12px] text-muted">{fmtDate(i.period_start)} to {fmtDate(i.period_end)}{i.students ? ` · ${i.students} students × ${money(i.rate)}` : ""}</span></td><td className="py-2">998314</td><td className="py-2 text-right">{money(i.amount)}</td></tr>
            {intra ? (<>
              <tr><td className="py-1" colSpan={2}>CGST {Number(i.gst_rate) / 2}%</td><td className="py-1 text-right">{money(Number(i.gst_amount) / 2)}</td></tr>
              <tr><td className="py-1" colSpan={2}>SGST {Number(i.gst_rate) / 2}%</td><td className="py-1 text-right">{money(Number(i.gst_amount) / 2)}</td></tr>
            </>) : <tr><td className="py-1" colSpan={2}>IGST {Number(i.gst_rate)}%</td><td className="py-1 text-right">{money(i.gst_amount)}</td></tr>}
          </tbody>
          <tfoot><tr className="border-y-2 border-ink font-bold"><td className="py-2" colSpan={2}>Total</td><td className="py-2 text-right">{money(i.total)}</td></tr></tfoot>
        </table>
        <p className="my-3">{amountInWords(Number(i.total))}</p>
        <p className="m-0">Status: <b>{i.status === "paid" ? `Paid ${fmtDate(i.paid_at)}${i.payment_ref ? ` · ${i.payment_ref}` : ""}` : i.status === "due" ? "Due" : "Void"}</b></p>
      </article>
    </div>
  );
}
