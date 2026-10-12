import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatform } from "@/lib/platform";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Tabs } from "@/components/platform/Tabs";
import { AuditTable, type AuditRow } from "@/components/platform/AuditTable";
import { fmtDate, money } from "@/lib/format";
import { getSubscription, priceText, STATE_LABEL, type Plan, type SubInvoice } from "@/lib/billing";
import { loadTenants, relTime } from "@/lib/tenants";
import {
  addTenantUser, archiveTenant, changePlan, createInvoice, deleteTenant, markInvoicePaid, removeTenantUser, resetTenantUserPassword,
  restoreTenant, setLicence, setSchoolStatus, startSupport, syncRoles, updateSubscription, updateTenant, viewSchool, voidInvoice,
} from "../../actions";

const TABS: [string, string][] = [["overview", "Overview"], ["subscription", "Subscription & invoices"], ["modules", "Modules & roles"], ["users", "Users"], ["activity", "Activity"], ["support", "Support"], ["danger", "Danger zone"]];
const BOARDS = ["CBSE", "ICSE", "UP Board", "State Board", "Other"].map((b) => [b, b] as [string, string]);

export default async function Tenant({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, can, role } = await requirePlatform("tenants");
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const { data: school } = await supabase.from("schools").select("*").eq("id", id).maybeSingle();
  if (!school) notFound();
  const t = (await loadTenants(supabase)).find((x) => x.id === id)!;
  const [{ data: tenancy }, { data: groups }] = await Promise.all([
    supabase.from("platform_settings").select("value").eq("key", "tenancy").maybeSingle(),
    supabase.from("school_groups").select("id,name").order("name"),
  ]);
  const root = (tenancy?.value as { root_domain?: string } | null)?.root_domain ?? "";
  const W = can("tenants", true);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="school"
        title={school.name}
        back={{ href: "/platform/tenants", label: "Schools" }}
        subtitle={<>{school.code} · {school.city ?? "—"} · {school.board}{t.group ? ` · ${t.group}` : ""} · <Badge value={t.state === "ok" ? "active" : t.state === "expired" ? "overdue" : t.state} text={STATE_LABEL[t.state]} />{school.archived_at && <> · <Badge value="cancelled" text="Archived" /></>}</>}
        actions={<>
          {school.status === "pending" && W && <form action={setSchoolStatus}><input type="hidden" name="school_id" value={id} /><input type="hidden" name="status" value="approve" /><Submit>Approve</Submit></form>}
          <form action={viewSchool}><input type="hidden" name="id" value={id} /><Submit variant="secondary">View school (read-only)</Submit></form>
        </>}
      />
      <Flash ok={sp.ok} error={sp.error} />
      <Tabs base={`/platform/tenants/${id}`} tabs={TABS} active={tab} />

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon="students" tone="blue" label="Active students" value={`${t.stats?.students ?? 0} / ${school.student_limit}`} />
            <Stat icon="team" tone="violet" label="Staff logins" value={t.stats?.staff ?? 0} hint={`${t.stats?.parents ?? 0} parent logins`} />
            <Stat icon="fees" tone="green" label="Fees collected this month" value={money(t.stats?.collected_month ?? 0)} hint={`${t.stats?.receipts_month ?? 0} receipts`} />
            <Stat icon="audit" tone="cyan" label="Last activity" value={relTime(t.stats?.last_activity ?? null)} hint={`since ${fmtDate(school.created_at)} · ${school.source === "self_signup" ? "self sign-up" : "created by platform"}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Profile, branding & domain" className="lg:col-span-2">
              <form action={updateTenant} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <input type="hidden" name="id" value={id} />
                <Input label="Name" name="name" defaultValue={school.name} className="sm:col-span-2" />
                <Select label="Board" name="board" defaultValue={school.board} options={BOARDS} />
                <Input label="City" name="city" defaultValue={school.city} />
                <Input label="State" name="state" defaultValue={school.state} />
                <Select label="Group / trust" name="group_id" defaultValue={school.group_id} blank="— none —" options={(groups ?? []).map((g) => [g.id, g.name] as [string, string])} />
                <Input label="School phone" name="phone" defaultValue={school.phone} />
                <Input label="School email" name="email" defaultValue={school.email} />
                <Input label="Principal" name="principal_name" defaultValue={school.principal_name} />
                <Input label="Principal mobile" name="principal_phone" defaultValue={school.principal_phone} />
                <Input label="Logo URL" name="logo_url" defaultValue={school.logo_url} className="sm:col-span-2" />
                <Input label="Brand colour" name="brand_color" defaultValue={school.brand_color} placeholder="#1d4ed8" />
                <Input label="Subdomain" name="subdomain" defaultValue={school.subdomain} hint={root ? `${school.subdomain ?? "…"}.${root}` : "Set the root domain in Settings"} />
                <Input label="Custom domain" name="custom_domain" defaultValue={school.custom_domain} placeholder="erp.school.in" className="sm:col-span-2" />
                <Textarea label="Internal notes" name="notes" defaultValue={school.notes} rows={3} className="sm:col-span-2 lg:col-span-3" />
                {W && <div><Submit>Save</Submit></div>}
              </form>
            </Card>
            <Card title="Enter this school">
              <p className="mt-0 text-[14px]"><b>View</b> is read-only. To change data on the school's behalf, start a <b>support session</b> — it needs a reason, expires on its own, shows a banner to you, and every change is logged with it.</p>
              {can("impersonate", true) ? (
                <form action={startSupport} className="flex flex-col gap-2">
                  <input type="hidden" name="school_id" value={id} />
                  <Input label="Reason" name="reason" required placeholder="Help principal set up fee structure (ticket #12)" />
                  <Select label="Duration" name="minutes" defaultValue="60" options={[["30", "30 minutes"], ["60", "1 hour"], ["120", "2 hours"], ["240", "4 hours"]]} />
                  <div><Submit>Start support session</Submit></div>
                </form>
              ) : <p className="text-[13px] text-muted">Your platform role can view only.</p>}
              {root && <p className="mb-0 text-[13px] text-muted">School URL: <code>https://{school.custom_domain ?? `${school.subdomain}.${root}`}</code></p>}
            </Card>
          </div>
        </>
      )}

      {tab === "subscription" && <SubscriptionTab id={id} supabase={supabase} canBill={can("billing", true)} students={t.stats?.students ?? 0} limit={school.student_limit} />}
      {tab === "modules" && <ModulesTab id={id} supabase={supabase} W={W} />}
      {tab === "users" && <UsersTab id={id} supabase={supabase} W={W} canReset={can("impersonate", true)} />}
      {tab === "activity" && <ActivityTab id={id} supabase={supabase} />}
      {tab === "support" && <SupportTab id={id} supabase={supabase} />}
      {tab === "danger" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Export all data">
            <p className="mt-0 text-[14px]">Download every record of this school (students, fees, receipts, attendance, marks, staff, settings) as one JSON file — for a backup, migration or a data request under the DPDP Act.</p>
            <a href={`/platform/tenants/${id}/export`} className="btn btn-sm btn-secondary" data-no-loader>Download JSON</a>
          </Card>
          <Card title="Suspend / re-activate">
            <p className="mt-0 text-[14px]">Suspended schools are read-only for everyone in them.</p>
            {W && (school.status === "suspended"
              ? <form action={setSchoolStatus}><input type="hidden" name="school_id" value={id} /><input type="hidden" name="status" value="active" /><Submit variant="secondary">Re-activate</Submit></form>
              : <form action={setSchoolStatus}><input type="hidden" name="school_id" value={id} /><input type="hidden" name="status" value="suspended" /><Submit variant="danger">Suspend</Submit></form>)}
          </Card>
          <Card title={school.archived_at ? `Archived on ${fmtDate(school.archived_at)}` : "Archive"}>
            <p className="mt-0 text-[14px]">Archiving stops logins and hides the school from lists and its domain. Data is kept and can be restored.</p>
            {W && (school.archived_at
              ? <form action={restoreTenant}><input type="hidden" name="school_id" value={id} /><Submit variant="secondary">Restore</Submit></form>
              : <form action={archiveTenant} className="flex flex-wrap items-end gap-2"><input type="hidden" name="school_id" value={id} /><Input label="Reason" name="reason" required /><Submit variant="danger">Archive school</Submit></form>)}
          </Card>
          {role === "owner" && school.archived_at && (
            <Card title="Delete permanently">
              <p className="mt-0 text-[14px] text-error">Deletes the school and every record in it. This cannot be undone. Export the data first.</p>
              <form action={deleteTenant} className="flex flex-wrap items-end gap-2"><input type="hidden" name="school_id" value={id} /><Input label={`Type ${school.code} to confirm`} name="confirm" required /><Submit variant="danger">Delete forever</Submit></form>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

type SB = Awaited<ReturnType<typeof requirePlatform>>["supabase"];

async function SubscriptionTab({ id, supabase, canBill, students, limit }: { id: string; supabase: SB; canBill: boolean; students: number; limit: number }) {
  const [{ sub }, { data: plans }, { data: invoices }] = await Promise.all([
    getSubscription(supabase, id),
    supabase.from("plans").select("*").order("sort"),
    supabase.from("subscription_invoices").select("*").eq("school_id", id).order("created_at", { ascending: false }),
  ]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Subscription">
        {sub ? (
          <dl className="m-0 mb-4 grid grid-cols-2 gap-y-1 text-[14px]">
            <dt className="text-muted">Plan</dt><dd className="m-0 font-semibold text-ink">{sub.plans?.name} · {sub.billing_cycle} {sub.plans && <span className="font-normal text-muted">({priceText(sub.plans, sub.billing_cycle)})</span>}</dd>
            <dt className="text-muted">Period</dt><dd className="m-0">{fmtDate(sub.current_period_start)} – {fmtDate(sub.current_period_end)}</dd>
            <dt className="text-muted">Grace</dt><dd className="m-0">{sub.grace_days} days · {sub.auto_renew ? "auto-renew invoice" : "no auto-renew"} · {sub.status}</dd>
            <dt className="text-muted">Usage</dt><dd className="m-0">{students} / {limit} students</dd>
          </dl>
        ) : <p className="text-[14px] text-muted">No subscription yet.</p>}
        {canBill && (
          <>
            <form action={changePlan} className="grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
              <input type="hidden" name="school_id" value={id} />
              <Select label="Change plan" name="plan" defaultValue={sub?.plans?.code ?? "trial"} options={((plans ?? []) as Plan[]).map((p) => [p.code, `${p.name} · ${priceText(p, "yearly")}`] as [string, string])} />
              <Select label="Billing" name="cycle" defaultValue={sub?.billing_cycle ?? "yearly"} options={[["yearly", "Yearly"], ["monthly", "Monthly"]]} />
              <Input label="Start" name="start" type="date" hint="Default today" />
              <Input label="End (optional)" name="end" type="date" hint="Default: one cycle / trial length" />
              <div className="sm:col-span-2"><Submit variant="secondary">Apply plan</Submit> <span className="text-[12px] text-muted">Sets modules, student limit and period.</span></div>
            </form>
            {sub && (
              <form action={updateSubscription} className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
                <input type="hidden" name="school_id" value={id} />
                <Input label="Extend / change period end" name="end" type="date" />
                <Input label="Grace days" name="grace" type="number" defaultValue={sub.grace_days} min={0} />
                <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="auto_renew" defaultChecked={sub.auto_renew} /> Auto-create renewal invoices</label>
                <label className="flex items-center gap-2 text-[14px] text-error"><input type="checkbox" name="cancel" /> Cancel at period end</label>
                <Input label="Notes" name="notes" defaultValue={sub.notes} className="sm:col-span-2" />
                <div><Submit variant="secondary">Save</Submit></div>
              </form>
            )}
          </>
        )}
      </Card>
      <Card title="Invoices" actions={canBill && sub?.plans && sub.plans.trial_days === 0 ? (
        <form action={createInvoice} className="flex items-end gap-2"><input type="hidden" name="school_id" value={id} /><Input label="Period start" name="start" type="date" /><Submit>Create invoice</Submit></form>
      ) : <span className="text-[12px] text-muted">{canBill ? "Move to a paid plan to invoice" : ""}</span>}>
        {(invoices ?? []).length ? (
          <Table head={["Invoice", "Period", "Total", "Status", ""]} minWidth={520}>
            {((invoices ?? []) as SubInvoice[]).map((i) => (
              <tr key={i.id}>
                <td className={`${td} font-mono text-[12px]`}>{i.number}<div className="font-sans text-[11px] text-muted">{i.students ? `${i.students} × ${money(i.rate)}` : "flat"}</div></td>
                <td className={`${td} text-[13px]`}>{fmtDate(i.period_start)} – {fmtDate(i.period_end)}</td>
                <td className={`${td} font-semibold text-ink`}>{money(i.total)}</td>
                <td className={td}><Badge value={i.status === "due" ? "due" : i.status === "void" ? "cancelled" : "paid"} text={i.status} />{i.razorpay_link_url && <a href={i.razorpay_link_url} target="_blank" rel="noopener" className="ml-1 text-[12px]">link</a>}</td>
                <td className={td}>
                  {i.status === "due" && canBill && (
                    <div className="flex flex-col gap-1">
                      <form action={markInvoicePaid} className="flex gap-1"><input type="hidden" name="school_id" value={id} /><input type="hidden" name="id" value={i.id} /><input name="ref" placeholder="UTR / ref" className="w-24 rounded-md border border-line px-1.5 py-1 text-[12px]" /><button className="cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-[12px]">Paid</button></form>
                      <form action={voidInvoice}><input type="hidden" name="school_id" value={id} /><input type="hidden" name="id" value={i.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-error underline">void</button></form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : <p className="m-0 text-[14px] text-muted">No invoices.</p>}
      </Card>
    </div>
  );
}

async function ModulesTab({ id, supabase, W }: { id: string; supabase: SB; W: boolean }) {
  const [{ data: modules }, { data: sm }, { data: roles }] = await Promise.all([
    supabase.from("erp_modules").select("code,name,grp,tier,core").order("sort"),
    supabase.from("school_modules").select("module_code,licensed,enabled").eq("school_id", id),
    supabase.from("roles").select("id,name,kind,template_code,locked").eq("school_id", id).order("created_at"),
  ]);
  const st = new Map((sm ?? []).map((m) => [m.module_code, m]));
  return (
    <div className="flex flex-col gap-4">
      <Card title="Module licences" actions={<Link href="/platform/modules" className="text-[14px]">Module map</Link>}>
        <p className="mt-0 text-[13px] text-muted">Set by the plan. Override here for one school; re-applying a plan resets these.</p>
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {(modules ?? []).map((m) => {
            const lic = m.core || st.get(m.code)?.licensed;
            return (
              <li key={m.code} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[14px]">
                <span><b className="text-ink">{m.name}</b><span className="block text-[12px] text-muted">{m.tier}{st.get(m.code) && !st.get(m.code)!.enabled ? " · school switched it off" : ""}</span></span>
                {m.core ? <Badge value="active" text="Core" /> : W ? (
                  <form action={setLicence}><input type="hidden" name="school_id" value={id} /><input type="hidden" name="module" value={m.code} /><input type="hidden" name="on" value={lic ? "0" : "1"} />
                    <button className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] font-semibold ${lic ? "border-wa bg-wa-tint text-[#0b4f2c]" : "border-line bg-white text-muted"}`}>{lic ? "Licensed" : "Not licensed"}</button>
                  </form>
                ) : <Badge value={lic ? "active" : "draft"} text={lic ? "Licensed" : "Not licensed"} />}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title={`Roles in this school (${roles?.length ?? 0})`} actions={W && <form action={syncRoles}><input type="hidden" name="school_id" value={id} /><Submit variant="secondary">Sync default roles</Submit></form>}>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">{(roles ?? []).map((r) => <li key={r.id}><Badge value={r.locked ? "active" : r.template_code ? "draft" : "contacted"} text={`${r.name}${r.template_code ? "" : " (custom)"}`} /></li>)}</ul>
      </Card>
    </div>
  );
}

