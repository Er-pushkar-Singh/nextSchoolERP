import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { appUrl } from "./brand";
import { fmtDate, fullName, todayIST } from "./format";
import { queueMessages, validMobile, type Recipient } from "./messages";

/* Producers: each turns something that happened into outbox rows. They never throw into the user's action — a failure to
   queue is logged and the action carries on (rule: a user action never depends on a message provider). */

type StuRow = {
  id: string; first_name: string; middle_name?: string | null; last_name: string | null; guardian_phone: string | null; guardian_email: string | null; msg_opt_out: boolean;
  portal_token?: string; classes?: { name: string } | { name: string }[] | null; sections?: { name: string } | { name: string }[] | null;
};
const SEL = "id,first_name,middle_name,last_name,guardian_phone,guardian_email,msg_opt_out,portal_token,classes!class_id(name),sections(name)";
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const rs = (n: number | string) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const safe = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  try { return await fn(); } catch (e) { console.error(`[messages] ${label}:`, (e as Error).message); return null; }
};
const schoolName = async (schoolId: string) => (await supabaseAdmin()?.from("schools").select("name").eq("id", schoolId).maybeSingle())?.data?.name ?? "School";
const stuClass = (s: StuRow) => [one(s.classes)?.name, one(s.sections)?.name].filter(Boolean).join("-");

async function students(schoolId: string, ids: string[]) {
  const db = supabaseAdmin();
  const out: StuRow[] = [];
  if (!db) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("students").select(SEL).eq("school_id", schoolId).in("id", ids.slice(i, i + 200));
    out.push(...((data ?? []) as unknown as StuRow[]));
  }
  return out;
}

/** One person per phone number (siblings share a number: they get one message, not one per child). */
function byContact<T extends { phone: string | null; email: string | null; id: string }>(list: T[]) {
  const seen = new Map<string, T[]>();
  for (const s of list) {
    const k = validMobile(s.phone) ?? s.email?.toLowerCase() ?? `id:${s.id}`;
    seen.set(k, [...(seen.get(k) ?? []), s]);
  }
  return [...seen.entries()];
}

/** After a fee receipt is created. */
export function notifyFeeReceipt(schoolId: string, receiptId: string, by?: string | null) {
  return safe("fee receipt", async () => {
    const db = supabaseAdmin();
    if (!db) return;
    const { data: r } = await db.from("fee_receipts").select("id,receipt_no,amount,student_id,cancelled").eq("id", receiptId).eq("school_id", schoolId).maybeSingle();
    if (!r || r.cancelled) return;
    const [s] = await students(schoolId, [r.student_id]);
    if (!s) return;
    const { data: dues } = await db.from("fee_dues").select("amount,concession,fine,paid").eq("student_id", r.student_id);
    const balance = (dues ?? []).reduce((t, d) => t + Math.max(Number(d.amount) - Number(d.concession) + Number(d.fine) - Number(d.paid), 0), 0);
    const school = await schoolName(schoolId);
    await queueMessages({
      schoolId, event: "fee_receipt", by, urgent: true,
      recipients: [{ name: fullName(s), phone: s.guardian_phone, email: s.guardian_email, studentId: s.id, optedOut: s.msg_opt_out, dedupe: `fee_receipt:${r.id}`,
        vars: { student: fullName(s), amount: rs(r.amount), receipt_no: r.receipt_no, balance: rs(balance), school } } as Recipient],
    });
  });
}

/** After attendance is saved: one message per absent student per day. */
export function notifyAbsent(schoolId: string, studentIds: string[], day: string, by?: string | null) {
  return safe("absent", async () => {
    if (!studentIds.length) return;
    const school = await schoolName(schoolId);
    const list = await students(schoolId, studentIds);
    await queueMessages({
      schoolId, event: "absent", by,
      recipients: list.map((s) => ({ name: fullName(s), phone: s.guardian_phone, email: s.guardian_email, studentId: s.id, optedOut: s.msg_opt_out, dedupe: `absent:${s.id}:${day}`,
        vars: { student: fullName(s), class: stuClass(s), date: fmtDate(day), school } })),
    });
  });
}

