import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { cleanSearch, fmtDate, fullName, money, todayIST } from "@/lib/format";
import { fmtTime, TRIPS } from "@/lib/transport";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { allocateStudent, billTransport, endAllocation, removeAllocation } from "../../_actions/transport";
import { getClasses } from "@/lib/erp";

type Stu = { id: string; admission_no: string; first_name: string; last_name: string | null; father_name: string | null; guardian_phone: string | null; classes: { name: string } | null; sections: { name: string } | null };
type Alloc = {
  id: string; route_id: string; stop_id: string; trip: string; monthly_fee: number | null; start_date: string; end_date: string | null;
  transport_routes: { name: string } | null; transport_stops: { name: string } | null;
};
type Rider = { alloc_id: string; student_id: string; admission_no: string; student_name: string; class_name: string | null; section_name: string | null; guardian_phone: string | null; father_name: string | null;
  route_id: string; route_name: string; stop_id: string; stop_name: string; pickup_time: string | null; trip: string; fee: number; start_date: string; end_date: string | null; total: number; monthly_total: number };
const stuSel = "id,admission_no,first_name,last_name,father_name,guardian_phone,classes!class_id(name),sections(name)";

export default async function TransportStudents({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, session, can } = await requirePerm("transport.allocation.view");
  const sp = await searchParams;
  const canAssign = can("transport.allocation.create") && can("transport.allocation.edit");
  const q = cleanSearch(sp.q ?? "").trim();
  const route = sp.route && /^[0-9a-f-]{36}$/.test(sp.route) ? sp.route : null;

  let found: Stu[] = [];
  if (canAssign && q && !sp.student) {
    const { data } = await supabase.from("students").select(stuSel).eq("school_id", school.id).eq("status", "active")
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,admission_no.ilike.${q}%,guardian_phone.ilike.%${q}%`).order("first_name").limit(20);
    found = (data ?? []) as unknown as Stu[];
    if (found.length === 1) sp.student = found[0].id;
  }
  let picked: Stu | null = null;
  if (canAssign && sp.student && /^[0-9a-f-]{36}$/.test(sp.student)) {
    const { data } = await supabase.from("students").select(stuSel).eq("id", sp.student).eq("school_id", school.id).maybeSingle();
    picked = data as unknown as Stu | null;
  }

  const { page, size, offset } = pageParams(sp);
  const listQ = cleanSearch(sp.lq ?? "").trim();
  const stopF = sp.stop && /^[0-9a-f-]{36}$/.test(sp.stop) ? sp.stop : null;
  const classF = sp.class_id && /^[0-9a-f-]{36}$/.test(sp.class_id) ? sp.class_id : null;
  const tripF = ["both", "pickup", "drop"].includes(sp.trip ?? "") ? sp.trip! : null;
  const sort = ["route", "name", "class", "fee"].includes(sp.sort ?? "") ? sp.sort! : "route";
  const [{ data: routes }, ridersQ, classes, curQ] = await Promise.all([
    supabase.from("transport_routes").select("id,name,active,transport_stops(id,name,sort,pickup_time,monthly_fee)").eq("school_id", school.id).order("name"),
    session
      ? supabase.rpc("transport_riders", { sid: school.id, sess: session.id, p_q: listQ || null, p_route: route, p_stop: stopF, p_class: classF, p_trip: tripF, p_ended: sp.ended === "1", p_sort: sort, p_limit: size, p_offset: offset })
      : Promise.resolve({ data: [], error: null as { message: string } | null }),
    getClasses(supabase, school.id),
    picked && session
      ? supabase.from("transport_allocations").select("id,route_id,stop_id,trip,monthly_fee,start_date,end_date,transport_routes(name),transport_stops(name)").eq("student_id", picked.id).eq("session_id", session.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const A = (ridersQ.data ?? []) as Rider[];
  const total = A[0] ? Number(A[0].total) : 0;
  const monthly = A[0] ? Number(A[0].monthly_total) : 0;
  const R = (routes ?? []) as unknown as { id: string; name: string; active: boolean; transport_stops: { id: string; name: string; sort: number; pickup_time: string | null; monthly_fee: number }[] }[];
  const stopOptions = R.filter((r) => r.active).flatMap((r) => [...r.transport_stops].sort((a, b) => a.sort - b.sort)
    .map((s) => [s.id, `${r.name} › ${s.name}${s.pickup_time ? ` (${fmtTime(s.pickup_time)})` : ""} · ${money(s.monthly_fee)}/mo`] as [string, string]));
  const current = (curQ.data ?? undefined) as unknown as Alloc | undefined;
  const filterStops = (route ? R.filter((r) => r.id === route) : R).flatMap((r) => r.transport_stops.map((x) => [x.id, route ? x.name : `${r.name} › ${x.name}`] as [string, string]));
  const trip = new Map(TRIPS);
  const params = { lq: listQ || undefined, route: route ?? undefined, stop: stopF ?? undefined, class_id: classF ?? undefined, trip: tripF ?? undefined, ended: sp.ended === "1" ? "1" : undefined, sort: sort === "route" ? undefined : sort };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="transport" title="Students on transport" subtitle={`${total} students${sp.ended === "1" ? " (incl. stopped)" : ""} · ${money(monthly)} a month${session ? ` · Session ${session.name}` : ""}`} back={{ href: "/app/transport", label: "Transport" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {!session && <Empty>Set a current session first (Settings → Classes & sessions).</Empty>}

      {canAssign && session && (
        <Card title={picked ? `Transport for ${fullName(picked)}` : "Add a student to transport"} icon="students">
          {!picked ? (
            <>
              <form className="flex flex-wrap gap-2">
                <input name="q" defaultValue={sp.q} placeholder="Student name, admission no. or phone" className="input !min-h-11 max-w-md !py-2" aria-label="Find student" />
                <button className="btn btn-sm btn-secondary cursor-pointer">Find</button>
              </form>
              {q && (found.length ? (
                <ul className="m-0 mt-3 list-none p-0 text-[14px]">
                  {found.map((s) => (
                    <li key={s.id} className="border-t border-line py-2 first:border-0">
                      <Link href={`/app/transport/students?student=${s.id}`} className="font-semibold">{fullName(s)}</Link>
                      <span className="text-muted"> · {s.admission_no} · Class {s.classes ? `${s.classes.name}-${s.sections?.name ?? ""}` : "—"} · {s.father_name ?? ""}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 mb-0 text-[14px] text-muted">No active student matches “{q}”.</p>)}
            </>
          ) : stopOptions.length ? (
            <form action={allocateStudent} className="grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="student_id" value={picked.id} />
              <p className="m-0 text-[14px] text-muted sm:col-span-4">
                Adm. {picked.admission_no} · Class {picked.classes ? `${picked.classes.name}-${picked.sections?.name ?? ""}` : "—"} · {picked.guardian_phone ?? "no phone"}
                {current && <> · now on <b className="text-ink">{current.transport_routes?.name} › {current.transport_stops?.name}</b>{current.end_date ? ` (stopped ${fmtDate(current.end_date)})` : ""}</>}
              </p>
              <Select label="Route › stop" name="stop_id" defaultValue={current?.stop_id} options={stopOptions} className="sm:col-span-2" />
              <Select label="Trip" name="trip" defaultValue={current?.trip ?? "both"} options={TRIPS} />
              <Input label="Fee / month (₹)" name="monthly_fee" type="number" step="0.01" min={0} defaultValue={current?.monthly_fee} hint="Blank = the stop's fee" />
              <Input label="From" name="start_date" type="date" defaultValue={current?.start_date ?? todayIST()} />
              <div className="flex items-end gap-3 sm:col-span-3">
                <Submit>{current ? "Update transport" : "Add to transport"}</Submit>
                <Link href="/app/transport/students" className="text-[14px]">Cancel</Link>
              </div>
            </form>
          ) : <p className="m-0 text-[14px]">Create a route with stops first: <Link href="/app/transport">Transport → New route</Link>.</p>}
        </Card>
      )}

      {session && (
        <>
          <form className="flex flex-wrap items-end gap-2">
            <Input label="Search" name="lq" defaultValue={sp.lq} placeholder="Name, adm. no., phone, stop" />
            <Select label="Route" name="route" blank="All routes" defaultValue={route} options={R.map((r) => [r.id, r.name] as [string, string])} />
            <Select label="Stop" name="stop" blank="All stops" defaultValue={stopF} options={filterStops} />
            <Select label="Class" name="class_id" blank="All classes" defaultValue={classF} options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
            <Select label="Trip" name="trip" blank="Any" defaultValue={tripF} options={TRIPS} />
            <Select label="Sort" name="sort" defaultValue={sort} options={[["route", "Route & stop"], ["name", "Name"], ["class", "Class"], ["fee", "Highest fee"]]} />
            <Select label="Show" name="ended" defaultValue={sp.ended === "1" ? "1" : ""} options={[["", "Currently using transport"], ["1", "Including stopped"]]} />
            <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
          </form>
          {ridersQ.error && <Flash error={`Could not load: ${ridersQ.error.message}`} />}
          {A.length ? (
            <Table head={["Student", "Class", "Route › stop", "Trip", "Fee / month", "Since", "Parent phone", ""]} minWidth={940}>
              {A.map((a) => (
                <tr key={a.alloc_id} className={a.end_date ? "opacity-60" : ""}>
                  <td className={td}><Link href={`/app/students/${a.student_id}`} className="font-semibold">{a.student_name}</Link><div className="text-[12px] text-muted">{a.admission_no}</div></td>
                  <td className={td}>{a.class_name ? `${a.class_name}${a.section_name ? `-${a.section_name}` : ""}` : "—"}</td>
                  <td className={td}><Link href={`/app/transport/routes/${a.route_id}`}>{a.route_name}</Link> › {a.stop_name}<div className="text-[12px] text-muted">{fmtTime(a.pickup_time)}</div></td>
                  <td className={td}>{trip.get(a.trip)}</td>
                  <td className={td}>{money(a.fee)}</td>
                  <td className={td}>{fmtDate(a.start_date)}{a.end_date && <div className="text-[12px] text-error">stopped {fmtDate(a.end_date)}</div>}</td>
                  <td className={td}>{a.guardian_phone ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {canAssign && <Link href={`/app/transport/students?student=${a.student_id}`} className="text-[13px]">Change</Link>}
                    {can("transport.allocation.edit") && !a.end_date && (
                      <form action={endAllocation} className="mt-1"><input type="hidden" name="id" value={a.alloc_id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Stop from today</button></form>
                    )}
                    {can("transport.allocation.delete") && a.end_date && (
                      <form action={removeAllocation} className="mt-1"><input type="hidden" name="id" value={a.alloc_id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No students on transport{route || listQ || stopF || classF || tripF ? " match these filters" : " yet"}.</Empty>}
          <Pagination total={total} page={page} size={size} basePath="/app/transport/students" params={params} />
        </>
      )}

      {session && can("fees.dues.create") && (
        <Card title="Bill transport fees" icon="fees" description="Adds a “Transport Fee” instalment to every student currently on transport (stop fee × months, concessions applied). Running the same period again adds nothing.">
          <form action={billTransport} className="grid gap-3 sm:grid-cols-4">
            <Input label="Period" name="label" required placeholder="Apr–Jun" />
            <Input label="Due date" name="due_date" type="date" required defaultValue={todayIST()} />
            <Input label="Months" name="months" type="number" min={1} max={12} defaultValue={1} />
            <div className="flex items-end"><Submit>Bill transport fee</Submit></div>
          </form>
        </Card>
      )}
    </div>
  );
}
