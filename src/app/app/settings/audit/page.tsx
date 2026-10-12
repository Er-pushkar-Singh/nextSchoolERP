import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { PageHeader } from "@/components/ui/ui";
import { AuditTable, type AuditRow } from "@/components/platform/AuditTable";

const PAGE = 100;

export default async function SchoolAudit({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string; from?: string; to?: string; page?: string }> }) {
  const { supabase, school } = await requirePerm("settings.audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  let q = supabase.from("audit_log").select("id,at,action,entity,entity_id,actor_email,actor_kind,support_session,details", { count: "exact" }).eq("school_id", school.id);
  if (sp.action) q = q.ilike("action", `${sp.action.replace(/[%,]/g, "")}%`);
  if (sp.entity) q = q.eq("entity", sp.entity);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "")) q = q.gte("at", `${sp.from}T00:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "")) q = q.lte("at", `${sp.to}T23:59:59+05:30`);
  const { data, count } = await q.order("at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const qs = (p: number) => `?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="audit" title="Audit log" subtitle={`${count ?? 0} events — every change in ${school.name}, including CodersDuniya support sessions`} back={{ href: "/app/settings", label: "Settings centre" }} />
      <form className="flex flex-wrap items-end gap-2 rounded-[14px] border border-line bg-white p-3 shadow-[var(--shadow-card)]">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Action<input name="action" defaultValue={sp.action} placeholder="update, delete, support." className="input !min-h-10 !py-2" /></label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Table<input name="entity" defaultValue={sp.entity} placeholder="students, fee_receipts" className="input !min-h-10 !py-2" /></label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">From<input type="date" name="from" defaultValue={sp.from} className="input !min-h-10 !py-2" /></label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">To<input type="date" name="to" defaultValue={sp.to} className="input !min-h-10 !py-2" /></label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
      </form>
      <AuditTable rows={(data ?? []) as AuditRow[]} />
      {(count ?? 0) > PAGE && (
        <div className="flex gap-3 text-[14px]">{page > 1 && <Link href={qs(page - 1)}>← Newer</Link>}<span className="text-muted">Page {page} of {Math.ceil((count ?? 0) / PAGE)}</span>{page * PAGE < (count ?? 0) && <Link href={qs(page + 1)}>Older →</Link>}</div>
      )}
    </div>
  );
}
