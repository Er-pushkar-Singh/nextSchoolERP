import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { CATEGORIES } from "@/lib/documents";
import { seedTemplates } from "../../_actions/documents";

export default async function Templates({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("documents.templates.view");
  const sp = await searchParams;
  const { data } = await supabase.from("document_templates").select("id,code,name,category,audience,page_size,card_width_mm,card_height_mm,active,is_system,version,numbering_prefix,updated_at").eq("school_id", school.id).neq("category", "fees").order("category").order("name");
  const rows = data ?? [];
  const cat = new Map(CATEGORIES);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Templates" subtitle="The wording and layout of every document. Change a template and new documents use it; issued ones never change."
        back={{ href: "/app/documents", label: "Documents" }}
        actions={<>
          {can("documents.templates.create") && <form action={seedTemplates}><button className="btn btn-sm btn-secondary cursor-pointer">Add missing standard templates</button></form>}
          {can("documents.templates.create") && <Link href="/app/documents/templates/new" className="btn btn-sm btn-primary">New template</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      {rows.length ? (
        <Table head={["Template", "Type", "For", "Size", "Number prefix", "Version", "Status", ""]} minWidth={820}>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className={`${td} font-semibold text-ink`}><Link href={`/app/documents/templates/${t.id}`}>{t.name}</Link><div className="font-mono text-[12px] font-normal text-muted">{t.code}{t.is_system ? " · standard" : ""}</div></td>
              <td className={td}>{cat.get(t.category)}</td>
              <td className={`${td} capitalize`}>{t.audience}</td>
              <td className={td}>{t.page_size === "card" ? `${t.card_width_mm}×${t.card_height_mm} mm` : t.page_size}</td>
              <td className={`${td} font-mono`}>{t.numbering_prefix}</td>
              <td className={td}>v{t.version}</td>
              <td className={td}><Badge value={t.active ? "active" : "cancelled"} text={t.active ? "On" : "Off"} /></td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{can("documents.issue.create") && t.active && <Link href={t.audience === "student" ? `/app/documents/bulk?template=${t.id}` : `/app/documents/bulk?template=${t.id}`}>{t.category === "id_card" ? "Bulk" : ""}</Link>}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No templates. Use “Add missing standard templates”.</Empty>}
    </div>
  );
}
