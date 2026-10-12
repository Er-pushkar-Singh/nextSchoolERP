import { requirePerm } from "@/lib/school";
import { Flash, PageHeader } from "@/components/ui/ui";
import { TemplateEditor } from "@/components/TemplateEditor";

const START = `<div style="font-size:15px;line-height:1.9;padding:8px">
  <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:6px">
    <div style="font-size:22px;font-weight:800;text-transform:uppercase">{{school.name}}</div>
    <div style="font-size:12px">{{school.address}}, {{school.city}}</div>
  </div>
  <p style="text-align:right;font-size:13px">No.: <b>{{doc.no}}</b> &nbsp; Date: <b>{{doc.date}}</b></p>
  <h2 style="text-align:center;text-decoration:underline">TITLE</h2>
  <p>This is to certify that <b>{{student.name}}</b>, {{student.son_daughter}} of <b>{{student.father_name}}</b>, Class {{student.class_section}} …</p>
  <div style="margin-top:60px;text-align:right">Principal</div>
</div>`;

export default async function NewTemplate({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePerm("documents.templates.create");
  const sp = await searchParams;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="New template" back={{ href: "/app/documents/templates", label: "Templates" }} />
      <Flash error={sp.error} />
      <TemplateEditor t={{ body_html: START, numbering_prefix: "DOC", category: "certificate", audience: "student" }} canEdit canDelete={false} />
    </div>
  );
}