/** When an exam's results are published. */
export function notifyResult(schoolId: string, examId: string, by?: string | null) {
  return safe("result", async () => {
    const db = supabaseAdmin();
    if (!db) return;
    const [{ data: ex }, { data: er }] = await Promise.all([
      db.from("exams").select("name").eq("id", examId).eq("school_id", schoolId).maybeSingle(),
      db.from("exam_results").select("student_id").eq("exam_id", examId).eq("school_id", schoolId).neq("result", "withheld").limit(20000),
    ]);
    let ids = [...new Set((er ?? []).map((r) => r.student_id as string))];
    if (!ids.length) {
      const { data: m } = await db.from("marks").select("student_id").eq("exam_id", examId).eq("school_id", schoolId).limit(50000);
      ids = [...new Set((m ?? []).map((r) => r.student_id as string))];
    }
    if (!ex || !ids.length) return;
    const school = await schoolName(schoolId);
    const list = await students(schoolId, ids);
    await queueMessages({
      schoolId, event: "exam_result", by,
      recipients: list.map((s) => ({ name: fullName(s), phone: s.guardian_phone, email: s.guardian_email, studentId: s.id, optedOut: s.msg_opt_out, dedupe: `exam_result:${examId}:${s.id}`,
        vars: { student: fullName(s), exam: ex.name, link: appUrl(`/p/${s.portal_token}`), school } })),
    });
  });
}

/** A published notice goes to the parents of its class (or the whole school). */
export function notifyNotice(schoolId: string, noticeId: string, by?: string | null) {
  return safe("notice", async () => {
    const db = supabaseAdmin();
    if (!db) return;
    const { data: n } = await db.from("notices").select("id,title,body,class_id").eq("id", noticeId).eq("school_id", schoolId).maybeSingle();
    if (!n) return;
    let q = db.from("students").select(SEL).eq("school_id", schoolId).eq("status", "active").limit(20000);
    if (n.class_id) q = q.eq("class_id", n.class_id);
    const { data } = await q;
    const list = (data ?? []) as unknown as StuRow[];
    const school = await schoolName(schoolId);
    const groups = byContact(list.map((s) => ({ ...s, phone: s.guardian_phone, email: s.guardian_email })));
    await queueMessages({
      schoolId, event: "notice", by,
      recipients: groups.map(([key, g]) => ({
        name: g.map((s) => fullName(s)).join(", "), phone: g[0].guardian_phone, email: g[0].guardian_email, studentId: g[0].id, optedOut: g.every((s) => s.msg_opt_out),
        dedupe: `notice:${n.id}:${key}`, vars: { title: n.title, body: (n.body ?? "").replace(/\s+/g, " ").slice(0, 160), school },
      })),
    });
  });
}

export type ReminderItem = { studentId: string; amount: number; dueDate: string; stage: string };
/** Fee reminders for the given students (the defaulters screen, or the daily job). */
export function notifyFeeReminders(schoolId: string, items: ReminderItem[], by?: string | null) {
  return safe("fee reminders", async () => {
    if (!items.length) return null;
    const school = await schoolName(schoolId);
    const list = await students(schoolId, items.map((i) => i.studentId));
    const by_id = new Map(list.map((s) => [s.id, s]));
    const recipients: Recipient[] = [];
    for (const i of items) {
      const s = by_id.get(i.studentId);
      if (!s) continue;
      recipients.push({
        name: fullName(s), phone: s.guardian_phone, email: s.guardian_email, studentId: s.id, optedOut: s.msg_opt_out, dedupe: `fee_reminder:${s.id}:${i.dueDate}:${i.stage}`,
        vars: { student: fullName(s), amount: rs(i.amount), due_date: fmtDate(i.dueDate), link: appUrl(`/p/${s.portal_token}`), school },
      });
    }
    return queueMessages({ schoolId, event: "fee_reminder", recipients, by });
  });
}

