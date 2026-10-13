"use server";

import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { METHODS, methodOf } from "@/lib/fees";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveIntegration } from "@/lib/integrations";
import { createRazorpayLink } from "@/lib/razorpay";

const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
const money2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

/* ───────────── Settings ───────────── */
export async function saveFeeSettings(f: FormData) {
  const { supabase, school } = await requirePerm("fees.structure.edit");
  const back = "/app/fees/settings";
  const row = {
    school_id: school.id,
    fine_enabled: f.get("fine_enabled") === "on",
    fine_mode: oneOf(f, "fine_mode", ["per_day", "per_month", "flat"] as const, "per_day"),
    fine_amount: Math.max(0, money2(num(f, "fine_amount")) ?? 0),
    fine_grace_days: Math.min(365, Math.max(0, Math.round(num(f, "fine_grace_days") ?? 0))),
    fine_cap: Math.max(0, money2(num(f, "fine_cap")) ?? 0),
    concession_approval: f.get("concession_approval") === "on",
    advance_allowed: f.get("advance_allowed") === "on",
    bounce_charge: Math.max(0, money2(num(f, "bounce_charge")) ?? 0),
    online_enabled: f.get("online_enabled") === "on",
    online_min_amount: Math.max(0, money2(num(f, "online_min_amount")) ?? 1),
    online_allow_partial: f.get("online_allow_partial") === "on",
    receipt_footer: str(f, "receipt_footer", 300),
    sibling_percent: Math.min(100, Math.max(0, money2(num(f, "sibling_percent")) ?? 0)),
    sibling_head_id: uuid(f, "sibling_head_id"),
  };
  if (row.fine_enabled && row.fine_amount <= 0) go(back, { error: "Enter the fine amount, or switch the late fine off." });
  const { error } = await supabase.from("fee_settings").upsert(row, { onConflict: "school_id" });
  go(back, error ? { error: errMsg(error) } : { ok: "Fee settings saved." });
}

/* ───────────── Collection ───────────── */
export async function collectFeeV2(f: FormData) {
  const { supabase, school, myName } = await requirePerm("fees.collection.create");
  const student = uuid(f, "student_id");
  const back = `/app/fees/collect?student=${student}`;
  if (!student) go("/app/fees/collect", { error: "Choose a student." });
  // fees chosen on the desk: alloc_<instalment id> = amount for that instalment
  const alloc: { due_id: string; amount: number }[] = [];
  for (const [k, v] of f.entries()) {
    const m = /^alloc_([0-9a-f-]{36})$/.exec(k);
    const amount = money2(Number(v));
    if (m && amount && amount > 0) alloc.push({ due_id: m[1], amount });
  }
  const splits: Record<string, string | number | null>[] = [];
  for (let i = 1; i <= 4; i++) {
    const amount = money2(num(f, `amount_${i}`));
    if (!amount || amount <= 0) continue;
    const m = methodOf(oneOf(f, `mode_${i}`, METHODS.map((x) => x.value) as readonly string[], "cash"));
    const reference = str(f, `reference_${i}`, 80);
    const label = str(f, `label_${i}`, 40);
    splits.push({
      mode: m.mode, sub_type: m.value === "other" ? label ?? "Other" : m.sub ?? null, amount, reference,
      cheque_no: m.mode === "cheque" || m.mode === "dd" ? str(f, `reference_${i}`, 40) : null, bank: str(f, `bank_${i}`, 60), cheque_date: date(f, `cheque_date_${i}`),
    });
  }
  const wallet = Math.max(0, money2(num(f, "wallet_use")) ?? 0);
  if (!alloc.length) go(back, { error: "Tick at least one fee to collect." });
  if (!splits.length && wallet <= 0) go(back, { error: "Enter the amount received." });
  const { data, error } = await supabase.rpc("collect_fee_v2", {
    sid: school.id, stu: student, p_splits: splits, p_due_ids: null, p_wallet_use: wallet, p_alloc: alloc,
    p_paid_on: date(f, "paid_on"), p_note: str(f, "note", 300), p_by: myName || null, p_fine: Math.max(0, money2(num(f, "fine")) ?? 0),
  });
  if (error) go(back, { error: errMsg(error) });
  go(`/app/fees/receipts/${data}`, { ok: "Fee received." });
}

