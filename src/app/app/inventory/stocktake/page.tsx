import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Empty, Flash, PageHeader, Select, Submit, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { stockTake } from "../../_actions/inventory";

const SIZES = [50, 100, 200] as const;
type Row = { id: string; name: string; variant: string | null; category: string; on_hand: number; unit: string; location: string | null; total: number };

/** Count what is on the shelf and type it in; only the items that differ become corrections in the ledger. */
export default async function StockTake({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school } = await requirePerm("inventory.items.edit");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp, 50, SIZES);
  const category = (sp.category ?? "").slice(0, 40) || null;
  const [{ data }, { data: cats }] = await Promise.all([
    supabase.rpc("inventory_item_list", { sid: school.id, p_category: category, p_active: "yes", p_limit: size, p_offset: offset }),
    supabase.from("inventory_items").select("category").eq("school_id", school.id).eq("track_stock", true).limit(2000),
  ]);
  const R = ((data ?? []) as (Row & { track_stock: boolean })[]).filter((r) => r.track_stock);
  const total = (data as Row[] | null)?.[0] ? Number((data as Row[])[0].total) : 0;
  const categories = [...new Set((cats ?? []).map((c) => c.category as string))].sort();
  const back = `/app/inventory/stocktake${category ? `?category=${encodeURIComponent(category)}` : ""}`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="layers" title="Stock take" subtitle="Count the shelf, type what you counted. Leave a box empty to skip an item." back={{ href: "/app/inventory/items", label: "Items" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <Select label="Category" name="category" blank="All" defaultValue={category} options={categories} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {R.length ? (
        <form action={stockTake} className="flex flex-col gap-3">
          <input type="hidden" name="back" value={back} />
          <div className="overflow-x-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
            <table className="w-full border-collapse text-[14px]" style={{ minWidth: 560 }}>
              <thead><tr className="bg-blue-soft text-left text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase"><th className="px-3 py-3">Item</th><th className="px-3 py-3">Location</th><th className="px-3 py-3 text-right">In the system</th><th className="px-3 py-3">Counted</th></tr></thead>
              <tbody>
                {R.map((r) => (
                  <tr key={r.id}>
                    <td className={td}><b className="text-ink">{r.name}</b>{r.variant ? <span className="text-muted"> · {r.variant}</span> : null}<div className="text-[12px] text-muted">{r.category}</div></td>
                    <td className={td}>{r.location ?? "—"}</td>
                    <td className={`${td} text-right font-semibold`}>{r.on_hand} <span className="font-normal text-muted">{r.unit}</span></td>
                    <td className={td}><input name={`c_${r.id}`} type="number" min={0} inputMode="numeric" className="input !min-h-9 !w-24 !py-1 text-[14px]" aria-label={`Counted ${r.name}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3"><Submit>Save the count</Submit><Link href="/app/inventory/items" className="text-[14px]">Cancel</Link></div>
        </form>
      ) : <Empty>No counted item here.</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/inventory/stocktake" sizes={SIZES} params={{ category: category ?? undefined }} />
    </div>
  );
}
