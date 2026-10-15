import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { CopyButton } from "@/components/CopyButton";
import { PrintButton } from "@/components/ui/PrintButton";
import { appUrl } from "@/lib/brand";
import { qrDataUrl } from "@/lib/qr";
import { nowMs, cleanSearch } from "@/lib/format";
import { addPaperQuestions, closeOnlineExam, declareOnlineExam, deleteOnlineExam, removePaperQuestion, scheduleOnlineExam, setPaperMarks, unscheduleOnlineExam, updateOnlineExam } from "../../../_actions/online-exams";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
type Ex = { id: string; title: string; instructions: string | null; class_id: string; subject_id: string; exam_id: string | null; duration_min: number; starts_at: string | null; ends_at: string | null; status: string;
  pool_mode: string; random_count: number | null; pool_filter: { chapter?: string; difficulty?: string }; shuffle_questions: boolean; shuffle_options: boolean; negative_marking: boolean;
  pass_percent: number; max_tab_switches: number; require_fullscreen: boolean; access_code: string | null; show_result: string; show_answers: boolean; total_marks: number; public_token: string };
type PQ = { question_id: string; marks: number; sort: number; question_bank: { text: string; kind: string; difficulty: string; chapter: string | null; negative_marks: number } | { text: string; kind: string; difficulty: string; chapter: string | null; negative_marks: number }[] | null };
type A = { attempt_id: string; student_id: string; admission_no: string; student_name: string; section_name: string | null; status: string; started_at: string; submitted_at: string | null;
  score: number | null; max_score: number | null; correct: number | null; wrong: number | null; skipped: number | null; tab_switches: number; ip: string | null; rank: number | null; total: number };