/* ───────────── Concessions ───────────── */
export async function addConcessionV2(f: FormData) {
  const { supabase, school } = await requirePerm("fees.concessions.create");
  const student_id = uuid(f, "student_id");
  const back = oneOf(f, "back", ["student", "list"] as const, "student") === "list" ? "/app/fees/concessions" : `/app/students/${student_id}`;
  const value = num(f, "value");
  const kind = oneOf(f, "kind", ["percent", "amount"] as const, "percent");
  if (!student_id || value === null || value <= 0 || (kind === "percent" && value > 100)) go(back, { error: "Enter a valid concession." });
  const from = date(f, "valid_from"), to = date(f, "valid_to");
  if (from && to && to < from) go(back, { error: "The end date is before the start date." });
  const { error } = await supabase.from("student_concessions").insert({
    school_id: school.id, student_id, fee_head_id: uuid(f, "fee_head_id"), kind, value, reason: str(f, "reason", 200),
    category: oneOf(f, "category", ["rte", "staff_ward", "sibling", "merit", "sports", "hardship", "other"] as const, "other"), valid_from: from, valid_to: to,
  });
  go(back, error ? { error: errMsg(error) } : { ok: "Concession recorded. If it needs approval it will be billed only after the principal approves it." });
}

export async function decideConcession(f: FormData) {
  const { supabase, school } = await requirePerm("fees.concessions.approve");
  const id = uuid(f, "id");
  const approve = f.get("decision") === "approve";
  const note = str(f, "note", 200);
  const back = "/app/fees/concessions";
  if (!approve && !note) go(back, { error: "Write the reason for rejecting." });
  const { data: c, error } = await supabase.from("student_concessions").update({ status: approve ? "approved" : "rejected", decision_note: note })
    .eq("id", id!).eq("school_id", school.id).select("student_id").maybeSingle();
  if (error) go(back, { error: errMsg(error) });
  if (c && approve) await supabase.rpc("reapply_concessions", { sid: school.id, stu: c.student_id });
  go(back, { ok: approve ? "Concession approved and applied to unpaid instalments." : "Concession rejected." });
}

/* ───────────── Adjustments ───────────── */
export async function adjustDue(f: FormData) {
  const { supabase } = await requirePerm("fees.dues.create");
  const id = uuid(f, "due_id");
  const back = String(f.get("back") ?? "/app/fees/collect").startsWith("/app/") ? String(f.get("back")) : "/app/fees/collect";
  const reason = str(f, "reason", 200);
  if (!id || !reason) go(back, { error: "Write the reason." });
  const action = oneOf(f, "action", ["amount", "extend", "waive", "waive_fine", "reverse", "split"] as const, "waive");
  let error: { message?: string } | null = null;
  if (action === "amount") ({ error } = await supabase.rpc("adjust_due_amount", { did: id, p_new: num(f, "value"), p_reason: reason }));
  else if (action === "waive") ({ error } = await supabase.rpc("waive_due", { did: id, p_amount: num(f, "value"), p_reason: reason }));
  else if (action === "waive_fine") ({ error } = await supabase.rpc("waive_fine", { did: id, p_amount: num(f, "value"), p_reason: reason }));
  else if (action === "reverse") ({ error } = await supabase.rpc("reverse_payment", { did: id, p_amount: num(f, "value"), p_reason: reason }));
  else if (action === "split") ({ error } = await supabase.rpc("split_due", { did: id, p_parts: Math.round(num(f, "value") ?? 0), p_first: date(f, "new_date"), p_gap_days: Math.round(num(f, "gap_days") ?? 30), p_reason: reason }));
  else {
    const { data: d } = await supabase.from("fee_dues").select("school_id").eq("id", id).maybeSingle();
    if (!d || !date(f, "new_date")) go(back, { error: "Choose the new due date." });
    ({ error } = await supabase.rpc("extend_dues", { sid: d!.school_id, p_ids: [id], p_date: date(f, "new_date"), p_reason: reason }));
  }
  go(back, error ? { error: errMsg(error) } : { ok: "Saved. The change is recorded in the student's fee history." });
}

