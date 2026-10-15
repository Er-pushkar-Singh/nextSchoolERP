import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader, Submit } from "@/components/ui/ui";
import { BarcodeStation } from "@/components/attendance/BarcodeStation";
import { getClasses } from "@/lib/erp";
import { fmtDate, todayIST } from "@/lib/format";
import { closeAttendanceDay } from "../../_actions/attendance-scan";

type Day = { section_id: string; strength: number; present: number; late: number; absent: number; leave: number; not_marked: number; scanned: number };
type Feed = { at: string; name: string | null; class_name: string | null; result: string; status: string | null };

/** Barcode attendance: scan ID cards at the gate (USB / Bluetooth scanner or the camera), then finish the day. */
export default async function BarcodeAttendance({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, scope, user } = await requirePerm("attendance.students.create", "attendance.staff.create");
  const sp = await searchParams;
  const today = todayIST();
  const schoolWide = scope("attendance.students.create") === "school";
  const [{ data: day }, { data: feed }, { data: holiday }, classes, { data: mine }] = await Promise.all([
    supabase.rpc("attendance_day", { sid: school.id, on_day: today }),
    supabase.rpc("attendance_scan_feed", { sid: school.id, p_limit: 25 }),
    supabase.rpc("holiday_on", { sid: school.id, on_day: today }),
    getClasses(supabase, school.id),
    schoolWide ? Promise.resolve({ data: null }) : supabase.from("staff_assignments").select("section_id").eq("school_id", school.id).eq("user_id", user.id),
  ]);
  const D = (day ?? []) as Day[];
  const mySecs = new Set((mine ?? []).map((m) => m.section_id));
  const rows = schoolWide ? D : D.filter((d) => mySecs.has(d.section_id));
  const strength = rows.reduce((t, d) => t + Number(d.strength), 0);
  const present = rows.reduce((t, d) => t + Number(d.present), 0);
  const notMarked = rows.reduce((t, d) => t + Number(d.not_marked), 0);
  const sections = classes.flatMap((c) => c.sections.filter((s) => schoolWide || mySecs.has(s.id)).map((s) => [s.id, `${c.name}-${s.name}`] as [string, string]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="attendance" title="Barcode attendance" subtitle={`${fmtDate(today)} · scan the ID card at the gate — present or late is decided by the time`} back={{ href: "/app/attendance", label: "Attendance" }}
        actions={<Link href="/app/attendance/barcodes" className="btn btn-sm btn-secondary">Print barcode cards</Link>} />
      <Flash ok={sp.ok} error={sp.error} />
      {holiday ? <p className="m-0 rounded-[12px] border border-[#e0b44a] bg-[#fff8e6] px-4 py-3 text-[14px]">Today is <b>{String(holiday)}</b> in the school calendar.</p> : null}
      <BarcodeStation feed={(feed ?? []) as Feed[]} strength={strength} present={present} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Finish the day" icon="attendance" description={`${notMarked} student${notMarked === 1 ? "" : "s"} have no mark yet. At closing time, mark them absent in one step.`}>
          <form action={closeAttendanceDay} className="flex flex-col gap-3">
            <input type="hidden" name="date" value={today} />
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Which students
              <select name="section_id" className="input !min-h-10 !py-2 text-[15px] font-normal" defaultValue="" required={!schoolWide}>
                {schoolWide && <option value="">Whole school</option>}
                {!schoolWide && <option value="" disabled>Choose your section…</option>}
                {sections.map(([id, name]) => <option key={id} value={id}>Class {name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="notify" defaultChecked /> Tell their parents (WhatsApp / SMS / email as set up)</label>
            <Submit>Mark the rest absent</Submit>
          </form>
        </Card>
        <Card title="How to set it up" icon="settings">
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-[13.5px] text-body">
            <li>Print ID cards with the <b>barcode</b> block (Template studio → “Student ID card — with barcode”), or the <Link href="/app/attendance/barcodes">barcode cards</Link> sheet.</li>
            <li>Plug a USB / Bluetooth barcode scanner into this computer and keep this page open — no setup needed, it types the code and Enter.</li>
            <li>The first scan marks <b>present</b> (or <b>late</b> after the time in <Link href="/app/attendance/devices">Devices &amp; timings</Link>); a scan 10 minutes later records going out.</li>
            <li>Scanned by mistake? Open the class in <Link href="/app/attendance">Attendance</Link> and change the mark — the scan time of the others is kept.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
