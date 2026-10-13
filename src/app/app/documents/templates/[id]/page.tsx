import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { TemplateEditor, type Tpl } from "@/components/TemplateEditor";
import { fmtDate } from "@/lib/format";
import { sanitizeHtml, withPhoto } from "@/lib/html-sanitize";
import { cleanSearch, fullName } from "@/lib/format";
import { restoreVersion } from "../../../_actions/documents";

export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ student?: string; staff?: string; q?: string; ok?: string; error?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("documents.templates.view");
  const sp = await searchParams;
  const { data: t } = await supabase.from("document_templates").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!t) notFound();
  const staffTpl = t.audience === "staff";
  const q = cleanSearch(sp.q ?? "").trim();
  const [{ data: versions }, { data: pick }, { data: sampleStu }, { data: sampleStf }] = await Promise.all([
    supabase.from("document_template_versions").select("id,version,name,changed_at").eq("template_id", id).order("version", { ascending: false }).limit(15),
    q ? (staffTpl
      ? supabase.from("staff").select("id,name").eq("school_id", school.id).ilike("name", `%${q}%`).limit(8)
      : supabase.from("students").select("id,first_name,last_name,admission_no").eq("school_id", school.id).or(`first_name.ilike.%${q}%,admission_no.ilike.${q}%`).limit(8))
      : Promise.resolve({ data: [] }),
    staffTpl ? Promise.resolve({ data: null }) : supabase.from("students").select("id").eq("school_id", school.id).eq("status", "active").order("created_at").limit(1).maybeSingle(),
    staffTpl ? supabase.from("staff").select("id").eq("school_id", school.id).eq("status", "active").order("created_at").limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const stu = staffTpl ? null : sp.student && /^[0-9a-f-]{36}$/.test(sp.student) ? sp.student : sampleStu?.id ?? null;
  const stf = staffTpl ? (sp.staff && /^[0-9a-f-]{36}$/.test(sp.staff) ? sp.staff : sampleStf?.id ?? null) : null;
  let preview: string | null = null;
  let previewError: string | null = null;
  if (t.category === "fees") {
    const { data, error } = await supabase.rpc("preview_fee_template", { tpl: id });
    if (error) previewError = error.message;
    else preview = (data as { html?: string } | null)?.html ? sanitizeHtml(String((data as { html: string }).html)) : null;
    if (!preview && !error) previewError = "Preview appears once the school has a receipt (receipt template) or a student with dues (demand / statement).";
  } else if (stu || stf) {
    const { data, error } = await supabase.rpc("preview_document", { tpl: id, stu, stf });
    if (error) previewError = error.message; else preview = withPhoto(sanitizeHtml(String(data ?? "")), null);
  }
  const w = t.page_size === "card" ? `${t.card_width_mm}mm` : t.page_size === "A5" ? "148mm" : "210mm";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title={t.name} subtitle={<>Version {t.version} · <span className="font-mono">{t.code}</span>{t.is_system ? " · standard template" : ""}</>} back={t.category === "fees" ? { href: "/app/fees/templates", label: "Fee templates" } : { href: "/app/documents/templates", label: "Templates" }}
        actions={can("documents.issue.create") && t.active ? <Link href={`/app/documents/bulk?template=${id}`} className="btn btn-sm btn-secondary">Issue in bulk</Link> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <TemplateEditor t={t as unknown as Tpl} canEdit={can("documents.templates.edit")} canDelete={can("documents.templates.delete")} />

      <Card title="Preview" icon="school" description="Rendered with real data from the school's records (nothing is issued).">
        <form className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Preview with<input name="q" defaultValue={sp.q} placeholder={staffTpl ? "Staff name" : "Student name or admission no."} className="input !min-h-10 !py-2 text-[15px] font-normal" /></label>
          <button className="btn btn-sm btn-secondary cursor-pointer">Search</button>
        </form>
        {(pick ?? []).length > 0 && (
          <p className="mt-0 mb-3 flex flex-wrap gap-3 text-[13px]">
            {(pick ?? []).map((p) => {
              const r = p as unknown as { id: string; name?: string; first_name?: string; last_name?: string | null; admission_no?: string };
              return <Link key={r.id} href={`/app/documents/templates/${id}?${staffTpl ? "staff" : "student"}=${r.id}`}>{staffTpl ? r.name : `${fullName({ first_name: r.first_name ?? "", last_name: r.last_name })} (${r.admission_no})`}</Link>;
            })}
          </p>
        )}
        {previewError ? <p className="m-0 text-[14px] text-error">{previewError}</p>
          : preview ? (
            <div className="overflow-x-auto rounded-lg border border-line bg-[#f4f6fb] p-4">
              <div className="mx-auto bg-white p-4 shadow" style={{ width: w, maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: preview }} />
            </div>
          ) : <p className="m-0 text-[14px] text-muted">Add a {staffTpl ? "staff member" : "student"} to preview.</p>}
      </Card>

      <Card title="Version history" icon="notifications" description="Every change is kept. Documents already issued keep the version they were made with.">
        <Table head={["Version", "Saved", "Name", ""]} minWidth={420}>
          {(versions ?? []).map((v) => (
            <tr key={v.id}>
              <td className={td}>v{v.version}{v.version === t.version && <span className="ml-1 text-[12px] text-muted">current</span>}</td>
              <td className={td}>{fmtDate(v.changed_at)}</td><td className={`${td} text-[13px]`}>{v.name}</td>
              <td className={td}>{v.version !== t.version && can("documents.templates.edit") && (
                <form action={restoreVersion}><input type="hidden" name="id" value={id} /><input type="hidden" name="version_id" value={v.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Restore</button></form>
              )}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
