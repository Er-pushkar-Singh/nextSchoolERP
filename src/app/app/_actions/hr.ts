"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireSchool } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";
import type { Line } from "@/lib/hr";
import { showPasswordOnce } from "@/lib/logins";
import { grantStaffLogin, staffBack, validEmail } from "@/lib/staff-login";
import { ensureHrLetters } from "@/lib/hr-letters";

/** Salary lines from inputs named <prefix>_name_<i> / <prefix>_amt_<i> */
function lines(f: FormData, prefix: string): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < 20; i++) {
    const name = str(f, `${prefix}_name_${i}`, 40);
    const amount = num(f, `${prefix}_amt_${i}`);
    if (name && amount !== null && amount > 0) out.push({ name, amount: Math.round(amount * 100) / 100 });
  }
  return out;
}

/* ───────── Staff ───────── */

export async function saveStaff(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school, can } = await requirePerm(id ? "hr.staff.edit" : "hr.staff.create");
  const back = id ? `/app/hr/staff/${id}` : "/app/hr";
  const name = str(f, "name", 100);
  if (!name) go(back, { error: "Name is required." });
  // a new staff member can get an ERP login in the same step
  const wantLogin = !id && f.get("create_login") === "on" && can("settings.users.create");
  const loginRoles = f.getAll("role_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const email = str(f, "email", 120)?.toLowerCase() ?? null;
  if (wantLogin && !validEmail(email)) go(back, { error: "To create a login, enter the staff member's email — it is the sign-in name." });
  if (wantLogin && !loginRoles.length) go(back, { error: "Pick at least one role for the login." });
  const quota: Record<string, number> = {};
  for (const k of ["CL", "SL", "EL"]) quota[k] = Math.max(0, Math.round(num(f, `quota_${k}`) ?? 0));
  const row: Record<string, unknown> = {
    name, emp_code: str(f, "emp_code", 20), designation: str(f, "designation", 60), department: str(f, "department", 60),
    kind: oneOf(f, "kind", ["teaching", "non_teaching", "support"] as const, "teaching"), gender: str(f, "gender", 1),
    dob: date(f, "dob"), phone: str(f, "phone", 20), email, address: str(f, "address", 300),
    qualification: str(f, "qualification", 120), joining_date: date(f, "joining_date"),
    pan: str(f, "pan", 10)?.toUpperCase() ?? null, uan: str(f, "uan", 12),
    bank_name: str(f, "bank_name", 80), bank_account: str(f, "bank_account", 30), ifsc: str(f, "ifsc", 11)?.toUpperCase() ?? null,
    user_id: uuid(f, "user_id"),
  };
  if (f.has("probation_months")) row.probation_months = Math.min(24, Math.max(0, Math.round(num(f, "probation_months") ?? 6)));
  if (row.gender && !["M", "F", "O"].includes(row.gender as string)) row.gender = null;
  if (f.has("earn_name_0")) { row.earnings = lines(f, "earn"); row.deductions = lines(f, "ded"); }
  if (f.has("quota_CL")) row.leave_quota = quota;
  if (f.has("earn_name_0")) { row.pf_applicable = f.get("pf_applicable") === "1"; row.esi_applicable = f.get("esi_applicable") === "1"; row.pt_applicable = f.get("pt_applicable") === "1"; }
  const { data, error } = id
    ? await supabase.from("staff").update(row).eq("id", id).eq("school_id", school.id).select("id").single()
    : await supabase.from("staff").insert({ ...row, school_id: school.id }).select("id").single();
  revalidatePath("/app/hr");
  if (error) {
    const dup = /staff_school_id_emp_code_key/.test(error.message) ? "Another staff member already has this employee code."
      : /staff_school_id_user_id_key/.test(error.message) ? "That login is already linked to another staff member." : errMsg(error);
    go(back, { error: dup });
  }
  if (id) go(`/app/hr/staff/${id}`, { ok: "Saved." });
  const sid = data!.id as string;
  // the standard letters are ready for the new joiner (appointment / joining letter first)
  if (can("documents.templates.create")) await ensureHrLetters(supabase, school.id);
  let note = "";
  if (wantLogin) {
    const r = await grantStaffLogin(supabase, school.id, { id: sid, name: name!, phone: row.phone as string | null }, email!, loginRoles);
    if ("error" in r) go(`/app/hr/staff/${sid}`, { error: `Staff member added, but the login could not be created: ${r.error}` });
    const ok = r as { uid: string; pw?: string };
    if (ok.pw) await showPasswordOnce("/app/hr", email!, ok.pw);
    await supabase.rpc("log_event", { p_action: "user.login_created", p_school: school.id, p_entity: "staff", p_entity_id: sid, p_details: { email } });
    note = ok.pw ? " Sign-in details are shown below — copy them for the staff member." : ` ${email} already had a sign-in, so it is linked.`;
  }
  go(`/app/hr/staff/${sid}#letters`, { ok: `Staff member added.${note} Joining letter and other letters are ready under Letters. Set the salary structure for payroll.` });
}

