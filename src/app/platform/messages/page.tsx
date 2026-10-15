import Link from "next/link";
import { requirePlatform } from "@/lib/platform";
import { Badge, Empty, Flash, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { CHANNEL_NAME, EVENTS } from "@/lib/messages";

type Row = { id: string; channel: string; event: string; to_addr: string; recipient_name: string | null; subject: string | null; body: string; status: string; attempts: number;
  last_error: string | null; account_source: string | null; created_at: string; sent_at: string | null; total: number };
const BADGE: Record<string, string> = { queued: "pending", sending: "info", sent: "done", failed: "overdue", skipped: "muted", cancelled: "cancelled" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—");

/** CodersDuniya's own messages (invoices, receipts for schools), sent through the platform's account in Settings → Integrations. */
export default async function PlatformMessages({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase } = await requirePlatform("settings");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const status = ["queued", "sent", "failed", "skipped", "cancelled"].includes(sp.status ?? "") ? sp.status! : null;
  const [{ data }, { data: st }] = await Promise.all([
    supabase.rpc("outbox_list", { sid: null, p_status: status, p_limit: size, p_offset: offset }),
    supabase.rpc("outbox_stats", { sid: null }),
  ]);
  const R = (data ?? []) as Row[];
  const total = R[0] ? Number(R[0].total) : 0;
  const S = (st ?? {}) as { queued?: number; sent_30?: number; failed_30?: number; skipped_30?: number };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notifications" title="Platform messages" subtitle="Invoices and payment receipts sent to schools from CodersDuniya's own email, SMS and WhatsApp accounts" actions={<Link href="/platform/settings/integrations" className="btn btn-sm btn-secondary">Integrations</Link>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting" value={S.queued ?? 0} icon="notifications" tone="amber" />
        <Stat label="Sent (30 days)" value={S.sent_30 ?? 0} icon="attendance" tone="green" />
        <Stat label="Failed" value={S.failed_30 ?? 0} icon="notifications" tone={S.failed_30 ? "rose" : "green"} />
        <Stat label="Skipped" value={S.skipped_30 ?? 0} icon="students" tone="violet" />
      </div>
      <nav className="flex flex-wrap gap-1.5">
        {[["", "All"], ["queued", "Waiting"], ["sent", "Sent"], ["failed", "Failed"], ["skipped", "Skipped"]].map(([k, t]) => (
          <Link key={k} href={k ? `/platform/messages?status=${k}` : "/platform/messages"} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${(status ?? "") === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{t}</Link>
        ))}
      </nav>
      {R.length ? (
        <Table head={["When", "School / to", "Message", "Channel", "Status"]} minWidth={860}>
          {R.map((m) => (
            <tr key={m.id}>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{when(m.created_at)}</td>
              <td className={td}><b className="text-ink">{m.recipient_name ?? "—"}</b><div className="text-[12px] text-muted">{m.to_addr}</div></td>
              <td className={`${td} max-w-[380px]`}><div className="text-[12px] font-semibold text-muted">{EVENTS[m.event as keyof typeof EVENTS]?.name ?? m.event}</div>
                {m.subject && <div className="font-semibold text-ink">{m.subject}</div>}<div className="line-clamp-2 text-[13.5px]">{m.body}</div>
                {m.last_error && <div className="mt-1 text-[12px] text-error">{m.last_error}</div>}</td>
              <td className={td}>{CHANNEL_NAME[m.channel as keyof typeof CHANNEL_NAME] ?? m.channel}</td>
              <td className={td}><Badge value={BADGE[m.status] ?? "normal"} text={m.status === "queued" ? "Waiting" : m.status[0].toUpperCase() + m.status.slice(1)} />{m.sent_at && <div className="mt-1 text-[12px] text-muted">{when(m.sent_at)}</div>}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No platform message yet. Create an invoice for a school (Invoices &amp; payments) and it will appear here.</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/platform/messages" params={{ status: status ?? undefined }} />
    </div>
  );
}
