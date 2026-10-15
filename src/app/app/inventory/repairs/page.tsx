import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { loadAssignables } from "@/lib/inventory";
import { fmtDate, money } from "@/lib/format";
import { closeRepair, reportFault } from "../../_actions/inventory";

type Row = { id: string; item_name: string; qty: number; issue: string; location_name: string | null; holder_name: string | null; reported_on: string; status: string; cost: number | null;
  vendor: string | null; closed_on: string | null; result_note: string | null; by_name: string | null; removed: boolean; days_open: number; total: number };

export default async function Repairs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("inventory.assign.view", "inventory.items.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const state = ["open", "fixed", "written_off", "all"].includes(sp.state ?? "") ? sp.state! : "open";
  const [{ data }, forms] = await Promise.all([
    supabase.rpc("inventory_repair_list", { sid: school.id, p_state: state, p_limit: size, p_offset: offset }),
    loadAssignables(supabase, school.id),
  ]);
  const R = (data ?? []) as Row[];
  const total = R[0] ? Number(R[0].total) : 0;
  const back = `/app/inventory/repairs${state !== "open" ? `?state=${state}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="settings" title="Repairs" subtitle="Faults reported in rooms and items that came back needing repair" back={{ href: "/app/inventory", label: "Inventory" }}
        actions={can("inventory.assign.create") || can("inventory.assign.edit") ? (
          <Modal label="+ Report a fault" title="Report a fault" size="sm">
            <form action={reportFault} className="flex flex-col gap-3">
              <input type="hidden" name="back" value={back} />
              <Select label="Item" name="item_id" blank="Choose…" options={forms.items.map((i) => [i.id, `${i.name}${i.variant ? ` (${i.variant})` : ""}`] as [string, string])} />
              <Select label="Where" name="location_id" blank="—" options={forms.locations} />
              <Input label="How many" name="qty" type="number" min={1} defaultValue={1} />
              <Textarea label="What is wrong" name="issue" rows={2} />
              <Submit>Report</Submit>
            </form>
          </Modal>
        ) : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="flex flex-wrap gap-1.5">
        {[["open", "Open"], ["fixed", "Fixed"], ["written_off", "Written off"], ["all", "All"]].map(([k, t]) => (
          <Link key={k} href={`/app/inventory/repairs${k === "open" ? "" : `?state=${k}`}`} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${state === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{t}</Link>
        ))}
      </nav>
      {R.length ? (
        <Table head={["Item", "Fault", "Where / from", "Reported", "Status", ""]} minWidth={900}>
          {R.map((r) => (
            <tr key={r.id}>
              <td className={td}><b className="text-ink">{r.qty} × {r.item_name}</b>{r.removed && <div className="text-[12px] text-muted">taken out of use</div>}</td>
              <td className={`${td} text-[13.5px]`}>{r.issue}</td>
              <td className={td}>{r.location_name ?? r.holder_name ?? "—"}</td>
              <td className={td}>{fmtDate(r.reported_on)}<div className="text-[12px] text-muted">{r.by_name}{r.status === "open" && r.days_open > 0 ? ` · ${r.days_open} days open` : ""}</div></td>
              <td className={td}><Badge value={r.status === "open" ? "pending" : r.status === "fixed" ? "done" : "cancelled"} text={r.status === "written_off" ? "Written off" : r.status === "fixed" ? "Fixed" : "Open"} />
                {r.status !== "open" && <div className="mt-1 text-[12px] text-muted">{[r.closed_on && fmtDate(r.closed_on), r.cost !== null && money(r.cost), r.vendor, r.result_note].filter(Boolean).join(" · ")}</div>}</td>
              <td className={`${td} text-[13px]`}>
                {r.status === "open" && can("inventory.assign.edit") && (
                  <Modal label="Close" variant="link" title={`Close repair — ${r.item_name}`} size="sm">
                    <form action={closeRepair} className="flex flex-col gap-3">
                      <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={r.id} />
                      <Select label="Result" name="result" defaultValue="fixed" options={[["fixed", r.removed ? "Fixed — back to the store" : "Fixed"], ["written_off", "Cannot be fixed — write off"]]} />
                      <Input label="Cost (₹)" name="cost" type="number" min={0} step="1" />
                      <Input label="Repaired by" name="vendor" placeholder="Local electrician" />
                      <Input label="Note" name="note" />
                      <Submit>Close</Submit>
                    </form>
                  </Modal>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{state === "open" ? "No open repairs." : "Nothing here."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/inventory/repairs" params={{ state: state === "open" ? undefined : state }} />
    </div>
  );
}
