import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Table, td } from "@/components/ui/ui";
import { cleanSearch, fmtDate, fullName } from "@/lib/format";
import { CERT_KINDS as KINDS } from "@/lib/certificates";

type Row = { id: string; kind: string; cert_no: string; issued_on: string; is_duplicate: boolean; status: string; students: { id: string; first_name: string; last_name: string | null; admission_no: string; classes: { name: string } | null } | null };
type Stu = { id: string; first_name: string; last_name: string | null; admission_no: string; father_name: string | null; classes: { name: string } | null; sections: { name: string } | null };

export default async function Certificates({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("students.certificates.view");
  const sp = await searchParams;
  const kind = KINDS.some(([k]) => k === sp.kind) ? sp.kind! : null;
  const q = cleanSearch(sp.q ?? "").trim();
  let list = supabase.from("student_certificates").select("id,kind,cert_no,issued_on,is_duplicate,status,students(id,first_name,last_name,admission_no,classes!class_id(name))")
    .eq("school_id", school.id).order("created_at", { ascending: false }).limit(100);
  if (kind) list = list.eq("kind", kind);
  const [{ data: rows }, found] = await Promise.all([
    list,
    q && can("students.certificates.create")
      ? supabase.from("students").select("id,first_name,last_name,admission_no,father_name,classes!class_id(name),sections(name)").eq("school_id", school.id)
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,admission_no.ilike.${q}%,father_name.ilike.%${q}%`).order("first_name").limit(15).then((r) => (r.data ?? []) as unknown as Stu[])
      : Promise.resolve([] as Stu[]),
  ]);
  const R = (rows ?? []) as unknown as Row[];
  const kn = new Map(KINDS);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Certificates" subtitle="Transfer (TC), bonafide, character and study certificates — numbered, printable, kept on record" />
      <Flash ok={sp.ok} error={sp.error} />
      {can("students.certificates.create") && (
        <section className="rounded-[14px] border border-line bg-white p-5 shadow-[var(--shadow-card)]">
          <h2 className="m-0 mb-3 text-[16px] font-bold text-ink">Issue a certificate</h2>
          <form className="flex flex-wrap items-end gap-2">
            <Input label="Find student" name="q" defaultValue={sp.q} placeholder="Name, admission no. or father" />
            <button className="btn btn-sm btn-secondary cursor-pointer">Find</button>
          </form>
          {q && (found.length ? (
            <ul className="m-0 mt-3 list-none p-0 text-[14px]">
              {found.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 first:border-0">
                  <span><b className="text-ink">{fullName(s)}</b> <span className="text-muted">· {s.admission_no} · Class {s.classes?.name}{s.sections ? `-${s.sections.name}` : ""} · {s.father_name ?? ""}</span></span>
                  <span className="flex flex-wrap gap-3">{KINDS.map(([k, t]) => <Link key={k} href={`/app/certificates/new?student=${s.id}&kind=${k}`} className="text-[13px]">{t.split(" (")[0]}</Link>)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 mb-0 text-[14px] text-muted">No student matches “{q}”.</p>)}
        </section>
      )}
      <form className="flex flex-wrap items-end gap-2">
        <Select label="Type" name="kind" blank="All" defaultValue={kind} options={KINDS} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {R.length ? (
        <Table head={["Number", "Type", "Student", "Class", "Issued", "Status"]} minWidth={720}>
          {R.map((c) => (
            <tr key={c.id}>
              <td className={`${td} font-mono text-[13px]`}><Link href={`/app/certificates/${c.id}`}>{c.cert_no}</Link></td>
              <td className={td}>{kn.get(c.kind)?.split(" (")[0]}{c.is_duplicate && <span className="ml-1 text-[12px] text-muted">duplicate</span>}</td>
              <td className={td}>{c.students ? <Link href={`/app/students/${c.students.id}`}>{fullName(c.students)}</Link> : "—"}<div className="text-[12px] text-muted">{c.students?.admission_no}</div></td>
              <td className={td}>{c.students?.classes?.name ?? "—"}</td>
              <td className={td}>{fmtDate(c.issued_on)}</td>
              <td className={td}><Badge value={c.status === "issued" ? "paid" : "cancelled"} text={c.status} /></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No certificates issued yet.</Empty>}
    </div>
  );
}
