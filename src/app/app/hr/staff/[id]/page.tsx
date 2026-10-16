import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Pagination, pager } from "@/components/ui/Pagination";
import { fmtDate, money, todayIST } from "@/lib/format";
import { DEFAULT_DEDUCTIONS, DEFAULT_EARNINGS, LEAVE_KINDS, monthName, QUOTA_KINDS, STAFF_KINDS, sumLines, type Line, type Staff } from "@/lib/hr";
import { saveStaff, setStaffStatus } from "../../../_actions/hr";
import { blockStaff, deleteStaffSafe, unblockStaff } from "../../../_actions/people";
import { PropertyCard } from "@/components/inventory/PropertyCard";
import { CredentialsBanner, StaffActions } from "@/components/hr/StaffActions";
import { readPasswordOnce } from "@/lib/logins";
import { installHrLetters } from "../../../_actions/staff-login";
import { HR_LETTERS } from "@/lib/design";

// joining / appointment letter first: it is the one handed over on the first day
const LETTER_ORDER = ["appointment_letter", "offer_letter", "confirmation_letter", "increment_letter", "salary_certificate", "experience_letter", "relieving_letter", "staff_noc", "warning_letter"];
const LETTER_NOTE = new Map(HR_LETTERS.map((l) => [l.key, l.description]));

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

