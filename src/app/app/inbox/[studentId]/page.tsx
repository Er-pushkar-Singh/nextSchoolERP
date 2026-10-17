import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Flash, PageHeader, Submit } from "@/components/ui/ui";
import { Pagination, pager } from "@/components/ui/Pagination";
import { fullName } from "@/lib/format";
import { replyToFamily } from "../../_actions/family";

const stamp = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function Thread({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { studentId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(studentId)) notFound();
  const { supabase, school, can } = await requirePerm("comms.messages.view");
  const { data: s } = await supabase.from("students").select("id,first_name,middle_name,last_name,admission_no,classes!class_id(name),sections(name)").eq("id", studentId).eq("school_id", school.id).maybeSingle();
  if (!s) notFound();
  const pg = pager(sp, "page", "size", 30, [30, 60, 100]);
  const { data, count } = await supabase.from("family_messages").select("id,body,from_family,sender_name,created_at", { count: "exact" }).eq("student_id", studentId).order("created_at", { ascending: false }).range(...pg.range);
  await supabase.rpc("read_family_messages", { stu: studentId });
  const msgs = [...(data ?? [])].reverse();
  const cls = s.classes as unknown as { name: string } | null, sec = s.sections as unknown as { name: string } | null;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader icon="notices" title={fullName(s)} subtitle={`Class ${cls?.name ?? "—"}${sec ? `-${sec.name}` : ""} · Adm. ${s.admission_no} · conversation with the family`} back={{ href: "/app/inbox", label: "Parent messages" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <Pagination {...pg.props(count ?? 0, `/app/inbox/${studentId}`)} />
      <div className="flex flex-col gap-2">
        {msgs.length ? msgs.map((m) => (
          <div key={m.id} className={`max-w-[80%] rounded-[14px] px-3 py-2 text-[14px] ${m.from_family ? "self-start border border-line bg-white" : "self-end bg-blue-tint"}`}>
            <p className="m-0 whitespace-pre-line">{m.body}</p>
            <p className="m-0 mt-1 text-[11px] text-muted">{m.from_family ? "Family" : m.sender_name ?? "School"} · {stamp(m.created_at)}</p>
          </div>
        )) : <p className="m-0 text-[14px] text-muted">No messages yet.</p>}
      </div>
      {can("comms.messages.create") && (
        <form id="end" action={replyToFamily} className="flex flex-col gap-2 border-t border-line pt-3">
          <input type="hidden" name="student_id" value={studentId} />
          <textarea name="body" required rows={3} maxLength={2000} aria-label="Reply" placeholder="Write a reply…" className="input w-full" />
          <div><Submit>Send reply</Submit></div>
        </form>
      )}
    </div>
  );
}
