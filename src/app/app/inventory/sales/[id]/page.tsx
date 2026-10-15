import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Flash } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, money } from "@/lib/format";

type Sale = { id: string; no: string; on_date: string; kind: string; customer_name: string | null; phone: string | null; subtotal: number; discount: number; total: number; mode: string; status: string;
  note: string | null; by_name: string | null; cancelled_reason: string | null; students: { first_name: string; last_name: string | null; admission_no: string; classes: { name: string } | null; sections: { name: string } | null } | null };
type Line = { id: string; item_name: string; qty: number; unit_price: number; line_total: number };
const MODE: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", cheque: "Cheque", bank_transfer: "Bank transfer", fee_account: "Added to the fee account — to be paid at the fee counter" };

export default async function SaleReceipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school } = await requirePerm("inventory.sales.view");
  const [{ data: s }, { data: l }, { data: sc }] = await Promise.all([
    supabase.from("inventory_sales").select("*,students(first_name,last_name,admission_no,classes!class_id(name),sections(name))").eq("id", id).eq("school_id", school.id).maybeSingle(),
    supabase.from("inventory_sale_lines").select("id,item_name,qty,unit_price,line_total").eq("sale_id", id).order("item_name"),
    supabase.from("schools").select("name,address,city,phone").eq("id", school.id).maybeSingle(),
  ]);
  if (!s) notFound();
  const sale = s as unknown as Sale;
  const rows = (l ?? []) as Line[];
  const who = sale.students ? `${sale.students.first_name} ${sale.students.last_name ?? ""}`.trim() : sale.customer_name ?? "Walk-in customer";

  return (
    <div className="mx-auto flex max-w-[620px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/app/inventory/sales" className="text-[14px] font-semibold no-underline">← Sales</Link>
        <PrintButton />
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <article className="rounded-[14px] border border-line bg-white p-6 shadow-[var(--shadow-card)] print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-line pb-3 text-center">
          <h1 className="m-0 text-[20px] font-extrabold text-ink">{sc?.name ?? school.name}</h1>
          <p className="m-0 text-[12.5px] text-muted">{[sc?.address, sc?.city, sc?.phone].filter(Boolean).join(" · ")}</p>
          <p className="mt-2 mb-0 text-[13px] font-bold tracking-wide uppercase">Sale receipt</p>
        </header>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-[14px]">
          <span><b>{who}</b>{sale.students && <span className="text-muted"> · {sale.students.admission_no} · Class {sale.students.classes?.name}{sale.students.sections ? `-${sale.students.sections.name}` : ""}</span>}</span>
          <span className="text-right"><b className="font-mono">{sale.no}</b><br /><span className="text-muted">{fmtDate(sale.on_date)}</span></span>
        </div>
        <table className="mt-3 w-full border-collapse text-[14px]">
          <thead><tr className="border-b border-line text-left text-[12px] tracking-wide text-muted uppercase"><th className="py-1.5">Item</th><th className="py-1.5 text-right">Qty</th><th className="py-1.5 text-right">Rate</th><th className="py-1.5 text-right">Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id} className="border-b border-line"><td className="py-1.5">{r.item_name}</td><td className="py-1.5 text-right">{r.qty}</td><td className="py-1.5 text-right">{money(r.unit_price)}</td><td className="py-1.5 text-right">{money(r.line_total)}</td></tr>)}
          </tbody>
          <tfoot>
            {Number(sale.discount) > 0 && <><tr><td colSpan={3} className="pt-2 text-right text-muted">Subtotal</td><td className="pt-2 text-right">{money(sale.subtotal)}</td></tr><tr><td colSpan={3} className="text-right text-muted">Discount</td><td className="text-right">− {money(sale.discount)}</td></tr></>}
            <tr><td colSpan={3} className="pt-2 text-right text-[15px] font-bold">Total</td><td className="pt-2 text-right text-[17px] font-extrabold text-ink">{money(sale.total)}</td></tr>
          </tfoot>
        </table>
        <p className="mt-3 mb-0 text-[13.5px]"><b>Payment:</b> {MODE[sale.mode] ?? sale.mode}</p>
        {sale.status === "cancelled" && <p className="mt-2 mb-0 rounded-lg bg-[#fdecea] px-3 py-2 text-[13.5px] font-semibold text-[#7a1a12]">CANCELLED — {sale.cancelled_reason}</p>}
        {sale.note && <p className="mt-1 mb-0 text-[13px] text-muted">{sale.note}</p>}
        <p className="mt-5 mb-0 flex justify-between text-[12px] text-muted"><span>Issued by {sale.by_name ?? "—"}</span><span>Goods once sold are exchanged only with this receipt.</span></p>
      </article>
    </div>
  );
}
