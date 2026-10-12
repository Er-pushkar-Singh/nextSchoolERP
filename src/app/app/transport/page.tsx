import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit } from "@/components/ui/ui";
import { money } from "@/lib/format";
import { expiringDocs, fmtTime, type Vehicle } from "@/lib/transport";
import { saveRoute } from "../_actions/transport";

type Route = { id: string; name: string; active: boolean; vehicle_id: string | null; transport_stops: { id: string; name: string; sort: number; pickup_time: string | null; monthly_fee: number }[] };

export default async function Transport({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, session, can } = await requirePerm("transport.routes.view");
  const sp = await searchParams;
  const [{ data: routes }, { data: vehicles }, { data: allocs }] = await Promise.all([
    supabase.from("transport_routes").select("id,name,active,vehicle_id,transport_stops(id,name,sort,pickup_time,monthly_fee)").eq("school_id", school.id).order("name"),
    supabase.from("transport_vehicles").select("*").eq("school_id", school.id).order("reg_no"),
    session && can("transport.allocation.view")
      ? supabase.from("transport_allocations").select("route_id").eq("session_id", session.id).is("end_date", null).limit(10000)
      : Promise.resolve({ data: null }),
  ]);
  const R = (routes ?? []) as unknown as Route[];
  const V = (vehicles ?? []) as Vehicle[];
  const vById = new Map(V.map((v) => [v.id, v]));
  const onRoute = new Map<string, number>();
  for (const a of allocs ?? []) onRoute.set(a.route_id, (onRoute.get(a.route_id) ?? 0) + 1);
  const alerts = V.filter((v) => v.active).flatMap((v) => expiringDocs(v).map((d) => ({ v, d })));
  const riders = allocs ? allocs.length : null;
  const seats = R.filter((r) => r.active).reduce((t, r) => t + (vById.get(r.vehicle_id ?? "")?.capacity ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="transport" title="Transport" subtitle="Routes, stops, buses and the students on them"
        actions={<>
          {can("transport.allocation.view") && <Link href="/app/transport/students" className="btn btn-sm btn-primary">Students on transport</Link>}
          <Link href="/app/transport/vehicles" className="btn btn-sm btn-secondary">Vehicles</Link>
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Routes" value={R.filter((r) => r.active).length} hint={`${R.reduce((t, r) => t + r.transport_stops.length, 0)} stops`} icon="route" />
        <Stat label="Vehicles" value={V.filter((v) => v.active).length} hint={seats ? `${seats} seats on active routes` : undefined} icon="transport" tone="cyan" />
        {riders !== null && <Stat label="Students on transport" value={riders} hint={session ? `Session ${session.name}` : undefined} href="/app/transport/students" icon="students" tone="green" />}
        <Stat label="Papers due (30 days)" value={alerts.length} hint={alerts.length ? "Insurance, fitness, permit, PUC" : "All papers valid"} icon="notifications" tone={alerts.length ? "rose" : "green"} />
      </div>

      {alerts.length > 0 && (
        <Card title="Vehicle papers to renew" icon="notifications">
          <ul className="m-0 list-none p-0 text-[14px]">
            {alerts.map(({ v, d }) => (
              <li key={v.id + d.name} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-0">
                <Link href={`/app/transport/vehicles?edit=${v.id}`} className="font-semibold">{v.reg_no}</Link>
                <Badge value={d.expired ? "overdue" : "due"} text={d.text} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {can("transport.routes.create") && (
        <Card title="New route">
          <form action={saveRoute} className="grid gap-3 sm:grid-cols-4">
            <Input label="Route name" name="name" required placeholder="Route 1 — Gomti Nagar" className="sm:col-span-2" />
            <Select label="Vehicle" name="vehicle_id" blank="Not assigned" options={V.filter((v) => v.active).map((v) => [v.id, `${v.reg_no}${v.capacity ? ` · ${v.capacity} seats` : ""}`] as [string, string])} />
            <div className="flex items-end"><Submit>Create route</Submit></div>
          </form>
          {!V.length && <p className="mt-3 mb-0 text-[13px] text-muted">Tip: <Link href="/app/transport/vehicles">add your vehicles</Link> first so you can assign one to each route.</p>}
        </Card>
      )}

      {R.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {R.map((r) => {
            const v = vById.get(r.vehicle_id ?? "");
            const stops = [...r.transport_stops].sort((a, b) => a.sort - b.sort);
            const n = onRoute.get(r.id) ?? 0;
            const fees = stops.map((s) => Number(s.monthly_fee)).filter((x) => x > 0);
            return (
              <Card key={r.id} title={r.name} icon="route"
                description={v ? `${v.reg_no}${v.driver_name ? ` · ${v.driver_name}` : ""}${v.driver_phone ? ` · ${v.driver_phone}` : ""}` : "No vehicle assigned"}
                actions={<span className="flex items-center gap-2">{!r.active && <Badge value="paused" text="Inactive" />}<Link href={`/app/transport/routes/${r.id}`} className="text-[14px] font-semibold">Open →</Link></span>}>
                <p className="m-0 text-[14px]">
                  <b className="text-ink">{stops.length}</b> stops
                  {riders !== null && <> · <b className="text-ink">{n}</b>{v?.capacity ? `/${v.capacity}` : ""} students</>}
                  {fees.length > 0 && <> · {money(Math.min(...fees))}{Math.max(...fees) !== Math.min(...fees) ? `–${money(Math.max(...fees))}` : ""}/month</>}
                </p>
                {stops.length > 0 && (
                  <p className="mt-2 mb-0 text-[13px] text-muted">{stops.slice(0, 6).map((s) => `${s.name}${s.pickup_time ? ` (${fmtTime(s.pickup_time)})` : ""}`).join(" → ")}{stops.length > 6 ? " → …" : ""}</p>
                )}
                {v?.capacity && n > v.capacity * 0.9 && <p className="mt-2 mb-0 text-[13px] font-semibold text-error">{n >= v.capacity ? "Full" : "Almost full"}</p>}
              </Card>
            );
          })}
        </div>
      ) : <Empty>No routes yet.</Empty>}
    </div>
  );
}
