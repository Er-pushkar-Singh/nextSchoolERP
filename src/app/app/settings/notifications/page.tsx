import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { NOTIFY_EVENTS, notifyOn, type Channel } from "@/lib/prefs";
import { saveNotifications } from "../../_actions/settings";

const CH: { code: Channel; name: string }[] = [{ code: "sms", name: "SMS" }, { code: "email", name: "Email" }, { code: "whatsapp", name: "WhatsApp" }];

export default async function Notifications({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("settings.school.view");
  const sp = await searchParams;
  const canEdit = can("settings.school.edit");
  const [{ data: eff }, { data: log }] = await Promise.all([
    supabase.rpc("effective_integrations", { sid: school.id }),
    supabase.from("message_log").select("id,channel,event,recipient,status,error,created_at").eq("school_id", school.id).order("created_at", { ascending: false }).limit(15),
  ]);
  const ready = new Map(((eff ?? []) as { provider: string; enabled: boolean; source: string }[]).map((e) => [e.provider, e]));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notifications" title="Notifications" subtitle="Choose which events reach parents and staff, and on which channel." back={{ href: "/app/settings", label: "Settings centre" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        {CH.map((c) => {
          const e = ready.get(c.code);
          return (
            <div key={c.code} className="flex items-center justify-between gap-2 rounded-[14px] border border-line bg-white px-4 py-3 shadow-[var(--shadow-card)]">
              <span className="text-[15px] font-bold text-ink">{c.name}</span>
              {e?.enabled ? <Badge value="active" text={e.source === "platform" ? "Shared account" : "Connected"} /> : <Link href={`/app/settings/integrations#${c.code}`} className="text-[13px] font-semibold">Set up →</Link>}
            </div>
          );
        })}
      </div>
      <Card title="Events" icon="notifications" description="WhatsApp links from staff phones keep working even without an API account.">
        <form action={saveNotifications} className="flex flex-col gap-4">
          <Table head={["Event", "Who gets it", ...CH.map((c) => c.name)]} minWidth={640}>
            {NOTIFY_EVENTS.map((ev) => (
              <tr key={ev.code}>
                <td className={`${td} font-semibold text-ink`}>{ev.name}</td>
                <td className={`${td} text-[13px] text-muted`}>{ev.who}</td>
                {CH.map((c) => (
                  <td key={c.code} className={td}>
                    <input type="checkbox" name={`${ev.code}.${c.code}`} aria-label={`${ev.name} by ${c.name}`} defaultChecked={notifyOn(school.prefs, ev.code, c.code)} disabled={!canEdit} className="h-4 w-4 accent-[#2563eb]" />
                  </td>
                ))}
              </tr>
            ))}
          </Table>
          {canEdit && <div><Submit>Save notification settings</Submit></div>}
        </form>
      </Card>
      <Card title="Recent messages" icon="tickets">
        {!log?.length ? <Empty>No messages sent yet. Test sends from Integrations show up here.</Empty> : (
          <Table head={["When", "Channel", "Event", "To", "Status"]} minWidth={560}>
            {log.map((m) => (
              <tr key={m.id}>
                <td className={td}>{new Date(m.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className={td}>{m.channel}</td>
                <td className={td}>{m.event}</td>
                <td className={td}>{m.recipient}</td>
                <td className={td}><Badge value={m.status === "sent" ? "done" : m.status === "failed" ? "overdue" : "pending"} text={m.status} />{m.error && <span className="block text-[12px] text-muted">{m.error}</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
