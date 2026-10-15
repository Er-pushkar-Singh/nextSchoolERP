import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Stat, Submit } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { fmtDate } from "@/lib/format";
import { createExam } from "../_actions/academics";

type E = { id: string; name: string; start_date: string | null; published: boolean; sort: number };

export default async function Exams({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, session, can } = await requirePerm("exams.setup.view", "exams.marks.view");
  const sp = await searchParams;
  const [{ data }, { data: declared }, { data: online }] = await Promise.all([
    session ? supabase.from("exams").select("id,name,start_date,published,sort").eq("session_id", session.id).order("sort").order("start_date") : Promise.resolve({ data: [] }),
    supabase.from("exam_class_status").select("exam_id,declared_at").eq("school_id", school.id).not("declared_at", "is", null),
    supabase.from("online_exams").select("status").eq("school_id", school.id),
  ]);
  const exams = (data ?? []) as E[];
  const dcount = new Map<string, number>();
  for (const d of declared ?? []) dcount.set(d.exam_id, (dcount.get(d.exam_id) ?? 0) + 1);
  const admin = can("exams.setup.create");
  const O = (online ?? []) as { status: string }[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="exams" title="Exams & results" subtitle={`Session ${session?.name ?? "—"}`}
        actions={<>
          {admin && (
            <Modal label="+ New exam" title="New exam" size="sm">
              <form action={createExam} className="grid gap-3">
                <Input label="Name" name="name" placeholder="Half Yearly" required />
                <Input label="Starts on" name="start_date" type="date" />
                <Input label="Order on report card" name="sort" type="number" defaultValue={exams.length + 1} />
                <Submit>Create exam</Submit>
              </form>
            </Modal>
          )}
          <Link href="/app/exams/online" className="btn btn-sm btn-secondary">Online exams</Link>
          <Link href="/app/exams/questions" className="btn btn-sm btn-secondary">Question bank</Link>
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Offline exams" value={exams.length} icon="exams" tone="blue" />
        <Stat label="Result declared" value={exams.filter((e) => dcount.has(e.id)).length} icon="exams" tone="green" />
        <Stat label="Online — scheduled" value={O.filter((o) => o.status === "scheduled").length} icon="exams" tone="amber" href="/app/exams/online?status=scheduled" />
        <Stat label="Online — total" value={O.length} icon="exams" tone="violet" href="/app/exams/online" />
      </div>

      <section>
        <h2 className="mt-0 mb-2 text-[16px] font-bold text-ink">Offline exams (paper-based)</h2>
        {exams.length ? (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {exams.map((e) => (
              <li key={e.id}>
                <Link href={`/app/exams/${e.id}`} className="block rounded-[12px] border border-line bg-white p-4 no-underline hover:border-ink">
                  <span className="flex items-center justify-between gap-2"><b className="text-[16px] text-ink">{e.name}</b>{e.published ? <Badge value="published" /> : dcount.has(e.id) ? <Badge value="due" text="Declared" /> : <Badge value="draft" />}</span>
                  <span className="text-[13px] text-muted">{e.start_date ? `From ${fmtDate(e.start_date)}` : "No date"}{dcount.has(e.id) ? ` · ${dcount.get(e.id)} class(es) declared` : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <Empty>No exams yet.{admin ? " Create the first one — e.g. Periodic Test 1, Half Yearly, Annual." : ""}</Empty>}
      </section>
    </div>
  );
}
