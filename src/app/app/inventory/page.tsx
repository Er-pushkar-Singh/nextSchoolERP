import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader, Stat } from "@/components/ui/ui";
import { BarChart, HBars } from "@/components/ui/charts";
import { money } from "@/lib/format";

type Dash = { items: number; units: number; stock_value: number; low: number; out: number; sales_today: number; sales_month: number; bills_month: number; on_fee_account: number; purchases_month: number;
  per_month: { m: string; sales: number; purchases: number }[]; top_items: { name: string; qty: number; amount: number }[]; reorder: { id: string; name: string; on_hand: number; reorder: number }[] };

export default async function Inventory({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("inventory.items.view", "inventory.sales.view", "inventory.purchase.view");
  const sp = await searchParams;
  const { data } = await supabase.rpc("inventory_dashboard", { sid: school.id });
  const D = (data ?? {}) as Dash;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="layers" title="Inventory & sales" subtitle="Uniform, books and stationery — stock, counter sales and purchases"
        actions={<>
          {can("inventory.sales.create") && <Link href="/app/inventory/sell" className="btn btn-sm btn-primary">+ New bill</Link>}
          {can("inventory.purchase.create") && <Link href="/app/inventory/purchases/new" className="btn btn-sm btn-secondary">+ Purchase</Link>}
          {can("inventory.items.view") && <Link href="/app/inventory/items" className="btn btn-sm btn-secondary">Items</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales today" value={money(D.sales_today ?? 0)} icon="fees" tone="green" href="/app/inventory/sales" />
        <Stat label="Sales this month" value={money(D.sales_month ?? 0)} hint={`${D.bills_month ?? 0} bills`} icon="revenue" tone="violet" href="/app/inventory/sales" />
        <Stat label="Stock value (at cost)" value={money(D.stock_value ?? 0)} hint={`${D.items ?? 0} items · ${D.units ?? 0} units`} icon="layers" href="/app/inventory/items" />
        <Stat label="Needs re-ordering" value={(D.low ?? 0) + (D.out ?? 0)} hint={`${D.out ?? 0} out of stock · ${D.low ?? 0} low`} icon="notifications" tone={(D.low ?? 0) + (D.out ?? 0) ? "rose" : "green"} href="/app/inventory/items?state=attention" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting on fee accounts" value={money(D.on_fee_account ?? 0)} hint="charged to students, not yet paid" icon="students" tone="amber" />
        <Stat label="Purchases this month" value={money(D.purchases_month ?? 0)} icon="billing" tone="cyan" href="/app/inventory/purchases" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Sales and purchases" description="Last 6 months" className="lg:col-span-2">
          <BarChart data={(D.per_month ?? []).map((m) => ({ label: m.m, value: Number(m.sales), value2: Number(m.purchases) }))} names={["Sales", "Purchases"]} colors={["#16a34a", "#94a3b8"]}
            format={(n) => (n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))} />
        </Card>
        <Card title="Best sellers (90 days)">
          <HBars data={(D.top_items ?? []).map((t) => ({ label: t.name, value: Number(t.amount), hint: `${t.qty} sold` }))} format={(n) => money(n)} color="#7c3aed" />
        </Card>
      </div>
      <Card title="Re-order list" description="At or below the re-order level" actions={can("inventory.purchase.create") ? <Link href="/app/inventory/purchases/new" className="text-[14px] font-semibold">Record a purchase →</Link> : undefined}>
        {(D.reorder ?? []).length ? (
          <ul className="m-0 grid list-none gap-x-8 gap-y-1 p-0 text-[14px] sm:grid-cols-2">
            {(D.reorder ?? []).map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 border-t border-line py-2">
                <span className="text-ink">{r.name}</span>
                <span><b className={r.on_hand <= 0 ? "text-error" : "text-[#b26a00]"}>{r.on_hand}</b><span className="text-muted"> left · re-order at {r.reorder}</span></span>
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-[14px] text-muted">Every tracked item is above its re-order level.</p>}
      </Card>
    </div>
  );
}