export async function addCharge(f: FormData) {
  const { supabase, school, session } = await requirePerm("fees.dues.create");
  const back = "/app/fees/charges";
  if (!session) go(back, { error: "No current session." });
  const students = ids(f, "student_id");
  const cls = uuid(f, "class_id"), sec = uuid(f, "section_id");
  const label = str(f, "label", 60), due = date(f, "due_date"), amount = money2(num(f, "amount"));
  if (!label || !due || !amount || amount <= 0) go(back, { error: "Label, due date and amount are required." });
  if (!students.length && !cls) go(back, { error: "Choose a class or a student." });
  const { data, error } = await supabase.rpc("add_charge", { sid: school.id, sess: session!.id, p_students: students, p_class: cls, p_section: sec, p_head: uuid(f, "fee_head_id"), p_label: label, p_due: due, p_amount: amount });
  go(back, error ? { error: errMsg(error) } : { ok: `Charge added to ${data} student(s).` });
}

export async function runLateFines() {
  const { supabase, school } = await requirePerm("fees.dues.create");
  const { data, error } = await supabase.rpc("apply_late_fines", { sid: school.id });
  go("/app/fees/charges", error ? { error: errMsg(error) } : { ok: `Late fine updated on ${data} instalment(s).` });
}

export async function carryForward(f: FormData) {
  const { supabase, school } = await requirePerm("fees.dues.create");
  const back = "/app/fees/charges";
  const from = uuid(f, "from_session"), to = uuid(f, "to_session"), due = date(f, "due_date");
  if (!from || !to || !due) go(back, { error: "Choose both sessions and the due date." });
  const { data, error } = await supabase.rpc("carry_forward_dues", { sid: school.id, from_sess: from, to_sess: to, p_due: due });
  go(back, error ? { error: errMsg(error) } : { ok: `Arrears carried forward for ${data} student(s).` });
}

/* ───────────── Cheques ───────────── */
export async function chequeStatus(f: FormData) {
  const { supabase } = await requirePerm("fees.collection.create");
  const back = "/app/fees/cheques";
  const status = oneOf(f, "status", ["deposited", "cleared", "bounced"] as const, "deposited");
  const { error } = await supabase.rpc("set_cheque_status", { cid: uuid(f, "id"), p_status: status, p_day: date(f, "day"), p_reason: str(f, "reason", 200) });
  go(back, error ? { error: errMsg(error) } : { ok: status === "bounced" ? "Cheque marked bounced — the receipt is cancelled and the dues are back." : "Cheque updated." });
}

/* ───────────── Refunds ───────────── */
export async function requestRefund(f: FormData) {
  const { supabase, school } = await requirePerm("fees.refunds.create");
  const back = "/app/fees/refunds";
  const { error } = await supabase.rpc("request_refund", { sid: school.id, stu: uuid(f, "student_id"), p_amount: money2(num(f, "amount")), p_reason: str(f, "reason", 200) ?? "" });
  go(back, error ? { error: errMsg(error) } : { ok: "Refund requested. The principal will approve it." });
}

export async function decideRefund(f: FormData) {
  const { supabase } = await requirePerm("fees.refunds.approve");
  const approve = f.get("decision") === "approve";
  const { error } = await supabase.rpc("decide_refund", { rid: uuid(f, "id"), p_approve: approve, p_note: str(f, "note", 200) });
  go("/app/fees/refunds", error ? { error: errMsg(error) } : { ok: approve ? "Refund approved." : "Refund rejected." });
}

