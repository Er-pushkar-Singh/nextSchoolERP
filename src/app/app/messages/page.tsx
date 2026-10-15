import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { BarChart } from "@/components/ui/charts";
import { CHANNELS, CHANNEL_NAME, EVENTS } from "@/lib/messages";
import { cancelMessage, retryMessage, sendQueuedNow, sendTestMessage } from "../_actions/messages";

type Row = { id: string; channel: string; event: string; to_addr: string; recipient_name: string | null; subject: string | null; body: string; status: string; attempts: number;
  last_error: string | null; account_source: string | null; send_after: string; created_at: string; sent_at: string | null; total: number };
type Stats = { queued: number; sent_30: number; failed_30: number; skipped_30: number; by_channel: Record<string, number>; by_event: { event: string; n: number }[] };
const STATUS: [string, string][] = [["queued", "Waiting"], ["sent", "Sent"], ["failed", "Failed"], ["skipped", "Skipped"], ["cancelled", "Cancelled"]];
const BADGE: Record<string, string> = { queued: "pending", sending: "info", sent: "done", failed: "overdue", skipped: "muted", cancelled: "cancelled" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—");

export default async function Messages({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("comms.outbox.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const status = STATUS.some(([k]) => k === sp.status) ? sp.status! : null;
  const channel = (CHANNELS as string[]).includes(sp.channel ?? "") ? sp.channel! : null;
  const event = sp.event && sp.event in EVENTS ? sp.event : null;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const [{ data }, { data: st }, { data: eff }] = await Promise.all([
    supabase.rpc("outbox_list", { sid: school.id, p_status: status, p_channel: channel, p_event: event, p_q: q || null, p_limit: size, p_offset: offset }),
    supabase.rpc("outbox_stats", { sid: school.id }),
    supabase.rpc("effective_integrations", { sid: school.id }),
  ]);
  const R = (data ?? []) as Row[];
  const total = R[0] ? Number(R[0].total) : 0;
  const S = (st ?? {}) as Partial<Stats>;
  const accounts = new Map(((eff ?? []) as { provider: string; source: string; enabled: boolean; status: string }[]).map((e) => [e.provider, e]));
  const params = { status: status ?? undefined, channel: channel ?? undefined, event: event ?? undefined, q: q || undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `/app/messages${qs ? `?${qs}` : ""}`;
  const edit = can("comms.outbox.edit");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notifications" title="Messages" subtitle="Everything the school sends by WhatsApp, SMS and email — from its own accounts"
        actions={<>
          {can("comms.broadcast.create") && <Link href="/app/messages/compose" className="btn btn-sm btn-primary">+ Send a message</Link>}
          {can("comms.templates.view") && <Link href="/app/messages/templates" className="btn btn-sm btn-secondary">Templates</Link>}
        {can("comms.broadcast.create") && (
            <Modal label="Send a test" variant="secondary" title="Send a test message" size="sm">
              <p className="mt-0 text-[13px] text-muted">Sends one real message through your own account, so you know the connection works end to end.</p>
              <form action={sendTestMessage} className="flex flex-col gap-3">
                <Select label="Channel" name="channel" defaultValue="email" options={CHANNELS.map((c) => [c, CHANNEL_NAME[c]] as [string, string])} />
                <Input label="Email address or mobile number" name="to" required />
                <Submit>Send test</Submit>
              </form>
            </Modal>
          )}
          <form action={sendQueuedNow}><input type="hidden" name="back" value={back} /><button className="btn btn-sm btn-secondary cursor-pointer">Send now</button></form>
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-3 sm:grid-cols-3">
        {CHANNELS.map((c) => {
          const a = accounts.get(c);
          const on = a?.enabled;
          return (
            <Link key={c} href="/app/settings/integrations" className="rounded-[14px] border border-line bg-white p-3.5 no-underline shadow-[var(--shadow-card)] hover:border-blue">
              <span className="flex items-center justify-between"><b className="text-ink">{CHANNEL_NAME[c]}</b>
                <Badge value={on ? (a?.status === "failed" ? "overdue" : "active") : "muted"} text={on ? (a?.source === "platform" ? "Shared account" : a?.status === "ok" ? "Connected" : a?.status === "failed" ? "Test failed" : "Connected, untested") : "Not connected"} /></span>
              <span className="mt-1 block text-[12.5px] text-muted">{S.by_channel?.[c] ?? 0} sent in 30 days</span>
            </Link>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting" value={S.queued ?? 0} icon="notifications" tone="amber" href="/app/messages?status=queued" />
        <Stat label="Sent (30 days)" value={S.sent_30 ?? 0} icon="attendance" tone="green" href="/app/messages?status=sent" />
        <Stat label="Failed" value={S.failed_30 ?? 0} icon="notifications" tone={S.failed_30 ? "rose" : "green"} href="/app/messages?status=failed" />
        <Stat label="Skipped" value={S.skipped_30 ?? 0} hint="no contact, opted out or no account" icon="students" tone="violet" href="/app/messages?status=skipped" />
      </div>
      {(S.by_event ?? []).length > 0 && (
        <Card title="What was sent (30 days)">
          <BarChart data={(S.by_event ?? []).slice(0, 8).map((e) => ({ label: EVENTS[e.event as keyof typeof EVENTS]?.name.split(" ")[0] ?? e.event, value: Number(e.n) }))} height={150} />
        </Card>
      )}

      <nav className="flex flex-wrap gap-1.5" aria-label="Status">
        <Link href="/app/messages" className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${!status ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>All</Link>
        {STATUS.map(([k, t]) => <Link key={k} href={`/app/messages?status=${k}`} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${status === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{t}</Link>)}
      </nav>
      <form className="flex flex-wrap items-end gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Name, number, email, words" className="input !min-h-10 w-60 !py-2 text-[15px] font-normal" /></label>
        <Select label="Channel" name="channel" blank="Any" defaultValue={channel} options={CHANNELS.map((c) => [c, CHANNEL_NAME[c]] as [string, string])} />
        <Select label="Event" name="event" blank="Any" defaultValue={event} options={Object.entries(EVENTS).filter(([, d]) => !d.platform).map(([k, d]) => [k, d.name] as [string, string])} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
      </form>

      {R.length ? (
        <Table head={["When", "To", "Message", "Channel", "Status", ""]} minWidth={940}>
          {R.map((m) => (
            <tr key={m.id}>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{when(m.created_at)}{m.status === "queued" && new Date(m.send_after) > new Date(m.created_at) && <div className="text-muted">due {when(m.send_after)}</div>}</td>
              <td className={td}><b className="text-ink">{m.recipient_name ?? "—"}</b><div className="text-[12px] text-muted">{m.to_addr}</div></td>
              <td className={`${td} max-w-[360px]`}>
                <div className="text-[12px] font-semibold text-muted">{EVENTS[m.event as keyof typeof EVENTS]?.name ?? m.event}</div>
                {m.subject && <div className="font-semibold text-ink">{m.subject}</div>}
                <div className="line-clamp-2 text-[13.5px]">{m.body}</div>
                {m.last_error && <div className="mt-1 text-[12px] text-error">{m.last_error}</div>}
              </td>
              <td className={td}>{CHANNEL_NAME[m.channel as keyof typeof CHANNEL_NAME] ?? m.channel}{m.account_source && <div className="text-[11.5px] text-muted">{m.account_source === "platform" ? "shared account" : "own account"}</div>}</td>
              <td className={td}><Badge value={BADGE[m.status] ?? "normal"} text={m.status === "queued" ? "Waiting" : m.status[0].toUpperCase() + m.status.slice(1)} />
                {m.sent_at && <div className="mt-1 text-[12px] text-muted">{when(m.sent_at)}</div>}{m.attempts > 1 && m.status !== "sent" && <div className="text-[12px] text-muted">attempt {m.attempts}</div>}</td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>
                {edit && ["failed", "skipped", "cancelled"].includes(m.status) && (
                  <form action={retryMessage}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={m.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Retry</button></form>
                )}
                {edit && m.status === "queued" && (
                  <form action={cancelMessage}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={m.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Cancel</button></form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{status || channel || event || q ? "No message matches these filters." : "Nothing has been sent yet. Connect an account in Settings → Integrations and use “Send a test”."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/messages" params={params} />
    </div>
  );
}
