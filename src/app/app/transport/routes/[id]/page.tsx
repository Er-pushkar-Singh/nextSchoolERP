import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fullName, money } from "@/lib/format";
import { fmtTime, TRIPS, type Vehicle } from "@/lib/transport";
import { deleteRoute, deleteStop, saveRoute, saveStop } from "../../../_actions/transport";

type Stop = { id: string; name: string; sort: number; pickup_time: string | null; drop_time: string | null; monthly_fee: number };
type Alloc = {
  id: string; stop_id: string; trip: string; students: { id: string; admission_no: string; first_name: string; last_name: string | null; guardian_phone: string | null; classes: { name: string } | null; sections: { name: string } | null } | null;
};

export default async function RoutePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session, can } = await requirePerm("transport.routes.view");
  const sp = await searchParams;
  const { data: route } = await supabase.from("transport_routes").select("id,name,vehicle_id,active,notes").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!route) notFound();
  const [{ data: stops }, { data: vehicles }, { data: allocs }] = await Promise.all([
    supabase.from("transport_stops").select("id,name,sort,pickup_time,drop_time,monthly_fee").eq("route_id", id).order("sort").order("name"),
    supabase.from("transport_vehicles").select("*").eq("school_id", school.id).order("reg_no"),
    session && can("transport.allocation.view")
      ? supabase.from("transport_allocations").select("id,stop_id,trip,students(id,admission_no,first_name,last_name,guardian_phone,classes(name),sections(name))").eq("route_id", id).eq("session_id", session.id).is("end_date", null)
      : Promise.resolve({ data: null }),
  ]);
  const S = (stops ?? []) as Stop[];
  const V = (vehicles ?? []) as Vehicle[];
  const v = V.find((x) => x.id === route.vehicle_id);
  const A = (allocs ?? []) as unknown as Alloc[];
  const edit = can("transport.routes.edit"), add = can("transport.routes.create"), del = can("transport.routes.delete");
  const trip = new Map(TRIPS);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="route" title={route.name} back={{ href: "/app/transport", label: "Transport" }}
        subtitle={v ? <>{v.reg_no}{v.capacity ? ` · ${v.capacity} seats` : ""}{v.driver_name ? ` · Driver ${v.driver_name}` : ""}{v.driver_phone ? ` (${v.driver_phone})` : ""}{v.attendant_name ? ` · Attendant ${v.attendant_name}${v.attendant_phone ? ` (${v.attendant_phone})` : ""}` : ""}</> : "No vehicle assigned"}
        actions={<PrintButton />} />
      <Flash ok={sp.ok} error={sp.error} />

      {edit && (
        <Card title="Route" className="print:hidden">
          <form action={saveRoute} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="id" value={route.id} />
            <Input label="Name" name="name" required defaultValue={route.name} />
            <Select label="Vehicle" name="vehicle_id" blank="Not assigned" defaultValue={route.vehicle_id} options={V.map((x) => [x.id, `${x.reg_no}${x.capacity ? ` · ${x.capacity} seats` : ""}${x.active ? "" : " (inactive)"}`] as [string, string])} />
            <Select label="Status" name="active" defaultValue={route.active ? "1" : "0"} options={[["1", "Active"], ["0", "Inactive"]]} />
            <div className="flex items-end"><Submit>Save</Submit></div>
          </form>
        </Card>
      )}

      <Card title={`Stops (${S.length})`} description="In the order the vehicle reaches them in the morning">
        {S.length ? (
          <Table head={["#", "Stop", "Pickup", "Drop", "Fee / month", "Students", ...(edit || del ? [""] : [])]} minWidth={640}>
            {S.map((s, i) => (
              <tr key={s.id}>
                <td className={td}>{i + 1}</td>
                <td className={`${td} font-semibold text-ink`}>{s.name}</td>
                <td className={td}>{fmtTime(s.pickup_time)}</td>
                <td className={td}>{fmtTime(s.drop_time)}</td>
                <td className={td}>{money(s.monthly_fee)}</td>
                <td className={td}>{allocs ? A.filter((a) => a.stop_id === s.id).length : "—"}</td>
                {(edit || del) && (
                  <td className={`${td} print:hidden`}>
                    <details>
                      <summary className="cursor-pointer text-[13px] text-blue">Change</summary>
                      {edit && (
                        <form action={saveStop} className="mt-2 grid gap-2">
                          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="route_id" value={id} />
                          <Input label="Name" name="name" defaultValue={s.name} required />
                          <div className="grid grid-cols-3 gap-2">
                            <Input label="Order" name="sort" type="number" defaultValue={s.sort} />
                            <Input label="Pickup" name="pickup_time" type="time" defaultValue={s.pickup_time?.slice(0, 5)} />
                            <Input label="Drop" name="drop_time" type="time" defaultValue={s.drop_time?.slice(0, 5)} />
                          </div>
                          <Input label="Fee / month (₹)" name="monthly_fee" type="number" step="0.01" min={0} defaultValue={s.monthly_fee} />
                          <Submit>Save stop</Submit>
                        </form>
                      )}
                      {del && <form action={deleteStop} className="mt-2"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="route_id" value={id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove stop</button></form>}
                    </details>
                  </td>
                )}
              </tr>
            ))}
          </Table>
        ) : <Empty>No stops yet.</Empty>}
        {add && (
          <form action={saveStop} className="mt-4 grid gap-3 sm:grid-cols-6 print:hidden">
            <input type="hidden" name="route_id" value={id} />
            <Input label="New stop" name="name" required placeholder="Hazratganj crossing" className="sm:col-span-2" />
            <Input label="Order" name="sort" type="number" defaultValue={(S.at(-1)?.sort ?? 0) + 1} />
            <Input label="Pickup" name="pickup_time" type="time" />
            <Input label="Fee / month (₹)" name="monthly_fee" type="number" step="0.01" min={0} defaultValue={S.at(-1)?.monthly_fee ?? ""} />
            <div className="flex items-end"><Submit>Add stop</Submit></div>
          </form>
        )}
      </Card>

      {allocs && (
        <Card title={`Students (${A.length}${v?.capacity ? ` of ${v.capacity} seats` : ""})`} description={session ? `Session ${session.name} · route sheet for the driver / attendant` : undefined}
          actions={can("transport.allocation.create") ? <Link href="/app/transport/students" className="text-[14px] font-semibold print:hidden">Add students →</Link> : undefined}>
          {A.length ? (
            <Table head={["Stop", "Student", "Class", "Trip", "Parent phone"]} minWidth={600}>
              {S.flatMap((s) => A.filter((a) => a.stop_id === s.id).sort((x, y) => fullName(x.students ?? { first_name: "" }).localeCompare(fullName(y.students ?? { first_name: "" }))).map((a, i) => (
                <tr key={a.id}>
                  <td className={`${td} text-[13px]`}>{i === 0 ? <b>{s.name}{s.pickup_time ? ` · ${fmtTime(s.pickup_time)}` : ""}</b> : ""}</td>
                  <td className={td}>{a.students ? <Link href={`/app/students/${a.students.id}`} className="font-semibold">{fullName(a.students)}</Link> : "—"} <span className="text-[12px] text-muted">{a.students?.admission_no}</span></td>
                  <td className={td}>{a.students?.classes ? `${a.students.classes.name}-${a.students.sections?.name ?? ""}` : "—"}</td>
                  <td className={td}>{trip.get(a.trip)}</td>
                  <td className={td}>{a.students?.guardian_phone ?? "—"}</td>
                </tr>
              )))}
            </Table>
          ) : <Empty>No students on this route yet.</Empty>}
        </Card>
      )}

      {del && (
        <form action={deleteRoute} className="print:hidden">
          <input type="hidden" name="id" value={id} />
          <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Delete this route</button>
        </form>
      )}
    </div>
  );
}