export async function payRefund(f: FormData) {
  const { supabase } = await requirePerm("fees.refunds.view");
  const mode = oneOf(f, "mode", ["cash", "upi", "cheque", "bank_transfer"] as const, "cash");
  const { error } = await supabase.rpc("pay_refund", { rid: uuid(f, "id"), p_mode: mode, p_ref: str(f, "reference", 80), p_paid_on: date(f, "paid_on") });
  go("/app/fees/refunds", error ? { error: errMsg(error) } : { ok: "Refund paid and the wallet reduced." });
}

/* ───────────── Day close ───────────── */
export async function closeDay(f: FormData) {
  const { supabase, school } = await requirePerm("fees.collection.create");
  const day = date(f, "day");
  const back = `/app/fees/daybook?day=${day ?? ""}`;
  const counted = num(f, "counted");
  if (!day || counted === null || counted < 0) go(back, { error: "Enter the cash counted." });
  const { error } = await supabase.rpc("close_day", { sid: school.id, p_day: day, p_collector: String(f.get("collector") ?? ""), p_counted: counted, p_note: str(f, "note", 200) });
  go(back, error ? { error: errMsg(error) } : { ok: "Day closed." });
}

/* ───────────── Promise to pay ───────────── */
export async function addPromise(f: FormData) {
  const { supabase, school } = await requirePerm("fees.defaulters.create", "fees.collection.create");
  const student = uuid(f, "student_id");
  const back = String(f.get("back") ?? "").startsWith("/app/fees") ? String(f.get("back")) : `/app/fees/collect?student=${student}`;
  const { error } = await supabase.rpc("add_fee_followup", { sid: school.id, stu: student, p_on: date(f, "promised_on"), p_amount: money2(num(f, "amount")), p_note: str(f, "note", 200) });
  go(back, error ? { error: errMsg(error) } : { ok: "Promise recorded." });
}

export async function closePromise(f: FormData) {
  const { supabase } = await requirePerm("fees.defaulters.create", "fees.collection.create");
  const status = oneOf(f, "status", ["kept", "broken", "closed"] as const, "closed");
  const { error } = await supabase.rpc("close_fee_followup", { fid: uuid(f, "id"), p_status: status });
  go("/app/fees/followups", error ? { error: errMsg(error) } : { ok: "Updated." });
}

/* ───────────── Structure tools ───────────── */
export async function copyClassPlans(f: FormData) {
  const { supabase, school, session } = await requirePerm("fees.structure.create");
  const back = "/app/fees/charges";
  const from = uuid(f, "from_class"), to = ids(f, "to_class");
  if (!session || !from || !to.length) go(back, { error: "Choose the class to copy from and at least one class to copy to." });
  const { data, error } = await supabase.rpc("copy_fee_plans", { sid: school.id, sess: session!.id, from_class: from, to_classes: to });
  go(back, error ? { error: errMsg(error) } : { ok: `${data} instalment(s) copied. Click “Generate dues” in Fee structure to bill students.` });
}

export async function copySessionPlans(f: FormData) {
  const { supabase, school } = await requirePerm("fees.structure.create");
  const back = "/app/fees/charges";
  const from = uuid(f, "from_session"), to = uuid(f, "to_session");
  if (!from || !to) go(back, { error: "Choose both sessions." });
  const { data, error } = await supabase.rpc("copy_session_plans", { sid: school.id, from_sess: from, to_sess: to, p_years: Math.round(num(f, "years") ?? 1), p_increase_percent: num(f, "increase") ?? 0 });
  go(back, error ? { error: errMsg(error) } : { ok: `${data} instalment(s) copied to the new session.` });
}

export async function siblingDiscount(f: FormData) {
  const { supabase, school } = await requirePerm("fees.concessions.create");
  const student = uuid(f, "student_id");
  const { data, error } = await supabase.rpc("apply_sibling_discount", { sid: school.id, stu: student });
  go(`/app/fees/collect?student=${student}`, error ? { error: errMsg(error) } : data ? { ok: "Sibling discount applied to the unpaid instalments." } : { error: "No sibling found, or the discount is already applied." });
}

