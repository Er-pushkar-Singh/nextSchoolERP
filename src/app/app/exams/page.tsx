import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Submit } from "@/components/ui/ui";
import { fmtDate } from "@/lib/format";
import { createExam } from "../_actions/academics";

export default async function Exams({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, session, can } = await requirePerm("exams.setup.view", "exams.marks.view");
  const sp = await searchParams;
  const { data } = session ? await supabase.from("exams").select("id,name,start_date,published,sort").eq("session_id", session.id).order("sort").order("start_date") : { data: [] };
  const admin = can("exams.setup.create");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="exams" title="Exams & results" subtitle={`Session ${session?.name ?? "—"}`} />
      <Flash ok={sp.ok} error={sp.error} />
      {(data ?? []).length ? (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((e) => (
            <li key={e.id}>
              <Link href={`/app/exams/${e.id}`} className="block rounded-[12px] border border-line bg-white p-4 no-underline hover:border-ink">
                <span className="flex items-center justify-between gap-2"><b className="text-[16px] text-ink">{e.name}</b>{e.published ? <Badge value="published" /> : <Badge value="draft" />}</span>
                <span className="text-[13px] text-muted">{e.start_date ? `From ${fmtDate(e.start_date)}` : "No date"}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <Empty>No exams yet.{admin ? " Create the first one below — e.g. Periodic Test 1, Half Yearly, Annual." : ""}</Empty>}
      {admin && (
        <Card title="New exam">
          <form action={createExam} className="flex flex-wrap items-end gap-3">
            <Input label="Name" name="name" placeholder="Half Yearly" required />
            <Input label="Starts on" name="start_date" type="date" />
            <Input label="Order on report card" name="sort" type="number" defaultValue={(data ?? []).length + 1} />
            <Submit>Create exam</Submit>
          </form>
        </Card>
      )}
    </div>
  );
}