/** Daily job: reminders 3 days before, on the day, and 7 / 15 / 30 days after an instalment's due date. */
export async function runFeeReminderJob() {
  const db = supabaseAdmin();
  if (!db) return { schools: 0, queued: 0 };
  const today = todayIST();
  const day = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86400_000).toISOString().slice(0, 10);
  const stages: [string, string][] = [["-3", day(-3)], ["0", day(0)], ["7", day(7)], ["15", day(15)], ["30", day(30)]];
  const { data: schools } = await db.from("schools").select("id").is("archived_at", null).limit(2000);
  let queued = 0, n = 0;
  for (const sc of schools ?? []) {
    const { data: due } = await db.from("fee_dues").select("student_id,due_date,amount,concession,fine,paid").eq("school_id", sc.id).in("due_date", stages.map((s) => s[1])).limit(20000);
    const items: ReminderItem[] = [];
    for (const d of due ?? []) {
      const bal = Number(d.amount) - Number(d.concession) + Number(d.fine) - Number(d.paid);
      if (bal <= 0) continue;
      items.push({ studentId: d.student_id, amount: bal, dueDate: d.due_date, stage: stages.find((s) => s[1] === d.due_date)![0] });
    }
    if (!items.length) continue;
    n++;
    const r = await notifyFeeReminders(sc.id, items, "auto");
    queued += r?.queued ?? 0;
  }
  return { schools: n, queued };
}

/** CodersDuniya → a school (invoice issued / paid). Goes through the platform account. */
export function notifyPlatformInvoice(invoiceId: string, kind: "invoice_issued" | "invoice_paid") {
  return safe("platform invoice", async () => {
    const db = supabaseAdmin();
    if (!db) return;
    const { data: inv } = await db.from("subscription_invoices").select("id,number,total,due_date,razorpay_link_url,school_id,schools(name,email,phone)").eq("id", invoiceId).maybeSingle();
    if (!inv) return;
    const sc = one(inv.schools as unknown as { name: string; email: string | null; phone: string | null } | { name: string; email: string | null; phone: string | null }[] | null);
    if (!sc) return;
    await queueMessages({
      schoolId: null, event: kind, channels: ["email", "whatsapp", "sms"], urgent: true, by: "platform",
      recipients: [{ name: sc.name, phone: sc.phone, email: sc.email, dedupe: `${kind}:${inv.id}`,
        vars: { school: sc.name, invoice_no: inv.number, amount: rs(inv.total), due_date: fmtDate(inv.due_date), link: inv.razorpay_link_url ?? appUrl("/app/settings/billing") } }],
    });
  });
}

/* ───────────── school property: given, returned, overdue ───────────── */
type AssetRow = {
  id: string; school_id: string; qty: number; tag: string | null; due_back: string | null; holder_kind: "location" | "staff" | "student" | "department"; status: string; return_condition: string | null;
  staff_id: string | null; student_id: string | null; location_id: string | null; department: string | null; assigned_by_name: string | null;
  inventory_items: { name: string; variant: string | null } | { name: string; variant: string | null }[] | null;
  inventory_locations: { name: string; in_charge_staff_id: string | null } | { name: string; in_charge_staff_id: string | null }[] | null;
};
const ASSET_SEL = "id,school_id,qty,tag,due_back,holder_kind,status,return_condition,staff_id,student_id,location_id,department,assigned_by_name,inventory_items(name,variant),inventory_locations(name,in_charge_staff_id)";
const COND: Record<string, string> = { good: "in good condition", needs_repair: "needs repair", damaged: "damaged", lost: "lost" };

/** Who should hear about a piece of property: the staff member, the student's parent, or a room's in-charge. */
async function assetRecipient(schoolId: string, a: AssetRow): Promise<(Omit<Recipient, "vars" | "dedupe"> & { holder: string }) | null> {
  const db = supabaseAdmin();
  if (!db) return null;
  if (a.holder_kind === "staff" && a.staff_id) {
    const { data: w } = await db.from("staff").select("name,phone,email").eq("id", a.staff_id).eq("school_id", schoolId).maybeSingle();
    return w ? { name: w.name, phone: w.phone, email: w.email, holder: w.name } : null;
  }
  if (a.holder_kind === "student" && a.student_id) {
    const [s] = await students(schoolId, [a.student_id]);
    if (!s) return null;
    const { data: own } = await db.from("students").select("email").eq("id", a.student_id).maybeSingle();
    return { name: fullName(s), phone: s.guardian_phone, email: s.guardian_email ?? own?.email ?? null, studentId: s.id, optedOut: s.msg_opt_out, holder: fullName(s) };
  }
  const loc = one(a.inventory_locations);
  if (a.holder_kind === "location" && loc?.in_charge_staff_id) {
    const { data: w } = await db.from("staff").select("name,phone,email").eq("id", loc.in_charge_staff_id).eq("school_id", schoolId).maybeSingle();
    return w ? { name: w.name, phone: w.phone, email: w.email, holder: loc.name } : null;
  }
  return null;
}
const itemName = (a: AssetRow) => { const i = one(a.inventory_items); return i ? `${i.name}${i.variant ? ` (${i.variant})` : ""}` : "item"; };