export async function setStaffStatus(f: FormData) {
  const { supabase, school } = await requirePerm("hr.staff.edit");
  const id = uuid(f, "id");
  const left = f.get("status") === "left";
  const to = staffBack(f, `/app/hr/staff/${id}`);
  const { error } = await supabase.from("staff").update(left ? { status: "left", leaving_date: date(f, "leaving_date") ?? todayIST() } : { status: "active", leaving_date: null })
    .eq("id", id!).eq("school_id", school.id);
  revalidatePath("/app/hr");
  go(to, error ? { error: errMsg(error) } : { ok: left ? "Marked as left. They are paid up to the leaving date in that month's payroll." : "Back on the active list." });
}

export async function deleteStaff(f: FormData) {
  const { supabase, school } = await requirePerm("hr.staff.delete");
  const id = uuid(f, "id");
  const { error } = await supabase.from("staff").delete().eq("id", id!).eq("school_id", school.id);
  if (error) go(`/app/hr/staff/${id}`, { error: /foreign key|violates/i.test(error.message) ? "This person has payslips, so the record must stay. Mark them as left instead." : errMsg(error) });
  revalidatePath("/app/hr");
  go("/app/hr", { ok: "Staff record deleted." });
}

/** Create staff records for every school login that has none yet. */
export async function importLogins() {
  const { supabase, school } = await requirePerm("hr.staff.create");
  const [{ data: members }, { data: staff }, { data: family }] = await Promise.all([
    supabase.from("school_members").select("user_id,name,email,phone").eq("school_id", school.id),
    supabase.from("staff").select("user_id").eq("school_id", school.id),
    supabase.from("member_roles").select("user_id, roles!inner(kind)").eq("school_id", school.id).eq("roles.kind", "family"),
  ]);
  const have = new Set((staff ?? []).map((s) => s.user_id));
  const fam = new Set((family ?? []).map((m) => m.user_id));
  const rows = (members ?? []).filter((m) => !have.has(m.user_id) && !fam.has(m.user_id))
    .map((m) => ({ school_id: school.id, user_id: m.user_id, name: m.name || m.email || "Staff", email: m.email, phone: m.phone }));
  if (!rows.length) go("/app/hr", { ok: "Every staff login already has a staff record." });
  const { error } = await supabase.from("staff").insert(rows);
  revalidatePath("/app/hr");
  go("/app/hr", error ? { error: errMsg(error) } : { ok: `Added ${rows.length} staff record(s) from logins. Open each one to fill in salary and bank details.` });
}

/* ───────── Leave ───────── */

export async function applyLeave(f: FormData) {
  const { supabase, school, scope } = await requirePerm("hr.leave.create");
  const back = "/app/hr/leave";
  let staff_id = uuid(f, "staff_id");
  if (scope("hr.leave.create") !== "school" || !staff_id) {
    const { data } = await supabase.rpc("my_staff_id", { sid: school.id });
    staff_id = (data as string | null) ?? staff_id;
  }
  if (!staff_id) go(back, { error: "Your login is not linked to a staff record yet. Ask the office to link it in Staff & payroll." });
  const from_date = date(f, "from_date"), to_date = date(f, "to_date") ?? from_date;
  if (!from_date || !to_date) go(back, { error: "Pick the dates." });
  if (to_date! < from_date!) go(back, { error: "The end date is before the start date." });
  const half_day = f.get("half_day") === "1";
  if (half_day && to_date !== from_date) go(back, { error: "A half day must be a single date." });
  const { error } = await supabase.from("staff_leaves").insert({
    school_id: school.id, staff_id, kind: oneOf(f, "kind", ["CL", "SL", "EL", "LWP", "OD", "other"] as const, "CL"),
    from_date, to_date, half_day, reason: str(f, "reason", 500),
  });
  revalidatePath(back);
  go(back, error ? { error: errMsg(error) } : { ok: "Leave request sent for approval." });
}