export default async function StaffPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session, can } = await requirePerm("hr.staff.view");
  const sp = await searchParams;
  const { data } = await supabase.from("staff").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!data) notFound();
  const s = data as Staff;
  const d1 = session?.start_date ?? `${todayIST().slice(0, 4)}-01-01`, d2 = session?.end_date ?? `${todayIST().slice(0, 4)}-12-31`;
  const pl = pager(sp, "lp", "ls"), pp = pager(sp, "pp", "ps"), pr = pager(sp, "rp", "rs"), pi = pager(sp, "ip", "is");
  const canPay = can("hr.payroll.view"), canIssue = can("documents.issue.view");
  const [{ data: leaves, count: leaveN }, { data: used }, { data: slips, count: slipN }, { data: members }, { data: linked }, cred, { data: staffRoles }, { data: loginRoles }, { data: tpls }, { data: issued, count: issuedN }, { data: revisions, count: revN }] = await Promise.all([
    supabase.from("staff_leaves").select("id,kind,from_date,to_date,days,status,reason", { count: "exact" }).eq("staff_id", id).order("from_date", { ascending: false }).range(...pl.range),
    supabase.rpc("leave_summary", { sid: school.id, d1, d2 }),
    canPay ? supabase.from("payroll_runs").select("month,status,payslips!inner(id,net,paid_on,staff_id)", { count: "exact" }).eq("payslips.staff_id", id).order("month", { ascending: false }).range(...pp.range) : Promise.resolve({ data: [], count: 0 }),
    can("hr.staff.edit") ? supabase.from("school_members").select("user_id,name,email").eq("school_id", school.id).order("name") : Promise.resolve({ data: [] }),
    supabase.from("staff").select("user_id").eq("school_id", school.id).not("user_id", "is", null),
    readPasswordOnce(),
    can("settings.users.create") ? supabase.from("roles").select("id,name").eq("school_id", school.id).eq("kind", "staff").order("created_at") : Promise.resolve({ data: [] }),
    s.user_id ? supabase.from("member_roles").select("roles(name)").eq("school_id", school.id).eq("user_id", s.user_id) : Promise.resolve({ data: [] }),
    canIssue ? supabase.from("document_templates").select("id,code,name,preset,category").eq("school_id", school.id).eq("audience", "staff").eq("active", true).order("name") : Promise.resolve({ data: [] }),
    canIssue ? supabase.from("issued_documents").select("id,doc_no,template_name,issued_on,status", { count: "exact" }).eq("staff_id", id).order("created_at", { ascending: false }).range(...pi.range) : Promise.resolve({ data: [], count: 0 }),
    canPay ? supabase.from("staff_salary_history").select("id,changed_on,old_gross,new_gross,changed_by_name", { count: "exact" }).eq("staff_id", id).order("created_at", { ascending: false }).range(...pr.range) : Promise.resolve({ data: [], count: 0 }),
  ]);
  const usedOf = (k: string) => ((used ?? []) as { staff_id: string; kind: string; days: number }[]).filter((u) => u.staff_id === id && u.kind === k).reduce((t, u) => t + Number(u.days), 0);
  const P = ((slips ?? []) as unknown as { month: string; status: string; payslips: { id: string; net: number; paid_on: string | null }[] }[]).flatMap((r) => r.payslips.map((x) => ({ ...x, payroll_runs: { month: r.month, status: r.status } })));
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
        actions={<StaffActions profile s={{ id: s.id, name: s.name, email: s.email, user_id: s.user_id, status: s.status, blocked: isBlocked }} back={`/app/hr/staff/${id}`} roles={(staffRoles ?? []) as { id: string; name: string }[]}
          can={{ edit, block: canBlock, loginCreate: can("settings.users.create"), loginEdit: can("settings.users.edit"), letters: false }} />}
        subtitle={<>{[s.designation, s.department, s.emp_code].filter(Boolean).join(" · ") || "—"} {s.status === "left" && <Badge value="cancelled" text={`Left ${fmtDate(s.leaving_date)}`} />}{isBlocked && <> <Badge value="overdue" text="Blocked" /></>}</>} />
      <Flash ok={sp.ok} error={sp.error} />
      <CredentialsBanner cred={cred} school={school.name} />
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

      {canIssue && (
        <Card id="letters" title="Letters & documents" icon="notices"
          description={s.status === "left" ? "Relieving and experience letters are ready for the leaving date on record." : "Given to the staff member on joining — pick a letter, answer its few questions, then print it."}
          actions={can("documents.templates.create") && (tpls ?? []).filter((t) => t.preset && LETTER_ORDER.includes(t.preset)).length < LETTER_ORDER.length
            ? <form action={installHrLetters}><input type="hidden" name="back" value={`/app/hr/staff/${id}#letters`} /><button className="btn btn-sm btn-secondary cursor-pointer">Add standard HR letters</button></form> : undefined}>
          {(tpls ?? []).length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...(tpls ?? [])].sort((a, b) => {
                const ia = LETTER_ORDER.indexOf(a.preset ?? ""), ib = LETTER_ORDER.indexOf(b.preset ?? "");
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
              }).map((t) => {
                const hint = s.status === "left" ? ["relieving_letter", "experience_letter"].includes(t.preset ?? "") : t.preset === "appointment_letter";
                return (
                  <div key={t.id} className={`flex flex-col gap-2 rounded-[12px] border p-3 ${hint ? "border-blue bg-blue-tint/40" : "border-line"}`}>
                    <div className="flex items-start justify-between gap-2"><b className="text-[14px] text-ink">{t.name}</b>{hint && <Badge value="contacted" text={s.status === "left" ? "For leaving" : "On joining"} />}</div>
                    <p className="m-0 flex-1 text-[12.5px] text-muted">{LETTER_NOTE.get(t.preset ?? "") ?? (t.category === "id_card" ? "ID card with photo and barcode." : "Custom template.")}</p>
                    {can("documents.issue.create") && <Link href={`/app/documents/issue?template=${t.id}&staff=${s.id}`} className="btn btn-sm btn-secondary self-start">Issue</Link>}
                  </div>
                );
              })}
            </div>
          ) : <p className="m-0 text-[14px] text-muted">No staff letter templates yet.{can("documents.templates.create") ? " Use “Add standard HR letters” above to set up the joining, confirmation, salary and relieving letters." : " Ask an admin to set them up under Documents → Templates."}</p>}
          {(issuedN ?? 0) > 0 && (
            <div className="mt-5 flex flex-col gap-3">
              <h3 className="m-0 text-[14px] font-bold text-ink">Already issued to {s.name}</h3>
              <Table head={["Number", "Letter", "Date", "Status"]} minWidth={480}>
                {(issued ?? []).map((d) => (
                  <tr key={d.id}>
                    <td className={td}><Link href={`/app/documents/${d.id}`} className="font-mono text-[13px]">{d.doc_no}</Link></td>
                    <td className={td}>{d.template_name}</td>
                    <td className={td}>{fmtDate(d.issued_on)}</td>
                    <td className={td}><Badge value={d.status === "issued" ? "paid" : "cancelled"} text={d.status === "issued" ? "Issued" : "Cancelled"} /></td>
                  </tr>
                ))}
              </Table>
              <Pagination {...pi.props(issuedN ?? 0, `/app/hr/staff/${id}`)} />
            </div>
          )}
        </Card>
      )}

      <Card title="ERP login" icon="account" description="The sign-in this person uses for the ERP.">
        {s.user_id ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-[14px]">
            <span><b className="text-ink">{s.email ?? "Linked login"}</b>
              <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">{((loginRoles ?? []) as unknown as { roles: { name: string } | { name: string }[] | null }[]).map((r) => (Array.isArray(r.roles) ? r.roles[0] : r.roles)?.name).filter(Boolean).map((n) => <Badge key={n} value="contacted" text={n!} />)}</span></span>
            <span className="flex flex-wrap items-center gap-3">
              {can("settings.users.view") && <Link href={`/app/settings/staff?user=${s.user_id}`} className="text-[13px]">Roles &amp; access</Link>}
              <StaffActions profile s={{ id: s.id, name: s.name, email: s.email, user_id: s.user_id, status: s.status, blocked: isBlocked }} back={`/app/hr/staff/${id}`} roles={[]}
                can={{ edit: false, block: false, loginCreate: false, loginEdit: can("settings.users.edit"), letters: false }} />
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-[14px]">
            <span className="text-muted">No login yet — {s.name} cannot sign in. {can("settings.users.create") ? "Create one and hand over the temporary password." : "Ask an admin to create one."}</span>
            <StaffActions profile s={{ id: s.id, name: s.name, email: s.email, user_id: null, status: s.status, blocked: isBlocked }} back={`/app/hr/staff/${id}`} roles={(staffRoles ?? []) as { id: string; name: string }[]}
              can={{ edit: false, block: false, loginCreate: can("settings.users.create"), loginEdit: false, letters: false }} />
          </div>
        )}
      </Card>

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
            <Input label="Probation (months)" name="probation_months" type="number" min={0} max={24} defaultValue={(s as unknown as { probation_months?: number }).probation_months ?? 6} hint="Printed on the appointment letter" />
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
                <div className="flex flex-wrap items-center gap-4 pt-6 text-[14px] sm:col-span-3">
                  <span className="font-semibold text-ink">Statutory deductions apply:</span>
                  <label className="flex items-center gap-1"><input type="checkbox" name="pf_applicable" value="1" defaultChecked={(s as unknown as { pf_applicable?: boolean }).pf_applicable !== false} />PF</label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="esi_applicable" value="1" defaultChecked={(s as unknown as { esi_applicable?: boolean }).esi_applicable !== false} />ESI</label>
                  <label className="flex items-center gap-1"><input type="checkbox" name="pt_applicable" value="1" defaultChecked={(s as unknown as { pt_applicable?: boolean }).pt_applicable !== false} />Professional tax</label>
                </div>
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

      {(revN ?? 0) > 0 && (
        <Card title="Salary revisions">
          <ul className="m-0 list-none divide-y divide-line p-0 text-[14px]">
            {(revisions ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{fmtDate(r.changed_on)}{r.changed_by_name ? <span className="text-muted"> · {r.changed_by_name}</span> : null}</span>
                <span>{money(r.old_gross)} → <b className={Number(r.new_gross) >= Number(r.old_gross) ? "text-[#15803d]" : "text-error"}>{money(r.new_gross)}</b></span>
              </li>
            ))}
          </ul>
          <div className="mt-3"><Pagination {...pr.props(revN ?? 0, `/app/hr/staff/${id}`)} /></div>
        </Card>
      )}
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
          <div className="mt-3"><Pagination {...pl.props(leaveN ?? 0, `/app/hr/staff/${id}`)} /></div>
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
            <div className="mt-3"><Pagination {...pp.props(slipN ?? 0, `/app/hr/staff/${id}`)} /></div>
          </Card>
        )}
      </div>

      {(can("inventory.assign.view") || can("inventory.items.view")) && <PropertyCard supabase={supabase} sid={school.id} kind="staff" id={s.id} />}

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
