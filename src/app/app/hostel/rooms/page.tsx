import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Submit } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { money } from "@/lib/format";
import { allocateBed, saveHostel, saveRoom, vacateBed } from "../../_actions/hostel";

type Room = { room_id: string; room_no: string; floor: number; beds: number; room_type: string; monthly_fee: number; active: boolean; occupants: { alloc: string; bed: number; student: string; name: string; class: string | null }[] };
type Hostel = { id: string; name: string; kind: string; warden_id: string | null; address: string | null; active: boolean };

function RoomForm({ hostel, r, back }: { hostel: string; r?: Room; back: string }) {
  return (
    <form action={saveRoom} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} /><input type="hidden" name="hostel_id" value={hostel} />
      {r && <input type="hidden" name="id" value={r.room_id} />}
      <Input label="Room no." name="room_no" required defaultValue={r?.room_no} />
      <Input label="Floor" name="floor" type="number" min={0} max={30} defaultValue={r?.floor ?? 0} hint="0 = ground floor" />
      <Input label="Beds" name="beds" type="number" min={1} max={40} defaultValue={r?.beds ?? 4} />
      <Select label="Type" name="room_type" defaultValue={r?.room_type ?? "dormitory"} options={[["dormitory", "Dormitory"], ["double", "Double"], ["single", "Single"]]} />
      <Input label="Monthly fee per bed (₹)" name="monthly_fee" type="number" min={0} step="1" defaultValue={r?.monthly_fee ?? 0} className="sm:col-span-2" />
      {r && <label className="flex items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" name="active" defaultChecked={r.active} /> Room in use</label>}
      <div className="sm:col-span-2"><Submit>{r ? "Save room" : "Add room"}</Submit></div>
    </form>
  );
}

