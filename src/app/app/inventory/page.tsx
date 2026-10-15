import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader, Stat } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { HBars } from "@/components/ui/charts";
import { AssignForm } from "@/components/inventory/AssetForms";
import { loadAssignables } from "@/lib/inventory";
import { money } from "@/lib/format";

type O = { kinds: number; in_store: number; assigned: number; with_people: number; in_rooms: number; overdue: number; repairs: number; low: number; value: number;
  by_category: { name: string; units: number }[]; recent: { at: string; by: string | null; action: string; detail: string | null }[] };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

export default async function Inventory({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("inventory.items.view", "inventory.assign.view", "inventory.sales.view", "inventory.purchase.view");
  const sp = await searchParams;
  if (!can("inventory.items.view") && !can("inventory.assign.view")) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader icon="layers" title="Inventory" subtitle="Your access covers the shop only" />
        <Link href="/app/inventory/shop" className="btn btn-primary w-fit">Open the uniform & book shop</Link>
      </div>
    );
  }
  const [{ data }, forms] = await Promise.all([
    supabase.rpc("inventory_overview", { sid: school.id }),
    can("inventory.assign.create") ? loadAssignables(supabase, school.id) : Promise.resolve({ items: [], locations: [] as [string, string][] }),
  ]);
  const o = (data ?? {}) as Partial<O>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="layers" title="Inventory & assets" subtitle="Everything the school owns — in the store, in each room, and with each person"
        actions={<>
          {can("inventory.assign.create") && <Modal label="+ Give an item" title="Give school property" size="lg"><AssignForm items={forms.items} locations={forms.locations} back="/app/inventory" /></Modal>}
          {can("inventory.items.view") && <Link href="/app/inventory/items" className="btn btn-sm btn-secondary">Items & stock</Link>}
          <Link href="/app/inventory/rooms" className="btn btn-sm btn-secondary">Rooms</Link>
          {can("inventory.sales.view") && <Link href="/app/inventory/shop" className="btn btn-sm btn-secondary">Shop</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In the store" value={o.in_store ?? 0} hint={`${o.kinds ?? 0} kinds of items`} icon="layers" href="/app/inventory/items" />
        <Stat label="Installed in rooms" value={o.in_rooms ?? 0} icon="school" tone="cyan" href="/app/inventory/rooms" />
        <Stat label="With staff & students" value={o.with_people ?? 0} icon="students" tone="violet" href="/app/inventory/assignments?holder=staff" />
        <Stat label="Value (at cost)" value={money(o.value ?? 0)} icon="revenue" tone="green" />
        <Stat label="Return overdue" value={o.overdue ?? 0} icon="notifications" tone={o.overdue ? "rose" : "green"} href="/app/inventory/assignments?state=overdue" />
        <Stat label="Open repairs" value={o.repairs ?? 0} icon="settings" tone={o.repairs ? "amber" : "green"} href="/app/inventory/repairs" />
        <Stat label="Low in the store" value={o.low ?? 0} hint="at or below the re-order level" icon="layers" tone={o.low ? "amber" : "green"} href="/app/inventory/items?state=attention" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What the school owns" description="Units by category — store + rooms + people">
          <HBars data={(o.by_category ?? []).map((c) => ({ label: c.name, value: Number(c.units) }))} />
        </Card>
        <Card title="Latest movements" actions={<Link href="/app/inventory/assignments?state=all" className="text-[14px] font-semibold">All →</Link>}>
          {(o.recent ?? []).length ? (
            <ul className="m-0 list-none p-0 text-[13.5px]">
              {(o.recent ?? []).map((r, i) => (
                <li key={i} className="border-t border-line py-2 first:border-0">
                  <span className="font-semibold text-ink capitalize">{r.action}</span> <span className="text-body">{r.detail}</span>
                  <div className="text-[12px] text-muted">{when(r.at)}{r.by ? ` · ${r.by}` : ""}</div>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[13px] text-muted">Nothing has been given out yet.</p>}
        </Card>
      </div>
      <Card title="How it works">
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[14px] text-body">
          <li>Add the <Link href="/app/inventory/rooms">rooms &amp; places</Link> (one click creates a classroom for every section).</li>
          <li>Add the <Link href="/app/inventory/items">items</Link> with the quantity in the store (or record a <Link href="/app/inventory/purchases/new">purchase</Link>).</li>
          <li><b>Give</b> them out: fans and benches to rooms, laptops and keys to staff, books or kits to students — with a return date when it must come back.</li>
          <li>Staff and parents get an email when something is given and when it is returned; a reminder goes out every week once it is overdue.</li>
          <li>On return, choose the condition: good (back to the store), needs repair, damaged or lost — a student&apos;s damage can be charged to the fee account.</li>
        </ol>
      </Card>
    </div>
  );
}
