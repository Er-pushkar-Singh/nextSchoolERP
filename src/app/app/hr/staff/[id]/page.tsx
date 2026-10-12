import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { fmtDate, money, todayIST } from "@/lib/format";
import { DEFAULT_DEDUCTIONS, DEFAULT_EARNINGS, LEAVE_KINDS, monthName, QUOTA_KINDS, STAFF_KINDS, sumLines, type Line, type Staff } from "@/lib/hr";
import { saveStaff, setStaffStatus } from "../../../_actions/hr";
import { blockStaff, deleteStaffSafe, unblockStaff } from "../../../_actions/people";

function SalaryRows({ prefix, title, rows, defaults }: { prefix: string; title: string; rows: Line[]; defaults: string[] }) {
  const list = rows.length ? [...rows, { name: "", amount: 0 }, { name: "", amount: 0 }] : defaults.map((name) => ({ name, amount: 0 }));
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-[13px] font-bold text-ink">{title} <span className="font-normal text-muted">(per month)</span></legend>
      {list.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_130px] gap-2">
          <input name={`${prefix}_name_${i}`} defaultValue={l.name} aria-label={`${title} ${i + 1} name`} className="input !min-h-10 !py-2 text-[15px]" placeholder="Head" />
          <input name={`${prefix}_amt_${i}`} defaultValue={l.amount || ""} aria-label={`${title} ${i + 1} amount`} type="number" min={0} step="0.01" className="input !min-h-10 !py-2 text-right text-[15px]" placeholder="₹" />
        </div>
      ))}
    </fieldset>
  );
}

