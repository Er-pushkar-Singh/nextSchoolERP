"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requirePerm } from "@/lib/school";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { date, errMsg, go, oneOf, str, uuid } from "@/lib/action-util";
import { CHANNELS, EVENTS, processOutbox, queueMessages, type Lang, type MsgEvent, type Recipient } from "@/lib/messages";
import { notifyFeeReminders } from "@/lib/message-events";
import type { Channel } from "@/lib/prefs";
import { fullName, todayIST } from "@/lib/format";
import { appUrl } from "@/lib/brand";

const back = (f: FormData, fallback: string) => {
  const b = str(f, "back", 300);
  return b && /^\/app\/(messages|fees|settings)(\/[a-z-]+)*(\?[^#\s]*)?$/.test(b) ? b : fallback;
};

/** Sends what is due now for this school (the page-level "Send now" and the tail of every action that queues). */
export async function sendQueuedNow(f: FormData) {
  const { school } = await requirePerm("comms.outbox.create", "comms.outbox.edit", "comms.outbox.view");
  const r = await processOutbox({ schoolId: school.id, limit: 50 });
  revalidatePath("/app/messages");
  go(back(f, "/app/messages"), { ok: r.picked ? `Tried ${r.picked}: ${r.sent} sent${r.retry ? `, ${r.retry} will retry` : ""}${r.failed ? `, ${r.failed} failed` : ""}.` : "Nothing is waiting to be sent." });
}

export async function retryMessage(f: FormData) {
  const { supabase, school } = await requirePerm("comms.outbox.edit");
  const { error } = await supabase.rpc("outbox_retry", { sid: school.id, p_id: uuid(f, "id")! });
  after(() => processOutbox({ schoolId: school.id, limit: 10 }));
  revalidatePath("/app/messages");
  go(back(f, "/app/messages"), error ? { error: errMsg(error) } : { ok: "Queued again." });
}

export async function cancelMessage(f: FormData) {
  const { supabase, school } = await requirePerm("comms.outbox.edit");
  const { error } = await supabase.rpc("outbox_cancel", { sid: school.id, p_id: uuid(f, "id")! });
  revalidatePath("/app/messages");
  go(back(f, "/app/messages"), error ? { error: errMsg(error) } : { ok: "Cancelled." });
}

/* ───────── Templates ───────── */
export async function saveTemplate(f: FormData) {
  const { supabase, school, myName } = await requirePerm("comms.templates.edit", "comms.templates.create");
  const event = oneOf(f, "event", Object.keys(EVENTS) as MsgEvent[], "custom");
  const channel = oneOf(f, "channel", CHANNELS, "whatsapp");
  const language = oneOf(f, "language", ["en", "hi"] as const, "en");
  const to = `/app/messages/templates?event=${event}`;
  const body = str(f, "body", 1000);
  if (EVENTS[event].platform) go(to, { error: "Platform messages are written by CodersDuniya." });
  if (f.get("reset") === "1") {
    const { error } = await supabase.from("message_templates").delete().eq("school_id", school.id).eq("event", event).eq("channel", channel).eq("language", language);
    go(to, error ? { error: errMsg(error) } : { ok: "Back to the standard wording." });
  }
  if (!body) go(to, { error: "Write the message." });
  const unknown = [...body!.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()).filter((k) => !EVENTS[event].vars.includes(k));
  if (unknown.length) go(to, { error: `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${[...new Set(unknown)].map((u) => `{{${u}}}`).join(", ")}. Allowed: ${EVENTS[event].vars.map((v) => `{{${v}}}`).join(" ")}` });
  const { error } = await supabase.from("message_templates").upsert({
    school_id: school.id, event, channel, language, body, subject: channel === "email" ? str(f, "subject", 200) : null, provider_template: str(f, "provider_template", 120),
    active: f.get("active") !== "off", updated_at: new Date().toISOString(), updated_by_name: myName || null,
  }, { onConflict: "school_id,event,channel,language" });
  go(to, error ? { error: errMsg(error) } : { ok: "Template saved." });
}

/* ───────── Compose (broadcast) ───────── */
export async function composeMessage(f: FormData) {
  const { supabase, school, myName } = await requirePerm("comms.broadcast.create");
  const to = "/app/messages/compose";
  const text = str(f, "body", 600);
  if (!text) go(to, { error: "Write the message." });
  const channels = f.getAll("channel").map(String).filter((c): c is Channel => (CHANNELS as string[]).includes(c));
  if (!channels.length) go(to, { error: "Choose at least one channel." });
  const audience = oneOf(f, "audience", ["school", "class", "section", "defaulters", "staff", "numbers"] as const, "school");
  const language: Lang = f.get("language") === "hi" ? "hi" : "en";
  const db = supabaseAdmin();
  if (!db) go(to, { error: "The server key is not configured." });
  const { data: sc } = await db!.from("schools").select("name").eq("id", school.id).maybeSingle();
  const vars = { body: text!, school: sc?.name ?? "School" };
  const stamp = Date.now().toString(36);
  const recipients: Recipient[] = [];

  if (audience === "numbers") {
    const items = (str(f, "numbers", 2000) ?? "").split(/[\s,;]+/).filter(Boolean);
    items.forEach((x, i) => recipients.push(x.includes("@") ? { email: x, vars, language, dedupe: `custom:${stamp}:${i}` } : { phone: x, vars, language, dedupe: `custom:${stamp}:${i}` }));
  } else if (audience === "staff") {
    const { data } = await db!.from("staff").select("id,name,phone,email").eq("school_id", school.id).eq("status", "active").limit(5000);
    for (const s of data ?? []) recipients.push({ name: s.name, phone: s.phone, email: s.email, vars, language, dedupe: `custom:${stamp}:${s.id}` });
  } else {
    let q = db!.from("students").select("id,first_name,middle_name,last_name,guardian_phone,guardian_email,msg_opt_out,class_id,section_id").eq("school_id", school.id).eq("status", "active").limit(20000);
    const cls = uuid(f, "class_id"), sec = uuid(f, "section_id");
    if (audience === "class" || audience === "section") {
      if (!cls) go(to, { error: "Choose the class." });
      q = q.eq("class_id", cls!);
      if (audience === "section") { if (!sec) go(to, { error: "Choose the section." }); q = q.eq("section_id", sec!); }
    }
    const { data } = await q;
    let list = (data ?? []) as { id: string; first_name: string; middle_name: string | null; last_name: string | null; guardian_phone: string | null; guardian_email: string | null; msg_opt_out: boolean }[];
    if (audience === "defaulters") {
      const { data: dues } = await db!.from("fee_dues").select("student_id,amount,concession,fine,paid").eq("school_id", school.id).lte("due_date", todayIST()).limit(50000);
      const owing = new Set((dues ?? []).filter((d) => Number(d.amount) - Number(d.concession) + Number(d.fine) - Number(d.paid) > 0).map((d) => d.student_id));
      list = list.filter((s) => owing.has(s.id));
    }
    // siblings share a number: one message per number
    const seen = new Set<string>();
    for (const s of list) {
      const key = (s.guardian_phone ?? "").replace(/\D/g, "").slice(-10) || (s.guardian_email ?? "").toLowerCase() || s.id;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push({ name: fullName(s), phone: s.guardian_phone, email: s.guardian_email, studentId: s.id, optedOut: s.msg_opt_out, vars, language, dedupe: `custom:${stamp}:${key}` });
    }
  }
  if (!recipients.length) go(to, { error: "Nobody matches this audience." });
  const cap = 5000;
  if (recipients.length > cap) go(to, { error: `That is ${recipients.length} people — please send to at most ${cap} at a time.` });
  const at = str(f, "send_at", 25);
  const sendAt = at ? new Date(`${at}:00+05:30`) : null;
  if (sendAt && Number.isNaN(sendAt.getTime())) go(to, { error: "The schedule time is not valid." });
  void supabase;
  const r = await queueMessages({ schoolId: school.id, event: "custom", recipients, channels, sendAt, by: myName || null, urgent: Boolean(f.get("ignore_quiet")) });
  if (!sendAt || sendAt.getTime() <= Date.now() + 60_000) after(() => processOutbox({ schoolId: school.id, limit: 50 }));
  revalidatePath("/app/messages");
  go("/app/messages", { ok: `Queued ${r.queued} message${r.queued === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} could not be sent (see “Skipped”)` : ""}${sendAt ? ` for ${sendAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}.` });
}

/* ───────── Fee reminders from the defaulters screen ───────── */
export async function sendFeeReminders(f: FormData) {
  const { supabase, school, myName } = await requirePerm("fees.defaulters.view");
  const ids = f.getAll("student_id").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const day = date(f, "on") ?? todayIST();
  const target = back(f, "/app/fees/defaulters");
  const cls = uuid(f, "class_id");
  const { data: sess } = await supabase.from("sessions").select("id").eq("school_id", school.id).eq("is_current", true).maybeSingle();
  if (!sess) go(target, { error: "No current session." });
  const { data } = await supabase.rpc("defaulters", { sid: school.id, sess: sess!.id, on_day: day, cls, min_amount: 1 }).limit(5000);
  const rows = ((data ?? []) as { student_id: string; overdue: number; oldest_due: string }[]).filter((r) => !ids.length || ids.includes(r.student_id));
  if (!rows.length) go(target, { error: "No defaulters to remind." });
  const r = await notifyFeeReminders(school.id, rows.map((d) => ({ studentId: d.student_id, amount: Number(d.overdue), dueDate: d.oldest_due, stage: `m${day}` })), myName || null);
  after(() => processOutbox({ schoolId: school.id, limit: 50 }));
  revalidatePath("/app/messages");
  go(target, { ok: r ? `Reminders queued for ${r.queued} parent${r.queued === 1 ? "" : "s"}${r.skipped ? ` · ${r.skipped} skipped (no contact / channel)` : ""}${r.duplicates ? ` · ${r.duplicates} already sent today` : ""}. See Messages for the status.` : "Could not queue reminders." });
}

/* ───────── Parent opt-out ───────── */
export async function setMessageOptOut(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.edit");
  const id = uuid(f, "student_id");
  const { error } = await supabase.from("students").update({ msg_opt_out: f.get("opt_out") === "1" }).eq("id", id!).eq("school_id", school.id);
  go(`/app/students/${id}`, error ? { error: errMsg(error) } : { ok: f.get("opt_out") === "1" ? "Automatic messages to this family are switched off." : "Automatic messages are on again." });
}

/** A small "does it work end to end" check from the Messages page: queues one message to the signed-in staff member's choice. */
export async function sendTestMessage(f: FormData) {
  const { school, myName } = await requirePerm("comms.broadcast.create", "settings.integrations.edit");
  const channel = oneOf(f, "channel", CHANNELS, "email");
  const target = str(f, "to", 120);
  if (!target) go("/app/messages", { error: "Enter an email address or mobile number." });
  const r = await queueMessages({
    schoolId: school.id, event: "custom", channels: [channel], urgent: true, by: myName || null,
    recipients: [{ name: "Test", phone: channel === "email" ? null : target, email: channel === "email" ? target : null, dedupe: `test:${Date.now()}`,
      vars: { body: `This is a test message from ${school.name}. ${appUrl("/app")}`, school: school.name } }],
  });
  const p = await processOutbox({ schoolId: school.id, limit: 5 });
  revalidatePath("/app/messages");
  go("/app/messages", r.skipped ? { error: "Could not send: no connected account or valid contact for that channel (see the Skipped list)." } : { ok: `Test queued — ${p.sent} sent, ${p.retry + p.failed} not delivered yet. Check the list below.` });
}