export default async function Rooms({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("hostel.rooms.view");
  const sp = await searchParams;
  const { data: hs } = await supabase.from("hostels").select("id,name,kind,warden_id,address,active").eq("school_id", school.id).order("name");
  const hostels = (hs ?? []) as Hostel[];
  const cur = hostels.find((h) => h.id === sp.hostel) ?? hostels[0] ?? null;
  const { data } = cur ? await supabase.rpc("hostel_room_grid", { sid: school.id, p_hostel: cur.id }) : { data: [] };
  const rooms = (data ?? []) as Room[];
  const base = `/app/hostel/rooms${cur ? `?hostel=${cur.id}` : ""}`;
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b);
  const editRoom = sp.room ? rooms.find((r) => r.room_id === sp.room) ?? null : null;
  const canAllocate = can("hostel.allocation.create");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="hostel" title="Rooms & beds" subtitle={cur ? `${cur.name} · ${rooms.length} rooms` : "Create a hostel first"} back={{ href: "/app/hostel", label: "Hostel" }}
        actions={cur && can("hostel.rooms.create") ? <Modal label="+ Add room" title={`Add room to ${cur.name}`} size="sm"><RoomForm hostel={cur.id} back={base} /></Modal> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      {hostels.length > 1 && (
        <nav className="flex flex-wrap gap-1.5" aria-label="Hostel">
          {hostels.map((h) => <Link key={h.id} href={`/app/hostel/rooms?hostel=${h.id}`} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${h.id === cur?.id ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{h.name}</Link>)}
        </nav>
      )}
      {cur && can("hostel.rooms.edit") && (
        <details className="rounded-[12px] border border-line bg-white px-4 py-2.5 text-[14px]">
          <summary className="cursor-pointer font-semibold text-ink">Hostel details — {cur.name} ({cur.kind}){!cur.active ? " · closed" : ""}</summary>
          <form action={saveHostel} className="mt-3 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="back" value={base} /><input type="hidden" name="id" value={cur.id} />
            <Input label="Name" name="name" required defaultValue={cur.name} />
            <Select label="For" name="kind" defaultValue={cur.kind} options={[["boys", "Boys"], ["girls", "Girls"], ["mixed", "Mixed"]]} />
            <Input label="Address / block" name="address" defaultValue={cur.address} />
            <EntityPicker kind="staff" name="warden_id" label="Warden (leave to keep)" placeholder="Search staff" />
            <label className="flex items-center gap-2 self-end pb-2 text-[14px]"><input type="checkbox" name="active" defaultChecked={cur.active} /> Hostel in use</label>
            <div className="flex items-end"><Submit>Save hostel</Submit></div>
          </form>
        </details>
      )}

      {cur && rooms.length === 0 && <Empty>No rooms yet.{can("hostel.rooms.create") ? " Use “+ Add room”." : ""}</Empty>}
      {floors.map((fl) => (
        <section key={fl}>
          <h2 className="m-0 mb-2 text-[14px] font-bold tracking-wide text-muted uppercase">{fl === 0 ? "Ground floor" : `Floor ${fl}`}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rooms.filter((r) => r.floor === fl).map((r) => {
              const free = r.beds - r.occupants.length;
              return (
                <div key={r.room_id} className={`rounded-[14px] border bg-white p-4 shadow-[var(--shadow-card)] ${r.active ? "border-line" : "border-dashed border-line-strong opacity-70"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="m-0 text-[16px] font-extrabold text-ink">Room {r.room_no}</h3>
                      <p className="m-0 text-[12.5px] text-muted">{r.room_type} · {r.beds} beds · {money(r.monthly_fee)}/bed{!r.active ? " · closed" : ""}</p>
                    </div>
                    <Badge value={free === 0 ? "overdue" : free === r.beds ? "normal" : "active"} text={free === 0 ? "Full" : `${free} free`} />
                  </div>
                  <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0 text-[13.5px]">
                    {Array.from({ length: r.beds }, (_, i) => i + 1).map((bed) => {
                      const o = r.occupants.find((x) => x.bed === bed);
                      return (
                        <li key={bed} className="flex items-center justify-between gap-2 rounded-lg bg-[#f6f8fc] px-2.5 py-1.5">
                          <span className="min-w-0 truncate"><span className="mr-2 inline-block w-4 text-center text-[12px] font-bold text-muted">{bed}</span>
                            {o ? <Link href={`/app/students/${o.student}`} className="font-semibold">{o.name}</Link> : <span className="text-muted">Free</span>}
                            {o?.class ? <span className="text-muted"> · {o.class}</span> : null}</span>
                          {o && can("hostel.allocation.edit") && (
                            <form action={vacateBed}><input type="hidden" name="back" value={base} /><input type="hidden" name="id" value={o.alloc} />
                              <button className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-error underline">Vacate</button></form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
                    {canAllocate && free > 0 && r.active && (
                      <Modal label="Allot a bed" variant="link" title={`Allot a bed — room ${r.room_no}`} size="sm">
                        <form action={allocateBed} className="flex flex-col gap-3">
                          <input type="hidden" name="back" value={base} /><input type="hidden" name="room_id" value={r.room_id} />
                          <EntityPicker kind="student" name="student_id" label="Student" required />
                          <Select label="Bed" name="bed_no" defaultValue="" blank="First free bed" options={Array.from({ length: r.beds }, (_, i) => i + 1).filter((b) => !r.occupants.some((o) => o.bed === b)).map((b) => [String(b), `Bed ${b}`] as [string, string])} />
                          <Input label="Fee override (₹/month)" name="monthly_fee" type="number" min={0} hint={`Blank = room fee ${money(r.monthly_fee)}`} />
                          <Submit>Allot</Submit>
                        </form>
                      </Modal>
                    )}
                    {can("hostel.rooms.edit") && <Link href={`${base}${cur ? "&" : "?"}room=${r.room_id}`}>Edit room</Link>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {cur && editRoom && (
        <Modal defaultOpen closeHref={base} title={`Edit room ${editRoom.room_no}`} size="sm"><RoomForm hostel={cur.id} r={editRoom} back={base} /></Modal>
      )}
    </div>
  );
}
