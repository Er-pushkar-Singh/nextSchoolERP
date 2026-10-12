import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { cleanSearch, fmtDate, fullName, money, todayIST } from "@/lib/format";
import { balance, type Due } from "@/lib/erp";
import { collectFee } from "../../_actions/fees";

const MODES: [string, string][] = [["cash", "Cash"], ["upi", "UPI"], ["cheque", "Cheque"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["online", "Online"]];
type Stu = { id: string; admission_no: string; first_name: string; last_name: string | null; father_name: string | null; guardian_phone: string | null; classes: { name: string } | null; sections: { name: string } | null };
const sel = "id,admission_no,first_name,last_name,father_name,guardian_phone,classes(name),sections(name)";

export default async function Collect({ searchParams }: { searchParams: Promise<{ q?: string; student?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("fees.collection.create");
  const sp = await searchParams;
  const today = todayIST();
  const q = cleanSearch(sp.q ?? "").trim();
  let results: Stu[] = [];
  if (q && !sp.student) {
    const { data } = await supabase.from("students").select(sel).eq("school_id", school.id)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,admission_no.ilike.${q}%,guardian_phone.ilike.%${q}%,father_name.ilike.%${q}%`).order("first_name").limit(30);
    results = (data ?? []) as unknown as Stu[];
    if (results.length === 1) sp.student = results[0].id;
  }
  let stu: Stu | null = null, dues: Due[] = [];
  if (sp.student && /^[0-9a-f-]{36}$/.test(sp.student)) {
    const [{ data: s }, { data: d }] = await Promise.all([
      supabase.from("students").select(sel).eq("id", sp.student).eq("school_id", school.id).maybeSingle(),
      supabase.from("fee_dues").select("id,label,due_date,amount,concession,fine,paid,status").eq("student_id", sp.student).neq("status", "paid").order("due_date").order("label"),
    ]);
    stu = s as unknown as Stu | null;
    dues = (d ?? []) as Due[];
  }
  const total = dues.reduce((t, d) => t + balance(d), 0);
  const overdue = dues.filter((d) => d.due_date <= today).reduce((t, d) => t + balance(d), 0);
  const oldest = dues.find((d) => d.due_date < today);
  const lateDays = oldest ? Math.round((Date.parse(today) - Date.parse(oldest.due_date)) / 86400000) : 0;
  const fine = Math.round(lateDays * Number(school.late_fine_per_day));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="card" title="Collect fee" back={{ href: "/app/fees", label: "Fees" }} />
      <Flash error={sp.error} />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} autoFocus={!stu} placeholder="Student name, admission no., father or phone" className="input !min-h-11 max-w-md !py-2" aria-label="Find student" />
        <button className="btn btn-sm btn-secondary cursor-pointer">Find</button>
      </form>

      {!stu && q && (results.length ? (
        <Table head={["Adm. no.", "Student", "Class", "Father", "Phone"]} minWidth={560}>
          {results.map((s) => (
            <tr key={s.id}>
              <td className={`${td} font-mono text-[13px]`}>{s.admission_no}</td>
              <td className={td}><Link href={`/app/fees/collect?student=${s.id}`} className="font-semibold">{fullName(s)}</Link></td>
              <td className={td}>{s.classes ? `${s.classes.name}-${s.sections?.name ?? ""}` : "—"}</td>
              <td className={td}>{s.father_name ?? "—"}</td>
              <td className={td}>{s.guardian_phone ?? "—"}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No student matches “{q}”.</Empty>)}

      {stu && (
        <>
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <Link href={`/app/students/${stu.id}`} className="text-[20px] font-extrabold">{fullName(stu)}</Link>
                <p className="m-0 text-[14px] text-muted">Adm. {stu.admission_no} · Class {stu.classes ? `${stu.classes.name}-${stu.sections?.name ?? ""}` : "—"} · {stu.father_name ?? ""} · {stu.guardian_phone ?? ""}</p>
              </div>
              <p className="m-0 text-[14px]">Overdue <b className="text-error">{money(overdue)}</b> · Session balance <b className="text-ink">{money(total)}</b></p>
            </div>
          </Card>
          {dues.length ? (
            <>
              <Table head={["Instalment", "Due", "Balance", ""]} minWidth={480}>
                {dues.map((d) => (
                  <tr key={d.id}>
                    <td className={td}>{d.label}</td>
                    <td className={td}>{fmtDate(d.due_date)}</td>
                    <td className={`${td} font-semibold text-ink`}>{money(balance(d))}</td>
                    <td className={td}><Badge value={d.due_date <= today ? "overdue" : d.status} /></td>
                  </tr>
                ))}
              </Table>
              <Card title="Receive payment">
                <form action={collectFee} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="student_id" value={stu.id} />
                  <Input label="Amount received (₹)" name="amount" type="number" step="0.01" min={1} defaultValue={overdue || total} required hint={`Overdue ${money(overdue)} · full session ${money(total)}`} />
                  <Select label="Mode" name="mode" options={MODES} />
                  <Input label="UTR / cheque no." name="reference" />
                  <Input label="Date" name="paid_on" type="date" defaultValue={today} />
                  <Input label="Late fine (₹)" name="fine" type="number" step="1" min={0} defaultValue={fine || ""} hint={fine ? `${lateDays} days late × ${money(school.late_fine_per_day)}/day — edit or clear` : "Added on top; include it in the amount"} />
                  <Input label="Note" name="note" className="lg:col-span-2" />
                  <div className="flex items-end"><Submit>Save &amp; print receipt</Submit></div>
                </form>
                <p className="mt-3 mb-0 text-[13px] text-muted">The amount is applied to the oldest instalments first. Partial payments are fine.</p>
              </Card>
            </>
          ) : <Empty>No unpaid instalments for this student. 🎉</Empty>}
        </>
      )}
    </div>
  );
}
