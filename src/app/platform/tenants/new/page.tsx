import { requirePlatform } from "@/lib/platform";
import { Card, Flash, Input, PageHeader, Select, Submit } from "@/components/ui/ui";
import { priceText, type Plan } from "@/lib/billing";
import { createTenant } from "../../actions";

export default async function NewTenant({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await requirePlatform("tenants", true);
  const sp = await searchParams;
  const [{ data: plans }, { data: groups }, { data: tenancy }] = await Promise.all([
    supabase.from("plans").select("*").eq("active", true).order("sort"),
    supabase.from("school_groups").select("id,name").order("name"),
    supabase.from("platform_settings").select("value").eq("key", "tenancy").maybeSingle(),
  ]);
  const root = (tenancy?.value as { root_domain?: string } | null)?.root_domain;
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader icon="school" title="New school" subtitle="Creates the school with the current session, classes Nursery–12, subjects, fee heads, default roles and the chosen plan." back={{ href: "/platform/tenants", label: "Schools" }} />
      <Flash error={sp.error} />
      <form action={createTenant} className="flex flex-col gap-5">
        <Card title="1 · School">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="School name" name="name" required className="sm:col-span-2" />
            <Input label="Code / subdomain" name="code" required placeholder="sunrise-lko" hint={root ? `Opens at <code>.${root}` : "Lowercase letters, digits, -"} />
            <Select label="Board" name="board" options={["CBSE", "ICSE", "UP Board", "State Board", "Other"].map((b) => [b, b] as [string, string])} />
            <Input label="City" name="city" defaultValue="Lucknow" />
            <Input label="State" name="state" defaultValue="Uttar Pradesh" />
            <Input label="School phone" name="phone" type="tel" />
            <Input label="School email" name="email" type="email" />
            <Select label="Group / trust" name="group_id" blank="— none —" options={(groups ?? []).map((g) => [g.id, g.name] as [string, string])} />
          </div>
        </Card>
        <Card title="2 · Plan">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Plan" name="plan" defaultValue="trial" options={((plans ?? []) as Plan[]).map((p) => [p.code, `${p.name} · ${priceText(p, "yearly")}`] as [string, string])} />
            <Select label="Billing" name="cycle" defaultValue="yearly" options={[["yearly", "Yearly"], ["monthly", "Monthly"]]} />
          </div>
        </Card>
        <Card title="3 · Principal / school admin login">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" name="admin_name" />
            <Input label="Email (login)" name="admin_email" type="email" hint="A temporary password is shown once after creating" />
          </div>
        </Card>
        <Card title="4 · Branding & domain (optional)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Logo URL" name="logo_url" placeholder="https://…" className="sm:col-span-2" />
            <Input label="Brand colour" name="brand_color" placeholder="#1d4ed8" />
            <Input label="Custom domain" name="custom_domain" placeholder="erp.sunriseschool.in" hint="Point a CNAME to the app host, then add the domain in Vercel" className="sm:col-span-2" />
          </div>
        </Card>
        <div><Submit>Create school</Submit></div>
      </form>
    </div>
  );
}
