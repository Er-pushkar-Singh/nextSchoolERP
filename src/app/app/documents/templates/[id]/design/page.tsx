import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader } from "@/components/ui/ui";
import { TemplateDesigner } from "@/components/TemplateDesigner";
import { normalizeDesign } from "@/lib/design";
import { saveDesign } from "../../../../_actions/templates";

export default async function DesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ start?: string; ok?: string; error?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("documents.templates.view");
  const sp = await searchParams;
  const { data: t } = await supabase.from("document_templates").select("id,name,category,design,page_size,orientation,card_width_mm,card_height_mm,body_html,version,school_id")
    .eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!t) notFound();
  const back = t.category === "fees" ? "/app/fees/templates" : "/app/templates";
  const canEdit = can("documents.templates.edit");

  // a template written as HTML has no canvas yet: ask before replacing its layout
  if (!t.design && sp.start !== "1") {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader icon="academics" title={t.name} back={{ href: back, label: "Templates" }} />
        <Card title="This template was written as HTML">
          <p className="mt-0 text-[14px]">Opening the visual designer starts with an empty canvas; saving it replaces the HTML layout (the old layout stays in the version history and can be restored).</p>
          <div className="flex flex-wrap gap-3">
            {canEdit && <Link href={`/app/documents/templates/${id}/design?start=1`} className="btn btn-primary">Design it visually</Link>}
            <Link href={`/app/documents/templates/${id}`} className="btn btn-secondary">Keep editing the HTML</Link>
          </div>
        </Card>
      </div>
    );
  }
  const d = t.design
    ? normalizeDesign(t.design)
    : normalizeDesign({ v: 1, w: t.page_size === "card" ? t.card_width_mm ?? 86 : t.page_size === "A5" ? (t.orientation === "landscape" ? 210 : 148) : t.orientation === "landscape" ? 297 : 210,
        h: t.page_size === "card" ? t.card_height_mm ?? 54 : t.page_size === "A5" ? (t.orientation === "landscape" ? 148 : 210) : t.orientation === "landscape" ? 210 : 297, bg: "#ffffff", items: [] });

  return (
    <div className="flex flex-col gap-3">
      <Flash ok={sp.ok} error={sp.error} />
      {canEdit ? (
        <TemplateDesigner initial={d} name={t.name} templateId={id} action={saveDesign} backHref={back} />
      ) : <Card title="View only">You can view this template but not change it.</Card>}
      <p className="m-0 text-[12px] text-muted">
        <Link href={`/app/documents/templates/${id}`}>Settings, questions and HTML</Link> · the design is compiled to HTML when you save; fields such as <code>{"{{student.name}}"}</code> are filled from the school&apos;s records.
      </p>
    </div>
  );
}
