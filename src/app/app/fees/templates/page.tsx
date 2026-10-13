import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, PageHeader, Submit } from "@/components/ui/ui";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { seedFeeTemplates } from "../../_actions/fees2";

const KIND: Record<string, { what: string; where: string }> = {
  fee_receipt: { what: "Printed / shared for every payment received.", where: "Fees → Receipts → open a receipt" },
  fee_demand: { what: "Notice sent to a family for the dues outstanding.", where: "Fees → Defaulters → Demand notice" },
  fee_statement: { what: "Account of a student's instalments and payments.", where: "Fees → Fee statement → Print" },
};

type T = { id: string; code: string; name: string; page_size: string; active: boolean; version: number; updated_at: string; is_system: boolean };

export default async function FeeTemplates({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.structure.view", "documents.templates.view");
  const sp = await searchParams;
  const { data } = await supabase.from("document_templates").select("id,code,name,page_size,active,version,updated_at,is_system").eq("school_id", school.id).eq("category", "fees").order("code");
  const T = (data ?? []) as T[];
  const canEdit = can("documents.templates.edit");
  const previews = await Promise.all(T.map(async (t) => {
    const { data: p } = await supabase.rpc("preview_fee_template", { tpl: t.id });
    return [t.id, p as { html?: string; empty?: boolean } | null] as const;
  }));
  const pv = new Map(previews);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Fee templates" subtitle="The layout of fee receipts, demand notices and fee statements — edit once, used everywhere" back={{ href: "/app/fees", label: "Fees" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {T.length === 0 && (
        <Card title="No fee templates yet">
          <p className="mt-0 text-[14px]">Add the standard receipt, demand notice and statement, then edit them to match the school.</p>
          {canEdit && <form action={seedFeeTemplates}><Submit>Add standard fee templates</Submit></form>}
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {T.map((t) => {
          const k = KIND[t.code];
          const p = pv.get(t.id);
          return (
            <Card key={t.id} title={t.name} actions={<Badge value={t.active ? "active" : "cancelled"} text={t.active ? "In use" : "Switched off (built-in layout)"} />}>
              <p className="mt-0 mb-2 text-[13px] text-muted">{k?.what} Used from: {k?.where}. Page {t.page_size} · version {t.version}.</p>
              <div className="mb-3 max-h-[320px] overflow-auto rounded-[10px] border border-line bg-white p-3 text-ink">
                {p?.html ? <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.html) }} /> : <p className="m-0 text-[13px] text-muted">The preview appears once there is a receipt / a student with dues.</p>}
              </div>
              <div className="flex flex-wrap gap-3">
                {canEdit && <Link href={`/app/documents/templates/${t.id}/design?start=1`} className="btn btn-sm btn-primary">Design visually</Link>}
                <Link href={`/app/documents/templates/${t.id}`} className="btn btn-sm btn-secondary">{canEdit ? "Edit HTML & settings" : "View"}</Link>
                <Link href="/app/templates?module=fees" className="btn btn-sm btn-secondary">Gallery</Link>
              </div>
            </Card>
          );
        })}
      </div>
      {T.length > 0 && <Empty>Placeholders such as {"{{fee.amount}}"}, {"{{fee.lines_html}}"} and {"{{student.name}}"} are listed in the editor. A template that is switched off falls back to the built-in layout.</Empty>}
    </div>
  );
}
