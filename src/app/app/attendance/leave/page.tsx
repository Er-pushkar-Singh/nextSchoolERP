import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { cleanSearch, fmtDate, todayIST } from "@/lib/format";
import { applyStudentLeaveForParent, cancelStudentLeaveStaff, decideStudentLeave } from "../../_actions/family";

const TABS: [string, string][] = [["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Rejected"], ["cancelled", "Cancelled"], ["all", "All"]];

type Row = { id: string; student_id: string; student_name: string; admission_no: string; class_name: string | null; section_name: string | null; from_date: string; to_date: string; days: number;
  reason: string | null; status: string; applied_via: string; applied_by_name: string | null; decided_by_name: string | null; decision_note: string | null; total: number };

export default async function StudentLeave({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("attendance.leave.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const status = TABS.some(([k]) => k === sp.status) ? sp.status! : "pending";
  const q = cleanSearch(sp.q ?? "").trim();
  const { data, error } = await supabase.rpc("student_leave_list", { sid: school.id, p_status: status, p_q: q || null, p_limit: size, p_offset: offset });
  const rows = (data ?? []) as Row[];
  const total = rows[0]?.total ? Number(rows[0].total) : 0;
  const { data: counts } = await supabase.from("student_leaves").select("status").eq("school_id", school.id).eq("status", "pending").limit(1000);
  const waiting = (counts ?? []).length;
  const params = { q: q || undefined, status: status === "pending" ? undefined : status };
  const here = `/app/attendance/leave${new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size === 25 ? undefined : String(size) }).filter(([, v]) => v) as [string, string][]).toString().replace(/^(?=.)/, "?")}`;
  const approve = can("attendance.leave.approve");
  const today = todayIST();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="leave" title="Student leave" subtitle={`${waiting} waiting for a decision · approved days appear as leave in the attendance register`} back={{ href: "/app/attendance", label: "Attendance" }}
        actions={can("attendance.leave.create") && (
          <Modal label="Enter a leave" title="Enter a leave the parent asked for" size="md">
            <form action={applyStudentLeaveForParent} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="back" value={here} />
              <EntityPicker kind="student" name="student_id" label="Student" required placeholder="Type name or admission no." className="sm:col-span-2" />
              <Input label="From" name="from_date" type="date" required defaultValue={today} />
              <Input label="To" name="to_date" type="date" required defaultValue={today} />
              <Textarea label="Reason" name="reason" rows={2} className="sm:col-span-2" />
              {approve && <label className="flex items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" name="approve_now" defaultChecked /> Approve at once</label>}
              <div className="sm:col-span-2"><Submit>Save leave</Submit></div>
            </form>
          </Modal>
        )} />
      <Flash ok={sp.ok} error={sp.error ?? error?.message} />

      <nav className="flex flex-wrap gap-2 text-[14px]" aria-label="Status">
        {TABS.map(([k, l]) => <Link key={k} href={`/app/attendance/leave${k === "pending" ? "" : `?status=${k}`}`} className={`chip ${status === k ? "!border-ink" : ""}`}>{l}</Link>)}
      </nav>
      <form className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="status" value={status} />
        <div className="w-full sm:w-72"><Input label="Search student" name="q" defaultValue={sp.q} placeholder="Name or admission no." /></div>
        <button className="btn btn-sm btn-secondary cursor-pointer">Search</button>
        {q && <Link href={`/app/attendance/leave${status === "pending" ? "" : `?status=${status}`}`} className="pb-2 text-[14px]">Clear</Link>}
      </form>

      {rows.length ? (
        <Table head={["Student", "Class", "Dates", "Days", "Reason", "Status", "Action"]} minWidth={900}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}><Link href={`/app/students/${r.student_id}`} className="font-semibold">{r.student_name}</Link><div className="text-[12px] text-muted">Adm. {r.admission_no}</div></td>
              <td className={td}>{r.class_name ?? "—"}{r.section_name ? `-${r.section_name}` : ""}</td>
              <td className={td}>{fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` – ${fmtDate(r.to_date)}` : ""}</td>
              <td className={td}>{r.days}</td>
              <td className={`${td} max-w-[260px] text-[13px]`}>{r.reason ?? "—"}<div className="text-[12px] text-muted">{r.applied_via === "staff" ? `Entered by ${r.applied_by_name ?? "office"}` : `By ${r.applied_by_name ?? "parent"}`}</div>
                {r.decided_by_name && r.status !== "pending" && <div className="text-[12px] text-muted">{r.decided_by_name}{r.decision_note ? `: ${r.decision_note}` : ""}</div>}</td>
              <td className={td}><Badge value={r.status === "approved" ? "paid" : r.status === "pending" ? "due" : r.status === "rejected" ? "overdue" : "cancelled"} text={r.status} /></td>
              <td className={td}>
                {approve && r.status === "pending" && (
                  <Modal label="Decide" variant="link" size="sm" title={`${r.student_name} · ${r.days} day(s)`}>
                    <form action={decideStudentLeave} className="flex flex-col gap-3">
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} />
                      <p className="m-0 text-[14px]">{fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` – ${fmtDate(r.to_date)}` : ""}{r.reason ? ` — “${r.reason}”` : ""}</p>
                      <Input label="Note for the parent (optional)" name="note" />
                      <div className="flex gap-2"><button name="decision" value="approve" className="btn btn-sm btn-primary cursor-pointer">Approve</button>
                        <button name="decision" value="reject" className="btn btn-sm btn-secondary cursor-pointer">Reject</button></div>
                    </form>
                  </Modal>
                )}
                {approve && ["pending", "approved"].includes(r.status) && r.to_date >= today && (
                  <form action={cancelStudentLeaveStaff} className="mt-1"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} />
                    <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Cancel</button></form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q ? "No leave matches this search." : status === "pending" ? "Nothing is waiting. Parents apply from their app; you can also enter a leave on a phone call." : "No leave here."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/attendance/leave" params={params} />
    </div>
  );
}
