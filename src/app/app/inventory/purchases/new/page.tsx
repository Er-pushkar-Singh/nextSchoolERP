import { requirePerm } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Select } from "@/components/ui/ui";
import { Cart, type CartItem } from "@/components/inventory/Cart";
import { todayIST } from "@/lib/format";
import { savePurchase } from "../../../_actions/inventory";

type Row = { id: string; sku: string | null; name: string; category: string; variant: string | null; unit: string; cost: number; price: number; track_stock: boolean; on_hand: number; class_name: string | null };

export default async function NewPurchase({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("inventory.purchase.create");
  const sp = await searchParams;
  const [{ data }, { data: sup }] = await Promise.all([
    supabase.rpc("inventory_item_list", { sid: school.id, p_active: "yes", p_limit: 200, p_offset: 0 }),
    supabase.from("inventory_suppliers").select("id,name").eq("school_id", school.id).eq("active", true).order("name"),
  ]);
  const items: CartItem[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id, name: r.name, variant: r.variant, category: r.category, sku: r.sku, price: Number(r.price), cost: Number(r.cost), on_hand: r.on_hand, track: r.track_stock, unit: r.unit, cls: r.class_name,
  }));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="billing" title="New purchase" subtitle="Record the goods received and what was paid" back={{ href: "/app/inventory/purchases", label: "Purchases" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {items.length === 0 ? <Card title="No items yet">Create the items first under <a href="/app/inventory/items">Items &amp; stock</a>.</Card> : (
        <form action={savePurchase} className="flex flex-col gap-4">
          <Card title="Bill">
            <div className="grid gap-3 sm:grid-cols-4">
              <Select label="Supplier" name="supplier_id" blank="— not recorded —" options={(sup ?? []).map((s) => [s.id, s.name] as [string, string])} />
              <Input label="Supplier's bill no." name="bill_no" />
              <Input label="Date" name="on_date" type="date" defaultValue={todayIST()} max={todayIST()} />
              <Input label="Note" name="note" />
            </div>
          </Card>
          <Cart items={items} mode="purchase" />
          <Card title="Payment to the supplier">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Amount paid now (₹)" name="paid" type="number" min={0} step="0.01" defaultValue={0} hint="Leave 0 if it is on credit" />
              <Select label="Paid by" name="mode" defaultValue="cash" options={[["cash", "Cash"], ["upi", "UPI"], ["cheque", "Cheque"], ["bank_transfer", "Bank transfer"], ["card", "Card"]]} />
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
