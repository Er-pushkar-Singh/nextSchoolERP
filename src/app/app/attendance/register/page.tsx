import { requirePerm } from "@/lib/school";
import { Empty, PageHeader } from "@/components/ui/ui";
import { ClassSection } from "@/components/ClassSection";
import { PrintButton } from "@/components/ui/PrintButton";
import { fullName, todayIST } from "@/lib/format";
import { getClasses, pct } from "@/lib/erp";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function Register({ searchParams }: { searchParams: Promise<{ class_id?: string; section_id?: string; month?: string }> }) {
  const { supabase, school } = await requirePerm("attendance.students.view");
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayIST().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const classes = await getClasses(supabase, school.id);
  const cls = uid(sp.class_id), sec = uid(sp.section_id);
  let students: { id: string; first_name: string; last_name: string | null; roll_no: number | null }[] = [];
  const grid = new Map<string, string>();
  if (sec) {
    const { data } = await supabase.from("students").select("id,first_name,last_name,roll_no").eq("school_id", school.id).eq("section_id", sec).eq("status", "active").order("roll_no", { nullsFirst: false }).order("first_name");
    students = data ?? [];
    if (students.length) {
      const { data: a } = await supabase.from("attendance").select("student_id,date,status").eq("section_id", sec).gte("date", `${month}-01`).lte("date", `${month}-${String(days).padStart(2, "0")}`).limit(10000);
      for (const r of a ?? []) grid.set(`${r.student_id}|${Number(r.date.slice(8))}`, r.status);
    }
  }
  const label = classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, l: `${c.name}-${s.name}` }))).find((s) => s.id === sec)?.l;
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const color: Record<string, string> = { A: "text-error font-bold", L: "text-[#b26a00]", H: "text-blue", LV: "text-muted" };

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden"><PageHeader icon="attendance" title="Attendance register" back={{ href: "/app/attendance", label: "Attendance" }} actions={sec ? <PrintButton /> : undefined} /></div>
      <form className="grid items-end gap-2 sm:grid-cols-4 print:hidden">
        <ClassSection key={`${cls}-${sec}`} classes={classes} classId={cls} sectionId={sec} required />
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Month<input type="month" name="month" defaultValue={month} className="input !min-h-10 !py-2" /></label>
        <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Show</button></div>
      </form>
      {sec && (students.length ? (
        <div>
          <h2 className="m-0 mb-2 text-[16px] font-bold text-ink">{school.name} · Class {label} · {new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
          <div className="overflow-x-auto rounded-[12px] border border-line bg-white print:overflow-visible print:border-0">
            <table className="border-collapse text-[12px]">
              <thead><tr className="bg-surface-alt"><th className="sticky left-0 bg-surface-alt px-2 py-1 text-left">Student</th>{dayList.map((d) => <th key={d} className="w-6 px-1 py-1 text-center font-semibold">{d}</th>)}<th className="px-2">P</th><th className="px-2">A</th><th className="px-2">%</th></tr></thead>
              <tbody>
                {students.map((s) => {
                  const marks = dayList.map((d) => grid.get(`${s.id}|${d}`) ?? "");
                  const marked = marks.filter(Boolean).length;
                  const p = marks.filter((x) => ["P", "L", "H"].includes(x)).length;
                  return (
                    <tr key={s.id} className="border-t border-line">
                      <td className="sticky left-0 bg-white px-2 py-1 whitespace-nowrap">{s.roll_no ? `${s.roll_no}. ` : ""}{fullName(s)}</td>
                      {marks.map((x, i) => <td key={i} className={`px-1 py-1 text-center ${color[x] ?? ""}`}>{x === "P" ? "•" : x}</td>)}
                      <td className="px-2 text-center">{p}</td><td className="px-2 text-center">{marks.filter((x) => x === "A").length}</td><td className="px-2 text-center">{marked ? pct(p, marked) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-muted">• present · A absent · L late · H half day · LV leave · blank = not marked</p>
        </div>
      ) : <Empty>No students in this section.</Empty>)}
    </div>
  );
}
