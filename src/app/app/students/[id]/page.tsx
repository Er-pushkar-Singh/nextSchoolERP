import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { StudentForm, type Student } from "@/components/StudentForm";
import { CopyButton } from "@/components/CopyButton";
import { fmtDate, fullName, money, todayIST, waLink } from "@/lib/format";
import { balance, getClasses, pct, type Due } from "@/lib/erp";
import { appUrl } from "@/lib/brand";
import { addConcession, applyConcessions, newPortalLink, removeConcession, setStudentStatus } from "../../_actions/students";

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session, can } = await requirePerm("students.profile.view");
  const { data: s } = await supabase.from("students").select("*, classes(name), sections(name)").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!s) notFound();
  const fees = can("fees.collection.view");
  const feeWrite = can("fees.concessions.create");
  const canEdit = can("students.profile.edit");
  const today = todayIST();

  const [classes, duesQ, receiptsQ, consQ, headsQ, attQ] = await Promise.all([
    getClasses(supabase, school.id),
    fees ? supabase.from("fee_dues").select("id,label,due_date,amount,concession,fine,paid,status").eq("student_id", id).order("due_date") : Promise.resolve({ data: [] }),
    fees ? supabase.from("fee_receipts").select("id,receipt_no,paid_on,amount,mode,cancelled").eq("student_id", id).order("paid_on", { ascending: false }) : Promise.resolve({ data: [] }),
    fees ? supabase.from("student_concessions").select("id,kind,value,reason,fee_heads(name)").eq("student_id", id) : Promise.resolve({ data: [] }),
    feeWrite ? supabase.from("fee_heads").select("id,name").eq("school_id", school.id).order("sort") : Promise.resolve({ data: [] }),
    session ? supabase.from("attendance").select("status").eq("student_id", id).gte("date", session.start_date).lte("date", session.end_date) : Promise.resolve({ data: [] }),
  ]);
  const dues = (duesQ.data ?? []) as Due[];
  const due = dues.reduce((t, d) => t + balance(d), 0);
  const overdue = dues.filter((d) => d.due_date <= today).reduce((t, d) => t + balance(d), 0);
  const att = (attQ.data ?? []) as { status: string }[];
  const present = att.filter((a) => ["P", "L", "H"].includes(a.status)).length;
  const link = appUrl(`/p/${s.portal_token}`);
  const name = fullName(s);
  const cls = s.classes ? `${s.classes.name}-${s.sections?.name ?? ""}` : "—";
  const wa = waLink(s.guardian_phone, `Dear Parent, here is ${name}'s page for fees, attendance and results at ${school.name}:\n${link}`);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={name}
        subtitle={<>Adm. no. <span className="font-mono">{s.admission_no}</span> · Class {cls}{s.roll_no ? ` · Roll ${s.roll_no}` : ""} · {s.father_name ?? "—"} · {s.guardian_phone ?? "no phone"} {s.status !== "active" && <Badge value={s.status} />}</>}
        back={{ href: "/app/students", label: "Students" }}
        actions={fees && !isNaN(due) && can("fees.collection.create") && due > 0 ? <Link href={`/app/fees/collect?student=${id}`} className="btn btn-sm btn-primary">Collect fee</Link> : undefined}
      />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {fees && <Stat label="Total due (session)" value={money(due)} />}
        {fees && <Stat label="Overdue now" value={money(overdue)} />}
        <Stat label="Attendance (session)" value={att.length ? `${pct(present, att.length)}%` : "—"} hint={`${present}/${att.length} days`} />
        <Stat label="Admitted" value={fmtDate(s.admission_date)} />
      </div>

      <Card title="Parent page">
        <p className="mt-0 text-[14px]">One private link for parents — fees due with UPI pay, receipts, attendance, results and notices. No app or password needed.</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded bg-surface-alt px-2 py-1 text-[12px]">{link}</code>
          <CopyButton text={link} />
          {wa && <a href={wa} target="_blank" rel="noopener" className="btn btn-sm btn-wa">Send on WhatsApp</a>}
          {can("students.parent_link.edit") && (
            <form action={newPortalLink}><input type="hidden" name="id" value={id} /><button className="cursor-pointer border-0 bg-transparent text-[13px] text-blue underline">Reset link</button></form>
          )}
        </div>
      </Card>

      {fees && (
        <Card title="Fee ledger" actions={<span className="text-[13px] text-muted">Instalments come from the fee structure → “Generate dues”.</span>}>
          {dues.length ? (
            <Table head={["Instalment", "Due date", "Amount", "Concession", "Fine", "Paid", "Balance", ""]} minWidth={700}>
              {dues.map((d) => (
                <tr key={d.id}>
                  <td className={td}>{d.label}</td>
                  <td className={td}>{fmtDate(d.due_date)}</td>
                  <td className={td}>{money(d.amount)}</td>
                  <td className={td}>{Number(d.concession) ? money(d.concession) : "—"}</td>
                  <td className={td}>{Number(d.fine) ? money(d.fine) : "—"}</td>
                  <td className={td}>{money(d.paid)}</td>
                  <td className={`${td} font-semibold text-ink`}>{money(balance(d))}</td>
                  <td className={td}><Badge value={d.status === "paid" ? "paid" : d.due_date <= today ? "overdue" : d.status} /></td>
                </tr>
              ))}
            </Table>
          ) : <p className="m-0 text-[14px] text-muted">No instalments yet for this student.</p>}
        </Card>
      )}

      {fees && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Receipts">
            <ul className="m-0 list-none p-0">
              {((receiptsQ.data ?? []) as { id: string; receipt_no: string; paid_on: string; amount: number; mode: string; cancelled: boolean }[]).map((r) => (
                <li key={r.id} className="flex justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
                  <Link href={`/app/fees/receipts/${r.id}`} className="font-mono text-[13px]">{r.receipt_no}</Link>
                  <span className="text-muted">{fmtDate(r.paid_on)} · {r.mode.replace("_", " ")}</span>
                  <span className={r.cancelled ? "text-muted line-through" : "font-semibold text-ink"}>{money(r.amount)}</span>
                </li>
              ))}
              {!receiptsQ.data?.length && <li className="text-[14px] text-muted">No receipts.</li>}
            </ul>
          </Card>
          <Card title="Concessions / scholarships">
            <ul className="m-0 mb-3 list-none p-0">
              {((consQ.data ?? []) as unknown as { id: string; kind: string; value: number; reason: string | null; fee_heads: { name: string } | null }[]).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
                  <span><b>{c.kind === "percent" ? `${Number(c.value)}%` : money(c.value)}</b> on {c.fee_heads?.name ?? "all heads"}{c.reason ? ` · ${c.reason}` : ""}</span>
                  {can("fees.concessions.delete") && <form action={removeConcession}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="student_id" value={id} /><button className="cursor-pointer border-0 bg-transparent text-[13px] text-error underline">Remove</button></form>}
                </li>
              ))}
              {!consQ.data?.length && <li className="text-[14px] text-muted">None.</li>}
            </ul>
            {feeWrite && (
              <>
                <form action={addConcession} className="grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="student_id" value={id} />
                  <Select label="Type" name="kind" options={[["percent", "Percent %"], ["amount", "Fixed ₹ per instalment"]]} />
                  <Input label="Value" name="value" type="number" step="0.01" min={0} required />
                  <Select label="Fee head" name="fee_head_id" blank="All heads" options={((headsQ.data ?? []) as { id: string; name: string }[]).map((h) => [h.id, h.name] as [string, string])} />
                  <Input label="Reason" name="reason" placeholder="Sibling, staff ward, RTE…" />
                  <div><Submit variant="secondary">Add concession</Submit></div>
                </form>
                {!!consQ.data?.length && (
                  <form action={applyConcessions} className="mt-2"><input type="hidden" name="student_id" value={id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Apply to unpaid instalments</button></form>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {canEdit && (
        <Card title="Details">
          <details>
            <summary className="cursor-pointer text-[14px] font-semibold text-blue">Edit student details</summary>
            <div className="mt-4"><StudentForm s={s as unknown as Student} classes={classes} /></div>
          </details>
          <form action={setStudentStatus} className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[14px]">
            <input type="hidden" name="id" value={id} />
            <span>Status:</span>
            <select name="status" defaultValue={s.status} className="rounded-md border border-line px-2 py-1"><option value="active">Active</option><option value="left">Left school (TC)</option><option value="passed_out">Passed out</option></select>
            <Submit variant="secondary">Update</Submit>
          </form>
        </Card>
      )}
    </div>
  );
}
