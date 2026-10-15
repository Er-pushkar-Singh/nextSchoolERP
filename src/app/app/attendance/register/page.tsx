import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Empty, PageHeader, Stat } from "@/components/ui/ui";
import { ClassSection } from "@/components/ClassSection";
import { PrintButton } from "@/components/ui/PrintButton";
import { fullName, todayIST } from "@/lib/format";
import { getClasses } from "@/lib/erp";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
type Mark = { student_id: string; date: string; status: string; source: string | null; in_time: string | null; out_time: string | null };
type Stu = { id: string; first_name: string; last_name: string | null; roll_no: number | null; admission_no: string; status: string };

const MARK: Record<string, string> = { P: "•", L: "L", H: "H", A: "A", LV: "LV", OD: "OD" };
const TONE: Record<string, string> = { A: "text-error font-bold", L: "text-[#b26a00] font-semibold", H: "text-blue font-semibold", LV: "text-muted", P: "text-[#15803d]" };
const SOURCE: Record<string, string> = { qr: "QR scan", biometric: "biometric", rfid: "RFID card", geo: "location check-in", import: "import" };
const addMonth = (month: string, n: number) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/**
 * Monthly register of one section. Marks are read **by student**, not by the section stored on the mark, so a scan made at the
 * gate (QR / biometric), a manual entry and a mark made before the student changed section all show up in the same grid.
 */
