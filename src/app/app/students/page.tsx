import Link from "next/link";
import { requireSchool } from "@/lib/school";
import { ButtonLink, Badge, Empty, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { cleanSearch, fullName } from "@/lib/format";
import { getClasses } from "@/lib/erp";

const PAGE = 50;

export default async function Students({ searchParams }: { searchParams: Promise<{ q?: string; class_id?: string; status?: string; page?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requireSchool();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const classes = await getClasses(supabase, school.id);
  const status = ["active", "left", "passed_out"].includes(sp.status ?? "") ? sp.status! : "active";
  let query = supabase.from("students")
    .select("id,admission_no,first_name,last_name,roll_no,father_name,guardian_phone,status,classes(name,sort),sections(name)", { count: "exact" })
    .eq("school_id", school.id).eq("status", status);
  if (sp.class_id && /^[0-9a-f-]{36}$/.test(sp.class_id)) query = query.eq("class_id", sp.class_id);
  const q = cleanSearch(sp.q ?? "").trim();
  if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,admission_no.ilike.%${q}%,guardian_phone.ilike.%${q}%,father_name.ilike.%${q}%`);
  const { data, count } = await query.order("first_name").range((page - 1) * PAGE, page * PAGE - 1);
  const rows = (data ?? []) as unknown as { id: string; admission_no: string; first_name: string; last_name: string | null; roll_no: number | null; father_name: string | null; guardian_phone: string | null; status: string; classes: { name: string } | null; sections: { name: string } | null }[];
  const canWrite = can("students.profile.create");
  const qs = (p: number) => `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.class_id ? { class_id: sp.class_id } : {}), status, page: String(p) })}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="students" title="Students" subtitle={`${count ?? 0} ${status.replace("_", " ")}`} actions={canWrite && <>
        {can("students.import.create") && <ButtonLink href="/app/students/import" variant="secondary">Import CSV</ButtonLink>}
        <ButtonLink href="/app/students/new">New admission</ButtonLink>
      </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Name, admission no., phone…" className="input !min-h-10 max-w-xs !py-2" aria-label="Search" />
        <select name="class_id" defaultValue={sp.class_id ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Class">
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
        </select>
        <select name="status" defaultValue={status} className="input !min-h-10 !w-auto !py-2" aria-label="Status">
          <option value="active">Active</option><option value="left">Left</option><option value="passed_out">Passed out</option>
        </select>
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
      </form>
      {rows.length ? (
        <Table head={["Adm. no.", "Name", "Class", "Roll", "Father", "Phone", ""]}>
          {rows.map((s) => (
            <tr key={s.id}>
              <td className={`${td} font-mono text-[13px]`}>{s.admission_no}</td>
              <td className={td}><Link href={`/app/students/${s.id}`} className="font-semibold">{fullName(s)}</Link></td>
              <td className={td}>{s.classes ? `${s.classes.name}-${s.sections?.name ?? ""}` : "—"}</td>
              <td className={td}>{s.roll_no ?? "—"}</td>
              <td className={td}>{s.father_name ?? "—"}</td>
              <td className={td}>{s.guardian_phone ?? "—"}</td>
              <td className={td}>{s.status !== "active" && <Badge value={s.status} />}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>No students found. {canWrite && <><Link href="/app/students/new">Admit one</Link> or <Link href="/app/students/import">import your list from Excel</Link>.</>}</Empty>
      )}
      {(count ?? 0) > PAGE && (
        <div className="flex items-center gap-3 text-[14px]">
          {page > 1 && <Link href={qs(page - 1)}>← Previous</Link>}
          <span className="text-muted">Page {page} of {Math.ceil((count ?? 0) / PAGE)}</span>
          {page * PAGE < (count ?? 0) && <Link href={qs(page + 1)}>Next →</Link>}
        </div>
      )}
    </div>
  );
}
