import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Table, td } from "@/components/ui/ui";
import { addDays, cleanSearch, fmtDate, fullName, todayIST } from "@/lib/format";
import { CATEGORIES } from "@/lib/documents";
import { seedTemplates } from "../_actions/documents";

type Tpl = { id: string; code: string; name: string; category: string; audience: string; active: boolean; page_size: string };
type Issued = { id: string; doc_no: string; template_name: string; category: string; status: string; issued_on: string; is_duplicate: boolean;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string } | null; staff: { id: string; name: string; emp_code: string | null } | null };

export default async function Documents({ searchParams }: { searchParams: Promise<{ q?: string; find?: string; template?: string; status?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("documents.issue.view", "documents.templates.view");
  const sp = await searchParams;
  const q = cleanSearch(sp.find ?? "").trim();
  const search = cleanSearch(sp.q ?? "").trim();
  const canIssue = can("documents.issue.create");
  const { data: tplRows } = await supabase.from("document_templates").select("id,code,name,category,audience,active,page_size").eq("school_id", school.id).neq("category", "fees").order("category").order("name");
  const T = (tplRows ?? []) as Tpl[];
  let list = supabase.from("issued_documents")
    .select("id,doc_no,template_name,category,status,issued_on,is_duplicate,students(id,first_name,last_name,admission_no),staff(id,name,emp_code)")
    .eq("school_id", school.id).order("created_at", { ascending: false }).limit(60);
  if (sp.template && /^[a-z0-9_]+$/.test(sp.template)) list = list.eq("template_code", sp.template);
  if (sp.status === "issued" || sp.status === "cancelled") list = list.eq("status", sp.status);
  if (search) list = list.ilike("doc_no", `%${search}%`);
  const [{ data: issued }, found, { count: total }, { count: month }] = await Promise.all([
    list,
    q && canIssue
      ? Promise.all([
          supabase.from("students").select("id,first_name,last_name,admission_no,father_name,classes!class_id(name),sections(name)").eq("school_id", school.id)
            .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,admission_no.ilike.${q}%,father_name.ilike.%${q}%`).order("first_name").limit(10),
          supabase.from("staff").select("id,name,emp_code,designation").eq("school_id", school.id).or(`name.ilike.%${q}%,emp_code.ilike.${q}%`).order("name").limit(10),
        ])
      : Promise.resolve(null),
    supabase.from("issued_documents").select("id", { count: "exact", head: true }).eq("school_id", school.id),
    supabase.from("issued_documents").select("id", { count: "exact", head: true }).eq("school_id", school.id).gte("created_at", addDays(todayIST(), -30)),
  ]);
  const I = (issued ?? []) as unknown as Issued[];
  const stuTpl = T.filter((t) => t.audience === "student" && t.active);
  const stfTpl = T.filter((t) => t.audience === "staff" && t.active);
  const students = (found?.[0].data ?? []) as unknown as { id: string; first_name: string; last_name: string | null; admission_no: string; father_name: string | null; classes: { name: string } | null; sections: { name: string } | null }[];
  const staff = (found?.[1].data ?? []) as unknown as { id: string; name: string; emp_code: string | null; designation: string | null }[];
  const catName = new Map(CATEGORIES);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Documents & templates" subtitle="TC, bonafide, ID cards, letters — each from a template you control"
        actions={<>
          {can("documents.issue.create") && <Link href="/app/documents/bulk" className="btn btn-sm btn-secondary">ID cards in bulk</Link>}
          {can("documents.templates.view") && <Link href="/app/documents/templates" className="btn btn-sm btn-primary">Manage templates</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Templates" value={T.filter((t) => t.active).length} hint={`${T.length} in all`} icon="layers" />
        <Stat label="Issued (all time)" value={total ?? 0} icon="academics" tone="cyan" />
        <Stat label="Issued (30 days)" value={month ?? 0} icon="revenue" tone="green" />
        <Stat label="Cancelled" value={I.filter((i) => i.status === "cancelled").length} hint="in the list below" icon="notifications" tone="rose" />
      </div>

      {T.length === 0 && (
        <Card title="No templates yet" icon="layers">
          <p className="mt-0 text-[14px]">Add the standard set — TC, bonafide, character, study, no-dues, admission letter, student and staff ID cards, experience certificate — then edit them to match your school.</p>
          {can("documents.templates.create") && <form action={seedTemplates}><button className="btn btn-primary cursor-pointer border-0">Add standard templates</button></form>}
        </Card>
      )}

      {canIssue && T.length > 0 && (
        <Card title="Issue a document" icon="academics">
          <form className="flex flex-wrap items-end gap-2">
            <Input label="Find student or staff" name="find" defaultValue={sp.find} placeholder="Name, admission no., father, employee code" />
            <button className="btn btn-sm btn-secondary cursor-pointer">Find</button>
          </form>
          {q && !students.length && !staff.length && <p className="mt-3 mb-0 text-[14px] text-muted">Nobody matches “{q}”.</p>}
          {students.length > 0 && (
            <ul className="m-0 mt-3 list-none p-0 text-[14px]">
              {students.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 first:border-0">
                  <span><b className="text-ink">{fullName(s)}</b> <span className="text-muted">· {s.admission_no} · Class {s.classes?.name}{s.sections ? `-${s.sections.name}` : ""} · {s.father_name ?? ""}</span></span>
                  <span className="flex flex-wrap gap-3">{stuTpl.map((t) => <Link key={t.id} href={`/app/documents/issue?template=${t.id}&student=${s.id}`} className="text-[13px]">{t.name.replace(/ \(.*\)/, "")}</Link>)}</span>
                </li>
              ))}
            </ul>
          )}
          {staff.length > 0 && (
            <ul className="m-0 mt-3 list-none p-0 text-[14px]">
              {staff.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 first:border-0">
                  <span><b className="text-ink">{s.name}</b> <span className="text-muted">· {s.emp_code ?? ""} · {s.designation ?? ""}</span></span>
                  <span className="flex flex-wrap gap-3">{stfTpl.map((t) => <Link key={t.id} href={`/app/documents/issue?template=${t.id}&staff=${s.id}`} className="text-[13px]">{t.name.replace(/ \(.*\)/, "")}</Link>)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <form className="flex flex-wrap items-end gap-2">
        <Input label="Document no." name="q" defaultValue={sp.q} placeholder="TC/2026-27/0001" />
        <Select label="Template" name="template" blank="All" defaultValue={sp.template} options={T.map((t) => [t.code, t.name] as [string, string])} />
        <Select label="Status" name="status" blank="All" defaultValue={sp.status} options={[["issued", "Issued"], ["cancelled", "Cancelled"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {I.length ? (
        <Table head={["Number", "Document", "Issued to", "Date", "Status"]} minWidth={720}>
          {I.map((d) => (
            <tr key={d.id}>
              <td className={`${td} font-mono text-[13px]`}><Link href={`/app/documents/${d.id}`}>{d.doc_no}</Link></td>
              <td className={td}>{d.template_name}{d.is_duplicate && <span className="ml-1 text-[12px] text-muted">duplicate</span>}<div className="text-[12px] text-muted">{catName.get(d.category)}</div></td>
              <td className={td}>{d.students ? <Link href={`/app/students/${d.students.id}`}>{fullName(d.students)}</Link> : d.staff ? d.staff.name : "—"}<div className="text-[12px] text-muted">{d.students?.admission_no ?? d.staff?.emp_code ?? ""}</div></td>
              <td className={td}>{fmtDate(d.issued_on)}</td>
              <td className={td}><Badge value={d.status === "issued" ? "paid" : "cancelled"} text={d.status} /></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No documents issued yet.</Empty>}
      <p className="m-0 text-[12px] text-muted">Certificates issued before templates were introduced are under <Link href="/app/certificates">Old-format certificates</Link>.</p>
    </div>
  );
}
