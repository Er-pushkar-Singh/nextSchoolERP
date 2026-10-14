import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, PageHeader, Stat, Table, td } from "@/components/ui/ui";

type Row = { class_id: string; class_name: string; section_id: string; section_name: string; capacity: number | null; room: string | null; students: number;
  class_teacher_name: string | null; subjects_mapped: number; subjects_staffed: number };

export default async function Academics({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, session, can } = await requirePerm("academics.setup.view");
  const sp = await searchParams;
  const { data } = await supabase.rpc("academic_overview", { sid: school.id });
  const rows = (data ?? []) as Row[];
  const students = rows.reduce((t, r) => t + Number(r.students), 0);
  const noTeacher = rows.filter((r) => !r.class_teacher_name).length;
  const unstaffed = rows.filter((r) => Number(r.subjects_mapped) > Number(r.subjects_staffed)).length;
  const over = rows.filter((r) => r.capacity && Number(r.students) > Number(r.capacity)).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Academic setup" subtitle={session ? `Session ${session.name}` : "No current session"}
        actions={can("academics.setup.create") ? <Link href="/app/settings/academic" className="btn btn-sm btn-secondary">Classes, subjects & sessions</Link> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sections" value={rows.length} hint={`${students} students`} tone="blue" />
        <Stat label="Without class teacher" value={noTeacher} tone={noTeacher ? "amber" : "green"} href="/app/academics/allocation" />
        <Stat label="Subjects not staffed" value={unstaffed} hint="sections with a subject lacking a teacher" tone={unstaffed ? "amber" : "green"} href="/app/academics/allocation" />
        <Stat label="Over capacity" value={over} tone={over ? "rose" : "green"} />
      </div>

      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
        {[["/app/academics/curriculum", "Curriculum", "Subjects of each class, periods a week"], ["/app/academics/allocation", "Teacher allocation", "Class teacher and subject teachers"],
          ["/app/academics/syllabus", "Syllabus & lesson plans", "Topics, coverage, verification"], ["/app/timetable", "Timetable", "Class grid, cover, calendar"]].map(([h, l, d]) => (
          <li key={h}><Link href={h} className="block h-full rounded-[12px] border border-line bg-white px-3 py-2.5 no-underline hover:border-blue"><b className="block text-[14px] text-ink">{l}</b><span className="text-[12px] text-muted">{d}</span></Link></li>
        ))}
      </ul>

      <Card title="Sections at a glance">
        {rows.length ? (
          <Table head={["Class-section", "Students", "Capacity", "Class teacher", "Subjects staffed", "Room"]} minWidth={720}>
            {rows.map((r) => (
              <tr key={r.section_id}>
                <td className={td}><Link href={`/app/academics/allocation?section=${r.section_id}`}><b>{r.class_name}-{r.section_name}</b></Link></td>
                <td className={td}>{r.students}</td>
                <td className={td}>{r.capacity ? <span className={Number(r.students) > Number(r.capacity) ? "font-bold text-error" : ""}>{r.students}/{r.capacity}</span> : <span className="text-muted">—</span>}</td>
                <td className={td}>{r.class_teacher_name ?? <span className="text-[#b26a00]">Not assigned</span>}</td>
                <td className={td}>{Number(r.subjects_mapped) ? <span className={Number(r.subjects_staffed) < Number(r.subjects_mapped) ? "text-[#b26a00]" : "text-[#15803d]"}>{r.subjects_staffed} of {r.subjects_mapped}</span> : <span className="text-muted">no curriculum</span>}</td>
                <td className={td}>{r.room ?? "—"}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>Add classes and sections first.</Empty>}
      </Card>
    </div>
  );
}
