import Link from "next/link";
import { requirePlatform } from "@/lib/platform";
import { PageHeader } from "@/components/ui/ui";
import { AuditTable, type AuditRow } from "@/components/platform/AuditTable";

const PAGE = 100;

export default async function Audit({ searchParams }: { searchParams: Promise<{ school?: string; action?: string; entity?: string; kind?: string; from?: string; to?: string; page?: string }> }) {
  const { supabase } = await requirePlatform("audit");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  let q = supabase.from("audit_log").select("id,at,action,entity,entity_id,actor_email,actor_kind,support_session,details,school_id", { count: "exact" });
  if (sp.school && /^[0-9a-f-]{36}$/.test(sp.school)) q = q.eq("school_id", sp.school);
  if (sp.action) q = q.ilike("action", `${sp.action.replace(/[%,]/g, "")}%`);
  if (sp.entity) q = q.eq("entity", sp.entity);
  if (sp.kind) q = q.eq("actor_kind", sp.kind);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "")) q = q.gte("at", `${sp.from}T00:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "")) q = q.lte("at", `${sp.to}T23:59:59+05:30`);
  const [{ data, count }, { data: schools }] = await Promise.all([
    q.order("at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("schools").select("id,name").order("name"),
  ]);
  const name = new Map((schools ?? []).map((s) => [s.id, s.name]));
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="audit" title="Audit log" subtitle={`${count ?? 0} events · who changed what, when, and under which support session`} />
      <form className="flex flex-wrap items-end gap-2">
        <label className="text-[13px] font-semibold">School<select name="school" defaultValue={sp.school ?? ""} className="input !min-h-10 !py-2"><option value="">All</option>{(schools ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="text-[13px] font-semibold">Who<select name="kind" defaultValue={sp.kind ?? ""} className="input !min-h-10 !py-2"><option value="">Anyone</option><option value="user">School users</option><option value="platform">Platform team</option><option value="service">Server / webhooks</option><option value="system">System</option></select></label>
        <label className="text-[13px] font-semibold">Action<input name="action" defaultValue={sp.action} placeholder="update, support., plan." className="input !min-h-10 !py-2" /></label>
        <label className="text-[13px] font-semibold">Table<input name="entity" defaultValue={sp.entity} placeholder="students" className="input !min-h-10 !py-2" /></label>
        <label className="text-[13px] font-semibold">From<input type="date" name="from" defaultValue={sp.from} className="input !min-h-10 !py-2" /></label>
        <label className="text-[13px] font-semibold">To<input type="date" name="to" defaultValue={sp.to} className="input !min-h-10 !py-2" /></label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
      </form>
      <AuditTable rows={(data ?? []) as AuditRow[]} schoolName={(id) => (id ? name.get(id) ?? "deleted school" : "platform")} />
      {(count ?? 0) > PAGE && (
        <div className="flex gap-3 text-[14px]">{page > 1 && <Link href={qs(page - 1)}>← Newer</Link>}<span className="text-muted">Page {page} of {Math.ceil((count ?? 0) / PAGE)}</span>{page * PAGE < (count ?? 0) && <Link href={qs(page + 1)}>Older →</Link>}</div>
      )}
    </div>
  );
}
