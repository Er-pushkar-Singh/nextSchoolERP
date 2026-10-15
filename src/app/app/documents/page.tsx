import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { addDays, cleanSearch, fmtDate, fullName, todayIST } from "@/lib/format";
import { CATEGORIES } from "@/lib/documents";
import { seedTemplates } from "../_actions/documents";

type Tpl = { id: string; code: string; name: string; category: string; audience: string; active: boolean; page_size: string };
type Issued = { id: string; doc_no: string; template_name: string; template_code: string; category: string; status: string; issued_on: string; is_duplicate: boolean; student_id: string | null; staff_id: string | null;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string } | null; staff: { id: string; name: string; emp_code: string | null } | null };
const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function Documents({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("documents.issue.view", "documents.templates.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = cleanSearch(sp.q ?? "").trim();
  const canIssue = can("documents.issue.create");
  const from = ok(sp.from), to = ok(sp.to);
  const category = CATEGORIES.some(([k]) => k === sp.category) ? sp.category! : null;
  const status = sp.status === "issued" || sp.status === "cancelled" ? sp.status : null;
  const studentId = sp.student && /^[0-9a-f-]{36}$/.test(sp.student) ? sp.student : null;
  const template = sp.template && /^[a-z0-9_]+$/.test(sp.template) ? sp.template : null;
  const { data: tplRows } = await supabase.from("document_templates").select("id,code,name,category,audience,active,page_size").eq("school_id", school.id).neq("category", "fees").order("category").order("name");
  const T = (tplRows ?? []) as Tpl[];

  let list = supabase.from("issued_documents")
    .select("id,doc_no,template_name,template_code,category,status,issued_on,is_duplicate,student_id,staff_id,students(id,first_name,last_name,admission_no),staff(id,name,emp_code)", { count: "exact" })
    .eq("school_id", school.id).order("created_at", { ascending: false }).range(offset, offset + size - 1);
  if (template) list = list.eq("template_code", template);
  if (category) list = list.eq("category", category);
  if (status) list = list.eq("status", status);
  if (studentId) list = list.eq("student_id", studentId);
  if (from) list = list.gte("issued_on", from);
  if (to) list = list.lte("issued_on", to);
  if (q) {
    const p = `%${q.replace(/[%_\\,()]/g, " ")}%`;
    const [{ data: ss }, { data: ff }] = await Promise.all([
      supabase.from("students").select("id").eq("school_id", school.id).or(`first_name.ilike.${p},last_name.ilike.${p},admission_no.ilike.${p}`).limit(100),
      supabase.from("staff").select("id").eq("school_id", school.id).or(`name.ilike.${p},emp_code.ilike.${p}`).limit(100),
    ]);
    const parts = [`doc_no.ilike.${p}`, (ss ?? []).length ? `student_id.in.(${(ss ?? []).map((x) => x.id).join(",")})` : null, (ff ?? []).length ? `staff_id.in.(${(ff ?? []).map((x) => x.id).join(",")})` : null].filter(Boolean).join(",");
    list = list.or(parts);
  }
  const [{ data: issued, count }, { count: total }, { count: month }] = await Promise.all([
    list,
    supabase.from("issued_documents").select("id", { count: "exact", head: true }).eq("school_id", school.id),
    supabase.from("issued_documents").select("id", { count: "exact", head: true }).eq("school_id", school.id).gte("created_at", addDays(todayIST(), -30)),
  ]);
  const I = (issued ?? []) as unknown as Issued[];
  const stuTpl = T.filter((t) => t.audience === "student" && t.active);
  const stfTpl = T.filter((t) => t.audience === "staff" && t.active);
  const catName = new Map(CATEGORIES);
  const params = { q: q || undefined, template: template ?? undefined, category: category ?? undefined, status: status ?? undefined, from: from ?? undefined, to: to ?? undefined, student: studentId ?? undefined };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Documents" subtitle="TC, bonafide, ID cards, letters — each from a template you control"
        actions={<>
          {canIssue && T.length > 0 && (
            <Modal label="+ Issue a document" title="Issue a document">
              <div className="grid gap-6">
                <form action="/app/documents/issue" method="get" className="grid gap-3">
                  <h3 className="m-0 text-[15px] font-bold text-ink">For a student</h3>
                  <Select label="Document" name="template" options={stuTpl.map((t) => [t.id, t.name] as [string, string])} />
                  <EntityPicker kind="student" name="student" label="Student" required placeholder="Type name or admission no." />
                  <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Continue</button></div>
                </form>
                <form action="/app/documents/issue" method="get" className="grid gap-3 border-t border-line pt-4">
                  <h3 className="m-0 text-[15px] font-bold text-ink">For a staff member</h3>
                  <Select label="Document" name="template" options={stfTpl.map((t) => [t.id, t.name] as [string, string])} />
                  <EntityPicker kind="staff" name="staff" label="Staff member" required placeholder="Type name or employee code" />
                  <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Continue</button></div>
                </form>
              </div>
            </Modal>
          )}
          {can("documents.issue.create") && <Link href="/app/documents/bulk" className="btn btn-sm btn-secondary">ID cards in bulk</Link>}
          {can("documents.templates.view") && <Link href="/app/documents/templates" className="btn btn-sm btn-secondary">Manage templates</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Templates" value={T.filter((t) => t.active).length} hint={`${T.length} in all`} icon="layers" />
        <Stat label="Issued (all time)" value={total ?? 0} icon="academics" tone="cyan" />
        <Stat label="Issued (30 days)" value={month ?? 0} icon="revenue" tone="green" />
        <Stat label="Matching filters" value={count ?? 0} icon="notifications" tone="violet" />
      </div>

      {T.length === 0 && (
        <Card title="No templates yet" icon="layers">
          <p className="mt-0 text-[14px]">Add the standard set — TC, bonafide, character, study, no-dues, admission letter, student and staff ID cards, experience certificate — then edit them to match your school.</p>
          {can("documents.templates.create") && <form action={seedTemplates}><button className="btn btn-primary cursor-pointer border-0">Add standard templates</button></form>}
        </Card>
      )}

      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Doc no., student, staff" className="lg:col-span-2" />
        <Select label="Template" name="template" blank="All" defaultValue={template} options={T.map((t) => [t.code, t.name] as [string, string])} />
        <Select label="Category" name="category" blank="All" defaultValue={category} options={CATEGORIES.map(([k, l]) => [k, l] as [string, string])} />
        <Select label="Status" name="status" blank="All" defaultValue={status} options={[["issued", "Issued"], ["cancelled", "Cancelled"]]} />
        <Input label="From" name="from" type="date" defaultValue={from ?? ""} />
        <Input label="To" name="to" type="date" defaultValue={to ?? ""} />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>

      {I.length ? (
        <Table head={["Number", "Document", "Issued to", "Date", "Status", ""]} minWidth={860}>
          {I.map((d) => (
            <tr key={d.id}>
              <td className={`${td} font-mono text-[13px]`}><Link href={`/app/documents/${d.id}`}>{d.doc_no}</Link></td>
              <td className={td}>{d.template_name}{d.is_duplicate && <span className="ml-1 text-[12px] text-muted">duplicate</span>}<div className="text-[12px] text-muted">{catName.get(d.category)}</div></td>
              <td className={td}>{d.students ? <Link href={`/app/students/${d.students.id}`}>{fullName(d.students)}</Link> : d.staff ? <Link href={`/app/hr/staff/${d.staff.id}`}>{d.staff.name}</Link> : "—"}<div className="text-[12px] text-muted">{d.students?.admission_no ?? d.staff?.emp_code ?? ""}</div></td>
              <td className={td}>{fmtDate(d.issued_on)}</td>
              <td className={td}><Badge value={d.status === "issued" ? "paid" : "cancelled"} text={d.status} /></td>
              <td className={`${td} text-[13px]`}>
                <div className="flex flex-wrap gap-3">
                  <Link href={`/app/documents/${d.id}`}>Open / print</Link>
                  {d.students && <Link href={`/app/documents?student=${d.students.id}`}>All of this student</Link>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || template || category || status || from || to || studentId ? "No document matches these filters." : "No documents issued yet."}</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/documents" params={params} />
      <p className="m-0 text-[12px] text-muted">Certificates issued before templates were introduced are under <Link href="/app/certificates">Old-format certificates</Link>.</p>
    </div>
  );
}
