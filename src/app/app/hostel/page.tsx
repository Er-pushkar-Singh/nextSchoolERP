import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Donut } from "@/components/ui/charts";
import { saveHostel } from "../_actions/hostel";

type H = { hostel_id: string; name: string; kind: string; warden: string | null; active: boolean; rooms: number; beds: number; occupied: number; free: number; out_now: number; absent_last_night: number; pending_outpass: number };

export default async function HostelHome({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("hostel.rooms.view", "hostel.allocation.view", "hostel.rollcall.view");
  const sp = await searchParams;
  const { data } = await supabase.rpc("hostel_overview", { sid: school.id });
  const rows = (data ?? []) as H[];
  const sum = (k: keyof H) => rows.reduce((t, r) => t + Number(r[k]), 0);
  const beds = sum("beds"), occ = sum("occupied");
  const pct = beds ? Math.round((100 * occ) / beds) : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="hostel" title="Hostel" subtitle="Beds, boarders, night roll call and outpass"
        actions={can("hostel.rooms.create") ? (
          <Modal label="+ New hostel" title="New hostel" size="sm">
            <form action={saveHostel} className="flex flex-col gap-3">
              <Input label="Name" name="name" required placeholder="Gandhi House" />
              <Select label="For" name="kind" defaultValue="boys" options={[["boys", "Boys"], ["girls", "Girls"], ["mixed", "Mixed"]]} />
              <EntityPicker kind="staff" name="warden_id" label="Warden" placeholder="Search staff" />
              <Input label="Address / block" name="address" />
              <Submit>Create hostel</Submit>
            </form>
          </Modal>
        ) : undefined} />
      <Flash ok={sp.ok} error={sp.error} />

      {rows.length === 0 ? (
        <Empty>No hostel is set up yet.{can("hostel.rooms.create") ? " Create the first hostel, then add its rooms." : ""}</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Beds" value={beds} hint={`${rows.length} hostel${rows.length === 1 ? "" : "s"}`} icon="hostel" href="/app/hostel/rooms" />
            <Stat label="Boarders" value={occ} hint={`${pct}% full`} icon="students" tone="green" href="/app/hostel/allocation" />
            <Stat label="Free beds" value={beds - occ} icon="layers" tone="cyan" />
            <Stat label="Out on outpass" value={sum("out_now")} icon="route" tone="amber" href="/app/hostel/outpass?status=out" />
            <Stat label="Absent last night" value={sum("absent_last_night")} icon="notifications" tone={sum("absent_last_night") ? "rose" : "green"} href="/app/hostel/rollcall" />
          </div>
          {sum("pending_outpass") > 0 && (
            <p className="m-0 rounded-[12px] border border-[#f1d79a] bg-[#fff8e6] px-4 py-3 text-[14px]">
              <b>{sum("pending_outpass")}</b> outpass request{sum("pending_outpass") === 1 ? " is" : "s are"} waiting for approval. <Link href="/app/hostel/outpass?status=requested">Review →</Link>
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Occupancy">
              <Donut data={[{ label: "Occupied", value: occ, color: "#2563eb" }, { label: "Free", value: beds - occ, color: "#cbd5e1" }]}
                centre={<><b className="text-[22px] text-ink">{pct}%</b><span className="text-[11px] text-muted">occupied</span></>} />
            </Card>
            <div className="lg:col-span-2">
              <Table head={["Hostel", "Warden", "Rooms", "Beds", "Boarders", "Out", ""]} minWidth={640}>
                {rows.map((h) => (
                  <tr key={h.hostel_id}>
                    <td className={td}><b className="text-ink">{h.name}</b> <Badge value="normal" text={h.kind} />{!h.active && <> <Badge value="muted" text="Closed" /></>}</td>
                    <td className={td}>{h.warden ?? <span className="text-muted">—</span>}</td>
                    <td className={td}>{h.rooms}</td>
                    <td className={td}>{h.beds}</td>
                    <td className={td}><b className="text-ink">{h.occupied}</b>{h.beds > 0 && <span className="text-muted"> · {Math.round((100 * h.occupied) / h.beds)}%</span>}</td>
                    <td className={td}>{h.out_now || "—"}</td>
                    <td className={`${td} whitespace-nowrap text-[13px]`}><Link href={`/app/hostel/rooms?hostel=${h.hostel_id}`}>Rooms</Link></td>
                  </tr>
                ))}
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
