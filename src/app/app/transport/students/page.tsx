import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { cleanSearch, fmtDate, fullName, money, todayIST } from "@/lib/format";
import { fmtTime, TRIPS } from "@/lib/transport";
import { allocateStudent, billTransport, endAllocation, removeAllocation } from "../../_actions/transport";

type Stu = { id: string; admission_no: string; first_name: string; last_name: string | null; father_name: string | null; guardian_phone: string | null; classes: { name: string } | null; sections: { name: string } | null };
type Alloc = {
  id: string; route_id: string; stop_id: string; trip: string; monthly_fee: number | null; start_date: string; end_date: string | null;
  students: Stu | null; transport_stops: { name: string; pickup_time: string | null; monthly_fee: number } | null; transport_routes: { name: string } | null;
};
const stuSel = "id,admission_no,first_name,last_name,father_name,guardian_phone,classes!class_id(name),sections(name)";

export default async function TransportStudents({ searchParams }: { searchParams: Promise<{ q?: string; student?: string; route?: string; ended?: string; ok?: string; error?: string }> }) {
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

  let aq = session
    ? supabase.from("transport_allocations")
        .select(`id,route_id,stop_id,trip,monthly_fee,start_date,end_date,students(${stuSel}),transport_stops(name,pickup_time,monthly_fee),transport_routes(name)`)
        .eq("school_id", school.id).eq("session_id", session.id).limit(5000)
    : null;
  if (aq && route) aq = aq.eq("route_id", route);
  if (aq && sp.ended !== "1") aq = aq.is("end_date", null);
  const [{ data: routes }, { data: allocs }] = await Promise.all([
    supabase.from("transport_routes").select("id,name,active,transport_stops(id,name,sort,pickup_time,monthly_fee)").eq("school_id", school.id).order("name"),
    aq ?? Promise.resolve({ data: [] }),
  ]);
  const A = ((allocs ?? []) as unknown as Alloc[]).sort((x, y) =>
    (x.transport_routes?.name ?? "").localeCompare(y.transport_routes?.name ?? "") || fullName(x.students ?? { first_name: "" }).localeCompare(fullName(y.students ?? { first_name: "" })));
  const R = (routes ?? []) as unknown as { id: string; name: string; active: boolean; transport_stops: { id: string; name: string; sort: number; pickup_time: string | null; monthly_fee: number }[] }[];
  const stopOptions = R.filter((r) => r.active).flatMap((r) => [...r.transport_stops].sort((a, b) => a.sort - b.sort)
    .map((s) => [s.id, `${r.name} › ${s.name}${s.pickup_time ? ` (${fmtTime(s.pickup_time)})` : ""} · ${money(s.monthly_fee)}/mo`] as [string, string]));
  const current = picked ? A.find((a) => a.students?.id === picked!.id) : undefined;
  const fee = (a: Alloc) => Number(a.monthly_fee ?? a.transport_stops?.monthly_fee ?? 0);
  const active = A.filter((a) => !a.end_date);
  const trip = new Map(TRIPS);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="transport" title="Students on transport" subtitle={`${active.length} students · ${money(active.reduce((t, a) => t + fee(a), 0))} a month${session ? ` · Session ${session.name}` : ""}`} back={{ href: "/app/transport", label: "Transport" }} />
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
            <Select label="Route" name="route" blank="All routes" defaultValue={route} options={R.map((r) => [r.id, r.name] as [string, string])} />
            <Select label="Show" name="ended" defaultValue={sp.ended === "1" ? "1" : ""} options={[["", "Currently using transport"], ["1", "Including stopped"]]} />
            <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
          </form>
          {A.length ? (
            <Table head={["Student", "Class", "Route › stop", "Trip", "Fee / month", "Since", "Parent phone", ""]} minWidth={940}>
              {A.map((a) => (
                <tr key={a.id} className={a.end_date ? "opacity-60" : ""}>
                  <td className={td}>{a.students ? <Link href={`/app/students/${a.students.id}`} className="font-semibold">{fullName(a.students)}</Link> : "—"}<div className="text-[12px] text-muted">{a.students?.admission_no}</div></td>
                  <td className={td}>{a.students?.classes ? `${a.students.classes.name}-${a.students.sections?.name ?? ""}` : "—"}</td>
                  <td className={td}><Link href={`/app/transport/routes/${a.route_id}`}>{a.transport_routes?.name}</Link> › {a.transport_stops?.name}<div className="text-[12px] text-muted">{fmtTime(a.transport_stops?.pickup_time)}</div></td>
                  <td className={td}>{trip.get(a.trip)}</td>
                  <td className={td}>{money(fee(a))}{a.monthly_fee !== null && <div className="text-[12px] text-muted">special</div>}</td>
                  <td className={td}>{fmtDate(a.start_date)}{a.end_date && <div className="text-[12px] text-error">stopped {fmtDate(a.end_date)}</div>}</td>
                  <td className={td}>{a.students?.guardian_phone ?? "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {canAssign && a.students && <Link href={`/app/transport/students?student=${a.students.id}`} className="text-[13px]">Change</Link>}
                    {can("transport.allocation.edit") && !a.end_date && (
                      <form action={endAllocation} className="mt-1"><input type="hidden" name="id" value={a.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Stop from today</button></form>
                    )}
                    {can("transport.allocation.delete") && a.end_date && (
                      <form action={removeAllocation} className="mt-1"><input type="hidden" name="id" value={a.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No students on transport{route ? " on this route" : ""} yet.</Empty>}
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
