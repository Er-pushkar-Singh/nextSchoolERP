import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { nowMs, cleanSearch, fmtDate } from "@/lib/format";
import { createOnlineExam } from "../../_actions/online-exams";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
type Row = { id: string; title: string; class_id: string; subject_id: string; status: string; duration_min: number; starts_at: string | null; ends_at: string | null; total_marks: number; pool_mode: string; random_count: number | null };
const ist = (t: string) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function OnlineExams({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("exams.setup.view", "exams.marks.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const cls = uid(sp.class_id), sub = uid(sp.subject_id);
  const status = ["draft", "scheduled", "closed", "declared"].includes(sp.status ?? "") ? sp.status! : null;
  const q = cleanSearch(sp.q ?? "").trim();
  let query = supabase.from("online_exams").select("id,title,class_id,subject_id,status,duration_min,starts_at,ends_at,total_marks,pool_mode,random_count", { count: "exact" })
    .eq("school_id", school.id).order("starts_at", { ascending: false, nullsFirst: true }).order("created_at", { ascending: false }).range(offset, offset + size - 1);
  if (cls) query = query.eq("class_id", cls);
  if (sub) query = query.eq("subject_id", sub);
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("title", `%${q.replace(/[%_\\,()]/g, " ")}%`);
  const [{ data, count }, { data: classes }, { data: subjects }, { data: offline }, { data: stat }] = await Promise.all([
    query,
    supabase.from("classes").select("id,name,sort").eq("school_id", school.id).order("sort"),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("sort").order("name"),
    session(supabase, school.id),
    supabase.from("online_exams").select("status").eq("school_id", school.id),
  ]);
  const rows = (data ?? []) as Row[];
  const cn = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const sn = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const S = (stat ?? []) as { status: string }[];
  const now = nowMs();
  const live = (r: Row) => r.status === "scheduled" && r.starts_at && r.ends_at && new Date(r.starts_at).getTime() <= now && new Date(r.ends_at).getTime() >= now;
  const params = { class_id: cls ?? undefined, subject_id: sub ?? undefined, status: status ?? undefined, q: q || undefined };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="exams" title="Online exams" subtitle="Computer-based tests: timed, shuffled, secured, auto-graded" back={{ href: "/app/exams", label: "Exams" }}
        actions={<>
          {(can("exams.marks.create") || can("exams.setup.create")) && (
            <Modal label="+ New online exam" title="New online exam" size="sm">
              <form action={createOnlineExam} className="grid gap-3">
                <Input label="Title" name="title" required placeholder="Maths — Unit test 2" />
                <Select label="Class" name="class_id" options={(classes ?? []).map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
                <Select label="Subject" name="subject_id" options={(subjects ?? []).map((s) => [s.id, s.name] as [string, string])} />
                <Input label="Duration (minutes)" name="duration_min" type="number" min={1} max={360} defaultValue={30} />
                <Select label="Paper" name="pool_mode" defaultValue="fixed" options={[["fixed", "Fixed — I choose the questions"], ["random", "Random — each student gets a different draw"]]} />
                <Select label="Feeds marks of offline exam (optional)" name="exam_id" blank="— none —" options={(offline ?? []).map((e: { id: string; name: string }) => [e.id, e.name] as [string, string])} />
                <Submit>Create</Submit>
              </form>
            </Modal>
          )}
          <Link href="/app/exams/questions" className="btn btn-sm btn-secondary">Question bank</Link>
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Draft" value={S.filter((s) => s.status === "draft").length} icon="exams" tone="blue" />
        <Stat label="Scheduled" value={S.filter((s) => s.status === "scheduled").length} icon="exams" tone="amber" />
        <Stat label="Closed" value={S.filter((s) => s.status === "closed").length} icon="exams" tone="violet" />
        <Stat label="Result declared" value={S.filter((s) => s.status === "declared").length} icon="exams" tone="green" />
      </div>

      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Title" className="lg:col-span-2" />
        <Select label="Class" name="class_id" blank="All" defaultValue={cls} options={(classes ?? []).map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
        <Select label="Subject" name="subject_id" blank="All" defaultValue={sub} options={(subjects ?? []).map((s) => [s.id, s.name] as [string, string])} />
        <Select label="Status" name="status" blank="All" defaultValue={status} options={[["draft", "Draft"], ["scheduled", "Scheduled"], ["closed", "Closed"], ["declared", "Result declared"]]} />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>

      {rows.length ? (
        <Table head={["Exam", "Class · subject", "When", "Duration", "Paper", "Status", ""]} minWidth={900}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}><Link href={`/app/exams/online/${r.id}`} className="font-semibold">{r.title}</Link></td>
              <td className={td}>Class {cn.get(r.class_id)} · {sn.get(r.subject_id)}</td>
              <td className={`${td} text-[13px]`}>{r.starts_at ? <>{ist(r.starts_at)}<div className="text-muted">to {r.ends_at ? ist(r.ends_at) : "—"}</div></> : <span className="text-muted">Not scheduled</span>}</td>
              <td className={td}>{r.duration_min} min</td>
              <td className={`${td} text-[13px]`}>{r.pool_mode === "random" ? `${r.random_count ?? "?"} random` : "Fixed"}{Number(r.total_marks) ? ` · ${Number(r.total_marks)} marks` : ""}</td>
              <td className={td}>{live(r) ? <Badge value="active" text="Live now" /> : <Badge value={r.status === "declared" ? "paid" : r.status === "scheduled" ? "due" : r.status === "closed" ? "info" : "draft"} text={r.status === "declared" ? "Result declared" : r.status} />}</td>
              <td className={`${td} text-[13px]`}><Link href={`/app/exams/online/${r.id}`}>Manage</Link></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || cls || sub || status ? "No online exam matches these filters." : "No online exams yet. Add questions to the bank, then create an exam."}</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/exams/online" params={params} />
      <p className="m-0 text-[12px] text-muted">Dates shown in India time. {fmtDate(new Date().toISOString().slice(0, 10))}</p>
    </div>
  );
}

async function session(supabase: Awaited<ReturnType<typeof requirePerm>>["supabase"], schoolId: string) {
  const { data } = await supabase.from("exams").select("id,name").eq("school_id", schoolId).order("sort");
  return { data: (data ?? []) as { id: string; name: string }[] };
}
