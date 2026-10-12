import { requirePlatform } from "@/lib/platform";
import { Card, Flash, Input, PageHeader, Submit } from "@/components/ui/ui";
import { savePlatformSettings } from "../actions";
import { appUrl } from "@/lib/brand";

export default async function PlatformSettings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, can } = await requirePlatform("settings");
  const sp = await searchParams;
  const [{ data: rows }, { data: plans }] = await Promise.all([
    supabase.from("platform_settings").select("key,value"),
    supabase.from("plans").select("code,name,trial_days").gt("trial_days", 0),
  ]);
  const get = (k: string) => ((rows ?? []).find((r) => r.key === k)?.value ?? {}) as Record<string, string | number | boolean>;
  const signup = get("signup"), billing = get("billing"), tenancy = get("tenancy"), branding = get("branding");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="settings" title="Platform settings" subtitle="Registration, billing, domains and branding for every school on the platform." />
      <Flash ok={sp.ok} error={sp.error} />
      <form action={savePlatformSettings} className="flex flex-col gap-5">
        <Card title="School registration">
          <div className="flex flex-col gap-2 text-[14px]">
            <label className="flex items-center gap-2"><input type="checkbox" name="signup_enabled" defaultChecked={Boolean(signup.enabled)} /> Schools can register themselves at <code>{appUrl("/register")}</code></label>
            <label className="flex items-center gap-2"><input type="checkbox" name="require_approval" defaultChecked={Boolean(signup.require_approval)} /> New registrations wait for approval (read-only until approved)</label>
            <label className="flex items-center gap-2">Trial plan for new schools
              <select name="trial_plan" defaultValue={String(signup.trial_plan ?? "trial")} className="rounded-md border border-line px-2 py-1">{(plans ?? []).map((p) => <option key={p.code} value={p.code}>{p.name} ({p.trial_days} days)</option>)}</select>
            </label>
          </div>
        </Card>
        <Card title="Domains (multi-tenant)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Root domain for school subdomains" name="root_domain" defaultValue={String(tenancy.root_domain ?? "")} placeholder="erp.codersduniya.com" hint="Each school opens at <subdomain>.<root>. Add a wildcard DNS record *.<root> → your host and the wildcard domain in Vercel." />
            <Input label="Main app host" name="app_host" defaultValue={String(tenancy.app_host ?? "")} placeholder="app.codersduniya.com" hint="Where staff of any school and the Super Admin sign in" />
          </div>
          <p className="mb-0 text-[13px] text-muted">Custom domains: the school adds a CNAME (erp.school.in → your host); you add the domain in Vercel and enter it on the school's page.</p>
        </Card>
        <Card title="Branding & support contacts">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Product name" name="product_name" defaultValue={String(branding.product_name ?? "CodersDuniya School ERP")} />
            <Input label="Support WhatsApp" name="support_whatsapp" defaultValue={String(branding.support_whatsapp ?? "")} />
            <Input label="Support email" name="support_email" defaultValue={String(branding.support_email ?? "")} />
            <Input label="Support phone" name="support_phone" defaultValue={String(branding.support_phone ?? "")} />
          </div>
        </Card>
        <Card title="Subscription billing">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="GST %" name="gst_rate" type="number" step="0.01" defaultValue={Number(billing.gst_rate ?? 18)} />
            <Input label="Invoice prefix" name="invoice_prefix" defaultValue={String(billing.invoice_prefix ?? "CDS")} hint="CDS/2026-27/0001" />
            <Input label="Grace days after expiry" name="grace_days" type="number" defaultValue={Number(billing.grace_days ?? 7)} />
            <Input label="Renewal invoice, days before end" name="renew_days_before" type="number" defaultValue={Number(billing.renew_days_before ?? 7)} />
            <Input label="Seller name" name="seller_name" defaultValue={String(billing.seller_name ?? "CodersDuniya")} />
            <Input label="Seller GSTIN" name="seller_gstin" defaultValue={String(billing.seller_gstin ?? "")} />
            <Input label="Seller state code" name="seller_state" defaultValue={String(billing.seller_state ?? "09")} hint="09 = Uttar Pradesh" />
            <Input label="Seller address" name="seller_address" defaultValue={String(billing.seller_address ?? "")} />
          </div>
        </Card>
        {can("settings", true) && <div><Submit>Save settings</Submit></div>}
      </form>
    </div>
  );
}
