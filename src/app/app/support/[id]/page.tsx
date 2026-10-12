import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader, Submit, Textarea } from "@/components/ui/ui";
import { replyTicketSchool } from "../../_actions/support";

export default async function SchoolTicket({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("support.tickets.view");
  const { data: t } = await supabase.from("tickets").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!t) notFound();
  const { data: msgs } = await supabase.from("ticket_messages").select("*").eq("ticket_id", id).order("created_at");
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={`#${t.number} ${t.subject}`} subtitle={`${t.category} · ${t.priority} · ${t.status}`} back={{ href: "/app/support", label: "Help & support" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {(msgs ?? []).map((m) => (
        <div key={m.id} className={`rounded-[12px] border p-4 text-[14px] ${m.from_platform ? "border-blue/30 bg-blue-tint" : "border-line bg-white"}`}>
          <p className="m-0 mb-1 text-[12px] text-muted"><b className="text-ink">{m.from_platform ? `${m.author_name ?? "Support"} · CodersDuniya` : m.author_name}</b> · {new Date(m.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</p>
          <p className="m-0 whitespace-pre-line">{m.body}</p>
        </div>
      ))}
      {can("support.tickets.create") && t.status !== "closed" && (
        <Card title="Reply">
          <form action={replyTicketSchool} className="flex flex-col gap-2"><input type="hidden" name="ticket_id" value={id} /><Textarea label="Message" name="body" rows={4} /><div><Submit>Send</Submit></div></form>
        </Card>
      )}
    </div>
  );
}
