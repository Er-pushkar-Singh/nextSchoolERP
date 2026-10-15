import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { cleanSearch, fmtDate, fullName } from "@/lib/format";
import { CERT_KINDS as KINDS } from "@/lib/certificates";

type Row = { id: string; kind: string; cert_no: string; issued_on: string; is_duplicate: boolean; status: string; student_id: string;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string; classes: { name: string } | { name: string }[] | null } | null };
const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function Certificates({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("students.certificates.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const kind = KINDS.some(([k]) => k === sp.kind) ? sp.kind! : null;
  const status = sp.status === "issued" || sp.status === "cancelled" ? sp.status : null;
  const dup = sp.dup === "yes" ? true : sp.dup === "no" ? false : null;
  const from = ok(sp.from), to = ok(sp.to);
  const q = cleanSearch(sp.q ?? "").trim();

  let list = supabase.from("student_certificates")
    .select("id,kind,cert_no,issued_on,is_duplicate,status,student_id,students(id,first_name,last_name,admission_no,classes!class_id(name))", { count: "exact" })
    .eq("school_id", school.id).order("created_at", { ascending: false }).range(offset, offset + size - 1);
  if (kind) list = list.eq("kind", kind);
  if (status) list = list.eq("status", status);
  if (dup !== null) list = list.eq("is_duplicate", dup);
  if (from) list = list.gte("issued_on", from);
  if (to) list = list.lte("issued_on", to);
  if (q) {
    const p = `%${q.replace(/[%_\\,()]/g, " ")}%`;
    const { data: ss } = await supabase.from("students").select("id").eq("school_id", school.id).or(`first_name.ilike.${p},last_name.ilike.${p},admission_no.ilike.${p},father_name.ilike.${p}`).limit(200);
    const ids = (ss ?? []).map((x) => x.id);
    list = list.or([`cert_no.ilike.${p}`, ids.length ? `student_id.in.(${ids.join(",")})` : null].filter(Boolean).join(","));
  }
  const [{ data: rows, count }, { count: all }, { count: tcs }] = await Promise.all([
    list,
    supabase.from("student_certificates").select("id", { count: "exact", head: true }).eq("school_id", school.id),
    supabase.from("student_certificates").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("kind", "tc").eq("status", "issued"),
  ]);
  const R = (rows ?? []) as unknown as Row[];
  const kn = new Map(KINDS);
  const params = { q: q || undefined, kind: kind ?? undefined, status: status ?? undefined, dup: sp.dup, from: from ?? undefined, to: to ?? undefined };
  const className = (c: Row["students"]) => { const x = c?.classes; return (Array.isArray(x) ? x[0] : x)?.name ?? "—"; };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Certificates" subtitle="Transfer (TC), bonafide, character and study certificates — numbered, printable, kept on record"
        actions={can("students.certificates.create") ? (
          <Modal label="+ Issue a certificate" title="Issue a certificate" size="sm">
            <form action="/app/certificates/new" method="get" className="grid gap-3">
              <EntityPicker kind="student" name="student" label="Student" required placeholder="Type name or admission no." />
              <Select label="Certificate" name="kind" options={KINDS.map(([k, t]) => [k, t] as [string, string])} />
              <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Continue</button></div>
            </form>
          </Modal>
        ) : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Issued (all time)" value={all ?? 0} icon="academics" tone="blue" />
        <Stat label="Transfer certificates" value={tcs ?? 0} icon="school" tone="violet" />
        <Stat label="Matching filters" value={count ?? 0} icon="notifications" tone="green" />
      </div>

      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Number, student, admission no." className="lg:col-span-2" />
        <Select label="Type" name="kind" blank="All" defaultValue={kind} options={KINDS} />
        <Select label="Status" name="status" blank="All" defaultValue={status} options={[["issued", "Issued"], ["cancelled", "Cancelled"]]} />
        <Select label="Duplicate" name="dup" blank="Any" defaultValue={sp.dup} options={[["yes", "Duplicates only"], ["no", "Originals only"]]} />
        <Input label="From" name="from" type="date" defaultValue={from ?? ""} />
        <Input label="To" name="to" type="date" defaultValue={to ?? ""} />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>

      {R.length ? (
        <Table head={["Number", "Type", "Student", "Class", "Issued", "Status", ""]} minWidth={820}>
          {R.map((c) => (
            <tr key={c.id}>
              <td className={`${td} font-mono text-[13px]`}><Link href={`/app/certificates/${c.id}`}>{c.cert_no}</Link></td>
              <td className={td}>{kn.get(c.kind)?.split(" (")[0]}{c.is_duplicate && <span className="ml-1 text-[12px] text-muted">duplicate</span>}</td>
              <td className={td}>{c.students ? <Link href={`/app/students/${c.students.id}`}>{fullName(c.students)}</Link> : "—"}<div className="text-[12px] text-muted">{c.students?.admission_no}</div></td>
              <td className={td}>{className(c.students)}</td>
              <td className={td}>{fmtDate(c.issued_on)}</td>
              <td className={td}><Badge value={c.status === "issued" ? "paid" : "cancelled"} text={c.status} /></td>
              <td className={`${td} text-[13px]`}>
                <div className="flex flex-wrap gap-3">
                  <Link href={`/app/certificates/${c.id}`}>Open / print</Link>
                  {c.students && <Link href={`/app/certificates?q=${encodeURIComponent(c.students.admission_no)}`}>All of this student</Link>}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || kind || status || from || to || dup !== null ? "No certificate matches these filters." : "No certificates issued yet."}</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/certificates" params={params} />
    </div>
  );
}
