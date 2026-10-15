import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { fmtDate, money } from "@/lib/format";

type Row = { id: string; no: string; on_date: string; bill_no: string | null; total: number; paid: number; mode: string | null; note: string | null; by_name: string | null;
  supplier: { name: string } | { name: string }[] | null; lines: { qty: number; inventory_items: { name: string; variant: string | null } | { name: string; variant: string | null }[] | null }[] };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function Purchases({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("inventory.purchase.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const { data, count } = await supabase.from("inventory_purchases")
    .select("id,no,on_date,bill_no,total,paid,mode,note,by_name,supplier:inventory_suppliers(name),lines:inventory_purchase_lines(qty,inventory_items(name,variant))", { count: "exact" })
    .eq("school_id", school.id).neq("status", "cancelled").order("on_date", { ascending: false }).order("created_at", { ascending: false }).range(offset, offset + size - 1);
  const R = (data ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="billing" title="Purchases" subtitle="Stock bought from suppliers — each bill raises stock and posts the payment to the day book" back={{ href: "/app/inventory", label: "Inventory" }}
        actions={<>
          <Link href="/app/inventory/suppliers" className="btn btn-sm btn-secondary">Suppliers</Link>
          {can("inventory.purchase.create") && <Link href="/app/inventory/purchases/new" className="btn btn-sm btn-primary">+ New purchase</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      {R.length ? (
        <Table head={["Purchase", "Supplier", "Items", "Bill", "Paid", ""]} minWidth={860}>
          {R.map((p) => {
            const due = Number(p.total) - Number(p.paid);
            return (
              <tr key={p.id}>
                <td className={td}><b className="font-mono text-[13px] text-ink">{p.no}</b><div className="text-[12px] text-muted">{fmtDate(p.on_date)}{p.bill_no ? ` · bill ${p.bill_no}` : ""}</div></td>
                <td className={td}>{one(p.supplier)?.name ?? <span className="text-muted">—</span>}<div className="text-[12px] text-muted">{p.by_name}</div></td>
                <td className={`${td} max-w-[320px] text-[13.5px]`}>{p.lines.map((l) => `${one(l.inventory_items)?.name ?? ""}${one(l.inventory_items)?.variant ? ` (${one(l.inventory_items)!.variant})` : ""} ×${l.qty}`).join(", ")}</td>
                <td className={`${td} font-semibold text-ink`}>{money(p.total)}</td>
                <td className={td}>{money(p.paid)}{due > 0 && <div><Badge value="due" text={`${money(due)} owed`} /></div>}{p.mode && Number(p.paid) > 0 && <div className="text-[12px] text-muted">{p.mode.replace("_", " ")}</div>}</td>
                <td className={`${td} text-[13px] text-muted`}>{p.note}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No purchases recorded yet.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/inventory/purchases" params={{}} />
    </div>
  );
}
