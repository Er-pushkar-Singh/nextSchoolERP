import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { cleanSearch, fmtDate, fullName, money } from "@/lib/format";
import { CONCESSION_CATEGORIES } from "@/lib/fees";
import { addConcessionV2, decideConcession } from "../../_actions/fees2";

type C = { id: string; kind: string; value: number; category: string; status: string; reason: string | null; valid_from: string | null; valid_to: string | null; decision_note: string | null; created_at: string;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string; classes: { name: string } | null } | null; fee_heads: { name: string } | null };
const cat = new Map(CONCESSION_CATEGORIES);

export default async function Concessions({ searchParams }: { searchParams: Promise<{ status?: string; find?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.concessions.view");
  const sp = await searchParams;
  const status = ["pending", "approved", "rejected"].includes(sp.status ?? "") ? sp.status! : "pending";
  const q = cleanSearch(sp.find ?? "").trim();
  const [{ data }, { data: heads }, found, { count: pending }] = await Promise.all([
    supabase.from("student_concessions").select("id,kind,value,category,status,reason,valid_from,valid_to,decision_note,created_at,students(id,first_name,last_name,admission_no,classes(name)),fee_heads(name)")
      .eq("school_id", school.id).eq("status", status).order("created_at", { ascending: false }).limit(200),
    supabase.from("fee_heads").select("id,name").eq("school_id", school.id).order("sort"),
    q && can("fees.concessions.create")
      ? supabase.from("students").select("id,first_name,last_name,admission_no,classes(name)").eq("school_id", school.id).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,admission_no.ilike.${q}%`).order("first_name").limit(8)
      : Promise.resolve({ data: null }),
    supabase.from("student_concessions").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("status", "pending"),
  ]);
  const rows = (data ?? []) as unknown as C[];
  const people = (found.data ?? []) as unknown as { id: string; first_name: string; last_name: string | null; admission_no: string; classes: { name: string } | null }[];
  const canDecide = can("fees.concessions.approve");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Concessions & scholarships" subtitle={`${pending ?? 0} waiting for approval`} back={{ href: "/app/fees", label: "Fees" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="flex gap-3 text-[14px]">
        {["pending", "approved", "rejected"].map((s) => <Link key={s} href={`/app/fees/concessions?status=${s}`} className={s === status ? "font-bold" : ""}>{s[0].toUpperCase() + s.slice(1)}</Link>)}
      </nav>
      {rows.length ? (
        <Table head={["Student", "Concession", "Category", "Applies to", "Valid", "Reason", ""]} minWidth={860}>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className={td}>{c.students ? <Link href={`/app/students/${c.students.id}`}>{fullName(c.students)}</Link> : "—"}<div className="text-[12px] text-muted">{c.students?.admission_no} · {c.students?.classes?.name}</div></td>
              <td className={`${td} font-semibold text-ink`}>{c.kind === "percent" ? `${c.value}%` : money(c.value)}</td>
              <td className={td}>{cat.get(c.category) ?? c.category}</td>
              <td className={td}>{c.fee_heads?.name ?? "All fees"}</td>
              <td className={td}>{c.valid_from || c.valid_to ? `${c.valid_from ? fmtDate(c.valid_from) : "…"} – ${c.valid_to ? fmtDate(c.valid_to) : "…"}` : "Whole session"}</td>
              <td className={td}>{c.reason ?? "—"}{c.decision_note && <div className="text-[12px] text-muted">{c.decision_note}</div>}</td>
              <td className={td}>
                {c.status === "pending" && canDecide ? (
                  <form action={decideConcession} className="flex flex-col gap-1">
                    <input type="hidden" name="id" value={c.id} />
                    <input name="note" placeholder="Note (needed to reject)" className="input !min-h-9 !py-1 text-[13px]" />
                    <span className="flex gap-2"><button name="decision" value="approve" className="btn btn-sm btn-primary cursor-pointer border-0">Approve</button><button name="decision" value="reject" className="btn btn-sm btn-secondary cursor-pointer">Reject</button></span>
                  </form>
                ) : <Badge value={c.status === "approved" ? "paid" : c.status === "rejected" ? "cancelled" : "pending"} text={c.status} />}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No {status} concessions.</Empty>}

      {can("fees.concessions.create") && (
        <Card title="Give a concession">
          <form className="flex flex-wrap items-end gap-2"><Input label="Find student" name="find" defaultValue={sp.find} placeholder="Name or admission no." /><button className="btn btn-sm btn-secondary cursor-pointer">Find</button></form>
          {q && !people.length && <p className="mt-3 mb-0 text-[14px] text-muted">Nobody matches “{q}”.</p>}
          {people.length > 0 && (
            <form action={addConcessionV2} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="back" value="list" />
              <Select label="Student" name="student_id" options={people.map((p) => [p.id, `${fullName(p)} · ${p.admission_no} · ${p.classes?.name ?? ""}`] as [string, string])} />
              <Select label="Category" name="category" options={CONCESSION_CATEGORIES} />
              <Select label="Fee head" name="fee_head_id" blank="All fees" options={(heads ?? []).map((h) => [h.id, h.name] as [string, string])} />
              <Select label="Type" name="kind" options={[["percent", "Percent (%)"], ["amount", "Amount per instalment (₹)"]]} />
              <Input label="Value" name="value" type="number" step="0.01" min={0} required />
              <Input label="Valid from" name="valid_from" type="date" hint="Optional" />
              <Input label="Valid to" name="valid_to" type="date" hint="Optional" />
              <Input label="Reason" name="reason" />
              <div className="flex items-end"><Submit>Save concession</Submit></div>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
