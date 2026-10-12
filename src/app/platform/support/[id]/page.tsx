import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatform } from "@/lib/platform";
import { Badge, Card, Flash, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { replyTicket, updateTicket } from "../../_actions/ops";

export default async function Ticket({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, can } = await requirePlatform("support");
  const { data: t } = await supabase.from("tickets").select("*, schools(name,phone,email,principal_name)").eq("id", id).maybeSingle();
  if (!t) notFound();
  const [{ data: msgs }, { data: team }] = await Promise.all([
    supabase.from("ticket_messages").select("*").eq("ticket_id", id).order("created_at"),
    supabase.from("platform_admins").select("user_id,name,email").eq("active", true),
  ]);
  const s = t.schools as { name: string; phone: string | null; email: string | null; principal_name: string | null } | null;
  const W = can("support", true);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={`#${t.number} ${t.subject}`} back={{ href: "/platform/support", label: "Support desk" }}
        subtitle={<><Link href={`/platform/tenants/${t.school_id}`}>{s?.name}</Link> · {t.created_by_name} · {t.category} · <Badge value={t.priority} /> <Badge value={t.status === "open" ? "new" : t.status === "resolved" ? "paid" : t.status} text={t.status} /></>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          {(msgs ?? []).map((m) => (
            <div key={m.id} className={`rounded-[12px] border p-4 text-[14px] ${m.internal ? "border-[#f1d39a] bg-[#fff8eb]" : m.from_platform ? "border-blue/30 bg-blue-tint" : "border-line bg-white"}`}>
              <p className="m-0 mb-1 text-[12px] text-muted"><b className="text-ink">{m.author_name ?? "—"}</b> · {m.internal ? "internal note" : m.from_platform ? "CodersDuniya" : s?.name} · {new Date(m.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</p>
              <p className="m-0 whitespace-pre-line">{m.body}</p>
            </div>
          ))}
          {W && (
            <Card title="Reply">
              <form action={replyTicket} className="flex flex-col gap-2">
                <input type="hidden" name="ticket_id" value={id} />
                <Textarea label="Message" name="body" rows={5} />
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="internal" /> Internal note (the school won't see it)</label>
                <div><Submit>Send</Submit></div>
              </form>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {W && (
            <Card title="Ticket">
              <form action={updateTicket} className="flex flex-col gap-3">
                <input type="hidden" name="ticket_id" value={id} />
                <Select label="Status" name="status" defaultValue={t.status} options={["open", "pending", "resolved", "closed"]} />
                <Select label="Priority" name="priority" defaultValue={t.priority} options={["low", "normal", "high", "urgent"]} />
                <Select label="Assigned to" name="assigned_to" defaultValue={t.assigned_to} blank="— nobody —" options={(team ?? []).map((m) => [m.user_id, m.name ?? m.email ?? m.user_id] as [string, string])} />
                <div><Submit variant="secondary">Update</Submit></div>
              </form>
            </Card>
          )}
          <Card title="School contact">
            <p className="m-0 text-[14px]">{s?.principal_name}<br />{s?.phone}<br />{s?.email}</p>
            <Link href={`/platform/tenants/${t.school_id}`} className="mt-2 inline-block text-[14px]">Open school page →</Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