/** After an assignment is made: an email (and WhatsApp / SMS if the school switched them on) to the person who now holds it. */
export function notifyAssetAssigned(schoolId: string, assignmentId: string, by?: string | null) {
  return safe("asset assigned", async () => {
    const db = supabaseAdmin();
    if (!db) return;
    const { data } = await db.from("inventory_assignments").select(ASSET_SEL).eq("id", assignmentId).eq("school_id", schoolId).maybeSingle();
    const a = data as unknown as AssetRow | null;
    if (!a) return;
    const r = await assetRecipient(schoolId, a);
    if (!r) return;
    const school = await schoolName(schoolId);
    await queueMessages({
      schoolId, event: "asset_assigned", by, urgent: true,
      recipients: [{ name: r.name, phone: r.phone, email: r.email, studentId: r.studentId, optedOut: r.optedOut, dedupe: `asset_assigned:${a.id}`,
        vars: { holder: r.holder, item: itemName(a), qty: String(a.qty), tag: a.tag ? ` (tag ${a.tag})` : "", due_back: a.due_back ? fmtDate(a.due_back) : "until further notice", school, by: a.assigned_by_name ?? "the school office" } }],
    });
  });
}

/** After a return (the closed row's id): an acknowledgement, with the condition it came back in. */
export function notifyAssetReturned(schoolId: string, assignmentId: string, by?: string | null) {
  return safe("asset returned", async () => {
    const db = supabaseAdmin();
    if (!db) return;
    const { data } = await db.from("inventory_assignments").select(ASSET_SEL).eq("id", assignmentId).eq("school_id", schoolId).maybeSingle();
    const a = data as unknown as AssetRow | null;
    if (!a) return;
    const r = await assetRecipient(schoolId, a);
    if (!r) return;
    const school = await schoolName(schoolId);
    await queueMessages({
      schoolId, event: "asset_returned", by, urgent: true,
      recipients: [{ name: r.name, phone: r.phone, email: r.email, studentId: r.studentId, optedOut: r.optedOut, dedupe: `asset_returned:${a.id}`,
        vars: { holder: r.holder, item: itemName(a), qty: String(a.qty), condition: COND[a.return_condition ?? "good"] ?? "received", school } }],
    });
  });
}

/** Daily job: a reminder every week for property that is past its return date. */
export async function runAssetOverdueJob() {
  const db = supabaseAdmin();
  if (!db) return { queued: 0 };
  const today = todayIST();
  const week = `${today.slice(0, 4)}-w${Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${today.slice(0, 4)}-01-01T00:00:00Z`)) / (7 * 86400_000))}`;
  const { data } = await db.from("inventory_assignments").select(ASSET_SEL).eq("status", "active").lt("due_back", today).in("holder_kind", ["staff", "student"]).limit(5000);
  let queued = 0;
  for (const a of (data ?? []) as unknown as AssetRow[]) {
    const r = await assetRecipient(a.school_id, a);
    if (!r) continue;
    const school = await schoolName(a.school_id);
    const q = await queueMessages({
      schoolId: a.school_id, event: "asset_overdue", by: "auto",
      recipients: [{ name: r.name, phone: r.phone, email: r.email, studentId: r.studentId, optedOut: r.optedOut, dedupe: `asset_overdue:${a.id}:${week}`,
        vars: { holder: r.holder, item: itemName(a), qty: String(a.qty), due_back: a.due_back ? fmtDate(a.due_back) : "", school } }],
    });
    queued += q.queued;
  }
  return { queued };
}