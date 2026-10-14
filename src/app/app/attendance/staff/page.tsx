import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { fmtDate, todayIST } from "@/lib/format";
import { saveStaffAttendance } from "../../_actions/attendance";

type Day = { staff_id: string; name: string; emp_code: string | null; designation: string | null; department: string | null; status: string | null; in_time: string | null; out_time: string | null;
  source: string | null; note: string | null; leave_kind: string | null };
type Month = { staff_id: string; name: string; emp_code: string | null; present: number; late: number; half: number; absent: number; leave_days: number; on_duty: number; marked: number; working_days: number; suggested_lop: number };

const OPTS: [string, string][] = [["P", "Present"], ["L", "Late"], ["H", "Half day"], ["A", "Absent"], ["LV", "Leave"], ["OD", "On duty"]];
const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : "");

export default async function StaffAttendance({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("attendance.staff.view");
  const sp = await searchParams;
  const today = todayIST();
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : day.slice(0, 7);
  const canWrite = can("attendance.staff.create") || can("attendance.staff.edit");
  const [{ data: d }, { data: m }] = await Promise.all([
    supabase.rpc("staff_attendance_day", { sid: school.id, on_day: day }),
    supabase.rpc("staff_attendance_month", { sid: school.id, p_month: `${month}-01` }),
  ]);
  const rows = (d ?? []) as Day[];
  const months = (m ?? []) as Month[];
  const count = (f: (r: Day) => boolean) => rows.filter(f).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="attendance" title="Staff attendance" subtitle={fmtDate(day)} back={{ href: "/app/attendance", label: "Attendance" }}
        actions={<Link href="/app/attendance/me" className="btn btn-sm btn-secondary">My check-in</Link>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Staff" value={rows.length} />
        <Stat label="Present" value={count((r) => ["P", "L", "H", "OD"].includes(r.status ?? ""))} tone="green" />
        <Stat label="Absent / leave" value={count((r) => ["A", "LV"].includes(r.status ?? ""))} tone="rose" />
        <Stat label="Not marked" value={count((r) => !r.status)} />
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <Input label="Date" name="date" type="date" max={today} defaultValue={day} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Open</button>
      </form>

      {rows.length ? (
        <form action={saveStaffAttendance} className="flex flex-col gap-3">
          <input type="hidden" name="date" value={day} />
          <Table head={["Staff", "Designation", "In", "Out", "How", "Status"]} minWidth={760}>
            {rows.map((r) => (
              <tr key={r.staff_id}>
                <td className={td}><b className="text-ink">{r.name}</b><div className="text-[12px] text-muted">{r.emp_code ?? ""}</div></td>
                <td className={`${td} text-[13px]`}>{r.designation ?? "—"}<div className="text-[12px] text-muted">{r.department ?? ""}</div></td>
                <td className={td}>{hhmm(r.in_time) || "—"}</td>
                <td className={td}>{hhmm(r.out_time) || "—"}</td>
                <td className={`${td} text-[12px] capitalize text-muted`}>{r.source ?? ""}{r.leave_kind && !r.status ? `Leave approved (${r.leave_kind})` : ""}</td>
                <td className={td}>
                  {canWrite ? (
                    <select name={`sf_${r.staff_id}`} defaultValue={r.status ?? (r.leave_kind ? "LV" : "")} className="input !min-h-9 !w-auto !py-1 text-[13px]" aria-label={`Status of ${r.name}`}>
                      <option value="">Not marked</option>
                      {OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  ) : <b>{OPTS.find(([k]) => k === r.status)?.[1] ?? "Not marked"}</b>}
                </td>
              </tr>
            ))}
          </Table>
          {canWrite && <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Save staff attendance</button></div>}
        </form>
      ) : <Empty>No active staff yet. Add staff in HR.</Empty>}

      <Card title={`Month summary — ${month}`} description="Suggested unpaid days = working days − present − approved paid leave. Use it when preparing payroll.">
        <form className="mb-3 flex items-end gap-2">
          <input type="hidden" name="date" value={day} />
          <Input label="Month" name="month" type="month" defaultValue={month} />
          <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        </form>
        {months.length ? (
          <Table head={["Staff", "Working days", "Present", "Late", "Half", "Absent", "Leave", "Suggested unpaid"]} minWidth={760}>
            {months.map((r) => (
              <tr key={r.staff_id}>
                <td className={td}><b className="text-ink">{r.name}</b><div className="text-[12px] text-muted">{r.emp_code ?? ""}</div></td>
                <td className={td}>{r.working_days}</td>
                <td className={td}>{Number(r.present)}</td>
                <td className={td}>{r.late}</td>
                <td className={td}>{r.half}</td>
                <td className={td}>{r.absent}</td>
                <td className={td}>{Number(r.leave_days)}</td>
                <td className={td}><b className={Number(r.suggested_lop) > 0 ? "text-error" : "text-ink"}>{Number(r.suggested_lop)}</b></td>
              </tr>
            ))}
          </Table>
        ) : <p className="m-0 text-[14px] text-muted">Nothing to show.</p>}
      </Card>
    </div>
  );
}
