import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Submit } from "@/components/ui/ui";
import { getClasses } from "@/lib/erp";
import { deleteExam, removeExamSubject, setExamSubjects, togglePublish } from "../../_actions/academics";

export default async function Exam({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("exams.setup.view", "exams.marks.view");
  const { data: exam } = await supabase.from("exams").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!exam) notFound();
  const [classes, { data: subjects }, { data: es }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("sort"),
    supabase.from("exam_subjects").select("id,class_id,subject_id,max_marks").eq("exam_id", id),
  ]);
  const admin = can("exams.setup.delete");
  const canPublish = can("exams.results.publish");
  const canSetup = can("exams.setup.create");
  const canWrite = can("exams.marks.create");
  const subName = (sid: string) => (subjects ?? []).find((s) => s.id === sid)?.name ?? "—";
  const rows = (es ?? []) as { id: string; class_id: string; subject_id: string; max_marks: number }[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={exam.name} subtitle={exam.published ? <Badge value="published" text="Published to parents" /> : "Not visible to parents yet"} back={{ href: "/app/exams", label: "Exams" }}
        actions={canPublish && <form action={togglePublish}><input type="hidden" name="id" value={id} /><input type="hidden" name="published" value={exam.published ? "0" : "1"} /><Submit variant={exam.published ? "secondary" : "primary"}>{exam.published ? "Unpublish" : "Publish results"}</Submit></form>} />
      <Flash ok={sp.ok} error={sp.error} />

      <Card title="Classes">
        {classes.filter((c) => rows.some((r) => r.class_id === c.id)).length ? (
          <ul className="m-0 list-none p-0">
            {classes.filter((c) => rows.some((r) => r.class_id === c.id)).map((c) => {
              const mine = rows.filter((r) => r.class_id === c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3 first:border-0">
                  <div className="min-w-0">
                    <b className="text-ink">Class {c.name}</b>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[13px]">
                      {mine.map((r) => (
                        <span key={r.id} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5">
                          {subName(r.subject_id)} /{Number(r.max_marks)}
                          {canSetup && <form action={removeExamSubject}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="exam_id" value={id} /><button aria-label="Remove" className="cursor-pointer border-0 bg-transparent px-0.5 text-muted">×</button></form>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="flex flex-wrap gap-2">
                    {canWrite && <Link href={`/app/exams/${id}/marks?class_id=${c.id}`} className="btn btn-sm btn-primary">Enter marks</Link>}
                    {can("exams.results.print") && <Link href={`/app/exams/${id}/report?class_id=${c.id}`} className="btn btn-sm btn-secondary">Report cards</Link>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : <Empty>Add subjects and max marks for classes below.</Empty>}
      </Card>

      {canSetup && (
        <Card title="Add subjects to classes">
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
        </Card>
      )}
      {admin && (
        <details className="text-[14px]"><summary className="cursor-pointer text-error">Delete exam</summary>
          <form action={deleteExam} className="mt-2"><input type="hidden" name="id" value={id} /><Submit variant="danger">Delete {exam.name} and all its marks</Submit></form>
        </details>
      )}
    </div>
  );
}
