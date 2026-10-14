import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, PageHeader, Stat, Submit } from "@/components/ui/ui";
import { ClassSection } from "@/components/ClassSection";
import { AttendanceGrid } from "@/components/AttendanceGrid";
import { WaQueue } from "@/components/WaQueue";
import { fmtDate, fullName, todayIST, waLink } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { saveAttendance } from "../_actions/academics";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function Attendance({ searchParams }: { searchParams: Promise<{ class_id?: string; section_id?: string; date?: string; saved?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can, scope, user } = await requirePerm("attendance.students.view");
  const sp = await searchParams;
  const today = todayIST();
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const allClasses = await getClasses(supabase, school.id);
  // Teachers with "assigned" scope only see their own sections
  const assignedOnly = scope("attendance.students.view") !== "school";
  const { data: mine } = assignedOnly ? await supabase.from("staff_assignments").select("section_id").eq("user_id", user.id).eq("school_id", school.id) : { data: null };
  const mySecs = new Set((mine ?? []).map((m) => m.section_id));
  const classes = assignedOnly ? allClasses.map((c) => ({ ...c, sections: c.sections.filter((x) => mySecs.has(x.id)) })).filter((c) => c.sections.length) : allClasses;
  const cls = uid(sp.class_id), sec = uid(sp.section_id);
  const canWrite = can("attendance.students.create");

  const [{ data: summary }, { data: counts }, { data: dayRows }] = await Promise.all([
    supabase.rpc("attendance_summary", { sid: school.id, on_day: day }),
    supabase.rpc("class_counts", { sid: school.id }),
    supabase.rpc("attendance_day", { sid: school.id, on_day: day }),
  ]);
  const tot = ((dayRows ?? []) as { strength: number; present: number; late: number; absent: number; leave: number; not_marked: number; scanned: number }[])
    .reduce((a, x) => ({ strength: a.strength + Number(x.strength), present: a.present + Number(x.present), late: a.late + Number(x.late), absent: a.absent + Number(x.absent),
      leave: a.leave + Number(x.leave), not_marked: a.not_marked + Number(x.not_marked), scanned: a.scanned + Number(x.scanned) }),
      { strength: 0, present: 0, late: 0, absent: 0, leave: 0, not_marked: 0, scanned: 0 });
  const methods: { href: string; title: string; hint: string; show: boolean }[] = [
    { href: "/app/attendance/scan", title: "Scan QR", hint: "ID card with the camera", show: can("attendance.students.create") || can("attendance.staff.create") },
    { href: "/app/attendance/staff", title: "Staff", hint: "Day list & month summary", show: can("attendance.staff.view") },
    { href: "/app/attendance/me", title: "My check-in", hint: "From my phone, at school", show: true },
    { href: "/app/attendance/low", title: "Low attendance", hint: "Below 75% — call parents", show: true },
    { href: "/app/attendance/qr", title: "QR cards", hint: "Print for students / staff", show: true },
    { href: "/app/attendance/devices", title: "Devices & timings", hint: "Gate kiosk, biometric, late time", show: can("attendance.students.edit") },
  ];
  const sum = (summary ?? []) as { section_id: string; marked: number; present: number; absent: number }[];

  let students: { id: string; first_name: string; last_name: string | null; roll_no: number | null; guardian_phone: string | null }[] = [];
  let existing: Record<string, string> = {};
  if (cls && sec) {
    const { data } = await supabase.from("students").select("id,first_name,last_name,roll_no,guardian_phone").eq("school_id", school.id).eq("section_id", sec).eq("status", "active").order("roll_no", { nullsFirst: false }).order("first_name");
    students = data ?? [];
    if (students.length) {
      const { data: a } = await supabase.from("attendance").select("student_id,status").eq("date", day).in("student_id", students.map((s) => s.id));
      existing = Object.fromEntries((a ?? []).map((x) => [x.student_id, x.status]));
    }
  }
  const absentees = students.filter((s) => existing[s.id] === "A");
  const secName = classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name}-${s.name}`, class_id: c.id }))).find((s) => s.id === sec)?.label;
  const allSections = classes.flatMap((c) => c.sections.map((s) => ({ ...s, label: `${c.name}-${s.name}`, class_id: c.id })))
    .filter((s) => ((counts ?? []) as { section_id: string; students: number }[]).some((x) => x.section_id === s.id));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="attendance" title="Attendance" subtitle={`${fmtDate(day)} · mark by class, scan a QR or use a device`} actions={<Link href="/app/attendance/register" className="btn btn-sm btn-secondary">Monthly register</Link>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Students" value={tot.strength} />
        <Stat label="Present" value={tot.present} hint={tot.late ? `${tot.late} late` : undefined} tone="green" />
        <Stat label="Absent" value={tot.absent} hint={tot.leave ? `${tot.leave} on leave` : undefined} tone="rose" />
        <Stat label="Not marked" value={tot.not_marked} tone="amber" />
        <Stat label="By scan / device" value={tot.scanned} tone="violet" />
      </div>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-6">
        {methods.filter((m) => m.show).map((m) => (
          <li key={m.href}>
            <Link href={m.href} className="block h-full rounded-[12px] border border-line bg-white px-3 py-2.5 no-underline hover:border-blue">
              <b className="block text-[14px] text-ink">{m.title}</b><span className="text-[12px] text-muted">{m.hint}</span>
            </Link>
          </li>
        ))}
      </ul>

      <form className="grid items-end gap-2 sm:grid-cols-4">
        <ClassSection key={`${cls}-${sec}`} classes={classes} classId={cls} sectionId={sec} required />
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Date<input type="date" name="date" max={today} defaultValue={day} className="input !min-h-10 !py-2" /></label>
        <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Open register</button></div>
      </form>

      {cls && sec && (students.length ? (
        <Card title={`Class ${secName} · ${students.length} students${Object.keys(existing).length ? " · already marked (editing)" : ""}`}>
          {sp.saved && absentees.length > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              <p className="m-0 text-[14px] font-semibold text-ink">Tell parents of the {absentees.length} absent student(s):</p>
              <WaQueue items={absentees.map((s) => ({ id: s.id, name: fullName(s), href: waLink(s.guardian_phone, `Dear Parent, ${fullName(s)} (Class ${secName}) is absent from school today, ${fmtDate(day)}. Please inform the class teacher of the reason.\n— ${school.name}`) }))} />
            </div>
          )}
          {canWrite ? (
            <form action={saveAttendance} className="flex flex-col gap-4">
              <input type="hidden" name="class_id" value={cls} /><input type="hidden" name="section_id" value={sec} /><input type="hidden" name="date" value={day} />
              <AttendanceGrid key={`${sec}-${day}-${sp.saved ?? ""}`} students={students.map((s) => ({ id: s.id, name: fullName(s), roll: s.roll_no }))} initial={existing} />
              <div className="sticky bottom-3"><Submit className="w-full sm:w-auto">Save attendance</Submit></div>
            </form>
          ) : (
            <ul className="m-0 list-none p-0 text-[14px]">{students.map((s) => <li key={s.id} className="border-t border-line py-1.5 first:border-0">{fullName(s)} — <b>{existing[s.id] ?? "not marked"}</b></li>)}</ul>
          )}
        </Card>
      ) : <Empty>No active students in this section.</Empty>)}

      <Card title={`Sections on ${fmtDate(day)}`}>
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-3 lg:grid-cols-5">
          {allSections.map((s) => {
            const m = sum.find((x) => x.section_id === s.id);
            return (
              <li key={s.id}>
                <Link href={`/app/attendance?class_id=${s.class_id}&section_id=${s.id}&date=${day}`} className={`block rounded-lg border px-3 py-2 text-[14px] no-underline ${m ? "border-[#a8d8bc] bg-wa-tint text-[#0b4f2c]" : "border-line bg-white text-ink"}`}>
                  <b>{s.label}</b> <span className="text-[12px]">{m ? `✓ ${m.present}/${m.marked}${Number(m.absent) ? ` · ${m.absent} absent` : ""}` : "not marked"}</span>
                </Link>
              </li>
            );
          })}
          {!allSections.length && <li className="text-[14px] text-muted">Add students first.</li>}
        </ul>
      </Card>
    </div>
  );
}
