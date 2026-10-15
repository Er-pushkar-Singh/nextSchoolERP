import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Empty, PageHeader } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, fullName } from "@/lib/format";
import { getClasses, pct } from "@/lib/erp";
import { classResults } from "@/lib/results";
import { signedPhotoUrls } from "@/lib/doc-photo";
import { getBranding } from "@/lib/branding";
import { DocSheet } from "@/components/DocSheet";

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
  // Who was in this class during the exam's session comes from the enrolment history, so promoted,
  // transferred and passed-out students still get their card — and classmates for the rank are the same set.
  type Row = { id: string; admission_no: string; first_name: string; last_name: string | null; middle_name: string | null; roll_no: number | null; father_name: string | null; mother_name: string | null; dob: string | null; sections: { name: string } | null };
  const { data: enr } = await supabase.from("student_enrolments").select("student_id,section_id,section_name,roll_no")
    .eq("school_id", school.id).eq("session_id", exam.session_id).eq("class_id", cls).limit(5000);
  let ids = [...new Set((enr ?? []).map((e) => e.student_id))];
  let legacy = false;
  if (!ids.length) {
    // schools whose history predates this feature: fall back to today's class list
    const { data: now } = await supabase.from("students").select("id").eq("school_id", school.id).eq("class_id", cls).eq("status", "active");
    ids = (now ?? []).map((x) => x.id);
    legacy = true;
  }
  const secOf = new Map((enr ?? []).map((e) => [e.student_id, e]));
  let list: Row[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("students").select("id,admission_no,first_name,middle_name,last_name,roll_no,father_name,mother_name,dob,sections(name)").in("id", ids.slice(i, i + 150));
    list.push(...((data ?? []) as unknown as Row[]));
  }
  list = list.map((s) => {
    const e = secOf.get(s.id);
    return legacy || !e ? s : { ...s, roll_no: e.roll_no ?? s.roll_no, sections: e.section_name ? { name: e.section_name } : s.sections };
  });
  if (uid(sp.section_id) && !legacy) {
    const keep = new Set((enr ?? []).filter((e) => e.section_id === sp.section_id).map((e) => e.student_id));
    list = list.filter((s) => keep.has(s.id));
  } else if (uid(sp.section_id)) {
    const { data: sec } = await supabase.from("students").select("id").in("id", ids.slice(0, 1000)).eq("section_id", sp.section_id!);
    const keep = new Set((sec ?? []).map((x) => x.id));
    list = list.filter((s) => keep.has(s.id));
  }
  if (uid(sp.student)) list = list.filter((s) => s.id === sp.student);
  list.sort((a, b) => (a.roll_no ?? 1e9) - (b.roll_no ?? 1e9) || a.first_name.localeCompare(b.first_name));
  // Rank must be computed against the whole class, not only the filtered students
  const results = await classResults(supabase, cls, (allExams ?? []) as { id: string; name: string }[], ids, school.grade_scale);
  const att = session && list.length ? (await supabase.from("attendance").select("student_id,status").in("student_id", list.map((s) => s.id)).gte("date", session.start_date).lte("date", session.end_date).limit(50000)).data ?? [] : [];

  const { data: decl } = list.length ? await supabase.from("exam_results").select("student_id,result,rank,percent,grade,remark,withheld_reason,failed_subjects").eq("exam_id", id).in("student_id", list.map((s) => s.id)) : { data: [] };
  const declared = new Map((decl ?? []).map((d) => [d.student_id as string, d as { result: string; rank: number | null; percent: number; grade: string | null; remark: string | null; withheld_reason: string | null; failed_subjects: number }]));
  const notDeclared = list.length > 0 && declared.size === 0;
  const [photos, branding] = await Promise.all([signedPhotoUrls(school.id, list.map((s) => s.id)), getBranding(supabase, school.id)]);

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden"><PageHeader title={`Report cards · ${exam.name} · Class ${klass?.name ?? ""}`} subtitle={`${list.length} students · prints one per page`} back={{ href: `/app/exams/${id}`, label: exam.name }} actions={<PrintButton />} /></div>
      {notDeclared && <p role="note" className="m-0 rounded-[12px] border border-[#f1d39a] bg-[#fff4e0] px-4 py-3 text-[14px] text-[#7a4b00] print:hidden">The result of this class is <b>not declared</b> yet — these cards show marks only, without pass / fail and rank. Declare it from the exam page.</p>}
      {!list.length && <Empty>No students.</Empty>}
      {list.map((s) => {
        const res = results.get(s.id) ?? [];
        const mine = att.filter((a) => a.student_id === s.id);
        const present = mine.filter((a) => ["P", "L", "H"].includes(a.status)).length;
        const subjects = [...new Set(res.flatMap((r) => r.rows.map((x) => x.subject)))];
        const dr = declared.get(s.id);
        return (
          <DocSheet key={s.id} branding={branding} logoUrl={school.logo_url} schoolName={school.name} className="mx-auto w-full max-w-[800px] break-after-page rounded-[12px] border border-line bg-white print:max-w-none print:rounded-none print:border-0">
          <article className="p-6 text-[13px] text-ink print:p-0">
            <header className="relative border-b-2 border-ink pb-2 text-center">
              {photos.get(s.id) /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={photos.get(s.id)} alt="Photograph" className="absolute top-0 right-0 h-[86px] w-[68px] rounded border border-ink object-cover" /> : <span className="absolute top-0 right-0 flex h-[86px] w-[68px] items-center justify-center rounded border border-dashed border-ink text-[10px] text-muted">Photo</span>}
              {school.logo_url /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={school.logo_url} alt="" className="absolute top-0 left-0 h-[64px] w-[64px] object-contain" /> : null}
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
            {dr?.result === "withheld" ? <p className="my-6 rounded border border-ink p-4 text-center text-[14px] font-bold">RESULT WITHHELD{dr.withheld_reason ? ` — ${dr.withheld_reason}` : ""}. Please contact the school office.</p> : res.length ? (
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
            {dr && dr.result !== "withheld" && (
              <p className="mt-3 mb-0 flex flex-wrap gap-x-6 font-semibold">
                <span>Result: <b className={dr.result === "pass" ? "text-[#15803d]" : "text-error"}>{dr.result.toUpperCase()}</b>{dr.result === "fail" && dr.failed_subjects > 0 ? ` (${dr.failed_subjects} subject${dr.failed_subjects === 1 ? "" : "s"})` : ""}</span>
                <span>Percentage: {Number(dr.percent)}%</span><span>Grade: {dr.grade ?? "—"}</span><span>Rank: {dr.rank ?? "—"}</span>
              </p>
            )}
            <p className="mt-3 mb-0">Attendance this session: <b>{mine.length ? `${present}/${mine.length} days (${pct(present, mine.length)}%)` : "—"}</b></p>
            <p className="mt-1 mb-0 text-[11px] text-muted">Grades: {school.grade_scale.map((g) => `${g.grade} ≥${g.min}%`).join(" · ")}</p>
            <div className="mt-6 min-h-14 border border-line p-2 text-[12px] text-muted">Remarks: <span className="text-ink">{dr?.remark ?? ""}</span></div>
            <footer className="mt-10 grid grid-cols-3 gap-6 text-center text-[12px]">
              <span className="border-t border-ink pt-1">Class teacher</span><span className="border-t border-ink pt-1">Parent</span><span className="border-t border-ink pt-1">{branding.signature /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={branding.signature} alt="" className="mx-auto -mt-12 mb-1 block h-10 object-contain" /> : null}Principal{school.principal_name ? ` (${school.principal_name})` : ""}</span>
            </footer>
          </article>
          </DocSheet>
        );
      })}
    </div>
  );
}