/* ───────────── Payment gateway / payment link (staff) ───────────── */
export async function createPaymentLink(f: FormData) {
  const { school, myName } = await requirePerm("fees.online.create");
  const student = uuid(f, "student_id");
  const back = `/app/fees/collect?student=${student}`;
  const channel = oneOf(f, "channel", ["link", "gateway"] as const, "link");
  const amount = money2(num(f, "amount"));
  if (!student || !amount || amount <= 0) go(back, { error: "Enter the amount to collect." });
  const rz = await resolveIntegration(school.id, "razorpay");
  if (!rz || rz.source !== "school" || !rz.config.key_id || !rz.secrets.key_secret) go(back, { error: "Connect the school's Razorpay account first (Settings → Integrations → Razorpay)." });
  const db = supabaseAdmin();
  if (!db) go(back, { error: "SUPABASE_SECRET_KEY is not configured." });
  const { data: stu } = await db!.from("students").select("id,first_name,last_name,admission_no,guardian_phone").eq("id", student!).eq("school_id", school.id).maybeSingle();
  if (!stu) go(back, { error: "Student not found." });
  const phone = str(f, "phone", 15) ?? stu!.guardian_phone;
  const { data: oid, error } = await db!.rpc("create_online_order", { sid: school.id, stu: student, p_amount: amount, p_due_ids: null, p_channel: channel, p_by: myName || null, p_note: str(f, "note", 200), p_phone: phone });
  if (error || !oid) go(back, { error: errMsg(error, "Could not create the link.") });
  try {
    const link = await createRazorpayLink({ keyId: rz!.config.key_id, keySecret: rz!.secrets.key_secret }, {
      amountInr: amount, currency: "INR", description: `School fee · ${stu!.first_name} ${stu!.last_name ?? ""} · Adm. ${stu!.admission_no}`.trim(),
      referenceId: String(oid), customer: { name: [stu!.first_name, stu!.last_name].filter(Boolean).join(" "), contact: phone },
      callbackUrl: undefined, expireBy: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
    });
    await db!.from("fee_online_orders").update({ link_id: link.id, link_url: link.url }).eq("id", oid as string);
  } catch (e) {
    await db!.from("fee_online_orders").update({ status: "failed", error: String((e as Error).message).slice(0, 300) }).eq("id", oid as string);
    go(back, { error: `The payment page could not be created: ${(e as Error).message}` });
  }
  go(`${back}&link=${oid}`, { ok: channel === "gateway" ? "Payment page ready — open it and let the payer complete the payment." : "Payment link ready — share it with the parent." });
}

export async function cancelPaymentLink(f: FormData) {
  const { supabase, school } = await requirePerm("fees.online.create");
  const id = uuid(f, "id");
  const back = String(f.get("back") ?? "").startsWith("/app/fees") ? String(f.get("back")) : "/app/fees/links";
  const { data: linkId, error } = await supabase.rpc("cancel_payment_link", { oid: id });
  if (error) go(back, { error: errMsg(error) });
  // also close it at Razorpay so it cannot be paid by mistake (best effort)
  const rz = await resolveIntegration(school.id, "razorpay");
  if (rz?.source === "school" && linkId && rz.config.key_id && rz.secrets.key_secret) {
    const auth = Buffer.from(`${rz.config.key_id}:${rz.secrets.key_secret}`).toString("base64");
    await fetch(`https://api.razorpay.com/v1/payment_links/${linkId}/cancel`, { method: "POST", headers: { Authorization: `Basic ${auth}` } }).catch(() => null);
  }
  go(back, { ok: "Payment link cancelled." });
}

export async function seedFeeTemplates() {
  const { supabase, school } = await requirePerm("fees.structure.edit", "documents.templates.create");
  const { data, error } = await supabase.rpc("seed_fee_templates", { sid: school.id });
  go("/app/fees/templates", error ? { error: errMsg(error) } : { ok: data ? `${data} template(s) added.` : "The standard templates are already there." });
}
