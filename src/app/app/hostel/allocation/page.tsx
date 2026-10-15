import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { fmtDate, money, todayIST, waLink } from "@/lib/format";
import { allocateBed, generateHostelFee, vacateBed } from "../../_actions/hostel";

type Al = { id: string; student_id: string; student_name: string; admission_no: string; class_name: string | null; gender: string | null; guardian_phone: string | null; hostel_name: string;
  room_no: string; bed_no: number; start_date: string; end_date: string | null; status: string; monthly_fee: number; dues: number; total: number };
type RoomOpt = { id: string; room_no: string; beds: number; hostel: { name: string } | { name: string }[] | null };

export default async function Allocation({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("hostel.allocation.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = (sp.q ?? "").trim().slice(0, 60);
  const status = sp.status === "ended" || sp.status === "all" ? sp.status : "active";
  const hostel = sp.hostel && /^[0-9a-f-]{36}$/.test(sp.hostel) ? sp.hostel : null;
  const [{ data }, { data: hs }, { data: rms }] = await Promise.all([
    supabase.rpc("hostel_allocation_list", { sid: school.id, p_hostel: hostel, p_q: q || null, p_status: status, p_limit: size, p_offset: offset }),
    supabase.from("hostels").select("id,name").eq("school_id", school.id).order("name"),
    can("hostel.allocation.create") ? supabase.from("hostel_rooms").select("id,room_no,beds,hostel:hostels(name)").eq("school_id", school.id).eq("active", true).order("room_no").limit(500) : Promise.resolve({ data: [] }),
  ]);
  const A = (data ?? []) as Al[];
  const total = A[0] ? Number(A[0].total) : 0;
  const rooms = ((rms ?? []) as unknown as RoomOpt[]).map((r) => [r.id, `${(Array.isArray(r.hostel) ? r.hostel[0] : r.hostel)?.name ?? ""} · Room ${r.room_no}`] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  const params = { q: q || undefined, status: status === "active" ? undefined : status, hostel: hostel ?? undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `/app/hostel/allocation${qs ? `?${qs}` : ""}`;
  const today = todayIST();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="hostel" title="Bed allocation & hostel fee" subtitle="Who sleeps where, and the hostel fee on their fee account" back={{ href: "/app/hostel", label: "Hostel" }}
        actions={<>
          {can("hostel.allocation.edit") && (
            <Modal label="Bill hostel fee" variant="secondary" title="Bill hostel fee" size="sm">
              <p className="mt-0 text-[13px] text-muted">Adds the hostel fee to every boarder&apos;s fee account (head “Hostel Fee”). Running the same label again adds nothing, so it is safe to repeat.</p>
              <form action={generateHostelFee} className="flex flex-col gap-3">
                <input type="hidden" name="back" value={back} />
                <Input label="Label" name="label" required placeholder="October" />
                <Input label="Due date" name="due_date" type="date" required defaultValue={today} />
                <Input label="Months covered" name="months" type="number" min={1} max={12} step="1" defaultValue={1} />
                <Submit>Add to fee accounts</Submit>
              </form>
            </Modal>
          )}
          {can("hostel.allocation.create") && (
            <Modal label="+ Allot a bed" title="Allot a bed" size="sm">
              <form action={allocateBed} className="flex flex-col gap-3">
                <input type="hidden" name="back" value={back} />
                <EntityPicker kind="student" name="student_id" label="Student" required />
                <Select label="Room" name="room_id" blank="Choose…" options={rooms} />
                <Input label="Bed no." name="bed_no" type="number" min={1} hint="Blank = first free bed" />
                <Input label="Start date" name="start_date" type="date" defaultValue={today} />
                <Input label="Fee override (₹/month)" name="monthly_fee" type="number" min={0} hint="Blank = the room's fee" />
                <p className="m-0 text-[12.5px] text-muted">A boy cannot be put in a girls hostel and a student can hold only one bed.</p>
                <Submit>Allot bed</Submit>
              </form>
            </Modal>
          )}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Student, admission no., room" className="input !min-h-10 w-64 !py-2 text-[15px] font-normal" /></label>
        <Select label="Hostel" name="hostel" blank="All" defaultValue={hostel} options={(hs ?? []).map((h) => [h.id, h.name] as [string, string])} />
        <Select label="Show" name="status" defaultValue={status} options={[["active", "Living now"], ["ended", "Left the hostel"], ["all", "Everyone"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        {(q || hostel || status !== "active") && <Link href="/app/hostel/allocation" className="pb-2 text-[14px]">Clear</Link>}
      </form>
      {A.length ? (
        <Table head={["Student", "Hostel / bed", "Since", "Fee / month", "Hostel dues", ""]} minWidth={860}>
          {A.map((a) => {
            const nudge = a.dues > 0 ? waLink(a.guardian_phone, `Dear Parent, the hostel fee of ${money(a.dues)} for ${a.student_name} is pending. Please pay at the school office.\n— ${school.name}`) : null;
            return (
              <tr key={a.id}>
                <td className={td}><Link href={`/app/students/${a.student_id}`} className="font-semibold">{a.student_name}</Link><div className="text-[12px] text-muted">{a.admission_no} · {a.class_name}</div></td>
                <td className={td}>{a.hostel_name}<div className="text-[12px] text-muted">Room {a.room_no} · bed {a.bed_no}</div></td>
                <td className={td}>{fmtDate(a.start_date)}{a.status === "ended" && <div><Badge value="left" text={`Left ${fmtDate(a.end_date)}`} /></div>}</td>
                <td className={td}>{money(a.monthly_fee)}</td>
                <td className={td}>{a.dues > 0 ? <b className="text-error">{money(a.dues)}</b> : <span className="text-muted">—</span>}</td>
                <td className={`${td} whitespace-nowrap text-[13px]`}>
                  <div className="flex flex-col items-start gap-1">
                    {nudge && <a href={nudge} target="_blank" rel="noopener noreferrer">WhatsApp parent</a>}
                    {a.status === "active" && can("hostel.allocation.edit") && (
                      <form action={vacateBed}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={a.id} />
                        <button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Vacate</button></form>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{q || hostel ? "No boarder matches." : "No students are in the hostel yet."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/hostel/allocation" params={params} />
    </div>
  );
}