export default async function Register({ searchParams }: { searchParams: Promise<{ class_id?: string; section_id?: string; month?: string }> }) {
  const { supabase, school, scope, user } = await requirePerm("attendance.students.view");
  const sp = await searchParams;
  const today = todayIST();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${month}-01`, last = `${month}-${String(days).padStart(2, "0")}`;
  const allClasses = await getClasses(supabase, school.id);
  // a teacher with "assigned" scope picks only from own sections (same as the marking page)
  const assignedOnly = scope("attendance.students.view") !== "school";
  const { data: mine } = assignedOnly ? await supabase.from("staff_assignments").select("section_id").eq("user_id", user.id).eq("school_id", school.id) : { data: null };
  const mySecs = new Set((mine ?? []).map((x) => x.section_id));
  const classes = assignedOnly ? allClasses.map((c) => ({ ...c, sections: c.sections.filter((s) => mySecs.has(s.id)) })).filter((c) => c.sections.length) : allClasses;
  const cls = uid(sp.class_id), sec = uid(sp.section_id);

  let students: Stu[] = [];
  const grid = new Map<string, Mark>();
  const holidays = new Map<number, string>();
  if (sec) {
    const [{ data: cur }, { data: moved }, { data: ev }] = await Promise.all([
      supabase.from("students").select("id,first_name,last_name,roll_no,admission_no,status").eq("school_id", school.id).eq("section_id", sec).eq("status", "active").order("roll_no", { nullsFirst: false }).order("first_name"),
      // students who were marked in this section this month but have since moved or left
      supabase.from("attendance").select("student_id").eq("section_id", sec).gte("date", first).lte("date", last).limit(5000),
      supabase.from("school_events").select("title,start_date,end_date").eq("school_id", school.id).in("kind", ["holiday", "vacation"]).lte("start_date", last).gte("end_date", first),
    ]);
    const have = new Set((cur ?? []).map((s) => s.id));
    const extraIds = [...new Set((moved ?? []).map((r) => r.student_id))].filter((id) => !have.has(id));
    const { data: extra } = extraIds.length
      ? await supabase.from("students").select("id,first_name,last_name,roll_no,admission_no,status").in("id", extraIds)
      : { data: [] };
    students = [...((cur ?? []) as Stu[]), ...((extra ?? []) as Stu[])];
    for (const e of ev ?? []) {
      for (let d = 1; d <= days; d++) {
        const iso = `${month}-${String(d).padStart(2, "0")}`;
        if (iso >= e.start_date && iso <= e.end_date && !holidays.has(d)) holidays.set(d, e.title);
      }
    }
    if (students.length) {
      const { data: a } = await supabase.from("attendance").select("student_id,date,status,source,in_time,out_time")
        .in("student_id", students.map((s) => s.id)).gte("date", first).lte("date", last).limit(20000);
      for (const r of (a ?? []) as Mark[]) grid.set(`${r.student_id}|${Number(r.date.slice(8))}`, r);
    }
  }
  const label = classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, l: `${c.name}-${s.name}` }))).find((s) => s.id === sec)?.l;
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const isoOf = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const dow = (d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const closed = (d: number) => dow(d) === 0 || holidays.has(d);
  const future = (d: number) => isoOf(d) > today;
  // a "working day" counts once anyone in the section has a mark on it, or when it has passed and is not a Sunday / holiday
  const dayHasMarks = (d: number) => students.some((s) => grid.has(`${s.id}|${d}`));
  const workingDays = dayList.filter((d) => dayHasMarks(d) || (!closed(d) && !future(d))).length;

  const rows = students.map((s) => {
    let p = 0, l = 0, a = 0, lv = 0, marked = 0;
    for (const d of dayList) {
      const x = grid.get(`${s.id}|${d}`)?.status;
      if (!x) continue;
      marked++;
      if (x === "A") a++; else if (x === "LV") lv++; else { p++; if (x === "L") l++; }
    }
    return { s, p, l, a, lv, marked, pct: marked ? Math.round((1000 * p) / marked) / 10 : null };
  });
  const avg = rows.filter((r) => r.pct !== null).length ? Math.round((rows.reduce((t, r) => t + (r.pct ?? 0), 0) / rows.filter((r) => r.pct !== null).length) * 10) / 10 : null;
  const low = rows.filter((r) => r.pct !== null && r.pct < 75).length;
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const nav = (mo: string) => `/app/attendance/register?class_id=${cls ?? ""}&section_id=${sec ?? ""}&month=${mo}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <PageHeader icon="attendance" title="Attendance register" subtitle="Month view of a section — manual, QR, biometric and card marks together" back={{ href: "/app/attendance", label: "Attendance" }} actions={sec ? <PrintButton /> : undefined} />
      </div>
      <form className="grid items-end gap-2 sm:grid-cols-4 print:hidden">
        <ClassSection key={`${cls}-${sec}`} classes={classes} classId={cls} sectionId={sec} required />
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Month<input type="month" name="month" defaultValue={month} max={today.slice(0, 7)} className="input !min-h-10 !py-2" /></label>
        <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Show</button></div>
      </form>

      {sec && (students.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
            <Stat label="Students" value={students.length} icon="students" />
            <Stat label="Working days so far" value={workingDays} icon="attendance" tone="cyan" />
            <Stat label="Class average" value={avg === null ? "—" : `${avg}%`} icon="exams" tone="green" />
            <Stat label="Below 75%" value={low} icon="notifications" tone={low ? "rose" : "green"} href="/app/attendance/low" />
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-[16px] font-bold text-ink">{school.name} · Class {label} · {monthName}</h2>
              <span className="flex gap-3 text-[13px] print:hidden">
                <Link href={nav(addMonth(month, -1))}>← {addMonth(month, -1)}</Link>
                {addMonth(month, 1) <= today.slice(0, 7) && <Link href={nav(addMonth(month, 1))}>{addMonth(month, 1)} →</Link>}
              </span>
            </div>
            <div className="overflow-x-auto rounded-[12px] border border-line bg-white print:overflow-visible print:border-0">
              <table className="border-collapse text-[12px]">
                <thead>
                  <tr className="bg-surface-alt">
                    <th className="sticky left-0 z-10 bg-surface-alt px-2 py-1.5 text-left">Student</th>
                    {dayList.map((d) => (
                      <th key={d} title={holidays.get(d) ?? (dow(d) === 0 ? "Sunday" : undefined)} className={`w-7 px-0.5 py-1.5 text-center font-semibold ${closed(d) ? "bg-[#eef0f4] text-muted" : ""} ${future(d) ? "opacity-50" : ""}`}>
                        {d}<div className="text-[9px] font-normal text-muted">{"SMTWTFS"[dow(d)]}</div>
                      </th>
                    ))}
                    <th className="px-2" title="Present (incl. late and half day)">P</th><th className="px-2">L</th><th className="px-2">A</th><th className="px-2">LV</th><th className="px-2">%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ s, p, l, a, lv, pct }) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="sticky left-0 z-10 bg-white px-2 py-1 whitespace-nowrap">
                        <Link href={`/app/students/${s.id}`} className="text-ink no-underline hover:underline">{s.roll_no ? `${s.roll_no}. ` : ""}{fullName(s)}</Link>
                        {s.status !== "active" && <span className="ml-1 text-[10px] text-muted">({s.status})</span>}
                      </td>
                      {dayList.map((d) => {
                        const x = grid.get(`${s.id}|${d}`);
                        const scanned = x && x.source && x.source !== "manual";
                        const tip = x ? [x.status, x.in_time ? `in ${x.in_time.slice(0, 5)}` : null, x.out_time ? `out ${x.out_time.slice(0, 5)}` : null, scanned ? SOURCE[x.source!] ?? x.source : null].filter(Boolean).join(" · ") : holidays.get(d);
                        return (
                          <td key={d} title={tip} className={`px-0.5 py-1 text-center ${closed(d) ? "bg-[#f6f7fa]" : ""} ${x ? TONE[x.status] ?? "" : "text-[#cbd2de]"} ${scanned ? "underline decoration-blue decoration-2 underline-offset-2" : ""}`}>
                            {x ? MARK[x.status] ?? x.status : closed(d) || future(d) ? "" : "·"}
                          </td>
                        );
                      })}
                      <td className="px-2 text-center font-semibold">{p}</td><td className="px-2 text-center">{l || ""}</td>
                      <td className={`px-2 text-center ${a ? "font-bold text-error" : ""}`}>{a || ""}</td><td className="px-2 text-center">{lv || ""}</td>
                      <td className={`px-2 text-center font-semibold ${pct !== null && pct < 75 ? "text-error" : "text-ink"}`}>{pct === null ? "—" : `${pct}`}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line bg-surface-alt font-semibold">
                    <td className="sticky left-0 z-10 bg-surface-alt px-2 py-1">Present</td>
                    {dayList.map((d) => {
                      const n = students.filter((s) => { const x = grid.get(`${s.id}|${d}`)?.status; return x && x !== "A" && x !== "LV"; }).length;
                      return <td key={d} className="px-0.5 py-1 text-center">{dayHasMarks(d) ? n : ""}</td>;
                    })}
                    <td colSpan={5} />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-muted">• present · L late · H half day · A absent · LV leave · <span className="underline decoration-blue decoration-2">underlined</span> = marked by a scan or device (hover for the time) · grey = Sunday / holiday · · = not marked</p>
          </div>
        </>
      ) : <Empty>No students in this section.</Empty>)}
    </div>
  );
}