export default async function StaffPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session, can } = await requirePerm("hr.staff.view");
  const sp = await searchParams;
  const { data } = await supabase.from("staff").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!data) notFound();
  const s = data as Staff;
  const d1 = session?.start_date ?? `${todayIST().slice(0, 4)}-01-01`, d2 = session?.end_date ?? `${todayIST().slice(0, 4)}-12-31`;
  const [{ data: leaves }, { data: used }, { data: slips }, { data: members }, { data: linked }] = await Promise.all([
    supabase.from("staff_leaves").select("id,kind,from_date,to_date,days,status,reason").eq("staff_id", id).order("from_date", { ascending: false }).limit(20),
    supabase.rpc("leave_summary", { sid: school.id, d1, d2 }),
    can("hr.payroll.view") ? supabase.from("payslips").select("id,net,paid_on,payroll_runs(month,status)").eq("staff_id", id).limit(24) : Promise.resolve({ data: [] }),
    can("hr.staff.edit") ? supabase.from("school_members").select("user_id,name,email").eq("school_id", school.id).order("name") : Promise.resolve({ data: [] }),
    supabase.from("staff").select("user_id").eq("school_id", school.id).not("user_id", "is", null),
  ]);
  const usedOf = (k: string) => ((used ?? []) as { staff_id: string; kind: string; days: number }[]).filter((u) => u.staff_id === id && u.kind === k).reduce((t, u) => t + Number(u.days), 0);
  const P = ((slips ?? []) as unknown as { id: string; net: number; paid_on: string | null; payroll_runs: { month: string; status: string } | null }[])
    .sort((a, b) => (b.payroll_runs?.month ?? "").localeCompare(a.payroll_runs?.month ?? ""));
  const takenLogins = new Set((linked ?? []).map((x) => x.user_id).filter((u) => u !== s.user_id));
  const loginOptions = (members ?? []).filter((m) => !takenLogins.has(m.user_id)).map((m) => [m.user_id, `${m.name ?? m.email}${m.name && m.email ? ` · ${m.email}` : ""}`] as [string, string]);
  const edit = can("hr.staff.edit");
  const canBlock = can("hr.staff.block");
  const isBlocked = Boolean(s.blocked_at) && (!s.blocked_till || s.blocked_till >= todayIST());
  const gross = sumLines(s.earnings), ded = sumLines(s.deductions);
  const kind = new Map(LEAVE_KINDS);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="hr" title={s.name} back={{ href: "/app/hr", label: "Staff" }}
        subtitle={<>{[s.designation, s.department, s.emp_code].filter(Boolean).join(" · ") || "—"} {s.status === "left" && <Badge value="cancelled" text={`Left ${fmtDate(s.leaving_date)}`} />}{isBlocked && <> <Badge value="overdue" text="Blocked" /></>}</>} />
      <Flash ok={sp.ok} error={sp.error} />
      {isBlocked && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">
          <span><b>Blocked</b>{s.blocked_till ? ` until ${fmtDate(s.blocked_till)}` : ""} — {s.block_reason}{s.blocked_by_name ? ` (by ${s.blocked_by_name})` : ""}.{s.user_id ? " Their ERP login is switched off." : ""}</span>
          {canBlock && <form action={unblockStaff}><input type="hidden" name="id" value={s.id} /><button className="btn btn-sm btn-secondary cursor-pointer">Unblock</button></form>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {can("hr.payroll.view") && <Stat label="Monthly gross" value={money(gross)} icon="payroll" tone="green" />}
        {can("hr.payroll.view") && <Stat label="Monthly take-home" value={money(gross - ded)} hint={ded ? `after ${money(ded)} deductions` : undefined} icon="payroll" />}
        {QUOTA_KINDS.filter((k) => (s.leave_quota?.[k] ?? 0) > 0).slice(0, 2).map((k) => (
          <Stat key={k} label={`${kind.get(k)} left`} value={`${(s.leave_quota[k] ?? 0) - usedOf(k)} / ${s.leave_quota[k]}`} hint={session ? `Session ${session.name}` : undefined} icon="leave" tone="amber" />
        ))}
      </div>

      <form action={saveStaff} className="flex flex-col gap-5">
        <input type="hidden" name="id" value={s.id} />
        <Card title="Profile">
          <fieldset disabled={!edit} className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-4">
            <Input label="Full name" name="name" required defaultValue={s.name} className="sm:col-span-2" />
            <Input label="Employee code" name="emp_code" defaultValue={s.emp_code} />
            <Select label="Type" name="kind" defaultValue={s.kind} options={STAFF_KINDS} />
            <Input label="Designation" name="designation" defaultValue={s.designation} />
            <Input label="Department" name="department" defaultValue={s.department} />
            <Input label="Qualification" name="qualification" defaultValue={s.qualification} />
            <Select label="Gender" name="gender" blank="—" defaultValue={s.gender} options={[["F", "Female"], ["M", "Male"], ["O", "Other"]]} />
            <Input label="Phone" name="phone" type="tel" defaultValue={s.phone} />
            <Input label="Email" name="email" type="email" defaultValue={s.email} />
            <Input label="Date of birth" name="dob" type="date" defaultValue={s.dob} />
            <Input label="Date of joining" name="joining_date" type="date" defaultValue={s.joining_date} />
            <Textarea label="Address" name="address" defaultValue={s.address} rows={2} className="sm:col-span-2" />
            <Select label="ERP login" name="user_id" blank="No login" defaultValue={s.user_id} options={loginOptions.length || !s.user_id ? loginOptions : [[s.user_id, "Linked login"]]} className="sm:col-span-2" />
          </fieldset>
        </Card>

        {can("hr.payroll.view") && (
          <Card title="Salary & bank" description="Payroll uses this structure every month; days of approved leave without pay are deducted pro rata.">
            <fieldset disabled={!edit} className="m-0 grid gap-5 border-0 p-0 md:grid-cols-2">
              <SalaryRows prefix="earn" title="Earnings" rows={s.earnings} defaults={DEFAULT_EARNINGS} />
              <SalaryRows prefix="ded" title="Deductions" rows={s.deductions} defaults={DEFAULT_DEDUCTIONS} />
              <div className="grid gap-3 sm:grid-cols-3 md:col-span-2">
                <Input label="Bank" name="bank_name" defaultValue={s.bank_name} />
                <Input label="Account no." name="bank_account" defaultValue={s.bank_account} />
                <Input label="IFSC" name="ifsc" defaultValue={s.ifsc} />
                <Input label="PAN" name="pan" defaultValue={s.pan} />
                <Input label="UAN (PF)" name="uan" defaultValue={s.uan} />
              </div>
            </fieldset>
          </Card>
        )}

        <Card title="Leave per session" description="Yearly quota; leave without pay and on-duty have no limit.">
          <fieldset disabled={!edit} className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-4">
            {QUOTA_KINDS.map((k) => <Input key={k} label={`${kind.get(k)} (${k})`} name={`quota_${k}`} type="number" min={0} defaultValue={s.leave_quota?.[k] ?? 0} hint={`Used ${usedOf(k)}`} />)}
          </fieldset>
        </Card>
        {edit && <div><Submit>Save staff record</Submit></div>}
      </form>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Recent leave" actions={<Link href="/app/hr/leave" className="text-[14px] font-semibold">Leave →</Link>}>
          {(leaves ?? []).length ? (
            <ul className="m-0 list-none p-0 text-[14px]">
              {(leaves ?? []).map((l) => (
                <li key={l.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-0">
                  <span><b className="text-ink">{l.kind}</b> · {fmtDate(l.from_date)}{l.to_date !== l.from_date ? ` – ${fmtDate(l.to_date)}` : ""} · {Number(l.days)} day{Number(l.days) === 1 ? "" : "s"}</span>
                  <Badge value={l.status === "approved" ? "paid" : l.status} text={l.status} />
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[14px] text-muted">No leave taken.</p>}
        </Card>
        {can("hr.payroll.view") && (
          <Card title="Payslips">
            {P.length ? (
              <Table head={["Month", "Net pay", "Paid"]} minWidth={300}>
                {P.map((p) => (
                  <tr key={p.id}>
                    <td className={td}><Link href={`/app/hr/payroll/slip/${p.id}`}>{p.payroll_runs ? monthName(p.payroll_runs.month) : "—"}</Link></td>
                    <td className={td}>{money(p.net)}</td>
                    <td className={td}>{p.paid_on ? fmtDate(p.paid_on) : <Badge value={p.payroll_runs?.status === "approved" ? "due" : "draft"} text={p.payroll_runs?.status === "approved" ? "Unpaid" : "Draft"} />}</td>
                  </tr>
                ))}
              </Table>
            ) : <p className="m-0 text-[14px] text-muted">No payroll run yet.</p>}
          </Card>
        )}
      </div>

      {edit && (
        <Card title={s.status === "active" ? "Leaving the school" : "Rejoining"}>
          <form action={setStaffStatus} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="status" value={s.status === "active" ? "left" : "active"} />
            {s.status === "active" && <Input label="Last working day" name="leaving_date" type="date" defaultValue={todayIST()} />}
            <Submit>{s.status === "active" ? "Mark as left" : "Mark as working again"}</Submit>
          </form>
        </Card>
      )}

      {canBlock && !isBlocked && (
        <Card title="Block this staff member" description={s.user_id ? "Their ERP login is switched off immediately (they are signed out of every screen). Payroll and records are untouched." : "Marks the record as blocked. They have no ERP login."}>
          <form action={blockStaff} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="id" value={s.id} />
            <Input label="Reason" name="reason" required className="sm:col-span-2" />
            <Input label="Blocked until (optional)" name="till" type="date" />
            <div className="flex items-end"><Submit variant="secondary">Block</Submit></div>
          </form>
        </Card>
      )}

      {can("hr.staff.delete") && (
        <Card title="Delete this record" description="Only for a record entered by mistake. Staff with payslips, leave records or issued documents cannot be deleted — mark them as Left instead.">
          <form action={deleteStaffSafe} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={s.id} />
            <Input label={`Type the full name (${s.name}) to confirm`} name="confirm" required />
            <Submit variant="danger">Delete staff record</Submit>
          </form>
        </Card>
      )}
    </div>
  );
}
