import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { fmtDate } from "@/lib/format";
import { expiringDocs, VEHICLE_DOCS, type Vehicle } from "@/lib/transport";
import { deleteVehicle, saveVehicle } from "../../_actions/transport";

export default async function Vehicles({ searchParams }: { searchParams: Promise<{ edit?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("transport.routes.view");
  const sp = await searchParams;
  const [{ data }, { data: routes }] = await Promise.all([
    supabase.from("transport_vehicles").select("*").eq("school_id", school.id).order("reg_no"),
    supabase.from("transport_routes").select("name,vehicle_id").eq("school_id", school.id),
  ]);
  const V = (data ?? []) as Vehicle[];
  const edit = sp.edit && can("transport.routes.edit") ? V.find((v) => v.id === sp.edit) : undefined;
  const showForm = edit || can("transport.routes.create");
  const routesOf = (id: string) => (routes ?? []).filter((r) => r.vehicle_id === id).map((r) => r.name);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="transport" title="Vehicles" subtitle="Buses and vans, drivers, and when their papers expire" back={{ href: "/app/transport", label: "Transport" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {V.length ? (
        <Table head={["Vehicle", "Seats", "Driver", "Attendant", "Papers", "Routes", ""]} minWidth={860}>
          {V.map((v) => {
            const due = expiringDocs(v);
            return (
              <tr key={v.id} className={edit?.id === v.id ? "bg-blue-tint" : ""}>
                <td className={td}><b className="font-mono text-ink">{v.reg_no}</b><div className="text-[12px] text-muted capitalize">{v.kind}{v.active ? "" : " · inactive"}</div></td>
                <td className={td}>{v.capacity ?? "—"}</td>
                <td className={td}>{v.driver_name ?? "—"}<div className="text-[12px] text-muted">{v.driver_phone ?? ""}{v.driver_licence ? ` · DL ${v.driver_licence}` : ""}</div></td>
                <td className={td}>{v.attendant_name ?? "—"}<div className="text-[12px] text-muted">{v.attendant_phone ?? ""}</div></td>
                <td className={td}>
                  {due.length ? <span className="flex flex-col gap-1">{due.map((d) => <Badge key={d.name} value={d.expired ? "overdue" : "due"} text={d.text} />)}</span>
                    : <span className="text-[13px] text-muted">{VEHICLE_DOCS.some(([k]) => v[k]) ? "Valid" : "Not entered"}</span>}
                </td>
                <td className={`${td} text-[13px]`}>{routesOf(v.id).join(", ") || "—"}</td>
                <td className={`${td} whitespace-nowrap`}>{can("transport.routes.edit") && <Link href={`/app/transport/vehicles?edit=${v.id}`} className="text-[13px]">Edit</Link>}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No vehicles yet.</Empty>}

      {showForm && (
        <Card title={edit ? `Edit ${edit.reg_no}` : "Add a vehicle"} icon="transport">
          <form action={saveVehicle} className="grid gap-3 sm:grid-cols-4">
            {edit && <input type="hidden" name="id" value={edit.id} />}
            <Input label="Registration no." name="reg_no" required defaultValue={edit?.reg_no} placeholder="UP32 AB 1234" />
            <Select label="Type" name="kind" defaultValue={edit?.kind ?? "bus"} options={["bus", "van", "auto", "other"]} />
            <Input label="Seats" name="capacity" type="number" min={1} defaultValue={edit?.capacity} hint="Allocation stops when full" />
            <Select label="Status" name="active" defaultValue={edit && !edit.active ? "0" : "1"} options={[["1", "Active"], ["0", "Inactive"]]} />
            <Input label="Driver" name="driver_name" defaultValue={edit?.driver_name} />
            <Input label="Driver phone" name="driver_phone" type="tel" defaultValue={edit?.driver_phone} />
            <Input label="Driving licence no." name="driver_licence" defaultValue={edit?.driver_licence} />
            <div />
            <Input label="Attendant" name="attendant_name" defaultValue={edit?.attendant_name} />
            <Input label="Attendant phone" name="attendant_phone" type="tel" defaultValue={edit?.attendant_phone} />
            <div className="sm:col-span-2" />
            {VEHICLE_DOCS.map(([k, name]) => <Input key={k} label={`${name} valid till`} name={k} type="date" defaultValue={edit?.[k]} hint={edit?.[k] ? fmtDate(edit[k]) : undefined} />)}
            <Textarea label="Notes" name="notes" defaultValue={edit?.notes} className="sm:col-span-4" rows={2} />
            <div className="flex items-end gap-3 sm:col-span-4">
              <Submit>{edit ? "Save vehicle" : "Add vehicle"}</Submit>
              {edit && <Link href="/app/transport/vehicles" className="text-[14px]">Cancel</Link>}
            </div>
          </form>
          {edit && can("transport.routes.delete") && (
            <form action={deleteVehicle} className="mt-3"><input type="hidden" name="id" value={edit.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove this vehicle</button></form>
          )}
        </Card>
      )}
    </div>
  );
}
