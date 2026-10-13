import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, PageHeader, Submit } from "@/components/ui/ui";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { newFeeTemplate, setFeeTemplate } from "../../_actions/templates";
import { seedFeeTemplates } from "../../_actions/fees2";

const KINDS: [string, string, string][] = [
  ["receipt", "Fee receipt", "Printed or shared for every payment received (Fees → Receipts)."],
  ["demand", "Fee demand notice", "Sent to a family for dues outstanding (Fees → Defaulters → Demand notice)."],
  ["statement", "Fee statement", "A student's account of instalments and payments (Fees → Fee statement → Official statement)."],
];

type T = { id: string; code: string; name: string; page_size: string; active: boolean; version: number; fee_kind: string | null; preset: string | null; design: unknown };

export default async function FeeTemplates({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.structure.view", "documents.templates.view");
  const sp = await searchParams;
  const res = await supabase.from("document_templates").select("id,code,name,page_size,active,version,fee_kind,preset,design").eq("school_id", school.id).eq("category", "fees").order("updated_at", { ascending: false });
  const T = (res.data ?? []) as T[];
  const needsMigration = Boolean(res.error && /fee_kind/.test(res.error.message));
  const legacy = needsMigration
    ? ((await supabase.from("document_templates").select("id,code,name,page_size,active,version").eq("school_id", school.id).eq("category", "fees")).data ?? []).map((t) => ({ ...t, fee_kind: null, preset: null, design: null }) as T)
    : T;
  const list = needsMigration ? legacy : T;
  const canEdit = can("documents.templates.edit");
  const usedFor = (k: string) => list.find((t) => t.fee_kind === k && t.active) ?? list.find((t) => t.active && (t.code === `fee_${k}` || t.preset === `fee_${k}_design`));
  const previews = await Promise.all(list.map(async (t) => {
    const { data: p } = await supabase.rpc("preview_fee_template", { tpl: t.id });
    return [t.id, p as { html?: string } | null] as const;
  }));
  const pv = new Map(previews);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Fee templates" subtitle="Design the receipt, demand notice and statement — and choose which one is used" back={{ href: "/app/fees", label: "Fees" }}
        actions={<Link href="/app/templates?module=fees" className="btn btn-sm btn-secondary">Gallery</Link>} />
      <Flash ok={sp.ok} error={sp.error} />
      {needsMigration && <Flash error="Run migration 0019_fee_template_binding.sql so a template can be chosen for receipts, demand notices and statements." />}

      <Card title="What is used right now" icon="fees">
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
          {KINDS.map(([k, label, help]) => {
            const u = usedFor(k);
            return (
              <li key={k} className="rounded-[12px] border border-line p-3">
                <b className="text-ink">{label}</b>
                <p className="my-1 text-[13px]">{u ? <>“{u.name}” <Badge value="active" text="template" /></> : <><Badge value="cancelled" text="built-in layout" /></>}</p>
                <p className="m-0 text-[12px] text-muted">{help}</p>
                {canEdit && (
                  <form action={newFeeTemplate} className="mt-2"><input type="hidden" name="kind" value={k} />
                    <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">New blank design</button></form>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {list.length === 0 && (
        <Card title="No fee templates yet">
          <p className="mt-0 text-[14px]">Add the standard receipt, demand notice and statement, or pick a design from the gallery.</p>
          {canEdit && <form action={seedFeeTemplates}><Submit>Add standard fee templates</Submit></form>}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {list.map((t) => {
          const p = pv.get(t.id);
          return (
            <Card key={t.id} title={t.name} actions={<Badge value={t.active ? "active" : "cancelled"} text={t.active ? (t.fee_kind ? `Used for ${t.fee_kind === "receipt" ? "receipts" : t.fee_kind === "demand" ? "demand notices" : "statements"}` : "Not chosen") : "Switched off"} />}>
              <div className="mb-3 max-h-[300px] overflow-auto rounded-[10px] border border-line bg-white p-3 text-ink">
                {p?.html ? <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.html) }} /> : <p className="m-0 text-[13px] text-muted">The preview appears once there is a receipt / a student with dues.</p>}
              </div>
              {canEdit && !needsMigration && (
                <form action={setFeeTemplate} className="mb-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Use this template for
                    <select name="kind" defaultValue={t.fee_kind ?? ""} className="input !min-h-10 !py-2 text-[15px] font-normal">
                      <option value="">— not used —</option>
                      {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <button className="btn btn-sm btn-primary cursor-pointer border-0">Save</button>
                </form>
              )}
              <div className="flex flex-wrap gap-3">
                {canEdit && <Link href={`/app/documents/templates/${t.id}/design${t.design ? "" : "?start=1"}`} className="btn btn-sm btn-secondary">Design visually</Link>}
                <Link href={`/app/documents/templates/${t.id}`} className="btn btn-sm btn-secondary">{canEdit ? "HTML & settings" : "View"}</Link>
              </div>
            </Card>
          );
        })}
      </div>
      {list.length > 0 && <Empty>Fields such as {"{{fee.amount}}"}, {"{{fee.lines_html}}"} and {"{{student.name}}"} are listed in the designer. A document with no chosen template uses the built-in layout.</Empty>}
    </div>
  );
}