async function UsersTab({ id, supabase, W, canReset }: { id: string; supabase: SB; W: boolean; canReset: boolean }) {
  const [{ data: members }, { data: mr }, { data: roles }] = await Promise.all([
    supabase.from("school_members").select("user_id,name,email,phone,created_at").eq("school_id", id).order("name"),
    supabase.from("member_roles").select("user_id,role_id").eq("school_id", id),
    supabase.from("roles").select("id,name,code,kind").eq("school_id", id),
  ]);
  const roleNames = (uid: string) => (mr ?? []).filter((x) => x.user_id === uid).map((x) => (roles ?? []).find((r) => r.id === x.role_id)?.name).filter(Boolean).join(", ");
  return (
    <div className="flex flex-col gap-4">
      {(members ?? []).length ? (
        <Table head={["Name", "Email / phone", "Roles", "Added", ""]} minWidth={760}>
          {(members ?? []).map((m) => (
            <tr key={m.user_id}>
              <td className={`${td} font-semibold text-ink`}>{m.name ?? "—"}</td>
              <td className={td}>{m.email}<div className="text-[12px] text-muted">{m.phone ?? ""}</div></td>
              <td className={td}>{roleNames(m.user_id) || "—"}</td>
              <td className={td}>{fmtDate(m.created_at)}</td>
              <td className={`${td} whitespace-nowrap`}>
                {canReset && <form action={resetTenantUserPassword} className="inline"><input type="hidden" name="school_id" value={id} /><input type="hidden" name="user_id" value={m.user_id} /><button className="mr-3 cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Reset password</button></form>}
                {W && <form action={removeTenantUser} className="inline"><input type="hidden" name="school_id" value={id} /><input type="hidden" name="user_id" value={m.user_id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove</button></form>}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No users yet.</Empty>}
      {W && (
        <Card title="Add a user to this school">
          <form action={addTenantUser} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="school_id" value={id} />
            <Input label="Name" name="name" />
            <Input label="Email (login)" name="email" type="email" required />
            <Input label="Phone" name="phone" />
            <Select label="Role" name="role" defaultValue="principal" options={(roles ?? []).filter((r) => r.kind === "staff").map((r) => [r.code, r.name] as [string, string])} />
            <div className="flex items-end"><Submit>Add user</Submit></div>
          </form>
        </Card>
      )}
    </div>
  );
}

async function ActivityTab({ id, supabase }: { id: string; supabase: SB }) {
  const [{ data: rows }, { data: sessions }] = await Promise.all([
    supabase.from("audit_log").select("id,at,action,entity,entity_id,actor_email,actor_kind,support_session,details").eq("school_id", id).order("at", { ascending: false }).limit(200),
    supabase.from("support_sessions").select("id,reason,started_at,expires_at,ended_at,user_id").eq("school_id", id).order("started_at", { ascending: false }).limit(20),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Support sessions">
        {(sessions ?? []).length ? (
          <ul className="m-0 list-none p-0 text-[14px]">{(sessions ?? []).map((s) => <li key={s.id} className="border-t border-line py-1.5 first:border-0">{new Date(s.started_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · <b>{s.reason}</b> · {s.ended_at ? `ended ${new Date(s.ended_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}` : new Date(s.expires_at) > new Date() ? "active" : "expired"}</li>)}</ul>
        ) : <p className="m-0 text-[14px] text-muted">None.</p>}
      </Card>
      <AuditTable rows={(rows ?? []) as AuditRow[]} />
    </div>
  );
}

async function SupportTab({ id, supabase }: { id: string; supabase: SB }) {
  const { data } = await supabase.from("tickets").select("id,number,subject,category,priority,status,created_by_name,updated_at").eq("school_id", id).order("updated_at", { ascending: false });
  return (data ?? []).length ? (
    <Table head={["#", "Subject", "From", "Priority", "Status", "Updated"]} minWidth={700}>
      {(data ?? []).map((t) => (
        <tr key={t.id}>
          <td className={td}>{t.number}</td>
          <td className={td}><Link href={`/platform/support/${t.id}`} className="font-semibold">{t.subject}</Link><div className="text-[12px] text-muted">{t.category}</div></td>
          <td className={td}>{t.created_by_name}</td>
          <td className={td}><Badge value={t.priority} /></td>
          <td className={td}><Badge value={t.status === "open" ? "new" : t.status === "resolved" ? "paid" : t.status} text={t.status} /></td>
          <td className={td}>{fmtDate(t.updated_at)}</td>
        </tr>
      ))}
    </Table>
  ) : <Empty>No tickets from this school.</Empty>;
}
