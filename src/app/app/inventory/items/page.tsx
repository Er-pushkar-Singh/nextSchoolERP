import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { getClasses } from "@/lib/erp";
import { money } from "@/lib/format";
import { adjustStock, issueItem, saveItem } from "../../_actions/inventory";

type Row = { id: string; sku: string | null; name: string; category: string; variant: string | null; unit: string; cost: number; price: number; reorder_level: number; track_stock: boolean;
  on_hand: number; stock_value: number; active: boolean; class_name: string | null; location: string | null; sold_30: number; state: string; total: number };
type Full = Row & { gst_rate: number; for_class_id: string | null; barcode: string | null; note: string | null };
const STATE: Record<string, [string, string]> = { ok: ["done", "In stock"], low: ["warn", "Low"], out: ["overdue", "Out"], na: ["muted", "Not counted"] };

function ItemForm({ item, back, classes, categories }: { item?: Full | null; back: string; classes: { id: string; name: string }[]; categories: string[] }) {
  return (
    <form action={saveItem} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="back" value={back} />
      {item && <input type="hidden" name="id" value={item.id} />}
      <Input label="Item name" name="name" required defaultValue={item?.name} className="sm:col-span-2" placeholder="School shirt, Maths textbook…" />
      <Input label="SKU / code" name="sku" defaultValue={item?.sku} />
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Category
        <input name="category" list="inv-cats" defaultValue={item?.category ?? "Uniform"} className="input !min-h-10 !py-2 text-[15px] font-normal" />
        <datalist id="inv-cats">{[...new Set(["Uniform", "Books", "Stationery", "Sports", "Lab", "General", ...categories])].map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <Input label="Size / variant" name="variant" defaultValue={item?.variant} placeholder="32, M, Class 5…" />
      <Input label="Unit" name="unit" defaultValue={item?.unit ?? "pcs"} />
      <Input label="Cost price (₹)" name="cost" type="number" min={0} step="0.01" defaultValue={item?.cost ?? 0} />
      <Input label="Selling price (₹)" name="price" type="number" min={0} step="0.01" defaultValue={item?.price ?? 0} />
      <Input label="Re-order at" name="reorder_level" type="number" min={0} defaultValue={item?.reorder_level ?? 0} hint="Low-stock alert at or below this" />
      <Select label="Meant for class" name="for_class_id" blank="Any" defaultValue={item?.for_class_id} options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
      <Input label="Shelf / location" name="location" defaultValue={item?.location} />
      <Input label="Barcode" name="barcode" defaultValue={item?.barcode} />
      {!item && <Input label="Opening stock" name="opening" type="number" min={0} defaultValue={0} hint="What is on the shelf today" />}
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="track_stock" value="on" defaultChecked={item?.track_stock ?? true} /> Count stock for this item</label>
      {item && <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="active" defaultChecked={item.active} /> Active (can be sold)</label>}
      <div className="sm:col-span-3"><Submit>{item ? "Save item" : "Add item"}</Submit></div>
    </form>
  );
}

export default async function Items({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("inventory.items.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = (sp.q ?? "").trim().slice(0, 60);
  const category = (sp.category ?? "").slice(0, 40) || null;
  const state = ["out", "low", "attention", "ok"].includes(sp.state ?? "") ? sp.state! : null;
  const active = sp.active === "no" || sp.active === "all" ? sp.active : "yes";
  const editId = sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) && can("inventory.items.edit") ? sp.edit : null;
  const [{ data }, classes, { data: cats }, edit] = await Promise.all([
    supabase.rpc("inventory_item_list", { sid: school.id, p_q: q || null, p_category: category, p_state: state, p_active: active, p_limit: size, p_offset: offset }),
    getClasses(supabase, school.id),
    supabase.from("inventory_items").select("category").eq("school_id", school.id).limit(2000),
    editId ? supabase.from("inventory_items").select("*").eq("id", editId).eq("school_id", school.id).maybeSingle().then((r) => r.data as (Full & { for_class_id: string | null }) | null) : Promise.resolve(null),
  ]);
  const R = (data ?? []) as Row[];
  const total = R[0] ? Number(R[0].total) : 0;
  const categories = [...new Set((cats ?? []).map((c) => c.category as string))].sort();
  const params = { q: q || undefined, category: category ?? undefined, state: state ?? undefined, active: active === "yes" ? undefined : active };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const base = `/app/inventory/items${qs ? `?${qs}` : ""}`;
  const cls = classes.map((c) => ({ id: c.id, name: c.name }));
  const edits = can("inventory.items.edit");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="layers" title="Items & stock" subtitle={`${total} item${total === 1 ? "" : "s"}`} back={{ href: "/app/inventory", label: "Inventory" }}
        actions={<>
          {edits && <Link href="/app/inventory/stocktake" className="btn btn-sm btn-secondary">Stock take</Link>}
          <Link href="/app/inventory/ledger" className="btn btn-sm btn-secondary">Stock ledger</Link>
          {can("inventory.items.create") && <Modal label="+ Add item" title="Add an item" size="lg"><ItemForm back={base} classes={cls} categories={categories} /></Modal>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Name, SKU, size, category" className="input !min-h-10 w-60 !py-2 text-[15px] font-normal" /></label>
        <Select label="Category" name="category" blank="All" defaultValue={category} options={categories} />
        <Select label="Stock" name="state" blank="Any" defaultValue={state} options={[["attention", "Needs re-ordering"], ["low", "Low"], ["out", "Out of stock"], ["ok", "Fine"]]} />
        <Select label="Show" name="active" defaultValue={active} options={[["yes", "Active"], ["no", "Withdrawn"], ["all", "All"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
        {(q || category || state || active !== "yes") && <Link href="/app/inventory/items" className="pb-2 text-[14px]">Clear</Link>}
      </form>
      {R.length ? (
        <Table head={["Item", "Category", "Price", "In stock", "Value", "Sold (30 days)", ""]} minWidth={940}>
          {R.map((i) => {
            const [tone, text] = STATE[i.state] ?? STATE.ok;
            return (
              <tr key={i.id} className={i.active ? "" : "opacity-60"}>
                <td className={td}><b className="text-ink">{i.name}</b>{i.variant ? <span className="text-muted"> · {i.variant}</span> : null}{!i.active && <> <Badge value="muted" text="Withdrawn" /></>}
                  <div className="text-[12px] text-muted">{[i.sku, i.class_name && `Class ${i.class_name}`, i.location].filter(Boolean).join(" · ")}</div></td>
                <td className={td}>{i.category}</td>
                <td className={td}>{money(i.price)}<div className="text-[12px] text-muted">cost {money(i.cost)}</div></td>
                <td className={td}>{i.track_stock ? <><b className="text-ink">{i.on_hand}</b> <span className="text-muted">{i.unit}</span> <Badge value={tone === "done" ? "done" : tone === "warn" ? "high" : tone === "overdue" ? "overdue" : "muted"} text={text} />
                  {i.reorder_level > 0 && <div className="text-[12px] text-muted">re-order at {i.reorder_level}</div>}</> : <span className="text-muted">not counted</span>}</td>
                <td className={td}>{i.track_stock ? money(i.stock_value) : "—"}</td>
                <td className={td}>{i.sold_30 || "—"}</td>
                <td className={`${td} whitespace-nowrap text-[13px]`}>
                  <div className="flex flex-col items-start gap-1">
                    {edits && i.track_stock && (
                      <Modal label="Stock" variant="link" title={`Stock — ${i.name}${i.variant ? ` (${i.variant})` : ""}`} size="sm">
                        <p className="mt-0 text-[13px] text-muted">In stock now: <b>{i.on_hand}</b></p>
                        <form action={adjustStock} className="grid gap-3 sm:grid-cols-2">
                          <input type="hidden" name="back" value={base} /><input type="hidden" name="item_id" value={i.id} />
                          <Select label="What happened" name="kind" defaultValue="adjust" options={[["adjust", "Correction"], ["damage", "Damaged / lost — write off"], ["opening", "Add opening stock"]]} />
                          <Select label="Correction goes" name="direction" defaultValue="in" options={[["in", "Add to stock"], ["out", "Take out of stock"]]} />
                          <Input label="How many" name="qty" type="number" min={1} required />
                          <Input label="Note" name="note" />
                          <div className="sm:col-span-2"><Submit>Save</Submit></div>
                        </form>
                        <hr className="my-4 border-line" />
                        <h3 className="m-0 mb-2 text-[14px] font-bold">Issue to a teacher / class (no bill)</h3>
                        <form action={issueItem} className="grid gap-3 sm:grid-cols-2">
                          <input type="hidden" name="back" value={base} /><input type="hidden" name="item_id" value={i.id} />
                          <Input label="Issued to" name="to" required placeholder="Mrs Verma — Class 5" />
                          <Input label="How many" name="qty" type="number" min={1} required />
                          <Input label="Note" name="note" className="sm:col-span-2" />
                          <div className="flex gap-2 sm:col-span-2"><Submit>Issue</Submit><button name="return" value="1" className="btn btn-sm btn-secondary cursor-pointer">Mark as returned</button></div>
                        </form>
                      </Modal>
                    )}
                    {edits && <Link href={`${base}${qs ? "&" : "?"}edit=${i.id}`}>Edit</Link>}
                    <Link href={`/app/inventory/ledger?item=${i.id}`}>History</Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{q || category || state ? "No item matches." : "No items yet — add the first uniform, book or stationery item."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/inventory/items" params={params} />
      {edit && <Modal defaultOpen closeHref={base} title={`Edit: ${edit.name}`} size="lg"><ItemForm item={edit} back={base} classes={cls} categories={categories} /></Modal>}
    </div>
  );
}
