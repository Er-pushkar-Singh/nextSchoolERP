import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { PrintButton } from "@/components/ui/PrintButton";
import { getClasses } from "@/lib/erp";
import { cleanSearch, fullName } from "@/lib/format";
import { saveRemark, withholdResult } from "../../../_actions/exams2";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
type R = { id: string; student_id: string; class_id: string; total: number; max_total: number; percent: number; grade: string | null; rank: number | null; result: string; failed_subjects: number; remark: string | null; withheld_reason: string | null;
  students: { first_name: string; middle_name: string | null; last_name: string | null; admission_no: string; roll_no: number | null; sections: { name: string } | { name: string }[] | null } | null };
const TONE: Record<string, string> = { pass: "paid", fail: "overdue", absent: "cancelled", withheld: "due" };

export default async function Results({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!uid(id)) notFound();
  const { supabase, school, can } = await requirePerm("exams.results.view");
  const { data: exam } = await supabase.from("exams").select("id,name,published").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!exam) notFound();
  const { page, size, offset } = pageParams(sp, 50);
  const cls = uid(sp.class_id);
  const result = ["pass", "fail", "absent", "withheld"].includes(sp.result ?? "") ? sp.result! : null;
  const q = cleanSearch(sp.q ?? "").trim();
  const classes = await getClasses(supabase, school.id);

  let query = supabase.from("exam_results").select("id,student_id,class_id,total,max_total,percent,grade,rank,result,failed_subjects,remark,withheld_reason,students(first_name,middle_name,last_name,admission_no,roll_no,sections(name))", { count: "exact" })
    .eq("exam_id", id).eq("school_id", school.id).order("class_id").order("rank", { nullsFirst: false }).range(offset, offset + size - 1);
  if (cls) query = query.eq("class_id", cls);
  if (result) query = query.eq("result", result);
  if (q) {
    const p = `%${q.replace(/[%_\\,()]/g, " ")}%`;
    const { data: ss } = await supabase.from("students").select("id").eq("school_id", school.id).or(`first_name.ilike.${p},last_name.ilike.${p},admission_no.ilike.${p}`).limit(300);
    const ids = (ss ?? []).map((x) => x.id);
    query = ids.length ? query.in("student_id", ids) : query.eq("student_id", "00000000-0000-0000-0000-000000000000");
  }
  const [{ data, count }, { data: all }] = await Promise.all([
    query,
    supabase.from("exam_results").select("result,class_id,percent").eq("exam_id", id).eq("school_id", school.id).limit(20000),
  ]);
  const rows = (data ?? []) as unknown as R[];
  const A = (all ?? []) as { result: string; class_id: string; percent: number }[];
  const inScope = cls ? A.filter((a) => a.class_id === cls) : A;
  const pass = inScope.filter((a) => a.result === "pass").length;
  const avg = inScope.length ? inScope.reduce((t, a) => t + Number(a.percent), 0) / inScope.length : 0;
  const className = (cid: string) => classes.find((c) => c.id === cid)?.name ?? "";
  const params2 = { class_id: cls ?? undefined, result: result ?? undefined, q: q || undefined };
  const qs = new URLSearchParams(Object.entries({ ...params2, page: sp.page, size: sp.size }).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/app/exams/${id}/results${qs ? "?" + qs : ""}`;
  const canEdit = can("exams.results.publish");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 print:hidden">
        <PageHeader icon="exams" title={`Result sheet · ${exam.name}`} subtitle={exam.published ? "Published to parents" : "Not published"} back={{ href: `/app/exams/${id}`, label: exam.name }}
          actions={<><PrintButton />{can("exams.results.print") && <a href={`/app/exams/${id}/results/export${qs ? "?" + qs : ""}`} className="btn btn-sm btn-secondary">Download CSV</a>}</>} />
        <Flash ok={sp.ok} error={sp.error} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Students" value={inScope.length} icon="exams" tone="blue" />
          <Stat label="Passed" value={pass} hint={inScope.length ? `${Math.round((100 * pass) / inScope.length)}%` : undefined} icon="exams" tone="green" />
          <Stat label="Failed / absent" value={inScope.filter((a) => a.result === "fail" || a.result === "absent").length} icon="exams" tone="rose" />
          <Stat label="Average" value={`${avg.toFixed(1)}%`} icon="exams" tone="violet" />
        </div>
        <form className="grid items-end gap-2 sm:grid-cols-4">
          <Select label="Class" name="class_id" blank="All classes" defaultValue={cls} options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
          <Select label="Result" name="result" blank="All" defaultValue={result} options={[["pass", "Pass"], ["fail", "Fail"], ["absent", "Absent"], ["withheld", "Withheld"]]} />
          <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name or admission no." />
          <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
        </form>
      </div>
      <h1 className="hidden text-[18px] font-bold print:block">{school.name} — {exam.name} result{cls ? ` · Class ${className(cls)}` : ""}</h1>

      {rows.length ? (
        <Table head={["Rank", "Student", "Class", "Marks", "%", "Grade", "Result", "Remark", ""]} minWidth={980}>
          {rows.map((r) => {
            const s = r.students;
            const sec = s ? (Array.isArray(s.sections) ? s.sections[0] : s.sections) : null;
            return (
              <tr key={r.id}>
                <td className={td}><b>{r.result === "withheld" ? "—" : r.rank}</b></td>
                <td className={td}>{s ? <Link href={`/app/students/${r.student_id}`} className="font-semibold">{fullName(s)}</Link> : "—"}<div className="text-[12px] text-muted">{s?.admission_no}{s?.roll_no ? ` · Roll ${s.roll_no}` : ""}</div></td>
                <td className={td}>{className(r.class_id)}{sec ? `-${sec.name}` : ""}</td>
                <td className={td}>{Number(r.total)} / {Number(r.max_total)}</td>
                <td className={td}>{Number(r.percent)}%</td>
                <td className={td}>{r.grade ?? "—"}</td>
                <td className={td}><Badge value={TONE[r.result] ?? "pending"} text={r.result[0].toUpperCase() + r.result.slice(1)} />{r.result === "fail" && r.failed_subjects > 0 ? <div className="text-[12px] text-muted">{r.failed_subjects} subject(s)</div> : null}
                  {r.withheld_reason && <div className="text-[12px] text-muted">{r.withheld_reason}</div>}</td>
                <td className={`${td} text-[13px]`}>{r.remark ?? ""}</td>
                <td className={`${td} text-[13px] print:hidden`}>
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/app/exams/${id}/report?class_id=${r.class_id}&student=${r.student_id}`}>Report card</Link>
                    {(canEdit || can("exams.marks.edit")) && (
                      <Modal label="Remark" variant="link" title="Teacher's remark" size="sm">
                        <form action={saveRemark} className="grid gap-3">
                          <input type="hidden" name="exam_id" value={id} /><input type="hidden" name="student_id" value={r.student_id} /><input type="hidden" name="back" value={here} />
                          <Input label="Remark on the report card" name="remark" defaultValue={r.remark} />
                          <Submit>Save</Submit>
                        </form>
                      </Modal>
                    )}
                    {canEdit && (r.result === "withheld" ? (
                      <form action={withholdResult}><input type="hidden" name="exam_id" value={id} /><input type="hidden" name="student_id" value={r.student_id} /><input type="hidden" name="release" value="1" /><input type="hidden" name="back" value={here} />
                        <button className="cursor-pointer border-0 bg-transparent p-0 text-[#15803d] underline">Release</button></form>
                    ) : (
                      <Modal label="Withhold" variant="link" title="Withhold this result" size="sm">
                        <form action={withholdResult} className="grid gap-3">
                          <input type="hidden" name="exam_id" value={id} /><input type="hidden" name="student_id" value={r.student_id} /><input type="hidden" name="back" value={here} />
                          <Input label="Reason" name="reason" required placeholder="Fees pending, documents…" />
                          <Submit>Withhold</Submit>
                        </form>
                      </Modal>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No declared results here. Declare the result from the exam page.</Empty>}
      <div className="print:hidden"><Pagination total={count ?? 0} page={page} size={size} basePath={`/app/exams/${id}/results`} params={params2} /></div>
    </div>
  );
}
