import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Empty, PageHeader } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, fullName } from "@/lib/format";
import { getClasses, pct } from "@/lib/erp";
import { classResults } from "@/lib/results";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function ReportCards({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ class_id?: string; section_id?: string; student?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const cls = uid(sp.class_id);
  if (!uid(id) || !cls) notFound();
  const { supabase, school, session } = await requirePerm("exams.results.print", "exams.results.view");
  const { data: exam } = await supabase.from("exams").select("id,name,sort,session_id").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!exam) notFound();
  // Cumulative card: every exam of the session up to (and including) this one
  const { data: allExams } = await supabase.from("exams").select("id,name,sort").eq("session_id", exam.session_id).lte("sort", exam.sort).order("sort");
  const classes = await getClasses(supabase, school.id);
  const klass = classes.find((c) => c.id === cls);
  let q = supabase.from("students").select("id,admission_no,first_name,last_name,roll_no,father_name,mother_name,dob,sections(name)").eq("school_id", school.id).eq("class_id", cls).eq("status", "active");
  if (uid(sp.section_id)) q = q.eq("section_id", sp.section_id!);
  if (uid(sp.student)) q = q.eq("id", sp.student!);
  const { data: students } = await q.order("roll_no", { nullsFirst: false }).order("first_name");
  const list = (students ?? []) as unknown as { id: string; admission_no: string; first_name: string; last_name: string | null; roll_no: number | null; father_name: string | null; mother_name: string | null; dob: string | null; sections: { name: string } | null }[];
  // Rank must be computed against the whole class, not only the filtered students
  const { data: classStudents } = await supabase.from("students").select("id").eq("school_id", school.id).eq("class_id", cls).eq("status", "active");
  const results = await classResults(supabase, cls, (allExams ?? []) as { id: string; name: string }[], (classStudents ?? []).map((s) => s.id), school.grade_scale);
  const att = session && list.length ? (await supabase.from("attendance").select("student_id,status").in("student_id", list.map((s) => s.id)).gte("date", session.start_date).lte("date", session.end_date).limit(50000)).data ?? [] : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden"><PageHeader title={`Report cards · ${exam.name} · Class ${klass?.name ?? ""}`} subtitle={`${list.length} students · prints one per page`} back={{ href: `/app/exams/${id}`, label: exam.name }} actions={<PrintButton />} /></div>
      {!list.length && <Empty>No students.</Empty>}
      {list.map((s) => {
        const res = results.get(s.id) ?? [];
        const mine = att.filter((a) => a.student_id === s.id);
        const present = mine.filter((a) => ["P", "L", "H"].includes(a.status)).length;
        const subjects = [...new Set(res.flatMap((r) => r.rows.map((x) => x.subject)))];
        return (
          <article key={s.id} className="mx-auto w-full max-w-[800px] break-after-page rounded-[12px] border border-line bg-white p-6 text-[13px] text-ink print:max-w-none print:rounded-none print:border-0 print:p-0">
            <header className="border-b-2 border-ink pb-2 text-center">
              <h2 className="m-0 text-[20px] font-extrabold">{school.name}</h2>
              <p className="m-0 text-[12px]">{[school.address, school.city].filter(Boolean).join(", ")}{school.affiliation_no ? ` · ${school.board} Aff. No. ${school.affiliation_no}` : ""}</p>
              <p className="mt-1 mb-0 text-[14px] font-bold">REPORT CARD · SESSION {session?.name}</p>
            </header>
            <dl className="my-3 grid grid-cols-2 gap-x-6 gap-y-0.5">
              <div><dt className="inline text-muted">Name: </dt><dd className="inline font-semibold">{fullName(s)}</dd></div>
              <div><dt className="inline text-muted">Class: </dt><dd className="inline">{klass?.name}-{s.sections?.name}{s.roll_no ? ` · Roll ${s.roll_no}` : ""}</dd></div>
              <div><dt className="inline text-muted">Father: </dt><dd className="inline">{s.father_name ?? "—"}</dd></div>
              <div><dt className="inline text-muted">Mother: </dt><dd className="inline">{s.mother_name ?? "—"}</dd></div>
              <div><dt className="inline text-muted">Adm. no.: </dt><dd className="inline">{s.admission_no}</dd></div>
              <div><dt className="inline text-muted">Date of birth: </dt><dd className="inline">{fmtDate(s.dob)}</dd></div>
            </dl>
            {res.length ? (
              <table className="w-full border-collapse border border-ink text-center">
                <thead>
                  <tr className="bg-surface-alt"><th rowSpan={2} className="border border-ink px-2 py-1 text-left">Subject</th>{res.map((r) => <th key={r.exam.id} colSpan={2} className="border border-ink px-2 py-1">{r.exam.name}</th>)}</tr>
                  <tr className="bg-surface-alt">{res.map((r) => [<th key={`${r.exam.id}m`} className="border border-ink px-2 py-0.5 font-normal">Marks</th>, <th key={`${r.exam.id}g`} className="border border-ink px-2 py-0.5 font-normal">Grade</th>])}</tr>
                </thead>
                <tbody>
                  {subjects.map((sub) => (
                    <tr key={sub}>
                      <td className="border border-ink px-2 py-1 text-left">{sub}</td>
                      {res.map((r) => { const x = r.rows.find((y) => y.subject === sub); return [
                        <td key={`${r.exam.id}m`} className="border border-ink px-2 py-1">{!x ? "" : x.absent ? "AB" : x.marks === null ? "—" : `${x.marks}/${x.max}`}</td>,
                        <td key={`${r.exam.id}g`} className="border border-ink px-2 py-1">{x?.grade ?? ""}</td>]; })}
                    </tr>
                  ))}
                  <tr className="font-bold"><td className="border border-ink px-2 py-1 text-left">Total</td>{res.map((r) => [<td key={`${r.exam.id}m`} className="border border-ink px-2 py-1">{r.total}/{r.max}</td>, <td key={`${r.exam.id}g`} className="border border-ink px-2 py-1">{r.grade}</td>])}</tr>
                  <tr><td className="border border-ink px-2 py-1 text-left">Percentage</td>{res.map((r) => <td key={r.exam.id} colSpan={2} className="border border-ink px-2 py-1">{r.percent}%</td>)}</tr>
                  <tr><td className="border border-ink px-2 py-1 text-left">Rank in class</td>{res.map((r) => <td key={r.exam.id} colSpan={2} className="border border-ink px-2 py-1">{r.rank ?? "—"}</td>)}</tr>
                </tbody>
              </table>
            ) : <p className="text-muted">No marks entered yet.</p>}
            <p className="mt-3 mb-0">Attendance this session: <b>{mine.length ? `${present}/${mine.length} days (${pct(present, mine.length)}%)` : "—"}</b></p>
            <p className="mt-1 mb-0 text-[11px] text-muted">Grades: {school.grade_scale.map((g) => `${g.grade} ≥${g.min}%`).join(" · ")}</p>
            <div className="mt-6 h-14 border border-line p-2 text-[12px] text-muted">Remarks:</div>
            <footer className="mt-10 grid grid-cols-3 gap-6 text-center text-[12px]">
              <span className="border-t border-ink pt-1">Class teacher</span><span className="border-t border-ink pt-1">Parent</span><span className="border-t border-ink pt-1">Principal{school.principal_name ? ` (${school.principal_name})` : ""}</span>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
