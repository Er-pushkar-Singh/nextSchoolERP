import { Flash, Submit } from "@/components/ui/ui";
import { Pagination, pager } from "@/components/ui/Pagination";
import { requireChild } from "@/lib/family";
import { familySendMessage } from "../../actions";

export const metadata = { title: "Messages" };

const stamp = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function FamilyMessages({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { studentId } = await params;
  const sp = await searchParams;
  const { supabase, child } = await requireChild(studentId);
  const pg = pager(sp, "page", "size", 30, [30, 60, 100]);
  const { data, count } = await supabase.from("family_messages").select("id,body,from_family,sender_name,created_at,read_at", { count: "exact" })
    .eq("student_id", studentId).order("created_at", { ascending: false }).range(...pg.range);
  await supabase.rpc("read_family_messages", { stu: studentId });
  const msgs = [...(data ?? [])].reverse();
  return (
    <div className="flex flex-col gap-4">
      <Flash ok={sp.ok} error={sp.error} />
      <p className="m-0 text-[14px] text-muted">Write to {child.first_name}&apos;s class teacher and the school office. Replies appear here.</p>
      <Pagination {...pg.props(count ?? 0, `/family/${studentId}/messages`)} />
      <div className="flex flex-col gap-2">
        {msgs.length ? msgs.map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-[14px] px-3 py-2 text-[14px] ${m.from_family ? "self-end bg-blue-tint" : "self-start border border-line bg-white"}`}>
            <p className="m-0 whitespace-pre-line">{m.body}</p>
            <p className="m-0 mt-1 text-[11px] text-muted">{m.from_family ? "You" : m.sender_name ?? "School"} · {stamp(m.created_at)}</p>
          </div>
        )) : <p className="m-0 rounded-[12px] border border-line bg-white p-4 text-[14px] text-muted">No messages yet. Say hello to the class teacher.</p>}
      </div>
      <form id="end" action={familySendMessage} className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-surface py-3">
        <input type="hidden" name="student_id" value={studentId} />
        <textarea name="body" required rows={3} maxLength={2000} aria-label="Message" placeholder="Write a message…" className="input w-full" />
        <div><Submit>Send</Submit></div>
      </form>
    </div>
  );
}
