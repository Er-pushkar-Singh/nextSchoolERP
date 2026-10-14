import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Empty, PageHeader, Table, td } from "@/components/ui/ui";
import { DAY_NAMES } from "@/lib/timetable";

type Row = { staff_id: string; name: string; designation: string | null; periods: number; sections: number; subjects: number; busiest_day: number | null; busiest_count: number | null };

export default async function Load() {
  const { supabase, school } = await requirePerm("academics.timetable.view");
  const { data } = await supabase.rpc("teacher_load", { sid: school.id });
  const rows = (data ?? []) as Row[];
  const max = Math.max(1, ...rows.map((r) => Number(r.periods)));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Teacher workload" subtitle="Periods per week from the class timetables" back={{ href: "/app/timetable", label: "Timetable" }} />
      {rows.length ? (
        <Table head={["Teacher", "Periods / week", "Sections", "Subjects", "Busiest day", ""]} minWidth={720}>
          {rows.map((r) => (
            <tr key={r.staff_id}>
              <td className={td}><b className="text-ink">{r.name}</b><div className="text-[12px] text-muted">{r.designation ?? ""}</div></td>
              <td className={td}>
                <span className="flex items-center gap-2"><b>{r.periods}</b><span className="block h-2 w-28 overflow-hidden rounded-full bg-[#eef1f6]"><span className="block h-full rounded-full bg-blue" style={{ width: `${(Number(r.periods) / max) * 100}%` }} /></span></span>
              </td>
              <td className={td}>{r.sections}</td>
              <td className={td}>{r.subjects}</td>
              <td className={td}>{r.busiest_day ? `${DAY_NAMES[r.busiest_day]} (${r.busiest_count})` : "—"}</td>
              <td className={td}><Link href={`/app/timetable/teacher?staff=${r.staff_id}`}>Timetable</Link></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No teaching staff yet.</Empty>}
      <p className="m-0 text-[12px] text-muted">School: {school.name}. Only active teaching staff are listed; assign teachers in the class timetable.</p>
    </div>
  );
}
