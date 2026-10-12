import { requirePlatform } from "@/lib/platform";
import { Card, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { priceText, type Plan } from "@/lib/billing";
import { savePlan } from "../actions";

function PlanForm({ p, modules }: { p?: Plan; modules: { code: string; name: string; core: boolean }[] }) {
  return (
    <form action={savePlan} className="flex flex-col gap-3">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!p && <Input label="Code" name="code" required placeholder="gold" hint="a–z, 0–9, _ (can't change later)" />}
        <Input label="Name" name="name" defaultValue={p?.name} required />
        <Select label="Price type" name="price_type" defaultValue={p?.price_type ?? "per_student"} options={[["per_student", "Per student"], ["flat", "Flat per school"]]} />
        <Input label="Monthly price ₹" name="price_monthly" type="number" step="0.01" defaultValue={p?.price_monthly ?? 0} />
        <Input label="Yearly price ₹" name="price_yearly" type="number" step="0.01" defaultValue={p?.price_yearly ?? 0} />
        <Input label="Bill at least (students)" name="min_students" type="number" defaultValue={p?.min_students ?? 0} />
        <Input label="Student limit" name="student_limit" type="number" defaultValue={p?.student_limit ?? 500} />
        <Input label="Storage (MB)" name="storage_mb" type="number" defaultValue={p?.storage_mb ?? 1024} />
        <Input label="Trial days (0 = paid plan)" name="trial_days" type="number" defaultValue={p?.trial_days ?? 0} />
        <Input label="Order" name="sort" type="number" defaultValue={p?.sort ?? 9} />
      </div>
      <Textarea label="Description" name="description" defaultValue={p?.description} rows={2} />
      <fieldset className="border-0 p-0"><legend className="mb-1 text-[13px] font-semibold text-ink">Modules included (core modules are always on)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">{modules.filter((m) => !m.core).map((m) => <label key={m.code} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="modules" value={m.code} defaultChecked={p?.modules.includes(m.code)} /> {m.name}</label>)}</div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4 text-[14px]">
        <label className="flex items-center gap-1.5"><input type="checkbox" name="is_public" defaultChecked={p?.is_public ?? true} /> Shown to schools</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Active</label>
        <Submit>{p ? "Save plan" : "Create plan"}</Submit>
      </div>
    </form>
  );
}

export default async function Plans({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase } = await requirePlatform("plans");
  const sp = await searchParams;
  const [{ data: plans }, { data: modules }] = await Promise.all([
    supabase.from("plans").select("*").order("sort"),
    supabase.from("erp_modules").select("code,name,core").order("sort"),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="plans" title="Plans" subtitle="Monthly and yearly prices, limits and included modules. Prices exclude 18% GST." />
      <Flash ok={sp.ok} error={sp.error} />
      {((plans ?? []) as Plan[]).map((p) => (
        <Card key={p.id} title={`${p.name} · ${priceText(p, "yearly")}${p.trial_days ? "" : ` or ${priceText(p, "monthly")}`}`} actions={<span className="font-mono text-[12px] text-muted">{p.code}{p.active ? "" : " · inactive"}</span>}>
          <details><summary className="cursor-pointer text-[14px] text-blue">Edit</summary><div className="mt-3"><PlanForm p={p} modules={modules ?? []} /></div></details>
        </Card>
      ))}
      <Card title="New plan"><PlanForm modules={modules ?? []} /></Card>
    </div>
  );
}
