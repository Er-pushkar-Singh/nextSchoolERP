import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Empty, Flash, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { PrintButton } from "@/components/ui/PrintButton";
import { AssignForm, ReturnForm, TransferForm } from "@/components/inventory/AssetForms";
import { LocationForm, LOCATION_KINDS } from "@/components/inventory/LocationForm";
import { loadAssignables } from "@/lib/inventory";
import { getClasses } from "@/lib/erp";
import { fmtDate, money } from "@/lib/format";

type Row = { id: string; item_name: string; category: string; qty: number; tag: string | null; assigned_on: string; note: string | null; assigned_by_name: string | null; holder_kind: string };
type Loc = { id: string; name: string; kind: string; class_id: string | null; section_id: string | null; building: string | null; active: boolean; in_charge_staff_id: string | null;
  staff: { name: string } | { name: string }[] | null };

/** One room: everything installed in it, printable as the room's stock register. */
export default async function Room({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; edit?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const { supabase, school, can } = await requirePerm("inventory.assign.view", "inventory.items.view");
  const [{ data: l }, { data }, forms, classes, { data: cost }] = await Promise.all([
    supabase.from("inventory_locations").select("id,name,kind,class_id,section_id,building,active,in_charge_staff_id,staff:staff!in_charge_staff_id(name)").eq("id", id).eq("school_id", school.id).maybeSingle(),
    supabase.rpc("inventory_assignment_list", { sid: school.id, p_state: "active", p_location: id, p_limit: 200, p_offset: 0 }),
    loadAssignables(supabase, school.id),
    getClasses(supabase, school.id),
    supabase.from("inventory_assignments").select("qty,inventory_items(cost)").eq("location_id", id).eq("status", "active"),
  ]);
  if (!l) notFound();
  const loc = l as unknown as Loc;
  const R = (data ?? []) as Row[];
  const units = R.reduce((t, r) => t + r.qty, 0);
  const value = ((cost ?? []) as unknown as { qty: number; inventory_items: { cost: number } | { cost: number }[] | null }[])
    .reduce((t, r) => t + r.qty * Number((Array.isArray(r.inventory_items) ? r.inventory_items[0] : r.inventory_items)?.cost ?? 0), 0);
  const back = `/app/inventory/rooms/${id}`;
  const inCharge = Array.isArray(loc.staff) ? loc.staff[0]?.name : loc.staff?.name;

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <PageHeader icon="school" title={loc.name} subtitle={[LOCATION_KINDS.find(([k]) => k === loc.kind)?.[1], loc.building, inCharge && `in-charge ${inCharge}`].filter(Boolean).join(" · ")}
          back={{ href: "/app/inventory/rooms", label: "Rooms" }}
          actions={<>
            {can("inventory.assign.create") && <Modal label="+ Put an item here" title={`Put an item in ${loc.name}`} size="lg"><AssignForm items={forms.items} locations={forms.locations} back={back} presetLocation={id} initial="location" /></Modal>}
            {can("inventory.items.edit") && <Modal label="Edit room" variant="secondary" title={`Edit ${loc.name}`}>
              <LocationForm loc={loc} back={back} classes={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} sections={classes.flatMap((c) => c.sections.map((s) => [s.id, `${c.name}-${s.name}`] as [string, string]))} />
            </Modal>}
            <PrintButton label="Print room register" />
          </>} />
      </div>
      <Flash ok={sp.ok} error={sp.error} />
      <h1 className="m-0 hidden text-[18px] print:block">{school.name} — {loc.name}: stock register</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:hidden">
        <Stat label="Units in this room" value={units} icon="layers" />
        <Stat label="Kinds of items" value={new Set(R.map((r) => r.item_name)).size} icon="layers" tone="cyan" />
        <Stat label="Value (at cost)" value={money(value)} icon="revenue" tone="green" />
      </div>
      {R.length ? (
        <Table head={["Item", "Qty", "Tag", "Since", "Note", ""]} minWidth={760}>
          {R.map((r) => (
            <tr key={r.id}>
              <td className={td}><b className="text-ink">{r.item_name}</b><div className="text-[12px] text-muted">{r.category}</div></td>
              <td className={`${td} font-bold text-ink`}>{r.qty}</td>
              <td className={`${td} font-mono text-[13px]`}>{r.tag ?? "—"}</td>
              <td className={td}>{fmtDate(r.assigned_on)}<div className="text-[12px] text-muted">{r.assigned_by_name}</div></td>
              <td className={`${td} text-[13px]`}>{r.note ?? ""}</td>
              <td className={`${td} whitespace-nowrap text-[13px] print:hidden`}>
                {can("inventory.assign.edit") && (
                  <div className="flex flex-col items-start gap-1">
                    <Modal label="Take back" variant="link" title={`Take back — ${r.item_name}`} size="sm"><ReturnForm id={r.id} qty={r.qty} holderKind={r.holder_kind} back={back} /></Modal>
                    <Modal label="Move" variant="link" title={`Move ${r.qty} × ${r.item_name}`}><TransferForm id={r.id} locations={forms.locations.filter(([x]) => x !== id)} back={back} /></Modal>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>Nothing is recorded in this room yet.</Empty>}
      <p className="m-0 text-[12.5px] text-muted print:hidden"><Link href={`/app/inventory/assignments?state=all&q=${encodeURIComponent(loc.name)}`}>Full history of this room →</Link></p>
      <div className="mt-10 hidden justify-between text-[13px] print:flex"><span>Checked by: ____________________</span><span>Room in-charge: ____________________</span><span>Date: ____________</span></div>
    </div>
  );
}
