import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Flash, PageHeader, Submit } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate } from "@/lib/format";
import { sanitizeHtml, withPhoto } from "@/lib/html-sanitize";
import { withQr } from "@/lib/qr";
import { signedPhotoUrls } from "@/lib/doc-photo";
import { getBranding, withBrand } from "@/lib/branding";
import { DocSheet } from "@/components/DocSheet";
import { cancelDocument } from "../../_actions/documents";

export default async function IssuedDocument({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("documents.issue.view");
  const sp = await searchParams;
  const { data: d } = await supabase.from("issued_documents").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!d) notFound();
  const photos = d.student_id ? await signedPhotoUrls(school.id, [d.student_id]) : new Map<string, string>();
  const branding = await getBranding(supabase, school.id);
  const html = withBrand(withQr(withPhoto(sanitizeHtml(d.html), d.student_id ? photos.get(d.student_id) ?? null : null)), branding);
  const width = d.page_size === "card" ? `${d.card_width_mm ?? 86}mm` : d.page_size === "A5" ? "148mm" : "210mm";
  const cancelled = d.status === "cancelled";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="print:hidden">
        <PageHeader icon="academics" title={`${d.template_name} · ${d.doc_no}`} back={{ href: "/app/documents", label: "Documents" }}
          subtitle={<>Issued {fmtDate(d.issued_on)}{d.issued_by_name ? ` by ${d.issued_by_name}` : ""} · template v{d.template_version}{d.valid_until ? ` · valid until ${fmtDate(d.valid_until)}` : ""}{cancelled ? " · CANCELLED" : ""}</>}
          actions={can("documents.issue.print") && !cancelled ? <PrintButton /> : undefined} />
        <Flash ok={sp.ok} error={sp.error} />
      </div>
      <style>{`@media print { @page { size: ${d.page_size === "card" ? `${d.card_width_mm ?? 86}mm ${d.card_height_mm ?? 54}mm` : `${d.page_size === "A5" ? "A5" : "A4"} ${d.orientation}`}; margin: ${d.page_size === "card" ? "0" : "12mm"}; } }`}</style>
      <div className="relative overflow-x-auto rounded-[12px] border border-line bg-[#f4f6fb] p-4 print:border-0 print:bg-white print:p-0">
        <div className="relative mx-auto bg-white p-4 shadow print:p-0 print:shadow-none" style={{ width, maxWidth: "100%" }}>
          {cancelled && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[70px] font-extrabold tracking-widest text-[#e11d48]/25 select-none">CANCELLED</div>}
          {d.is_duplicate && <p className="m-0 text-right text-[12px] font-bold tracking-widest">DUPLICATE</p>}
          <DocSheet branding={d.page_size === "card" ? { ...branding, watermark_mode: "none" } : branding} logoUrl={school.logo_url} schoolName={school.name}>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </DocSheet>
        </div>
      </div>
      {!cancelled && can("documents.issue.approve") && (
        <form action={cancelDocument} className="flex flex-wrap items-end gap-2 print:hidden">
          <input type="hidden" name="id" value={id} />
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Cancel this document — reason<input name="reason" required className="input !min-h-10 !py-2 text-[15px] font-normal" /></label>
          <Submit variant="secondary">Cancel document</Submit>
        </form>
      )}
      {cancelled && <p className="m-0 text-[13px] text-error print:hidden">Cancelled: {d.cancelled_reason}</p>}
      <p className="m-0 text-[12px] text-muted print:hidden">
        {d.student_id && <Link href={`/app/students/${d.student_id}`}>Student page</Link>}{d.staff_id && <Link href="/app/hr">Staff</Link>}
      </p>
    </div>
  );
}
