import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { fmtDate } from "@/lib/format";
import { createTicket } from "../_actions/support";

export default async function Support({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("support.tickets.view");
  const sp = await searchParams;
  const { data } = await supabase.from("tickets").select("id,number,subject,category,priority,status,created_by_name,updated_at").eq("school_id", school.id).order("updated_at", { ascending: false });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="support" title="Help & support" subtitle="Ask CodersDuniya for help, report a problem or request a feature." />
      <Flash ok={sp.ok} error={sp.error} />
      {can("support.tickets.create") && (
        <Card title="New request">
          <form action={createTicket} className="grid gap-3 sm:grid-cols-4">
            <Input label="Subject" name="subject" required className="sm:col-span-2" placeholder="Receipt number skipped after 00045" />
            <Select label="Type" name="category" options={[["question", "Question"], ["bug", "Something is broken"], ["billing", "Plan / billing"], ["feature", "Feature request"], ["data", "Data correction"], ["other", "Other"]]} />
            <Select label="Priority" name="priority" defaultValue="normal" options={["low", "normal", "high", "urgent"]} />
            <Textarea label="Details" name="body" rows={4} className="sm:col-span-4" placeholder="What happened, on which page, for which student / receipt…" />
            <div><Submit>Send</Submit></div>
          </form>
        </Card>
      )}
      {(data ?? []).length ? (
        <Table head={["#", "Subject", "From", "Status", "Updated"]} minWidth={640}>
          {(data ?? []).map((t) => (
            <tr key={t.id}>
              <td className={td}>{t.number}</td>
              <td className={td}><Link href={`/app/support/${t.id}`} className="font-semibold">{t.subject}</Link><div className="text-[12px] text-muted">{t.category} · {t.priority}</div></td>
              <td className={td}>{t.created_by_name}</td>
              <td className={td}><Badge value={t.status === "pending" ? "new" : t.status === "resolved" ? "paid" : t.status === "open" ? "contacted" : t.status} text={t.status === "pending" ? "Reply from support" : t.status === "open" ? "Waiting for support" : t.status} /></td>
              <td className={td}>{fmtDate(t.updated_at)}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No requests yet.</Empty>}
    </div>
  );
}
