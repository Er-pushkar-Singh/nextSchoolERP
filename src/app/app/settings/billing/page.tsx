import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { fmtDate, money, waLink } from "@/lib/format";
import { getSubscription, priceText, STATE_LABEL, type Plan, type SubInvoice } from "@/lib/billing";
import { brand } from "@/lib/brand";

export default async function Billing({ searchParams }: { searchParams: Promise<{ paid?: string }> }) {
  const { supabase, school } = await requirePerm("settings.billing.view");
  const sp = await searchParams;
  const [{ sub, state }, { data: invoices }, { data: plans }, { count: students }] = await Promise.all([
    getSubscription(supabase, school.id),
    supabase.from("subscription_invoices").select("*").eq("school_id", school.id).neq("status", "void").order("created_at", { ascending: false }),
    supabase.from("plans").select("*").eq("is_public", true).eq("active", true).order("sort"),
    supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("status", "active"),
  ]);
  const plan = sub?.plans;
  const cycle = sub?.billing_cycle ?? "yearly";
  const due = ((invoices ?? []) as SubInvoice[]).filter((i) => i.status === "due");
  const ask = (p: Plan, c: string) => waLink(brand.supportWhatsapp, `Hello, ${school.name} (${school.code}) would like the ${p.name} plan, billed ${c}.`);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="billing" title="Plan & billing" subtitle={`${school.name} · ${school.code}`} back={{ href: "/app/settings", label: "Settings centre" }} />
      {sp.paid && <Flash ok="Thank you! Your payment is being confirmed — the plan extends automatically within a few minutes." />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Plan" value={plan?.name ?? "—"} hint={plan ? priceText(plan, cycle) : undefined} />
        <Stat label="Status" value={STATE_LABEL[state]} hint={sub ? `${fmtDate(sub.current_period_start)} – ${fmtDate(sub.current_period_end)}` : undefined} />
        <Stat label="Students" value={`${students ?? 0} / ${school.student_limit}`} hint="active students / plan limit" />
        <Stat label="Billing" value={cycle === "yearly" ? "Yearly" : "Monthly"} hint={sub?.auto_renew ? "renewal invoice 7 days before the end" : "no auto renewal"} />
      </div>

      {due.length > 0 && (
        <Card title="Due now">
          {due.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2 first:border-0">
              <span className="text-[14px]"><Link href={`/app/settings/billing/${i.id}`} className="font-mono">{i.number}</Link> · {fmtDate(i.period_start)} – {fmtDate(i.period_end)} · due {fmtDate(i.due_date)}</span>
              <span className="flex items-center gap-3"><b className="text-[18px] text-ink">{money(i.total)}</b>
                {i.razorpay_link_url ? <a href={i.razorpay_link_url} target="_blank" rel="noopener" className="btn btn-sm btn-primary">Pay online</a> : <span className="text-[13px] text-muted">Pay by bank / UPI as per invoice</span>}
              </span>
            </div>
          ))}
        </Card>
      )}

      <Card title="Invoices">
        {(invoices ?? []).length ? (
          <Table head={["Invoice", "Period", "Students", "Amount", "GST", "Total", "Status"]} minWidth={680}>
            {((invoices ?? []) as SubInvoice[]).map((i) => (
              <tr key={i.id}>
                <td className={td}><Link href={`/app/settings/billing/${i.id}`} className="font-mono text-[13px]">{i.number}</Link></td>
                <td className={td}>{fmtDate(i.period_start)} – {fmtDate(i.period_end)}</td>
                <td className={td}>{i.students || "—"}</td>
                <td className={td}>{money(i.amount)}</td>
                <td className={td}>{money(i.gst_amount)}</td>
                <td className={`${td} font-semibold text-ink`}>{money(i.total)}</td>
                <td className={td}><Badge value={i.status === "due" ? "due" : i.status} /></td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No invoices yet.</Empty>}
      </Card>

      <Card title="Plans">
        <div className="grid gap-3 md:grid-cols-3">
          {((plans ?? []) as Plan[]).filter((p) => p.trial_days === 0).map((p) => (
            <div key={p.id} className={`flex flex-col gap-2 rounded-[12px] border p-4 ${p.id === plan?.id ? "border-blue bg-blue-tint" : "border-line"}`}>
              <div className="flex items-center justify-between"><b className="text-[17px] text-ink">{p.name}</b>{p.id === plan?.id && <Badge value="active" text="Current" />}</div>
              <p className="m-0 text-[14px]">{p.description}</p>
              <p className="m-0 text-[15px] font-semibold text-ink">{priceText(p, "yearly")}</p>
              <p className="m-0 text-[13px] text-muted">or {priceText(p, "monthly")} · up to {p.student_limit.toLocaleString("en-IN")} students{p.min_students ? ` · billed for at least ${p.min_students}` : ""} · + 18% GST</p>
              {p.id !== plan?.id && ask(p, "yearly") && <a href={ask(p, "yearly")!} target="_blank" rel="noopener" className="btn btn-sm btn-secondary mt-auto">Ask to switch</a>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
