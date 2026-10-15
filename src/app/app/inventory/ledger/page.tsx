import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";

type Row = { id: number; created_at: string; item_id: string; item_name: string; kind: string; qty: number; unit_cost: number | null; party: string | null; note: string | null; by_name: string | null; total: number };
const KIND: [string, string][] = [["purchase", "Purchase"], ["sale", "Sale"], ["sale_return", "Sale cancelled"], ["issue", "Issued"], ["issue_return", "Issue returned"], ["adjust", "Correction"], ["damage", "Damaged / lost"], ["stock_take", "Stock take"], ["opening", "Opening stock"]];
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

export default async function Ledger({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school } = await requirePerm("inventory.items.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const item = sp.item && /^[0-9a-f-]{36}$/.test(sp.item) ? sp.item : null;
  const kind = KIND.some(([k]) => k === sp.kind) ? sp.kind! : null;
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const from = ok(sp.from), to = ok(sp.to);
  const { data } = await supabase.rpc("inventory_move_list", { sid: school.id, p_item: item, p_kind: kind, p_from: from, p_to: to, p_limit: size, p_offset: offset });
  const R = (data ?? []) as Row[];
  const total = R[0] ? Number(R[0].total) : 0;
  const params = { item: item ?? undefined, kind: kind ?? undefined, from: from ?? undefined, to: to ?? undefined };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="layers" title="Stock ledger" subtitle="Every change of stock — who, when and why" back={{ href: "/app/inventory/items", label: "Items" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        {item && <input type="hidden" name="item" value={item} />}
        <Select label="Type" name="kind" blank="All" defaultValue={kind} options={KIND} />
        <Input label="From" name="from" type="date" defaultValue={from} /><Input label="To" name="to" type="date" defaultValue={to} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        {item && <Link href="/app/inventory/ledger" className="pb-2 text-[14px]">All items</Link>}
      </form>
      {R.length ? (
        <Table head={["When", "Item", "Change", "Type", "Who / note"]} minWidth={760}>
          {R.map((m) => (
            <tr key={m.id}>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{when(m.created_at)}</td>
              <td className={td}><Link href={`/app/inventory/ledger?item=${m.item_id}`} className="font-semibold">{m.item_name}</Link></td>
              <td className={`${td} font-bold ${m.qty < 0 ? "text-error" : "text-[#15803d]"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
              <td className={td}><Badge value="normal" text={KIND.find(([k]) => k === m.kind)?.[1] ?? m.kind} /></td>
              <td className={`${td} text-[13.5px]`}>{[m.party, m.note].filter(Boolean).join(" · ") || "—"}<div className="text-[12px] text-muted">{m.by_name}</div></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No stock movement matches.</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/inventory/ledger" params={params} />
    </div>
  );
}
