import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { addDays, cleanSearch, fmtDate, fullName, money, todayIST } from "@/lib/format";
import { balance, type Due } from "@/lib/erp";
import { PAY_MODES } from "@/lib/fees";
import { addPromise, adjustDue, collectFeeV2, siblingDiscount } from "../../_actions/fees2";

type Stu = { id: string; admission_no: string; first_name: string; last_name: string | null; father_name: string | null; guardian_phone: string | null; classes: { name: string } | null; sections: { name: string } | null };
type DueRow = Due & { kind: string; fine_auto: number; original_due_date: string | null };
const sel = "id,admission_no,first_name,last_name,father_name,guardian_phone,classes(name),sections(name)";

export default async function Collect({ searchParams }: { searchParams: Promise<{ q?: string; student?: string; error?: string; ok?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.collection.create");
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
  let siblings: { student_id: string; name: string; admission_no: string; class_name: string | null; balance: number }[] = [];
  let promises: { id: string; promised_on: string; amount: number | null; note: string | null; status: string }[] = [];
  let stu: Stu | null = null, dues: DueRow[] = [], wallet = 0, recent: { id: string; receipt_no: string; paid_on: string; amount: number; mode: string; cancelled: boolean }[] = [];
  let history: { id: string; kind: string; amount: number; reason: string; created_at: string; created_by_name: string | null }[] = [];
  const { data: st } = await supabase.from("fee_settings").select("fine_enabled,fine_mode,fine_amount,advance_allowed").eq("school_id", school.id).maybeSingle();
  if (sp.student && /^[0-9a-f-]{36}$/.test(sp.student)) {
    const [{ data: s }, { data: d }, { data: w }, { data: r }, { data: h }, sib, { data: pr }] = await Promise.all([
      supabase.from("students").select(sel).eq("id", sp.student).eq("school_id", school.id).maybeSingle(),
      supabase.from("fee_dues").select("id,label,due_date,amount,concession,fine,paid,status,kind,fine_auto,original_due_date").eq("student_id", sp.student).neq("status", "paid").order("due_date").order("label"),
      supabase.from("fee_wallet_entries").select("amount").eq("student_id", sp.student),
      supabase.from("fee_receipts").select("id,receipt_no,paid_on,amount,mode,cancelled").eq("student_id", sp.student).order("created_at", { ascending: false }).limit(5),
      supabase.from("fee_adjustments").select("id,kind,amount,reason,created_at,created_by_name").eq("student_id", sp.student).order("created_at", { ascending: false }).limit(8),
      supabase.rpc("student_siblings", { sid: school.id, stu: sp.student }),
      supabase.from("fee_followups").select("id,promised_on,amount,note,status").eq("student_id", sp.student).order("promised_on", { ascending: false }).limit(5),
    ]);
    siblings = (sib.data ?? []) as typeof siblings;
    promises = (pr ?? []) as typeof promises;
    stu = s as unknown as Stu | null;
    dues = (d ?? []) as DueRow[];
    wallet = ((w ?? []) as { amount: number }[]).reduce((t, x) => t + Number(x.amount), 0);
    recent = (r ?? []) as typeof recent;
    history = (h ?? []) as typeof history;
  }
  const total = dues.reduce((t, d) => t + balance(d), 0);
  const overdue = dues.filter((d) => d.due_date < today).reduce((t, d) => t + balance(d), 0);
  const autoFine = !!st?.fine_enabled;
  const oldest = dues.find((d) => d.due_date < today);
  const lateDays = oldest ? Math.round((Date.parse(today) - Date.parse(oldest.due_date)) / 86400000) : 0;
  const legacyFine = autoFine ? 0 : Math.round(lateDays * Number(school.late_fine_per_day));
  const canAdjust = can("fees.dues.create");
  const canWaive = can("fees.concessions.approve");
  const canReverse = can("fees.refunds.approve");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="card" title="Collect fee" back={{ href: "/app/fees", label: "Fees" }} />
      <Flash ok={sp.ok} error={sp.error} />
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
              <p className="m-0 text-[14px]">Overdue <b className="text-error">{money(overdue)}</b> · Total balance <b className="text-ink">{money(total)}</b>{wallet > 0 && <> · Advance <b className="text-[#0b4f2c]">{money(wallet)}</b></>}</p>
            </div>
            <p className="mt-2 mb-0 flex flex-wrap gap-3 text-[13px]">
              <Link href={`/app/fees/ledger/${stu.id}`}>Fee statement</Link>
              <Link href={`/app/students/${stu.id}`}>Student page</Link>
            </p>
          </Card>

          {siblings.length > 0 && (
            <div role="note" className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[12px] border border-[#cfd9f7] bg-blue-tint px-4 py-3 text-[14px] text-blue-strong">
              <b>Siblings:</b>
              {siblings.map((x) => <Link key={x.student_id} href={`/app/fees/collect?student=${x.student_id}`} className="font-semibold">{x.name} ({x.class_name ?? "—"}) — {Number(x.balance) > 0 ? `owes ${money(x.balance)}` : "no dues"}</Link>)}
              {canAdjust && <form action={siblingDiscount} className="inline"><input type="hidden" name="student_id" value={stu.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-blue underline">Apply sibling discount</button></form>}
            </div>
          )}
          {dues.length ? (
            <form action={collectFeeV2} className="flex flex-col gap-5">
              <input type="hidden" name="student_id" value={stu.id} />
              <Table head={["Pay", "Instalment", "Due", "Fine", "Balance", ""]} minWidth={560}>
                {dues.map((d) => (
                  <tr key={d.id}>
                    <td className={td}><input type="checkbox" name="due_id" value={d.id} aria-label={`Pay ${d.label}`} /></td>
                    <td className={td}>{d.label}{d.kind !== "plan" && <span className="ml-1 text-[12px] text-muted">{d.kind}</span>}</td>
                    <td className={td}>{fmtDate(d.due_date)}{d.original_due_date && <div className="text-[12px] text-muted">was {fmtDate(d.original_due_date)}</div>}</td>
                    <td className={td}>{Number(d.fine) > 0 ? money(d.fine) : "—"}</td>
                    <td className={`${td} font-semibold text-ink`}>{money(balance(d))}</td>
                    <td className={td}><Badge value={d.due_date < today ? "overdue" : d.status} /></td>
                  </tr>
                ))}
              </Table>
              <p className="m-0 -mt-3 text-[13px] text-muted">Tick instalments to pay only those; leave all unticked to pay oldest first.</p>

              <Card title="Receive payment">
                <div className="grid gap-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <Input label={i === 1 ? "Amount received (₹)" : `Second payment ${i - 1} (₹)`} name={`amount_${i}`} type="number" step="0.01" min={0}
                        defaultValue={i === 1 ? (overdue || total) : undefined} hint={i === 1 ? `Overdue ${money(overdue)} · all dues ${money(total)}` : undefined} />
                      <Select label="Mode" name={`mode_${i}`} options={PAY_MODES} defaultValue={i === 1 ? "cash" : i === 2 ? "upi" : "cheque"} />
                      <Input label="UTR / cheque no." name={`reference_${i}`} />
                      <Input label="Bank (cheque)" name={`bank_${i}`} />
                      <Input label="Cheque date" name={`cheque_date_${i}`} type="date" />
                    </div>
                  ))}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Input label="Receipt date" name="paid_on" type="date" defaultValue={today} />
                    {wallet > 0 && <Input label={`Use advance (max ${money(wallet)})`} name="wallet_use" type="number" step="0.01" min={0} max={wallet} />}
                    <Input label="Extra fine (₹)" name="fine" type="number" step="1" min={0} defaultValue={legacyFine || ""}
                      hint={autoFine ? "Late fine is added automatically by the school's rule." : legacyFine ? `${lateDays} days late × ${money(school.late_fine_per_day)}/day` : undefined} />
                    <Input label="Note" name="note" />
                  </div>
                  <div><Submit>Save &amp; print receipt</Submit></div>
                </div>
                <p className="mt-3 mb-0 text-[13px] text-muted">
                  Use the second line for split payments (cash + UPI). {st?.advance_allowed === false ? "Paying more than is due is not allowed." : "Anything above what is due is kept as the student's advance."}
                </p>
              </Card>
            </form>
          ) : <Empty>No unpaid instalments for this student. 🎉{wallet > 0 && ` Advance balance ${money(wallet)}.`}</Empty>}

          {canAdjust && dues.length > 0 && (
            <Card title="Adjust an instalment" description="Every change needs a reason and is kept in the student's fee history.">
              <form action={adjustDue} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <input type="hidden" name="back" value={`/app/fees/collect?student=${stu.id}`} />
                <Select label="Instalment" name="due_id" options={dues.map((d) => [d.id, `${d.label} · ${money(balance(d))}`] as [string, string])} />
                <Select label="Action" name="action" options={[
                  ["amount", "Change the amount (custom fee)"], ["extend", "Extend due date"], ["split", "Split into parts (value = number of parts)"],
                  ...(canWaive ? [["waive", "Waive (concession)"], ["waive_fine", "Waive fine"]] as [string, string][] : []),
                  ...(canReverse ? [["reverse", "Move a payment back to advance"]] as [string, string][] : []),
                ]} />
                <Input label="Amount (₹)" name="value" type="number" step="0.01" min={0} hint="New amount / amount to waive / amount to move" />
                <Input label="New / first due date" name="new_date" type="date" />
                <Input label="Gap between parts (days)" name="gap_days" type="number" min={1} defaultValue={30} hint="Only for “Split”" />
                <Input label="Reason" name="reason" required />
                <div className="flex items-end"><Submit>Apply</Submit></div>
              </form>
            </Card>
          )}

          {(total > 0 || promises.length > 0) && (
            <Card title="Promise to pay" description="Note what the parent promised, so the next call is informed.">
              {promises.length > 0 && (
                <ul className="m-0 mb-3 list-none p-0 text-[14px]">
                  {promises.map((p) => (
                    <li key={p.id} className="border-t border-line py-1.5 first:border-0">
                      <b className={p.status === "open" && p.promised_on < today ? "text-error" : "text-ink"}>{fmtDate(p.promised_on)}</b>
                      {p.amount ? ` · ${money(p.amount)}` : ""} · <Badge value={p.status === "kept" ? "paid" : p.status === "broken" ? "overdue" : "pending"} text={p.status} />{p.note ? <span className="text-muted"> — {p.note}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <form action={addPromise} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <input type="hidden" name="student_id" value={stu.id} />
                <Input label="Will pay on" name="promised_on" type="date" defaultValue={addDays(today, 3)} required />
                <Input label="Amount (₹)" name="amount" type="number" step="1" min={0} defaultValue={overdue || ""} />
                <Input label="Note" name="note" className="lg:col-span-2" placeholder="e.g. after salary, father will visit" />
                <div className="flex items-end"><Submit variant="secondary">Save promise</Submit></div>
              </form>
            </Card>
          )}

          {(recent.length > 0 || history.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {recent.length > 0 && (
                <Card title="Recent receipts">
                  <ul className="m-0 list-none p-0 text-[14px]">
                    {recent.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2 border-t border-line py-1.5 first:border-0">
                        <Link href={`/app/fees/receipts/${r.id}`} className="font-mono text-[13px]">{r.receipt_no}</Link>
                        <span className="text-muted">{fmtDate(r.paid_on)} · {r.mode}</span>
                        <b className={r.cancelled ? "text-muted line-through" : ""}>{money(r.amount)}</b>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {history.length > 0 && (
                <Card title="Recent changes">
                  <ul className="m-0 list-none p-0 text-[14px]">
                    {history.map((h) => (
                      <li key={h.id} className="border-t border-line py-1.5 first:border-0">
                        <b className="text-ink">{h.kind.replace("_", " ")}</b> {Number(h.amount) ? money(Math.abs(Number(h.amount))) : ""} <span className="text-muted">· {h.reason} · {fmtDate(h.created_at.slice(0, 10))}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
