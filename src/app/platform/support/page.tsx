import Link from "next/link";
import { requirePlatform } from "@/lib/platform";
import { Badge, Empty, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { fmtDate } from "@/lib/format";
import { relTime } from "@/lib/tenants";

export default async function SupportDesk({ searchParams }: { searchParams: Promise<{ status?: string; priority?: string; mine?: string; q?: string; ok?: string }> }) {
  const { supabase, user } = await requirePlatform("support");
  const sp = await searchParams;
  const status = sp.status ?? "active";
  let q = supabase.from("tickets").select("id,number,subject,category,priority,status,created_by_name,created_at,updated_at,assigned_to,school_id,schools(name)");
  q = status === "active" ? q.in("status", ["open", "pending"]) : status === "all" ? q : q.eq("status", status);
  if (sp.priority) q = q.eq("priority", sp.priority);
  if (sp.mine) q = q.eq("assigned_to", user.id);
  const { data } = await q.order("updated_at", { ascending: false }).limit(500);
  let rows = (data ?? []) as unknown as { id: string; number: number; subject: string; category: string; priority: string; status: string; created_by_name: string | null; created_at: string; updated_at: string; assigned_to: string | null; school_id: string; schools: { name: string } | null }[];
  const term = (sp.q ?? "").toLowerCase().trim();
  if (term) rows = rows.filter((r) => `${r.number} ${r.subject} ${r.schools?.name}`.toLowerCase().includes(term));
  const { data: team } = await supabase.from("platform_admins").select("user_id,name,email");
  const who = (id: string | null) => (team ?? []).find((t) => t.user_id === id)?.name ?? (team ?? []).find((t) => t.user_id === id)?.email ?? "—";
  const pr: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  rows.sort((a, b) => (a.status === b.status ? pr[a.priority] - pr[b.priority] : a.status === "open" ? -1 : 1));
  const link = (patch: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ status, priority: sp.priority, mine: sp.mine, ...patch }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="support" title="Support desk" subtitle="Tickets raised from schools' Help & support page. Replies show in the school app." />
      <Flash ok={sp.ok} />
      <nav className="flex flex-wrap gap-2 text-[14px]">
        {[["active", "Open & waiting"], ["open", "Open"], ["pending", "Waiting on school"], ["resolved", "Resolved"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={link({ status: k })} className={`chip ${status === k ? "!border-ink" : ""}`}>{l}</Link>)}
        <Link href={link({ mine: sp.mine ? undefined : "1" })} className={`chip ${sp.mine ? "!border-ink" : ""}`}>Assigned to me</Link>
      </nav>
      <form className="flex gap-2">{status && <input type="hidden" name="status" value={status} />}<input name="q" defaultValue={sp.q} placeholder="Search tickets" className="input !min-h-10 max-w-xs !py-2" aria-label="Search" /><button className="btn btn-sm btn-secondary cursor-pointer">Search</button></form>
      {rows.length ? (
        <Table head={["#", "Subject", "School", "Priority", "Status", "Assigned", "Updated"]} minWidth={900}>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className={td}>{t.number}</td>
              <td className={td}><Link href={`/platform/support/${t.id}`} className="font-semibold">{t.subject}</Link><div className="text-[12px] text-muted">{t.category} · {t.created_by_name} · {fmtDate(t.created_at)}</div></td>
              <td className={td}><Link href={`/platform/tenants/${t.school_id}`}>{t.schools?.name}</Link></td>
              <td className={td}><Badge value={t.priority} /></td>
              <td className={td}><Badge value={t.status === "open" ? "new" : t.status === "resolved" ? "paid" : t.status} text={t.status} /></td>
              <td className={td}>{who(t.assigned_to)}</td>
              <td className={td}>{relTime(t.updated_at)}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No tickets here.</Empty>}
    </div>
  );
}