const ist = (t: string | null) => (t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const istDate = (t: string | null) => (t ? new Date(new Date(t).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");
const istTime = (t: string | null) => (t ? new Date(new Date(t).getTime() + 5.5 * 3600_000).toISOString().slice(11, 16) : "");
const ATT: Record<string, [string, string]> = { in_progress: ["due", "Writing"], submitted: ["paid", "Submitted"], auto_submitted: ["info", "Auto-submitted"], terminated: ["overdue", "Ended (rules)"] };

export default async function OnlineExam({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!uid(id)) notFound();
  const { supabase, school, can } = await requirePerm("exams.setup.view", "exams.marks.view");
  const { data: ex } = await supabase.from("online_exams").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!ex) notFound();
  const e = ex as unknown as Ex;
  const { page, size, offset } = pageParams(sp, 25);
  const aStatus = ["in_progress", "submitted", "auto_submitted", "terminated"].includes(sp.astatus ?? "") ? sp.astatus! : null;
  const aq = cleanSearch(sp.aq ?? "").trim();
  const pickQ = cleanSearch(sp.pq ?? "").trim();
  const pickD = ["easy", "medium", "hard"].includes(sp.pd ?? "") ? sp.pd! : null;
  const pickC = sp.pc?.trim().slice(0, 80) || null;

  let bank = supabase.from("question_bank").select("id,text,kind,marks,difficulty,chapter").eq("school_id", school.id).eq("class_id", e.class_id).eq("subject_id", e.subject_id).eq("active", true).order("created_at", { ascending: false }).limit(40);
  if (pickD) bank = bank.eq("difficulty", pickD);
  if (pickC) bank = bank.ilike("chapter", `%${pickC.replace(/[%_\\,()]/g, " ")}%`);
  if (pickQ) bank = bank.ilike("text", `%${pickQ.replace(/[%_\\,()]/g, " ")}%`);

  const [{ data: cls }, { data: sub }, { data: paper }, { data: attempts }, { data: allAtt }, { data: offline }, pool, { data: chapters }, bankRes] = await Promise.all([
    supabase.from("classes").select("name").eq("id", e.class_id).maybeSingle(),
    supabase.from("subjects").select("name").eq("id", e.subject_id).maybeSingle(),
    supabase.from("online_exam_questions").select("question_id,marks,sort,question_bank(text,kind,difficulty,chapter,negative_marks)").eq("exam_id", id).order("sort"),
    supabase.rpc("online_attempt_list", { sid: school.id, p_exam: id, p_q: aq || null, p_status: aStatus, p_limit: size, p_offset: offset }),
    supabase.from("online_attempts").select("status,score,max_score,tab_switches").eq("exam_id", id),
    supabase.from("exams").select("id,name").eq("school_id", school.id).order("sort"),
    supabase.rpc("question_pool_size", { sid: school.id, p_class: e.class_id, p_subject: e.subject_id, p_chapter: e.pool_filter?.chapter || null, p_difficulty: e.pool_filter?.difficulty || null }),
    supabase.from("question_bank").select("chapter").eq("school_id", school.id).eq("class_id", e.class_id).eq("subject_id", e.subject_id).eq("active", true).not("chapter", "is", null).limit(500),
    sp.pick === "1" ? bank : Promise.resolve({ data: [] }),
  ]);
  const P = (paper ?? []) as unknown as PQ[];
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
  const A = (attempts ?? []) as A[];
  const total = A[0] ? Number(A[0].total) : 0;
  const all = (allAtt ?? []) as { status: string; score: number | null; max_score: number | null; tab_switches: number }[];
  const done = all.filter((a) => a.status !== "in_progress" && a.score !== null);
  const avg = done.length ? done.reduce((t, a) => t + (Number(a.max_score) ? (100 * Number(a.score)) / Number(a.max_score) : 0), 0) / done.length : 0;
  const passed = done.filter((a) => Number(a.max_score) && (100 * Number(a.score)) / Number(a.max_score) >= Number(e.pass_percent)).length;
  const writing = all.filter((a) => a.status === "in_progress").length;
  const flagged = all.filter((a) => a.tab_switches > 0 || a.status === "terminated").length;
  const chapterList = [...new Set((chapters ?? []).map((c) => c.chapter as string))].sort();
  const now = nowMs();
  const open = e.status === "scheduled" && e.starts_at && e.ends_at && new Date(e.starts_at).getTime() <= now && new Date(e.ends_at).getTime() >= now;
  const draft = e.status === "draft";
  const canEdit = (can("exams.marks.edit") || can("exams.setup.edit")) && draft;
  const canRun = can("exams.marks.edit") || can("exams.setup.edit");
  const canDeclare = can("exams.results.publish");
  const link = appUrl(`/exam/${e.public_token}`);
  const poolSize = Number(pool.data ?? 0);
  const pageFilters = { astatus: aStatus ?? undefined, aq: aq || undefined };
  const qs = new URLSearchParams(Object.entries({ ...pageFilters, page: sp.page, size: sp.size }).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/app/exams/online/${id}${qs ? "?" + qs : ""}`;
  const inPaper = new Set(P.map((p) => p.question_id));

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh seconds={15} enabled={Boolean(open) || writing > 0} />
      <PageHeader icon="exams" title={e.title} subtitle={<>Class {cls?.name} · {sub?.name} · {e.duration_min} minutes · {open ? <Badge value="active" text="Live now" /> : <Badge value={e.status === "declared" ? "paid" : e.status === "scheduled" ? "due" : e.status === "closed" ? "info" : "draft"} text={e.status === "declared" ? "Result declared" : e.status} />}</>}
        back={{ href: "/app/exams/online", label: "Online exams" }}
        actions={<>
          {canEdit && (
            <Modal label="Settings" variant="secondary" title="Exam settings" size="lg">
              <form action={updateOnlineExam} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={id} />
                <Input label="Title" name="title" defaultValue={e.title} required className="sm:col-span-2" />
                <Textarea label="Instructions shown to students" name="instructions" rows={3} defaultValue={e.instructions} className="sm:col-span-2" />
                <Input label="Duration (minutes)" name="duration_min" type="number" min={1} max={360} defaultValue={e.duration_min} />
                <Input label="Pass percentage" name="pass_percent" type="number" min={0} max={100} defaultValue={Number(e.pass_percent)} />
                <Select label="Paper" name="pool_mode" defaultValue={e.pool_mode} options={[["fixed", "Fixed — questions I choose"], ["random", "Random — each student gets a different draw"]]} />
                <Input label="Questions to draw (random paper)" name="random_count" type="number" min={1} max={300} defaultValue={e.random_count ?? ""} />
                <Input label="Random pool: chapter (optional)" name="pool_chapter" defaultValue={e.pool_filter?.chapter ?? ""} list="chapters" />
                <Select label="Random pool: difficulty" name="pool_difficulty" defaultValue={e.pool_filter?.difficulty ?? ""} options={[["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]} />
                <datalist id="chapters">{chapterList.map((c) => <option key={c} value={c} />)}</datalist>
                <Select label="Link to offline exam (marks go there)" name="exam_id" defaultValue={e.exam_id ?? ""} options={[["", "— none —"], ...(offline ?? []).map((o) => [o.id, o.name] as [string, string])]} />
                <Input label="Exam code (optional)" name="access_code" defaultValue={e.access_code ?? ""} hint="Students must type it to start" />
                <Input label="Allowed tab / window switches" name="max_tab_switches" type="number" min={0} max={20} defaultValue={e.max_tab_switches} hint="Exceeding it ends the attempt (0 = unlimited)" />
                <Select label="Show result to students" name="show_result" defaultValue={e.show_result} options={[["after_declare", "After I declare the result"], ["immediately", "Immediately after submitting"], ["never", "Never"]]} />
                <fieldset className="m-0 grid gap-1.5 border-0 p-0 text-[14px] sm:col-span-2">
                  <label className="flex items-center gap-2"><input type="checkbox" name="shuffle_questions" value="1" defaultChecked={e.shuffle_questions} /> Shuffle the question order for every student</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="shuffle_options" value="1" defaultChecked={e.shuffle_options} /> Shuffle the options of each question</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="negative_marking" value="1" defaultChecked={e.negative_marking} /> Negative marking (as set on each question)</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="require_fullscreen" value="1" defaultChecked={e.require_fullscreen} /> Require full-screen mode (leaving counts as a switch)</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="show_answers" value="1" defaultChecked={e.show_answers} /> Let students review correct answers after the result is shown</label>
                </fieldset>
                <div className="sm:col-span-2"><Submit>Save settings</Submit></div>
              </form>
            </Modal>
          )}
          {canRun && e.status === "scheduled" && !open && new Date(e.starts_at ?? 0).getTime() > now && (
            <form action={unscheduleOnlineExam}><input type="hidden" name="id" value={id} /><Submit variant="secondary">Back to draft</Submit></form>
          )}
          {canRun && e.status === "scheduled" && (
            <form action={closeOnlineExam}><input type="hidden" name="id" value={id} /><Submit variant="secondary">Close exam now</Submit></form>
          )}
          {canDeclare && (e.status === "closed" || (e.status === "scheduled" && e.ends_at && new Date(e.ends_at).getTime() < now) || e.status === "declared") && (
            <Modal label={e.status === "declared" ? "Declare again" : "Declare result"} title="Declare the result" size="sm">
              <form action={declareOnlineExam} className="grid gap-3">
                <input type="hidden" name="id" value={id} />
                <p className="m-0 text-[14px]">Students will see their score ({e.show_result === "never" ? "result display is switched off" : e.show_result === "immediately" ? "they already see it" : "from now on"}).</p>
                {e.exam_id ? <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="push" value="1" defaultChecked /> Write the scores into the linked offline exam (scaled to its maximum marks; absentees marked AB)</label>
                  : <p className="m-0 text-[13px] text-muted">Link an offline exam in Settings to also feed the report card marks.</p>}
                <Submit>Declare</Submit>
              </form>
            </Modal>
          )}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      {e.status !== "draft" && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Attempts" value={all.length} icon="exams" tone="blue" />
          <Stat label="Writing now" value={writing} icon="exams" tone="amber" />
          <Stat label="Average" value={done.length ? `${avg.toFixed(1)}%` : "—"} icon="exams" tone="violet" />
          <Stat label="Passed" value={done.length ? `${passed} / ${done.length}` : "—"} icon="exams" tone="green" />
          <Stat label="Flagged" value={flagged} hint="tab switches or ended by rules" icon="notifications" tone={flagged ? "rose" : "green"} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="When">
          {e.starts_at ? (
            <p className="m-0 text-[14px]"><b className="text-ink">{ist(e.starts_at)}</b> to <b className="text-ink">{ist(e.ends_at)}</b><span className="block text-[12px] text-muted">India time. Each student gets {e.duration_min} minutes from their own start, but never beyond the end time.</span></p>
          ) : <p className="m-0 text-[14px] text-muted">Not scheduled.</p>}
          {canRun && (draft || e.status === "scheduled") && (
            <form action={scheduleOnlineExam} className="mt-3 grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="id" value={id} />
              <Input label="Opens on" name="start_date" type="date" defaultValue={istDate(e.starts_at)} required />
              <Input label="at" name="start_time" type="time" defaultValue={istTime(e.starts_at) || "09:00"} required />
              <Input label="Closes on" name="end_date" type="date" defaultValue={istDate(e.ends_at)} />
              <Input label="at" name="end_time" type="time" defaultValue={istTime(e.ends_at) || "10:00"} required />
              <div className="sm:col-span-4"><Submit>{e.status === "scheduled" ? "Change schedule" : "Schedule exam"}</Submit></div>
            </form>
          )}
        </Card>

        <Card title="Student access">
          {e.status === "draft" ? <p className="m-0 text-[14px] text-muted">The link works once the exam is scheduled.</p> : (
            <div className="flex flex-wrap items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl(link)} alt="Exam link QR code" width={110} height={110} className="rounded-lg border border-line" />
              <div className="min-w-0 flex-1 text-[14px]">
                <p className="m-0 break-all font-mono text-[13px] text-ink">{link}</p>
                <div className="mt-2 flex flex-wrap gap-2"><CopyButton text={link} label="Copy link" /><PrintButton /></div>
                <p className="mt-2 mb-0 text-[12px] text-muted">Students sign in with <b>admission number</b> and <b>date of birth</b>{e.access_code ? <> and the exam code <b className="font-mono text-ink">{e.access_code}</b></> : ""}. One device at a time; the answer key never reaches their browser.</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title={e.pool_mode === "random" ? "Random paper" : `Paper — ${P.length} question${P.length === 1 ? "" : "s"}`}
        actions={e.pool_mode === "fixed" && canEdit ? <Link href={`${here}${here.includes("?") ? "&" : "?"}pick=1`} className="btn btn-sm btn-secondary">+ Add from the bank</Link> : undefined}>
        {e.pool_mode === "random" ? (
          <div className="text-[14px]">
            <p className="m-0">Each student gets <b>{e.random_count ?? "?"}</b> questions drawn at random from the bank of Class {cls?.name} · {sub?.name}
              {e.pool_filter?.chapter ? <>, chapter <b>{e.pool_filter.chapter}</b></> : ""}{e.pool_filter?.difficulty ? <>, <b>{e.pool_filter.difficulty}</b> only</> : ""}.</p>
            <p className="mt-1 mb-0"><b className={poolSize >= (e.random_count ?? 0) ? "text-[#15803d]" : "text-error"}>{poolSize}</b> matching question{poolSize === 1 ? "" : "s"} in the pool{poolSize < (e.random_count ?? 0) ? " — not enough to draw from" : ""}. <Link href="/app/exams/questions">Question bank</Link></p>
          </div>
        ) : P.length ? (
          <Table head={["#", "Question", "Type", "Level", "Marks", ""]} minWidth={700}>
            {P.map((p, i) => {
              const q = one(p.question_bank);
              return (
                <tr key={p.question_id}>
                  <td className={td}>{i + 1}</td>
                  <td className={`${td} max-w-[420px]`}><div className="line-clamp-2 text-ink">{q?.text}</div>{q?.chapter && <div className="text-[12px] text-muted">{q.chapter}</div>}</td>
                  <td className={`${td} text-[13px]`}>{q?.kind === "multi" ? "Multiple" : q?.kind === "truefalse" ? "True / False" : "Single"}</td>
                  <td className={td}>{q?.difficulty}</td>
                  <td className={td}>
                    {canEdit ? (
                      <form action={setPaperMarks} className="flex items-center gap-1"><input type="hidden" name="exam_id" value={id} /><input type="hidden" name="question_id" value={p.question_id} />
                        <input name="marks" type="number" step="0.5" min={0.5} defaultValue={Number(p.marks)} aria-label="Marks" className="input !min-h-8 !w-16 !py-0.5 text-[13px]" /><button className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-blue underline">Set</button></form>
                    ) : Number(p.marks)}
                  </td>
                  <td className={td}>{canEdit && <form action={removePaperQuestion}><input type="hidden" name="exam_id" value={id} /><input type="hidden" name="question_id" value={p.question_id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove</button></form>}</td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>No questions on the paper yet.</Empty>}
      </Card>

      {e.status !== "draft" && (
        <Card title="Attempts">
          <form className="mb-3 grid items-end gap-2 sm:grid-cols-4">
            <Input label="Search" name="aq" defaultValue={sp.aq} placeholder="Name or admission no." className="sm:col-span-2" />
            <Select label="Status" name="astatus" blank="All" defaultValue={aStatus} options={Object.entries(ATT).map(([k, v]) => [k, v[1]] as [string, string])} />
            <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
          </form>
          {A.length ? (
            <Table head={["Rank", "Student", "Status", "Score", "Right / wrong / blank", "Switches", "Started", "Submitted"]} minWidth={900}>
              {A.map((a) => (
                <tr key={a.attempt_id}>
                  <td className={td}>{a.rank ?? "—"}</td>
                  <td className={td}><b className="text-ink">{a.student_name}</b><div className="text-[12px] text-muted">{a.admission_no}{a.section_name ? ` · ${a.section_name}` : ""}</div></td>
                  <td className={td}><Badge value={ATT[a.status]?.[0] ?? "pending"} text={ATT[a.status]?.[1] ?? a.status} /></td>
                  <td className={td}>{a.score !== null ? <b>{Number(a.score)} / {Number(a.max_score)}</b> : "—"}</td>
                  <td className={`${td} text-[13px]`}>{a.correct !== null ? `${a.correct} / ${a.wrong} / ${a.skipped}` : "—"}</td>
                  <td className={`${td} ${a.tab_switches > 0 ? "font-semibold text-error" : ""}`}>{a.tab_switches}</td>
                  <td className={`${td} whitespace-nowrap text-[13px]`}>{ist(a.started_at)}</td>
                  <td className={`${td} whitespace-nowrap text-[13px]`}>{ist(a.submitted_at)}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No attempts yet.</Empty>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Pagination total={total} page={page} size={size} basePath={`/app/exams/online/${id}`} params={pageFilters} />
            {can("exams.results.print") && <a href={`/app/exams/online/${id}/export`} className="btn btn-sm btn-secondary">Download CSV</a>}
          </div>
        </Card>
      )}

      {can("exams.setup.delete") && draft && (
        <form action={deleteOnlineExam} className="print:hidden"><input type="hidden" name="id" value={id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Delete this draft exam</button></form>
      )}

      {sp.pick === "1" && canEdit && (
        <Modal defaultOpen closeHref={here} title="Add questions from the bank" size="lg">
          <form className="mb-3 grid items-end gap-2 sm:grid-cols-4">
            <input type="hidden" name="pick" value="1" />
            <Input label="Search" name="pq" defaultValue={pickQ} />
            <Select label="Level" name="pd" blank="Any" defaultValue={pickD} options={[["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]} />
            <Input label="Chapter" name="pc" defaultValue={pickC ?? ""} list="chapters2" />
            <datalist id="chapters2">{chapterList.map((c) => <option key={c} value={c} />)}</datalist>
            <div><button className="btn btn-sm btn-secondary cursor-pointer">Filter</button></div>
          </form>
          <form action={addPaperQuestions} className="grid gap-2">
            <input type="hidden" name="exam_id" value={id} /><input type="hidden" name="back" value={here} />
            {((bankRes.data ?? []) as { id: string; text: string; kind: string; marks: number; difficulty: string; chapter: string | null }[]).filter((b) => !inPaper.has(b.id)).map((b) => (
              <label key={b.id} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-[14px]">
                <input type="checkbox" name="question_id" value={b.id} className="mt-1" />
                <span className="min-w-0 flex-1"><span className="line-clamp-2 text-ink">{b.text}</span><span className="text-[12px] text-muted">{b.difficulty} · {Number(b.marks)} mark{Number(b.marks) === 1 ? "" : "s"}{b.chapter ? ` · ${b.chapter}` : ""}</span></span>
              </label>
            ))}
            {(bankRes.data ?? []).length === 0 && <p className="m-0 text-[14px] text-muted">No active question of this class and subject matches. <Link href="/app/exams/questions">Add questions</Link>.</p>}
            <div><Submit>Add ticked questions</Submit></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