export async function decideLeave(f: FormData) {
  const { supabase, school, myName } = await requirePerm("hr.leave.approve");
  const status = oneOf(f, "status", ["approved", "rejected"] as const, "approved");
  const { data, error } = await supabase.from("staff_leaves")
    .update({ status, decided_by_name: myName || null, decision_note: str(f, "note", 300) })
    .eq("id", uuid(f, "id")!).eq("school_id", school.id).eq("status", "pending").select("id");
  revalidatePath("/app/hr/leave");
  go("/app/hr/leave", error ? { error: errMsg(error) } : data?.length ? { ok: status === "approved" ? "Leave approved." : "Leave rejected." } : { error: "This request was already decided." });
}

export async function cancelLeave(f: FormData) {
  const { supabase, school } = await requireSchool();
  const { data, error } = await supabase.from("staff_leaves").update({ status: "cancelled" })
    .eq("id", uuid(f, "id")!).eq("school_id", school.id).in("status", ["pending", "approved"]).select("id");
  revalidatePath("/app/hr/leave");
  go("/app/hr/leave", error ? { error: errMsg(error) } : data?.length ? { ok: "Leave cancelled." } : { error: "You can't cancel this one." });
}

/* ───────── Payroll ───────── */

export async function generatePayroll(f: FormData) {
  const { supabase, school } = await requirePerm("hr.payroll.create");
  const m = str(f, "month", 7);
  if (!m || !/^\d{4}-\d{2}$/.test(m)) go("/app/hr/payroll", { error: "Pick a month." });
  const days = num(f, "working_days");
  const { data, error } = await supabase.rpc("generate_payroll", { sid: school.id, p_month: `${m}-01`, p_days: days ? Math.round(days) : null });
  if (error) go("/app/hr/payroll", { error: errMsg(error) });
  revalidatePath("/app/hr/payroll");
  go(`/app/hr/payroll/${data}`, { ok: "Payslips calculated from each person's salary structure and approved unpaid leave. Check them, then approve." });
}

export async function updatePayslip(f: FormData) {
  const { supabase, school } = await requirePerm("hr.payroll.edit");
  const run = uuid(f, "run_id");
  const lop = num(f, "lop_days") ?? 0;
  const { error } = await supabase.from("payslips")
    .update({ lop_days: Math.max(0, Math.round(lop * 2) / 2), adjustment: num(f, "adjustment") ?? 0, adjustment_note: str(f, "adjustment_note", 120) })
    .eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(`/app/hr/payroll/${run}`, error ? { error: /check/i.test(error.message) ? "Unpaid days can't be more than the working days." : errMsg(error) } : { ok: "Payslip updated." });
}

export async function setRunStatus(f: FormData) {
  const { supabase, school } = await requirePerm("hr.payroll.approve");
  const id = uuid(f, "id");
  const status = oneOf(f, "status", ["approved", "draft"] as const, "approved");
  const { data, error } = await supabase.from("payroll_runs").update({ status }).eq("id", id!).eq("school_id", school.id).select("id");
  revalidatePath("/app/hr/payroll");
  go(`/app/hr/payroll/${id}`, error ? { error: errMsg(error) } : data?.length ? { ok: status === "approved" ? "Payroll approved and locked. Staff can now see their payslips." : "Reopened for changes." } : { error: "Not allowed." });
}

export async function deleteRun(f: FormData) {
  const { supabase, school } = await requirePerm("hr.payroll.edit");
  const id = uuid(f, "id");
  const { error } = await supabase.from("payroll_runs").delete().eq("id", id!).eq("school_id", school.id);
  if (error) go(`/app/hr/payroll/${id}`, { error: errMsg(error) });
  revalidatePath("/app/hr/payroll");
  go("/app/hr/payroll", { ok: "Draft payroll deleted." });
}

export async function markPaid(f: FormData) {
  const { supabase, school } = await requirePerm("hr.payroll.edit");
  const run = uuid(f, "run_id");
  let ids = f.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (f.get("all_unpaid") === "1") {
    const { data: all } = await supabase.from("payslips").select("id").eq("run_id", run!).eq("school_id", school.id).is("paid_on", null).limit(5000);
    ids = (all ?? []).map((x) => x.id);
  }
  if (!ids.length) go(`/app/hr/payroll/${run}`, { error: "Tick the payslips that were paid." });
  const { data, error } = await supabase.from("payslips")
    .update({ paid_on: date(f, "paid_on") ?? todayIST(), pay_mode: oneOf(f, "pay_mode", ["bank_transfer", "cash", "cheque", "upi"] as const, "bank_transfer"), pay_ref: str(f, "pay_ref", 60) })
    .in("id", ids.slice(0, 1000)).eq("run_id", run!).eq("school_id", school.id).is("paid_on", null).select("id");
  go(`/app/hr/payroll/${run}`, error ? { error: errMsg(error) } : { ok: `Marked ${data?.length ?? 0} salary payment(s) as paid.` });
}
