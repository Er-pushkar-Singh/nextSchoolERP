import Link from "next/link";
import { requirePlatform } from "@/lib/platform";
import { Badge, Empty, Flash, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { fmtDate, money, todayIST } from "@/lib/format";
import type { SubInvoice } from "@/lib/billing";
import { markInvoicePaid, voidInvoice } from "../actions";

export default async function Billing({ searchParams }: { searchParams: Promise<{ status?: string; from?: string; to?: string; q?: string; ok?: string; error?: string }> }) {
  const { supabase, can } = await requirePlatform("billing");
  const sp = await searchParams;
  const today = todayIST();
  const status = ["due", "paid", "void", "overdue"].includes(sp.status ?? "") ? sp.status! : "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : `${today.slice(0, 4)}-01-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  let q = supabase.from("subscription_invoices").select("*, schools(name,code)").gte("created_at", `${from}T00:00:00+05:30`).lte("created_at", `${to}T23:59:59+05:30`);
  if (status === "overdue") q = q.eq("status", "due").lt("due_date", today); else if (status) q = q.eq("status", status);
  const { data } = await q.order("created_at", { ascending: false }).limit(1000);
  let rows = (data ?? []) as unknown as (SubInvoice & { schools: { name: string; code: string } | null })[];
  const term = (sp.q ?? "").toLowerCase().trim();
  if (term) rows = rows.filter((r) => `${r.number} ${r.schools?.name} ${r.schools?.code}`.toLowerCase().includes(term));
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((t, r) => t + Number(r.total), 0);
  const paid = sum((r) => r.status === "paid"), due = sum((r) => r.status === "due"), overdue = sum((r) => r.status === "due" && r.due_date < today);
  const gst = rows.filter((r) => r.status === "paid").reduce((t, r) => t + Number(r.gst_amount), 0);
  const qs = new URLSearchParams({ from, to, ...(status ? { status } : {}) });
  const back = `/platform/billing?${qs}`;
  const W = can("billing", true);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="billing" title="Billing & revenue" subtitle={`Invoices created ${fmtDate(from)} – ${fmtDate(to)}`} actions={<a href={`/platform/billing/export?${qs}`} className="btn btn-sm btn-secondary" data-no-loader>Download CSV</a>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="revenue" tone="green" label="Collected (incl. GST)" value={money(paid)} hint={`GST ${money(gst)} · net ${money(paid - gst)}`} />
        <Stat icon="billing" tone="amber" label="Unpaid" value={money(due)} href="/platform/billing?status=due" />
        <Stat icon="notifications" tone="rose" label="Overdue" value={money(overdue)} href="/platform/billing?status=overdue" />
        <Stat icon="layers" tone="blue" label="Invoices" value={rows.length} />
      </div>
      <form className="flex flex-wrap items-end gap-2">
        <label className="text-[13px] font-semibold">From<input type="date" name="from" defaultValue={from} className="input !min-h-10 !py-2" /></label>
        <label className="text-[13px] font-semibold">To<input type="date" name="to" defaultValue={to} className="input !min-h-10 !py-2" /></label>
        <label className="text-[13px] font-semibold">Status<select name="status" defaultValue={status} className="input !min-h-10 !py-2"><option value="">All</option><option value="due">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option></select></label>
        <input name="q" defaultValue={sp.q} placeholder="School or invoice no." className="input !min-h-10 max-w-xs !py-2" aria-label="Search" />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {rows.length ? (
        <Table head={["Invoice", "School", "Plan", "Period", "Amount", "GST", "Total", "Status", ""]} minWidth={1100}>
          {rows.map((i) => (
            <tr key={i.id}>
              <td className={`${td} font-mono text-[12px]`}>{i.number}<div className="font-sans text-[11px] text-muted">{fmtDate(i.created_at)}</div></td>
              <td className={td}><Link href={`/platform/tenants/${i.school_id}?tab=subscription`} className="font-semibold">{i.schools?.name}</Link></td>
              <td className={td}>{i.plan_code} · {i.billing_cycle}</td>
              <td className={`${td} text-[13px]`}>{fmtDate(i.period_start)} – {fmtDate(i.period_end)}</td>
              <td className={td}>{money(i.amount)}</td>
              <td className={td}>{money(i.gst_amount)}</td>
              <td className={`${td} font-semibold text-ink`}>{money(i.total)}</td>
              <td className={td}><Badge value={i.status === "due" ? (i.due_date < today ? "overdue" : "due") : i.status === "void" ? "cancelled" : "paid"} text={i.status === "due" && i.due_date < today ? "overdue" : i.status} />{i.paid_at && <div className="text-[11px] text-muted">{fmtDate(i.paid_at)} {i.payment_ref ?? ""}</div>}</td>
              <td className={td}>
                {i.status === "due" && W && (
                  <div className="flex flex-col gap-1">
                    <form action={markInvoicePaid} className="flex gap-1"><input type="hidden" name="school_id" value={i.school_id} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={back} /><input name="ref" placeholder="UTR" className="w-20 rounded-md border border-line px-1.5 py-1 text-[12px]" /><button className="cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-[12px]">Paid</button></form>
                    <form action={voidInvoice}><input type="hidden" name="school_id" value={i.school_id} /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={back} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-error underline">void</button></form>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No invoices in this period.</Empty>}
    </div>
  );
}
