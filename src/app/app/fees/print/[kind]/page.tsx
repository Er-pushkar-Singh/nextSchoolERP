import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { PrintButton } from "@/components/ui/PrintButton";
import { Empty, PageHeader } from "@/components/ui/ui";
import { sanitizeHtml } from "@/lib/html-sanitize";
import { getBranding, withBrand } from "@/lib/branding";
import { DocSheet } from "@/components/DocSheet";
import { todayIST } from "@/lib/format";

/**
 * Fee demand notice / fee statement from the school's template.
 *   /app/fees/print/demand?student=<id>            one notice
 *   /app/fees/print/demand?class_id=<id>&min=500   one notice per defaulter of a class (max 60 per print)
 *   /app/fees/print/statement?student=<id>
 */
export default async function PrintFeeDoc({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ student?: string; class_id?: string; min?: string }> }) {
  const { kind } = await params;
  if (kind !== "demand" && kind !== "statement") notFound();
  const sp = await searchParams;
  const { supabase, school, session } = await requirePerm("fees.defaulters.view", "fees.collection.view");
  const ok = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  let ids: string[] = [];
  if (ok(sp.student)) ids = [sp.student!];
  else if (kind === "demand" && session) {
    const { data } = await supabase.rpc("defaulters", { sid: school.id, sess: session.id, on_day: todayIST(), cls: ok(sp.class_id), min_amount: Math.max(1, Number(sp.min) || 1) }).limit(60);
    ids = ((data ?? []) as { student_id: string }[]).map((d) => d.student_id);
  }
  const docs = (await Promise.all(ids.map(async (id) => {
    const { data } = await supabase.rpc("render_fee_document", { p_kind: kind, subject: id });
    return (data as { html: string; page_size: string } | null) ?? null;
  }))).filter(Boolean) as { html: string; page_size: string }[];

  const branding = await getBranding(supabase, school.id);

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <PageHeader icon="fees" title={kind === "demand" ? "Fee demand notices" : "Fee statement"} subtitle={`${docs.length} document(s)`} back={{ href: kind === "demand" ? "/app/fees/defaulters" : "/app/fees", label: "Fees" }} actions={docs.length ? <PrintButton /> : undefined} />
      </div>
      {docs.length === 0 ? (
        <Empty>Nothing to print. {kind === "demand" ? "Nobody has dues for these filters, or the fee demand template is switched off (Fees → Templates)." : "The statement template is switched off (Fees → Templates)."}</Empty>
      ) : docs.map((d, i) => (
        <DocSheet key={i} branding={branding} logoUrl={school.logo_url} schoolName={school.name}
          className={`mx-auto w-full rounded-[12px] border border-line bg-white print:max-w-none print:break-after-page print:border-0 ${d.page_size === "A5" ? "max-w-[560px]" : "max-w-[794px]"}`}>
          <article className="p-8 text-ink print:p-0" dangerouslySetInnerHTML={{ __html: withBrand(sanitizeHtml(d.html), branding) }} />
        </DocSheet>
      ))}
    </div>
  );
}
