import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { QuestionForm, type QuestionInit } from "@/components/exams/QuestionForm";
import { cleanSearch } from "@/lib/format";
import { deleteQuestion, importQuestions, toggleQuestion } from "../../_actions/online-exams";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
type Q = QuestionInit & { class_id: string; subject_id: string };
const KIND: Record<string, string> = { single: "Single answer", multi: "Multiple answers", truefalse: "True / False" };
const TONE: Record<string, string> = { easy: "paid", medium: "due", hard: "overdue" };

export default async function QuestionBank({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("exams.setup.view", "exams.marks.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const cls = uid(sp.class_id), sub = uid(sp.subject_id);
  const diff = ["easy", "medium", "hard"].includes(sp.difficulty ?? "") ? sp.difficulty! : null;
  const kind = ["single", "multi", "truefalse"].includes(sp.kind ?? "") ? sp.kind! : null;
  const state = sp.state === "inactive" ? "inactive" : sp.state === "all" ? "all" : "active";
  const chapter = sp.chapter?.trim().slice(0, 80) || null;
  const q = cleanSearch(sp.q ?? "").trim();
  const editId = uid(sp.edit);

  let query = supabase.from("question_bank").select("*", { count: "exact" }).eq("school_id", school.id).order("created_at", { ascending: false }).range(offset, offset + size - 1);
  if (cls) query = query.eq("class_id", cls);
  if (sub) query = query.eq("subject_id", sub);
  if (diff) query = query.eq("difficulty", diff);
  if (kind) query = query.eq("kind", kind);
  if (chapter) query = query.ilike("chapter", `%${chapter.replace(/[%_\\,()]/g, " ")}%`);
  if (state !== "all") query = query.eq("active", state === "active");
  if (q) query = query.ilike("text", `%${q.replace(/[%_\\,()]/g, " ")}%`);

  const [{ data, count }, { data: classes }, { data: subjects }, { count: total }, editQ] = await Promise.all([
    query,
    supabase.from("classes").select("id,name,sort").eq("school_id", school.id).order("sort"),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("sort").order("name"),
    supabase.from("question_bank").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("active", true),
    editId ? supabase.from("question_bank").select("*").eq("id", editId).eq("school_id", school.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const rows = (data ?? []) as unknown as Q[];
  const edit = editQ.data as unknown as Q | null;
  const cn = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const sn = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const canWrite = can("exams.marks.create") || can("exams.setup.create");
  const params = { class_id: cls ?? undefined, subject_id: sub ?? undefined, difficulty: diff ?? undefined, kind: kind ?? undefined, state: state === "active" ? undefined : state, chapter: chapter ?? undefined, q: q || undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: sp.page, size: sp.size }).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/app/exams/questions${qs ? "?" + qs : ""}`;
  const addHref = (e: string) => `${here}${here.includes("?") ? "&" : "?"}edit=${e}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="exams" title="Question bank" subtitle="Questions by class and subject — used by online exams" back={{ href: "/app/exams", label: "Exams" }}
        actions={<>
          {canWrite && (
            <Modal label="+ Add question" title="Add a question" size="lg">
              <QuestionForm classes={classes ?? []} subjects={subjects ?? []} back={here} defaults={{ class_id: cls ?? undefined, subject_id: sub ?? undefined }} />
            </Modal>
          )}
          {canWrite && (
            <Modal label="Import" variant="secondary" title="Import questions" size="lg">
              <form action={importQuestions} className="grid gap-3">
                <input type="hidden" name="back" value={here} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label="Class" name="class_id" defaultValue={cls} options={(classes ?? []).map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
                  <Select label="Subject" name="subject_id" defaultValue={sub} options={(subjects ?? []).map((s) => [s.id, s.name] as [string, string])} />
                </div>
                <Textarea label="One question per line" name="lines" rows={8} placeholder={"2 + 2 = ? | 3 | 4 | 5 | 6 | B | 1 | easy | Numbers\nPrime numbers? | 2 | 4 | 7 | 9 | AC | 2 | medium | Numbers\nZero is even. | | | | | T | 1 | easy | Numbers"} />
                <p className="m-0 text-[12px] text-muted">Format: question | option A | option B | option C | option D | correct (A, B…, AC for several, T or F for true / false) | marks | difficulty | chapter. Up to 300 lines.</p>
                <div><Submit>Import</Submit></div>
              </form>
            </Modal>
          )}
          <Link href="/app/exams/online" className="btn btn-sm btn-secondary">Online exams</Link>
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Active questions" value={total ?? 0} icon="exams" tone="blue" />
        <Stat label="Matching filters" value={count ?? 0} icon="exams" tone="violet" />
        <Stat label="Subjects covered" value={new Set(rows.map((r) => r.subject_id)).size} hint="on this page" icon="exams" tone="green" />
      </div>

      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-8">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Words in the question" className="lg:col-span-2" />
        <Select label="Class" name="class_id" blank="All" defaultValue={cls} options={(classes ?? []).map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
        <Select label="Subject" name="subject_id" blank="All" defaultValue={sub} options={(subjects ?? []).map((s) => [s.id, s.name] as [string, string])} />
        <Select label="Difficulty" name="difficulty" blank="All" defaultValue={diff} options={[["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]} />
        <Select label="Type" name="kind" blank="All" defaultValue={kind} options={Object.entries(KIND)} />
        <Input label="Chapter" name="chapter" defaultValue={chapter ?? ""} />
        <Select label="Status" name="state" defaultValue={state} options={[["active", "Active"], ["inactive", "Inactive"], ["all", "All"]]} />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>

      {rows.length ? (
        <Table head={["Question", "Class · subject", "Type", "Marks", "Level", "Chapter", ""]} minWidth={940}>
          {rows.map((r) => (
            <tr key={r.id} className={r.active ? "" : "opacity-60"}>
              <td className={`${td} max-w-[360px]`}>
                <div className="line-clamp-2 text-ink">{r.text}</div>
                {r.kind !== "truefalse" && <div className="mt-1 text-[12px] text-muted">{r.options.length} options · correct {r.answer.map((a) => a.toUpperCase()).join(", ")}</div>}
                {r.kind === "truefalse" && <div className="mt-1 text-[12px] text-muted">Answer: {r.answer[0] === "t" ? "True" : "False"}</div>}
              </td>
              <td className={td}>{cn.get(r.class_id)} · {sn.get(r.subject_id)}</td>
              <td className={`${td} text-[13px]`}>{KIND[r.kind]}</td>
              <td className={td}>{Number(r.marks)}{Number(r.negative_marks) > 0 ? <span className="text-[12px] text-muted"> (−{Number(r.negative_marks)})</span> : null}</td>
              <td className={td}><Badge value={TONE[r.difficulty]} text={r.difficulty} /></td>
              <td className={`${td} text-[13px]`}>{r.chapter ?? "—"}</td>
              <td className={`${td} text-[13px]`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {canWrite && <Link href={addHref(r.id)}>Edit</Link>}
                  {canWrite && <form action={toggleQuestion}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={r.active ? "0" : "1"} /><input type="hidden" name="back" value={here} /><button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">{r.active ? "Switch off" : "Switch on"}</button></form>}
                  {can("exams.marks.edit") && <form action={deleteQuestion}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Delete</button></form>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || cls || sub || diff || kind || chapter ? "No question matches these filters." : "The question bank is empty. Add questions, or import many at once."}</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/exams/questions" params={params} />

      {edit && (
        <Modal defaultOpen closeHref={here} title="Edit question" size="lg">
          <QuestionForm key={edit.id} classes={classes ?? []} subjects={subjects ?? []} initial={edit} back={here} />
        </Modal>
      )}
    </div>
  );
}
