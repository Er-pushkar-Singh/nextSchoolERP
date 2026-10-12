import Link from "next/link";
import { requirePlatform } from "@/lib/platform";
import { Badge, Card, Flash, PageHeader, Stat } from "@/components/ui/ui";
import { BarChart } from "@/components/platform/BarChart";
import { fmtDate, money, todayIST, addDays } from "@/lib/format";
import type { Plan } from "@/lib/billing";

type Dash = {
  schools: number; states: Record<string, number>; students: number; trials_ending: number; renewals_due: number;
  overdue_amount: number; due_amount: number; open_tickets: number; urgent_tickets: number; pending_approval: number;
  signups: { week: string; n: number }[]; revenue: { month: string; amount: number }[];
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; denied?: string }> }) {
  const { supabase, can } = await requirePlatform("tenants");
  const sp = await searchParams;
  const today = todayIST();
  const [{ data: d }, { data: subs }, { data: counts }, { data: trials }, { data: overdue }, { data: tickets }, { data: pending }, { data: audit }, { data: names }] = await Promise.all([
    supabase.rpc("platform_dashboard"),
    supabase.from("school_subscriptions").select("school_id,billing_cycle,status,current_period_end,plans(*),schools(status,archived_at)"),
    supabase.rpc("platform_counts"),
    supabase.from("school_subscriptions").select("school_id,current_period_end,schools(name)").eq("status", "trialing").gte("current_period_end", today).lte("current_period_end", addDays(today, 7)).order("current_period_end"),
    supabase.from("subscription_invoices").select("id,number,total,due_date,school_id,schools(name)").eq("status", "due").lt("due_date", today).order("due_date").limit(8),
    supabase.from("tickets").select("id,number,subject,priority,status,updated_at,schools(name)").in("status", ["open", "pending"]).order("updated_at", { ascending: false }).limit(8),
    supabase.from("schools").select("id,name,city,created_at").eq("status", "pending").is("archived_at", null).order("created_at"),
    supabase.from("audit_log").select("id,at,action,entity,actor_email,actor_kind,school_id").order("at", { ascending: false }).limit(8),
    supabase.from("schools").select("id,name"),
  ]);
  const D = d as Dash;
  const nameOf = new Map((names ?? []).map((x) => [x.id, x.name]));
  const cmap = new Map(((counts ?? []) as { school_id: string; students: number }[]).map((c) => [c.school_id, Number(c.students)]));
  type Sub = { school_id: string; billing_cycle: string; status: string; current_period_end: string; plans: Plan | null; schools: { status: string; archived_at: string | null } | null };
  const live = ((subs ?? []) as unknown as Sub[]).filter((s) => s.schools?.status === "active" && !s.schools.archived_at && s.status !== "trialing" && s.plans && s.plans.trial_days === 0 && s.current_period_end >= today);
  const mrr = live.reduce((t, s) => {
    const p = s.plans!; const billed = Math.max(cmap.get(s.school_id) ?? 0, p.min_students);
    const per = s.billing_cycle === "yearly" ? Number(p.price_yearly) / 12 : Number(p.price_monthly);
    return t + (p.price_type === "per_student" ? per * billed : per);
  }, 0);
  const st = D.states ?? {};
  const k = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${n}`);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon="dashboard" title="Platform dashboard" subtitle={`${D.schools} schools · ${D.students.toLocaleString("en-IN")} active students · ${fmtDate(today)}`}
        actions={can("tenants", true) && <Link href="/platform/tenants/new" className="btn btn-sm btn-primary">New school</Link>} />
      {sp.denied && <Flash error="Your platform role doesn't include that area." />}
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="revenue" tone="green" label="MRR (paid, excl. GST)" value={money(Math.round(mrr))} hint={`ARR ${money(Math.round(mrr * 12))} · ${live.length} paying schools`} href="/platform/billing" />
        <Stat icon="tenants" tone="blue" label="Active · Trial" value={`${st.ok ?? 0} · ${st.trial ?? 0}`} hint={`${D.trials_ending} trials end in 7 days`} href="/platform/tenants?state=trial" />
        <Stat icon="notifications" tone="amber" label="Grace · Expired" value={`${st.grace ?? 0} · ${st.expired ?? 0}`} hint={`${D.renewals_due} renewals in 30 days`} href="/platform/tenants?state=expired" />
        <Stat icon="billing" tone="rose" label="Unpaid invoices" value={money(D.due_amount)} hint={`${money(D.overdue_amount)} overdue`} href="/platform/billing?status=due" />
        <Stat icon="admissions" tone="violet" label="Pending approval" value={D.pending_approval} href="/platform/tenants?state=pending" />
        <Stat icon="tickets" tone="cyan" label="Open tickets" value={D.open_tickets} hint={`${D.urgent_tickets} high / urgent`} href="/platform/support" />
        <Stat icon="team" tone="amber" label="Suspended" value={st.suspended ?? 0} href="/platform/tenants?state=suspended" />
        <Stat icon="students" tone="blue" label="Active students" value={D.students.toLocaleString("en-IN")} href="/platform/tenants" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Revenue collected (last 12 months)">
          <BarChart label="Subscription revenue collected per month" format={k} data={D.revenue.map((r) => ({ x: `${MON[Number(r.month.slice(5)) - 1]} ${r.month.slice(2, 4)}`, y: Number(r.amount), tip: `${r.month}: ${money(r.amount)}` }))} />
        </Card>
        <Card title="New schools per week (last 12 weeks)">
          <BarChart label="New school sign-ups per week" data={D.signups.map((s) => ({ x: fmtDate(s.week).replace(/ \d{4}$/, ""), y: Number(s.n), tip: `Week of ${fmtDate(s.week)}: ${s.n}` }))} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Waiting for approval (${(pending ?? []).length})`}>
          <List empty="Nobody waiting." rows={(pending ?? []).map((s) => ({ key: s.id, href: `/platform/tenants/${s.id}`, a: s.name, b: `${s.city ?? ""} · ${fmtDate(s.created_at)}` }))} />
        </Card>
        <Card title="Trials ending this week">
          <List empty="None." rows={((trials ?? []) as unknown as { school_id: string; current_period_end: string; schools: { name: string } | null }[]).map((t) => ({ key: t.school_id, href: `/platform/tenants/${t.school_id}?tab=subscription`, a: t.schools?.name ?? "", b: `ends ${fmtDate(t.current_period_end)}` }))} />
        </Card>
        <Card title="Overdue invoices">
          <List empty="Nothing overdue." rows={((overdue ?? []) as unknown as { id: string; number: string; total: number; due_date: string; school_id: string; schools: { name: string } | null }[]).map((i) => ({ key: i.id, href: `/platform/tenants/${i.school_id}?tab=subscription`, a: `${i.schools?.name} · ${i.number}`, b: `${money(i.total)} · due ${fmtDate(i.due_date)}` }))} />
        </Card>
        <Card title="Open tickets">
          <List empty="No open tickets." rows={((tickets ?? []) as unknown as { id: string; number: number; subject: string; priority: string; status: string; schools: { name: string } | null }[]).map((t) => ({ key: t.id, href: `/platform/support/${t.id}`, a: `#${t.number} ${t.subject}`, b: t.schools?.name ?? "", badge: t.priority === "normal" ? t.status : t.priority }))} />
        </Card>
      </div>

      {can("audit") && (
        <Card title="Latest activity" actions={<Link href="/platform/audit" className="text-[14px]">Audit log</Link>}>
          <List empty="No activity yet." rows={((audit ?? []) as { id: number; at: string; action: string; entity: string | null; actor_email: string | null; actor_kind: string; school_id: string | null }[]).map((a) => ({ key: String(a.id), a: `${a.action} ${a.entity ?? ""}`, b: `${(a.school_id && nameOf.get(a.school_id)) || "platform"} · ${a.actor_email || a.actor_kind} · ${new Date(a.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}` }))} />
        </Card>
      )}
    </div>
  );
}

function List({ rows, empty }: { rows: { key: string; href?: string; a: string; b: string; badge?: string }[]; empty: string }) {
  if (!rows.length) return <p className="m-0 text-[14px] text-muted">{empty}</p>;
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
          {r.href ? <Link href={r.href} className="font-semibold">{r.a}</Link> : <span className="font-semibold text-ink">{r.a}</span>}
          <span className="flex items-center gap-2 text-muted">{r.b}{r.badge && <Badge value={r.badge} />}</span>
        </li>
      ))}
    </ul>
  );
}
