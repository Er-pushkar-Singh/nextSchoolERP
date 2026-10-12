import Link from "next/link";
import { requirePlatform } from "@/lib/platform";
import { Badge, Empty, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { fmtDate, money } from "@/lib/format";
import { STATE_LABEL, type SubState } from "@/lib/billing";
import { loadTenants, relTime } from "@/lib/tenants";

const STATES: SubState[] = ["trial", "ok", "grace", "expired", "pending", "suspended"];
const tone = (s: SubState) => (s === "ok" ? "active" : s === "expired" ? "overdue" : s === "grace" ? "due" : s === "trial" ? "trial" : s);

export default async function Tenants({ searchParams }: { searchParams: Promise<{ q?: string; state?: string; plan?: string; board?: string; archived?: string; sort?: string; ok?: string; error?: string }> }) {
  const { supabase, can } = await requirePlatform("tenants");
  const sp = await searchParams;
  const all = await loadTenants(supabase);
  const q = (sp.q ?? "").trim().toLowerCase();
  let rows = all.filter((t) => (sp.archived ? t.archived_at : !t.archived_at));
  if (q) rows = rows.filter((t) => [t.name, t.code, t.city, t.subdomain, t.custom_domain, t.group].some((v) => v?.toLowerCase().includes(q)));
  if (sp.state && STATES.includes(sp.state as SubState)) rows = rows.filter((t) => t.state === sp.state);
  if (sp.plan) rows = rows.filter((t) => t.plan === sp.plan);
  if (sp.board) rows = rows.filter((t) => t.board === sp.board);
  const sort = sp.sort ?? "new";
  rows = [...rows].sort((a, b) =>
    sort === "students" ? (b.stats?.students ?? 0) - (a.stats?.students ?? 0)
    : sort === "name" ? a.name.localeCompare(b.name)
    : sort === "ending" ? (a.sub?.current_period_end ?? "9").localeCompare(b.sub?.current_period_end ?? "9")
    : sort === "active" ? (b.stats?.last_activity ?? "").localeCompare(a.stats?.last_activity ?? "")
    : b.created_at.localeCompare(a.created_at));
  const counts = Object.fromEntries(STATES.map((s) => [s, all.filter((t) => !t.archived_at && t.state === s).length]));
  const plans = [...new Set(all.map((t) => t.plan))];
  const qs = (patch: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ q: sp.q, state: sp.state, plan: sp.plan, board: sp.board, sort: sp.sort, archived: sp.archived, ...patch }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="tenants" title="Schools (tenants)" subtitle={`${all.filter((t) => !t.archived_at).length} schools · ${all.filter((t) => t.archived_at).length} archived`}
        actions={can("tenants", true) && <Link href="/platform/tenants/new" className="btn btn-sm btn-primary">New school</Link>} />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="flex flex-wrap gap-2 text-[14px]">
        <Link href={qs({ state: undefined, archived: undefined })} className={`chip ${!sp.state && !sp.archived ? "!border-ink" : ""}`}>All</Link>
        {STATES.map((s) => <Link key={s} href={qs({ state: s, archived: undefined })} className={`chip ${sp.state === s ? "!border-ink" : ""}`}>{STATE_LABEL[s]} ({counts[s]})</Link>)}
        <Link href={qs({ archived: "1", state: undefined })} className={`chip ${sp.archived ? "!border-ink" : ""}`}>Archived</Link>
      </nav>
      <form className="flex flex-wrap items-end gap-2">
        {sp.state && <input type="hidden" name="state" value={sp.state} />}
        <input name="q" defaultValue={sp.q} placeholder="Name, code, city, domain, group…" className="input !min-h-10 max-w-xs !py-2" aria-label="Search" />
        <select name="plan" defaultValue={sp.plan ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Plan"><option value="">All plans</option>{plans.map((p) => <option key={p}>{p}</option>)}</select>
        <select name="board" defaultValue={sp.board ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Board"><option value="">All boards</option>{["CBSE", "ICSE", "UP Board", "State Board", "Other"].map((b) => <option key={b}>{b}</option>)}</select>
        <select name="sort" defaultValue={sort} className="input !min-h-10 !w-auto !py-2" aria-label="Sort"><option value="new">Newest</option><option value="name">Name</option><option value="students">Most students</option><option value="ending">Period ending soonest</option><option value="active">Recently active</option></select>
        <button className="btn btn-sm btn-secondary cursor-pointer">Apply</button>
      </form>
      {rows.length ? (
        <Table head={["School", "Plan", "Status", "Students", "Staff", "Collected this month", "Last active", "Period ends"]} minWidth={1000}>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className={td}>
                <span className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- school logos are arbitrary URLs */}
                  {t.logo_url ? <img src={t.logo_url} alt="" className="h-7 w-7 rounded object-contain" /> : <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded text-[11px] font-bold text-white" style={{ background: t.brand_color ?? "#0b1b33" }}>{t.name.slice(0, 2).toUpperCase()}</span>}
                  <span><Link href={`/platform/tenants/${t.id}`} className="font-semibold">{t.name}</Link>
                    <span className="block text-[12px] text-muted">{t.code} · {t.city ?? "—"} · {t.board}{t.group ? ` · ${t.group}` : ""}{t.source === "self_signup" ? " · self sign-up" : ""}</span></span>
                </span>
              </td>
              <td className={td}>{t.sub?.plans?.name ?? t.plan}<div className="text-[12px] text-muted">{t.sub?.billing_cycle}</div></td>
              <td className={td}><Badge value={tone(t.state)} text={STATE_LABEL[t.state]} />{(t.stats?.open_tickets ?? 0) > 0 && <div className="mt-1 text-[12px] text-muted">{t.stats!.open_tickets} open ticket(s)</div>}</td>
              <td className={td}>{t.stats?.students ?? 0} <span className="text-[12px] text-muted">/ {t.student_limit}</span></td>
              <td className={td}>{t.stats?.staff ?? 0}</td>
              <td className={td}>{money(t.stats?.collected_month ?? 0)}<div className="text-[12px] text-muted">{t.stats?.receipts_month ?? 0} receipts</div></td>
              <td className={td}>{relTime(t.stats?.last_activity ?? null)}</td>
              <td className={td}>{fmtDate(t.sub?.current_period_end)}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No schools match.</Empty>}
    </div>
  );
}
