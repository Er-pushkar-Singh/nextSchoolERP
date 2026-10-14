import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { fmtDate } from "@/lib/format";
import { addUnit, copySyllabus, deleteUnit, setUnitStatus, verifyUnit } from "../../_actions/academics2";

type Prog = { class_id: string; class_name: string; subject_id: string; subject_name: string; units: number; in_progress: number; done: number; verified: number; pct: number | null };
type Unit = { id: string; no: number; title: string; term: string | null; planned_on: string | null; status: string; completed_on: string | null; note: string | null; verified_by_name: string | null; verified_at: string | null; updated_by_name: string | null };
const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function Syllabus({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, session, can } = await requirePerm("academics.syllabus.view");
  const sp = await searchParams;
  const cls = uid(sp.class), sub = uid(sp.subject);
  if (!session) return <Empty>Create and select a current session first (Classes, subjects & sessions).</Empty>;
  const [{ data: prog }, { data: units }, { data: sessions }] = await Promise.all([
    supabase.rpc("syllabus_progress", { sid: school.id, p_session: session.id, p_class: null }),
    cls && sub ? supabase.from("syllabus_units").select("*").eq("session_id", session.id).eq("class_id", cls).eq("subject_id", sub).order("no") : Promise.resolve({ data: [] }),
    supabase.from("sessions").select("id,name").eq("school_id", school.id).order("start_date", { ascending: false }),
  ]);
  const P = (prog ?? []) as Prog[];
  const U = (units ?? []) as Unit[];
  const cur = P.find((p) => p.class_id === cls && p.subject_id === sub);
  const classes = [...new Map(P.map((p) => [p.class_id, p.class_name])).entries()];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Syllabus & lesson plans" subtitle={`Session ${session.name} · coverage by class and subject`} back={{ href: "/app/academics", label: "Academic setup" }} />
      <Flash ok={sp.ok} error={sp.error} />

      {cur && cls && sub ? (
        <>
          <Card title={`Class ${cur.class_name} — ${cur.subject_name}`} description={`${cur.done} of ${cur.units} topics done${cur.pct !== null ? ` · ${cur.pct}%` : ""} · ${cur.verified} verified`}
            actions={<Link href="/app/academics/syllabus" className="text-[13px]">← All subjects</Link>}>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-[#eef1f6]"><div className="h-full rounded-full bg-[#16a34a]" style={{ width: `${cur.pct ?? 0}%` }} /></div>
            {U.length ? (
              <Table head={["#", "Topic", "Planned", "Status", "Done on", ""]} minWidth={760}>
                {U.map((u) => (
                  <tr key={u.id}>
                    <td className={td}>{u.no}</td>
                    <td className={td}><b className="text-ink">{u.title}</b>{u.term ? <span className="text-[12px] text-muted"> · {u.term}</span> : null}{u.note ? <div className="text-[12px] text-muted">{u.note}</div> : null}
                      {u.verified_at && <div className="text-[12px] text-[#15803d]">✓ Verified by {u.verified_by_name}</div>}</td>
                    <td className={`${td} text-[13px]`}>{u.planned_on ? fmtDate(u.planned_on) : "—"}</td>
                    <td className={td} colSpan={can("academics.syllabus.edit") ? 1 : 1}>
                      {can("academics.syllabus.edit") ? (
                        <form action={setUnitStatus} className="flex flex-wrap items-center gap-1">
                          <input type="hidden" name="id" value={u.id} /><input type="hidden" name="class_id" value={cls} /><input type="hidden" name="subject_id" value={sub} />
                          <input type="hidden" name="planned_on" value={u.planned_on ?? ""} /><input type="hidden" name="note" value={u.note ?? ""} />
                          <select name="status" defaultValue={u.status} className="input !min-h-8 !w-auto !py-0.5 text-[13px]"><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="done">Done</option></select>
                          <button className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-blue underline">Save</button>
                        </form>
                      ) : <Badge value={u.status === "done" ? "done" : u.status === "in_progress" ? "in_progress" : "pending"} text={u.status.replace("_", " ")} />}
                    </td>
                    <td className={`${td} text-[13px]`}>{u.completed_on ? fmtDate(u.completed_on) : "—"}{u.updated_by_name ? <div className="text-[12px] text-muted">{u.updated_by_name}</div> : null}</td>
                    <td className={`${td} text-[13px]`}>
                      <div className="flex flex-col gap-1">
                        {u.status === "done" && !u.verified_at && can("academics.syllabus.approve") && (
                          <form action={verifyUnit}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="class_id" value={cls} /><input type="hidden" name="subject_id" value={sub} /><button className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#15803d] underline">Verify</button></form>
                        )}
                        {can("academics.syllabus.delete") && (
                          <form action={deleteUnit}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="class_id" value={cls} /><input type="hidden" name="subject_id" value={sub} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Remove</button></form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : <Empty>No topics yet. Add them below — one per line.</Empty>}
          </Card>
          {can("academics.syllabus.create") && (
            <Card title="Add topics">
              <form action={addUnit} className="flex flex-col gap-3">
                <input type="hidden" name="class_id" value={cls} /><input type="hidden" name="subject_id" value={sub} />
                <Textarea label="One chapter / topic per line" name="titles" rows={5} placeholder={"Place value\nAddition and subtraction\nMultiplication"} />
                <div className="flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Term<input name="term" placeholder="Term 1" className="input !min-h-10 !py-2 font-normal" /></label><Submit>Add topics</Submit></div>
              </form>
            </Card>
          )}
        </>
      ) : (
        <>
          {P.length ? classes.map(([id, name]) => (
            <Card key={id} title={`Class ${name}`}>
              <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {P.filter((p) => p.class_id === id).map((p) => (
                  <li key={p.subject_id}>
                    <Link href={`/app/academics/syllabus?class=${p.class_id}&subject=${p.subject_id}`} className="block rounded-lg border border-line bg-white px-3 py-2 no-underline hover:border-blue">
                      <span className="flex items-center justify-between gap-2"><b className="text-[14px] text-ink">{p.subject_name}</b><span className="text-[13px] text-muted">{Number(p.units) ? `${p.done}/${p.units}` : "no topics"}</span></span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[#eef1f6]"><span className="block h-full rounded-full bg-[#16a34a]" style={{ width: `${p.pct ?? 0}%` }} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )) : <Empty>Map subjects to classes in <Link href="/app/academics/curriculum">Curriculum</Link> first.</Empty>}
          {can("academics.syllabus.create") && (sessions ?? []).length > 1 && (
            <Card title="Copy the syllabus to a new session" description="Titles and order are copied; everything starts pending.">
              <form action={copySyllabus} className="flex flex-wrap items-end gap-3">
                <Select label="From" name="from" options={(sessions ?? []).map((s) => [s.id, s.name] as [string, string])} />
                <Select label="To" name="to" defaultValue={session.id} options={(sessions ?? []).map((s) => [s.id, s.name] as [string, string])} />
                <Submit variant="secondary">Copy</Submit>
              </form>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
