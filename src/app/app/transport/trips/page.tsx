import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, PageHeader, Select, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";

type Row = { trip_id: string; vehicle_id: string; reg_no: string; route_name: string | null; kind: string; started_at: string; ended_at: string | null; minutes: number; points: number; total: number };
const when = (t: string) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function Trips({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school } = await requirePerm("transport.tracking.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const vehicle = sp.vehicle && /^[0-9a-f-]{36}$/.test(sp.vehicle) ? sp.vehicle : null;
  const [{ data }, { data: vehicles }] = await Promise.all([
    supabase.rpc("trip_history", { sid: school.id, p_vehicle: vehicle, p_limit: size, p_offset: offset }),
    supabase.from("transport_vehicles").select("id,reg_no").eq("school_id", school.id).order("reg_no"),
  ]);
  const rows = (data ?? []) as Row[];
  const total = rows[0] ? Number(rows[0].total) : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="transport" title="Trip history" subtitle="Every trip a driver started, with its recorded path" back={{ href: "/app/transport/live", label: "Live map" }} />
      <form className="flex flex-wrap items-end gap-2">
        <Select label="Vehicle" name="vehicle" blank="All vehicles" defaultValue={vehicle} options={(vehicles ?? []).map((v) => [v.id, v.reg_no] as [string, string])} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {rows.length ? (
        <Table head={["Started", "Vehicle", "Route", "Trip", "Duration", "Points", ""]} minWidth={720}>
          {rows.map((t) => (
            <tr key={t.trip_id}>
              <td className={td}>{when(t.started_at)}</td>
              <td className={`${td} font-mono text-[13px]`}>{t.reg_no}</td>
              <td className={td}>{t.route_name ?? "—"}</td>
              <td className={td}>{t.kind === "pickup" ? "Pickup" : "Drop"} {!t.ended_at && <Badge value="active" text="running" />}</td>
              <td className={td}>{t.minutes} min</td>
              <td className={td}>{t.points}</td>
              <td className={td}><Link href={`/app/transport/trips/${t.trip_id}`}>Path</Link></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No trips recorded yet.</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/transport/trips" params={{ vehicle: vehicle ?? undefined }} />
    </div>
  );
}
