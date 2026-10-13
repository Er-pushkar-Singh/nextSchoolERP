import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { CopyButton } from "@/components/CopyButton";
import { appUrl } from "@/lib/brand";
import { cleanSearch, fmtDate, todayIST, addDays } from "@/lib/format";
import { VEHICLE_DOCS, type Vehicle } from "@/lib/transport";
import { deleteVehicle, rotateDriverLink, saveVehicle } from "../../_actions/transport";

type Row = { id: string; reg_no: string; kind: string; capacity: number | null; driver_name: string | null; driver_phone: string | null; attendant_name: string | null; active: boolean; route_names: string | null;
  insurance_upto: string | null; fitness_upto: string | null; permit_upto: string | null; puc_upto: string | null; papers_due: number; track_token: string | null; seen_at: string | null; trip_state: string | null; total: number };

export default async function Vehicles({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("transport.routes.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = cleanSearch(sp.q ?? "").trim();
  const kind = ["bus", "van", "auto", "other"].includes(sp.kind ?? "") ? sp.kind! : null;
  const active = ["yes", "no", "all"].includes(sp.active ?? "") ? sp.active! : "yes";
  const papers = ["due", "ok"].includes(sp.papers ?? "") ? sp.papers! : null;
  const [{ data, error }, editQ] = await Promise.all([
    supabase.rpc("vehicle_list", { sid: school.id, p_q: q || null, p_kind: kind, p_active: active, p_papers: papers, p_limit: size, p_offset: offset }),
    sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) && can("transport.routes.edit")
      ? supabase.from("transport_vehicles").select("*").eq("id", sp.edit).eq("school_id", school.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const V = (data ?? []) as Row[];
  const total = V[0] ? Number(V[0].total) : 0;
  const edit = editQ.data as Vehicle | null;
  const showForm = edit || can("transport.routes.create");
  const soon = addDays(todayIST(), 30), today = todayIST();
  const params = { q: q || undefined, kind: kind ?? undefined, active: active === "yes" ? undefined : active, papers: papers ?? undefined };
  const paperBadges = (v: Row) => VEHICLE_DOCS.flatMap(([k, name]) => {
    const d = v[k];
    return d && d <= soon ? [{ name, text: `${name} ${d < today ? "expired" : "expires"} ${fmtDate(d)}`, expired: d < today }] : [];
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="transport" title="Vehicles" subtitle="Buses and vans, drivers, papers and the driver's live-tracking link" back={{ href: "/app/transport", label: "Transport" }}
        actions={can("transport.tracking.view") ? <Link href="/app/transport/live" className="btn btn-sm btn-primary">Live map</Link> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />

      <form className="flex flex-wrap items-end gap-2">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Registration, driver, phone" />
        <Select label="Type" name="kind" blank="All" defaultValue={kind} options={["bus", "van", "auto", "other"]} />
        <Select label="Status" name="active" defaultValue={active} options={[["yes", "Active"], ["no", "Inactive"], ["all", "All"]]} />
        <Select label="Papers" name="papers" blank="Any" defaultValue={papers} options={[["due", "Due within 30 days"], ["ok", "All valid"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>

      {error && <Flash error={`Could not load vehicles: ${error.message}`} />}
      {V.length ? (
        <Table head={["Vehicle", "Seats", "Driver", "Papers", "Routes", "Tracking", ""]} minWidth={940}>
          {V.map((v) => {
            const due = paperBadges(v);
            return (
              <tr key={v.id} className={edit?.id === v.id ? "bg-blue-tint" : ""}>
                <td className={td}><b className="font-mono text-ink">{v.reg_no}</b><div className="text-[12px] text-muted capitalize">{v.kind}{v.active ? "" : " · inactive"}</div></td>
                <td className={td}>{v.capacity ?? "—"}</td>
                <td className={td}>{v.driver_name ?? "—"}<div className="text-[12px] text-muted">{v.driver_phone ?? ""}{v.attendant_name ? ` · attendant ${v.attendant_name}` : ""}</div></td>
                <td className={td}>
                  {due.length ? <span className="flex flex-col gap-1">{due.map((d) => <Badge key={d.name} value={d.expired ? "overdue" : "due"} text={d.text} />)}</span>
                    : <span className="text-[13px] text-muted">{VEHICLE_DOCS.some(([k]) => v[k]) ? "Valid" : "Not entered"}</span>}
                </td>
                <td className={`${td} text-[13px]`}>{v.route_names || "—"}</td>
                <td className={td}>
                  {v.trip_state === "running" ? <Badge value="active" text="On a trip" /> : <span className="text-[13px] text-muted">{v.seen_at ? "Seen " + new Date(v.seen_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "Idle"}</span>}
                  {v.track_token && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                      <CopyButton text={appUrl(`/drive/${v.track_token}`)} label="Copy driver link" />
                      <form action={rotateDriverLink}><input type="hidden" name="id" value={v.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">New link</button></form>
                    </div>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap`}>{can("transport.routes.edit") && <Link href={`/app/transport/vehicles?edit=${v.id}`} className="text-[13px]">Edit</Link>}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{q || kind || papers || active !== "yes" ? "No vehicle matches these filters." : "No vehicles yet."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/transport/vehicles" params={params} />

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
