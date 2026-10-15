import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { PrintButton } from "@/components/ui/PrintButton";
import { getClasses } from "@/lib/erp";
import { fmtDate } from "@/lib/format";
import { deleteExam, removeExamSubject, setExamSubjects, togglePublish } from "../../_actions/academics";
import { copyExamSubjects, declareResult, saveExamSubject, setMarksLock, undoDeclaration } from "../../_actions/exams2";

type Prog = { class_id: string; class_name: string; students: number; subjects: number; expected: number; entered: number; absent: number; locked: boolean; declared_at: string | null; results: number };
type ES = { id: string; class_id: string; subject_id: string; max_marks: number; pass_marks: number | null; exam_date: string | null; start_time: string | null; end_time: string | null; room: string | null };
const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : "");

export default async function Exam({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("exams.setup.view", "exams.marks.view");
  const { data: exam } = await supabase.from("exams").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!exam) notFound();
  const [classes, { data: subjects }, { data: es }, { data: prog }, { data: others }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("sort"),
    supabase.from("exam_subjects").select("id,class_id,subject_id,max_marks,pass_marks,exam_date,start_time,end_time,room").eq("exam_id", id),
    supabase.rpc("exam_marks_progress", { sid: school.id, p_exam: id }),
    supabase.from("exams").select("id,name").eq("school_id", school.id).neq("id", id).order("sort"),
  ]);
  const admin = can("exams.setup.delete");
  const canPublish = can("exams.results.publish");
  const canSetup = can("exams.setup.create") || can("exams.setup.edit");
  const canWrite = can("exams.marks.create");
  const subName = (sid: string) => (subjects ?? []).find((s) => s.id === sid)?.name ?? "—";
  const rows = ((es ?? []) as ES[]).sort((a, b) => (a.exam_date ?? "9999").localeCompare(b.exam_date ?? "9999") || subName(a.subject_id).localeCompare(subName(b.subject_id)));
  const P = new Map(((prog ?? []) as Prog[]).map((p) => [p.class_id, p]));
  const classList = classes.filter((c) => rows.some((r) => r.class_id === c.id));
  const declaredAll = classList.length > 0 && classList.every((c) => P.get(c.id)?.declared_at);
  const anyDeclared = classList.some((c) => P.get(c.id)?.declared_at);
  const editing = sp.edit ? rows.find((r) => r.id === sp.edit) ?? null : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="exams" title={exam.name} subtitle={exam.published ? <Badge value="published" text="Published to parents" /> : anyDeclared ? "Result declared — not yet visible to parents" : "Not visible to parents yet"} back={{ href: "/app/exams", label: "Exams" }}
        actions={<>
          {canPublish && classList.length > 0 && (
            <Modal label={declaredAll ? "Re-declare result" : "Declare result"} title="Declare the result" size="sm">
              <form action={declareResult} className="grid gap-3">
                <input type="hidden" name="exam_id" value={id} />
                <p className="m-0 text-[14px]">Calculates total, percentage, grade, rank and pass / fail for every class of <b>{exam.name}</b> and locks marks entry. Withheld results stay withheld.</p>
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="force" value="1" /> Declare even if some marks are missing (counted as zero)</label>
                <Submit>Declare result</Submit>
              </form>
            </Modal>
          )}
          {canPublish && <form action={togglePublish}><input type="hidden" name="id" value={id} /><input type="hidden" name="published" value={exam.published ? "0" : "1"} /><Submit variant={exam.published ? "secondary" : "primary"}>{exam.published ? "Hide from parents" : "Publish to parents"}</Submit></form>}
          {can("exams.results.view") && <Link href={`/app/exams/${id}/results`} className="btn btn-sm btn-secondary">Result sheet</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Classes" value={classList.length} icon="exams" tone="blue" />
        <Stat label="Marks entered" value={`${classList.reduce((t, c) => t + Number(P.get(c.id)?.entered ?? 0), 0)} / ${classList.reduce((t, c) => t + Number(P.get(c.id)?.expected ?? 0), 0)}`} icon="exams" tone="violet" />
        <Stat label="Declared" value={`${classList.filter((c) => P.get(c.id)?.declared_at).length} / ${classList.length}`} icon="exams" tone="green" />
        <Stat label="Starts" value={exam.start_date ? fmtDate(exam.start_date) : "—"} icon="exams" tone="amber" />
      </div>

      <Card title="Classes — marks entry and result">
        {classList.length ? (
          <Table head={["Class", "Students", "Marks entered", "Status", ""]} minWidth={860}>
            {classList.map((c) => {
              const p = P.get(c.id);
              const pct = p && Number(p.expected) ? Math.round((100 * Number(p.entered)) / Number(p.expected)) : 0;
              const missing = p ? Number(p.expected) - Number(p.entered) : 0;
              return (
                <tr key={c.id}>
                  <td className={td}><b className="text-ink">Class {c.name}</b><div className="text-[12px] text-muted">{p?.subjects ?? 0} subjects</div></td>
                  <td className={td}>{p?.students ?? 0}</td>
                  <td className={td}>
                    <div className="flex items-center gap-2"><span className="block h-2 w-28 overflow-hidden rounded-full bg-[#eef1f6]"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? "#16a34a" : "#2563eb" }} /></span><span className="text-[13px]">{pct}%</span></div>
                    <div className="text-[12px] text-muted">{p?.entered ?? 0}/{p?.expected ?? 0}{Number(p?.absent) ? ` · ${p!.absent} absent` : ""}{missing > 0 ? ` · ${missing} missing` : ""}</div>
                  </td>
                  <td className={td}>
                    {p?.declared_at ? <Badge value="paid" text="Declared" /> : p?.locked ? <Badge value="due" text="Locked" /> : <Badge value="pending" text="Entry open" />}
                    {p?.declared_at && <div className="text-[12px] text-muted">{fmtDate(p.declared_at.slice(0, 10))} · {p.results} results</div>}
                  </td>
                  <td className={`${td} text-[13px]`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {canWrite && !p?.locked && <Link href={`/app/exams/${id}/marks?class_id=${c.id}`} className="btn btn-sm btn-primary">Enter marks</Link>}
                      {can("exams.results.print") && <Link href={`/app/exams/${id}/report?class_id=${c.id}`}>Report cards</Link>}
                      {can("exams.results.view") && p?.declared_at && <Link href={`/app/exams/${id}/results?class_id=${c.id}`}>Results</Link>}
                      {canPublish && !p?.declared_at && (
                        <form action={setMarksLock}><input type="hidden" name="exam_id" value={id} /><input type="hidden" name="class_id" value={c.id} /><input type="hidden" name="lock" value={p?.locked ? "0" : "1"} />
                          <button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">{p?.locked ? "Unlock marks" : "Lock marks"}</button></form>
                      )}
                      {canPublish && (
                        <Modal label={p?.declared_at ? "Re-declare" : "Declare"} variant="link" title={`Declare result — Class ${c.name}`} size="sm">
                          <form action={declareResult} className="grid gap-3">
                            <input type="hidden" name="exam_id" value={id} /><input type="hidden" name="class_id" value={c.id} />
                            <p className="m-0 text-[14px]">{missing > 0 ? <><b className="text-error">{missing} marks are missing.</b> Enter them first, or tick below to count them as zero.</> : "All marks are in. Totals, grades and ranks will be calculated."}</p>
                            {missing > 0 && <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="force" value="1" /> Declare anyway</label>}
                            <Submit>Declare</Submit>
                          </form>
                        </Modal>
                      )}
                      {canPublish && p?.declared_at && (
                        <form action={undoDeclaration}><input type="hidden" name="exam_id" value={id} /><input type="hidden" name="class_id" value={c.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Withdraw</button></form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>Add subjects and maximum marks for classes below.</Empty>}
      </Card>

      {rows.length > 0 && (
        <Card title="Date sheet" actions={<PrintButton />}>
          <Table head={["Class", "Subject", "Date", "Time", "Room", "Max", "Pass", ""]} minWidth={760}>
            {classes.flatMap((c) => rows.filter((r) => r.class_id === c.id).map((r) => (
              <tr key={r.id} className={editing?.id === r.id ? "bg-blue-tint" : ""}>
                <td className={td}>{c.name}</td>
                <td className={td}><b className="text-ink">{subName(r.subject_id)}</b></td>
                <td className={td}>{r.exam_date ? fmtDate(r.exam_date) : <span className="text-muted">—</span>}</td>
                <td className={`${td} text-[13px]`}>{r.start_time ? `${hhmm(r.start_time)}${r.end_time ? `–${hhmm(r.end_time)}` : ""}` : "—"}</td>
                <td className={`${td} text-[13px]`}>{r.room ?? "—"}</td>
                <td className={td}>{Number(r.max_marks)}</td>
                <td className={td}>{r.pass_marks !== null ? Number(r.pass_marks) : <span className="text-muted">33%</span>}</td>
                <td className={`${td} text-[13px] print:hidden`}>
                  {canSetup && (
                    <div className="flex items-center gap-3">
                      <Modal label="Edit" variant="link" title={`${subName(r.subject_id)} — Class ${c.name}`} size="sm">
                        <form action={saveExamSubject} className="grid gap-3 sm:grid-cols-2">
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="exam_id" value={id} />
                          <Input label="Date" name="exam_date" type="date" defaultValue={r.exam_date} />
                          <Input label="Room" name="room" defaultValue={r.room} />
                          <Input label="From" name="start_time" type="time" defaultValue={hhmm(r.start_time)} />
                          <Input label="To" name="end_time" type="time" defaultValue={hhmm(r.end_time)} />
                          <Input label="Max marks" name="max_marks" type="number" step="0.5" min={1} defaultValue={Number(r.max_marks)} />
                          <Input label="Pass marks" name="pass_marks" type="number" step="0.5" min={0} defaultValue={r.pass_marks ?? ""} hint="Blank = 33% of max" />
                          <div className="sm:col-span-2"><Submit>Save</Submit></div>
                        </form>
                      </Modal>
                      <form action={removeExamSubject}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="exam_id" value={id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Remove</button></form>
                    </div>
                  )}
                </td>
              </tr>
            )))}
          </Table>
        </Card>
      )}

      {canSetup && (
        <div className="flex flex-wrap gap-3 print:hidden">
          <Modal label="+ Add subjects to classes" variant="secondary" title="Add subjects to classes">
            <form action={setExamSubjects} className="flex flex-col gap-3">
              <input type="hidden" name="exam_id" value={id} />
              <fieldset className="border-0 p-0"><legend className="mb-1 text-[13px] font-semibold text-ink">Classes</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">{classes.map((c) => <label key={c.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="class_ids" value={c.id} /> {c.name}</label>)}</div>
              </fieldset>
              <fieldset className="border-0 p-0"><legend className="mb-1 text-[13px] font-semibold text-ink">Subjects</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">{(subjects ?? []).map((s) => <label key={s.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="subject_ids" value={s.id} /> {s.name}</label>)}</div>
              </fieldset>
              <div className="flex flex-wrap items-end gap-3"><Input label="Max marks" name="max_marks" type="number" defaultValue={100} min={1} /><Submit>Save</Submit></div>
            </form>
          </Modal>
          {(others ?? []).length > 0 && (
            <Modal label="Copy subjects from another exam" variant="secondary" title="Copy subjects" size="sm">
              <form action={copyExamSubjects} className="grid gap-3">
                <input type="hidden" name="exam_id" value={id} />
                <Select label="From exam" name="from" options={(others ?? []).map((o) => [o.id, o.name] as [string, string])} />
                <Submit>Copy</Submit>
              </form>
            </Modal>
          )}
        </div>
      )}
      {admin && (
        <details className="text-[14px] print:hidden"><summary className="cursor-pointer text-error">Delete exam</summary>
          <form action={deleteExam} className="mt-2"><input type="hidden" name="id" value={id} /><Submit variant="danger">Delete {exam.name} and all its marks</Submit></form>
        </details>
      )}
    </div>
  );
}
