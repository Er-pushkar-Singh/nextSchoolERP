import { requirePerm } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Select, Textarea } from "@/components/ui/ui";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Cart, type CartItem } from "@/components/inventory/Cart";
import { sellItems } from "../../_actions/inventory";
import { CounterCustomer } from "@/components/inventory/CounterCustomer";

type Row = { id: string; sku: string | null; name: string; category: string; variant: string | null; unit: string; cost: number; price: number; track_stock: boolean; on_hand: number; class_name: string | null };

export default async function Sell({ searchParams }: { searchParams: Promise<{ student?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("inventory.sales.create");
  const sp = await searchParams;
  const { data } = await supabase.rpc("inventory_item_list", { sid: school.id, p_active: "yes", p_limit: 200, p_offset: 0, p_kind: "shop" });
  const items: CartItem[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id, name: r.name, variant: r.variant, category: r.category, sku: r.sku, price: Number(r.price), cost: Number(r.cost), on_hand: r.on_hand, track: r.track_stock, unit: r.unit, cls: r.class_name,
  }));
  const pre = sp.student && /^[0-9a-f-]{36}$/.test(sp.student)
    ? (await supabase.from("students").select("id,first_name,last_name,admission_no").eq("id", sp.student).eq("school_id", school.id).maybeSingle()).data
    : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="New bill" subtitle="Pick the customer, tap the items, choose how it is paid" back={{ href: "/app/inventory/shop", label: "Shop" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {items.length === 0 ? (
        <Card title="No items yet">Add uniform, books or stationery under <a href="/app/inventory/items">Items & stock</a> first.</Card>
      ) : (
        <form action={sellItems} className="flex flex-col gap-4">
          <Card title="Customer">
            <CounterCustomer
              student={<EntityPicker kind="student" name="student_id" label="Student" required initial={pre ? { id: pre.id, label: `${pre.first_name} ${pre.last_name ?? ""}`.trim(), sub: pre.admission_no } : null} placeholder="Click to choose, or type a name / admission no." />}
              staff={<EntityPicker kind="staff" name="staff_id" label="Staff member" required />}
              walkin={<div className="grid gap-3 sm:grid-cols-2"><Input label="Customer name" name="customer_name" /><Input label="Phone" name="phone" type="tel" /></div>} />
          </Card>
          <Cart items={items} mode="sale" canPrice={can("inventory.sales.edit")} />
          <Card title="Payment">
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="How is it paid" name="mode" defaultValue="cash" options={[["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["cheque", "Cheque"], ["bank_transfer", "Bank transfer"], ["fee_account", "Add to the student's fee account (pay later)"]]} className="sm:col-span-2" />
              <Textarea label="Note" name="note" rows={1} />
            </div>
            <p className="m-0 mt-2 text-[12.5px] text-muted">Paid bills go straight into the day book. A bill added to the fee account shows as “Uniform &amp; Books” in the student&apos;s fees and is collected at the fee counter.</p>
          </Card>
        </form>
      )}
    </div>
  );
}
