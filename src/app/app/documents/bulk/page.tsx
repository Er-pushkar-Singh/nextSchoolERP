import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, PageHeader, Select, Submit } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { ClassSection } from "@/components/ClassSection";
import { getClasses } from "@/lib/erp";
import { sanitizeHtml, withPhoto } from "@/lib/html-sanitize";
import { withQr, withVerify } from "@/lib/qr";
import { withBarcode } from "@/lib/barcode";
import { signedPhotoUrls } from "@/lib/doc-photo";
import { getBranding, withBrand } from "@/lib/branding";
import { issueBulk } from "../../_actions/documents";

export default async function Bulk({ searchParams }: { searchParams: Promise<{ template?: string; class_id?: string; section_id?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("documents.issue.create");
  const sp = await searchParams;
  const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const [{ data: tpls }, classes] = await Promise.all([
    supabase.from("document_templates").select("id,name,audience,page_size,card_width_mm,card_height_mm,category").eq("school_id", school.id).eq("active", true).eq("one_per_student", false).order("name"),
    getClasses(supabase, school.id),
  ]);
  const T = tpls ?? [];
  const tpl = T.find((t) => t.id === uid(sp.template)) ?? null;
  const cls = uid(sp.class_id), sec = uid(sp.section_id);
  let docs: { id: string; html: string; student_id: string | null }[] = [];
  if (tpl && (tpl.audience === "staff" || cls)) {
    let q = supabase.from("issued_documents").select("id,html,student_id,students!inner(class_id,section_id,roll_no,first_name)").eq("school_id", school.id).eq("template_id", tpl.id).eq("status", "issued").limit(600);
    if (tpl.audience === "student") { q = q.eq("students.class_id", cls!); if (sec) q = q.eq("students.section_id", sec); }
    const { data } = tpl.audience === "student"
      ? await q
      : await supabase.from("issued_documents").select("id,html,student_id").eq("school_id", school.id).eq("template_id", tpl.id).eq("status", "issued").limit(600);
    docs = (data ?? []) as unknown as typeof docs;
  }
  const photos = await signedPhotoUrls(school.id, docs.map((d) => d.student_id).filter(Boolean) as string[]);
  const branding = await getBranding(supabase, school.id);
  const cw = tpl?.page_size === "card" ? `${tpl.card_width_mm ?? 86}mm` : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <PageHeader icon="academics" title="Issue in bulk & print sheets" subtitle="ID cards for a whole class or all staff — then print them on A4" back={{ href: "/app/documents", label: "Documents" }}
          actions={docs.length && can("documents.issue.print") ? <PrintButton /> : undefined} />
      </div>
      <div className="print:hidden"><Flash ok={sp.ok} error={sp.error} /></div>
      <Card title="Choose" className="print:hidden">
        <form className="flex flex-wrap items-end gap-3">
          <Select label="Template" name="template" blank="Select…" defaultValue={tpl?.id} options={T.map((t) => [t.id, `${t.name} (${t.audience})`] as [string, string])} />
          {(!tpl || tpl.audience === "student") && <ClassSection classes={classes} classId={cls} sectionId={sec} allowAll />}
          <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        </form>
        {tpl && (tpl.audience === "staff" || cls) && (
          <form action={issueBulk} className="mt-4 flex flex-wrap items-center gap-3">
            <input type="hidden" name="template_id" value={tpl.id} />
            {cls && <input type="hidden" name="class_id" value={cls} />}{sec && <input type="hidden" name="section_id" value={sec} />}
            <Submit>Issue for everyone who doesn&apos;t have one yet</Submit>
            <span className="text-[13px] text-muted">{docs.length} already issued here</span>
          </form>
        )}
      </Card>
      <style>{`@media print { @page { size: A4 portrait; margin: 8mm; } }`}</style>
      {docs.length ? (
        <div className="flex flex-wrap gap-[4mm] print:gap-[3mm]">
          {docs.map((d) => (
            <div key={d.id} className="break-inside-avoid" style={cw ? { width: cw } : { width: "100%" }}
              dangerouslySetInnerHTML={{ __html: withVerify(withBarcode(withBrand(withQr(withPhoto(sanitizeHtml(d.html), d.student_id ? photos.get(d.student_id) ?? null : null)), branding)), d.id) }} />
          ))}
        </div>
      ) : tpl ? <div className="print:hidden"><Empty>Nothing issued yet for this selection.</Empty></div> : null}
    </div>
  );
}
