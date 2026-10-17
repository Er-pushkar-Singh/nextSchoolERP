import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { resolveIntegration, sendEmail, sendSms, sendWhatsAppTemplate, type Resolved } from "./integrations";
import { notifyOn, type Channel, type NotifyEvent, type SchoolPrefs } from "./prefs";

/* ─────────────────────────────────────────────────────────────────────────────
   Messaging core. Events enqueue rows in `message_outbox`; `processOutbox` sends them through the school's OWN account
   (Settings → Integrations), or the platform's shared account when the platform owner allows it. Platform messages
   (school = null) go through CodersDuniya's account. A user action never waits for a provider.
   ───────────────────────────────────────────────────────────────────────────── */

export type MsgEvent = NotifyEvent | "custom" | "invoice_issued" | "invoice_paid" | "welcome";   // NotifyEvent includes the property events
export type Lang = "en" | "hi";
export const CHANNELS: Channel[] = ["whatsapp", "sms", "email"];
export const CHANNEL_NAME: Record<Channel, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email" };

type EventDef = { name: string; platform?: boolean; vars: string[]; subject: Record<Lang, string>; text: Record<Lang, string> };

/** Built-in wording. A school can override any (event, channel, language) in Messages → Templates. */
export const EVENTS: Record<MsgEvent, EventDef> = {
  fee_receipt: {
    name: "Fee received", vars: ["student", "amount", "receipt_no", "balance", "school"],
    subject: { en: "Fee receipt {{receipt_no}} — {{student}}", hi: "फीस रसीद {{receipt_no}} — {{student}}" },
    text: {
      en: "Dear Parent, fee of Rs {{amount}} received for {{student}} (receipt {{receipt_no}}). Balance Rs {{balance}}. Thank you. — {{school}}",
      hi: "प्रिय अभिभावक, {{student}} की Rs {{amount}} फीस प्राप्त हुई (रसीद {{receipt_no}})। शेष Rs {{balance}}। धन्यवाद। — {{school}}",
    },
  },
  fee_reminder: {
    name: "Fee due reminder", vars: ["student", "amount", "due_date", "link", "school"],
    subject: { en: "Fee reminder — {{student}}", hi: "फीस अनुस्मारक — {{student}}" },
    text: {
      en: "Dear Parent, fee of Rs {{amount}} for {{student}} is pending (due {{due_date}}). Details and payment: {{link}} Please ignore if paid. — {{school}}",
      hi: "प्रिय अभिभावक, {{student}} की Rs {{amount}} फीस बकाया है (देय {{due_date}})। विवरण व भुगतान: {{link}} भुगतान हो चुका हो तो क्षमा करें। — {{school}}",
    },
  },
  absent: {
    name: "Absent alert", vars: ["student", "class", "date", "school"],
    subject: { en: "{{student}} was absent on {{date}}", hi: "{{student}} {{date}} को अनुपस्थित था/थी" },
    text: {
      en: "Dear Parent, {{student}} (Class {{class}}) is absent from school today, {{date}}. Please inform the class teacher of the reason. — {{school}}",
      hi: "प्रिय अभिभावक, {{student}} (कक्षा {{class}}) आज {{date}} को विद्यालय में अनुपस्थित है। कृपया कारण कक्षा अध्यापक को बताएँ। — {{school}}",
    },
  },
  exam_result: {
    name: "Result published", vars: ["student", "exam", "link", "school"],
    subject: { en: "{{exam}} result — {{student}}", hi: "{{exam}} परिणाम — {{student}}" },
    text: {
      en: "Dear Parent, the {{exam}} result of {{student}} is published. See it here: {{link}} — {{school}}",
      hi: "प्रिय अभिभावक, {{student}} का {{exam}} परिणाम घोषित हो गया है। देखें: {{link}} — {{school}}",
    },
  },
  notice: {
    name: "New notice / circular", vars: ["title", "body", "school"],
    subject: { en: "{{title}}", hi: "{{title}}" },
    text: { en: "Notice from {{school}}: {{title}}. {{body}}", hi: "{{school}} की सूचना: {{title}}। {{body}}" },
  },
  admission: {
    name: "Admission confirmed", vars: ["student", "admission_no", "link", "school"],
    subject: { en: "Admission confirmed — {{student}}", hi: "प्रवेश की पुष्टि — {{student}}" },
    text: {
      en: "Dear Parent, admission of {{student}} is confirmed. Admission no. {{admission_no}}. Parent page: {{link}} Welcome to {{school}}.",
      hi: "प्रिय अभिभावक, {{student}} का प्रवेश स्वीकृत हो गया है। प्रवेश संख्या {{admission_no}}। पेरेंट पेज: {{link}} {{school}} में आपका स्वागत है।",
    },
  },
  birthday: {
    name: "Birthday wishes", vars: ["student", "school"],
    subject: { en: "Happy birthday {{student}}!", hi: "जन्मदिन मुबारक {{student}}!" },
    text: { en: "Happy birthday {{student}}! Wishing you a wonderful year ahead. — {{school}}", hi: "जन्मदिन मुबारक {{student}}! आपका आने वाला वर्ष शुभ हो। — {{school}}" },
  },
  asset_assigned: {
    name: "School property given", vars: ["holder", "item", "qty", "tag", "due_back", "school", "by"],
    subject: { en: "{{item}} given to {{holder}} — {{school}}", hi: "{{item}} {{holder}} को दिया गया — {{school}}" },
    text: {
      en: "Dear {{holder}}, {{qty}} × {{item}}{{tag}} has been given to you by {{school}} on your name. Return date: {{due_back}}. Please take care of it and return it on time. — Issued by {{by}}",
      hi: "प्रिय {{holder}}, {{school}} द्वारा {{qty}} × {{item}}{{tag}} आपके नाम पर दिया गया है। वापसी की तिथि: {{due_back}}। कृपया इसका ध्यान रखें और समय पर लौटाएँ। — जारीकर्ता {{by}}",
    },
  },
  asset_returned: {
    name: "School property returned", vars: ["holder", "item", "qty", "condition", "school"],
    subject: { en: "{{item}} returned — {{school}}", hi: "{{item}} वापस प्राप्त — {{school}}" },
    text: {
      en: "Dear {{holder}}, we have received back {{qty}} × {{item}} ({{condition}}). Thank you. — {{school}}",
      hi: "प्रिय {{holder}}, {{qty}} × {{item}} ({{condition}}) वापस प्राप्त हो गया है। धन्यवाद। — {{school}}",
    },
  },
  leave_decided: {
    name: "Leave decision", vars: ["student", "decision", "dates", "note", "school"],
    subject: { en: "Leave {{decision}} — {{student}}", hi: "अवकाश {{decision}} — {{student}}" },
    text: {
      en: "Dear Parent, the leave request of {{student}} for {{dates}} has been {{decision}}. {{note}} — {{school}}",
      hi: "प्रिय अभिभावक, {{student}} के {{dates}} के अवकाश का अनुरोध {{decision}} किया गया है। {{note}} — {{school}}",
    },
  },
  asset_overdue: {
    name: "Property not returned on time", vars: ["holder", "item", "qty", "due_back", "school"],
    subject: { en: "Please return {{item}} — {{school}}", hi: "कृपया {{item}} लौटाएँ — {{school}}" },
    text: {
      en: "Dear {{holder}}, {{qty}} × {{item}} was due back on {{due_back}}. Please return it to the school at the earliest. — {{school}}",
      hi: "प्रिय {{holder}}, {{qty}} × {{item}} की वापसी की तिथि {{due_back}} थी। कृपया इसे शीघ्र विद्यालय में लौटाएँ। — {{school}}",
    },
  },
  custom: {
    name: "Message from the school", vars: ["body", "school"],
    subject: { en: "Message from {{school}}", hi: "{{school}} की ओर से संदेश" },
    text: { en: "{{body}} — {{school}}", hi: "{{body}} — {{school}}" },
  },
  invoice_issued: {
    name: "Subscription invoice", platform: true, vars: ["school", "invoice_no", "amount", "due_date", "link"],
    subject: { en: "Invoice {{invoice_no}} for {{school}}", hi: "इनवॉइस {{invoice_no}} — {{school}}" },
    text: {
      en: "Hello {{school}}, your School ERP invoice {{invoice_no}} of Rs {{amount}} is due on {{due_date}}. Pay online: {{link}}",
      hi: "नमस्ते {{school}}, आपका School ERP इनवॉइस {{invoice_no}} (Rs {{amount}}) {{due_date}} तक देय है। भुगतान: {{link}}",
    },
  },
  invoice_paid: {
    name: "Payment received", platform: true, vars: ["school", "invoice_no", "amount"],
    subject: { en: "Payment received — {{invoice_no}}", hi: "भुगतान प्राप्त — {{invoice_no}}" },
    text: { en: "Thank you {{school}}! We received Rs {{amount}} for invoice {{invoice_no}}.", hi: "धन्यवाद {{school}}! इनवॉइस {{invoice_no}} के Rs {{amount}} प्राप्त हुए।" },
  },
  welcome: {
    name: "Welcome", platform: true, vars: ["school", "link"],
    subject: { en: "Welcome to School ERP, {{school}}", hi: "School ERP में स्वागत है, {{school}}" },
    text: { en: "Welcome {{school}}! Your School ERP is ready: {{link}}", hi: "स्वागत है {{school}}! आपका School ERP तैयार है: {{link}}" },
  },
};

export const eventDef = (e: string) => EVENTS[e as MsgEvent];
export const render = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k: string) => vars[k] ?? "");

/* ───────────── contact hygiene ───────────── */
export const validMobile = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(d) ? d : null;
};
export const validEmail = (e?: string | null) => (e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim()) ? e.trim().toLowerCase() : null);

/** Next time the quiet window (IST, default 21:00–07:00) is over; null when it is not quiet now. */
export function quietUntil(prefs: SchoolPrefs | null | undefined, now = new Date()): Date | null {
  const from = prefs?.quiet_from ?? "21:00", to = prefs?.quiet_to ?? "07:00";
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const m = (s: string) => { const [h, mm] = s.split(":").map(Number); return h * 60 + (mm || 0); };
  const f = m(from), t = m(to);
  const quiet = f === t ? false : f < t ? mins >= f && mins < t : mins >= f || mins < t;
  if (!quiet) return null;
  const end = new Date(ist);
  end.setUTCHours(Math.floor(t / 60), t % 60, 0, 0);
  if (end.getTime() <= ist.getTime()) end.setUTCDate(end.getUTCDate() + 1);
  return new Date(end.getTime() - 5.5 * 3600_000);
}

/* ───────────── enqueue ───────────── */
export type Recipient = {
  name?: string | null; phone?: string | null; email?: string | null; studentId?: string | null; language?: Lang | null;
  vars: Record<string, string>; dedupe?: string | null; optedOut?: boolean;
};
type Row = {
  school_id: string | null; channel: Channel; event: string; to_addr: string; recipient_name: string | null; student_id: string | null; subject: string | null; body: string;
  provider_template: string | null; variables: string[]; status: "queued" | "skipped"; last_error: string | null; dedupe_key: string | null; send_after: string; created_by_name: string | null;
};

/**
 * Queue one event for many people. Channels = the school's notification switches (or `channels` when the sender chose them)
 * that also have a connected account and a valid contact. A recipient who cannot be reached gets one visible "skipped" row with the reason.
 */
export async function queueMessages(o: { schoolId: string | null; event: MsgEvent; recipients: Recipient[]; channels?: Channel[]; sendAt?: Date | null; by?: string | null; urgent?: boolean }) {
  const db = supabaseAdmin();
  const out = { queued: 0, skipped: 0, duplicates: 0 };
  if (!db || !o.recipients.length) return out;
  const def = EVENTS[o.event];
  let prefs: SchoolPrefs | null = null;
  const override = new Map<string, { subject: string | null; body: string; provider_template: string | null }>();
  if (o.schoolId) {
    const [{ data: s }, { data: t }] = await Promise.all([
      db.from("schools").select("prefs").eq("id", o.schoolId).maybeSingle(),
      db.from("message_templates").select("channel,language,subject,body,provider_template").eq("school_id", o.schoolId).eq("event", o.event).eq("active", true),
    ]);
    prefs = (s?.prefs ?? null) as SchoolPrefs | null;
    for (const r of t ?? []) override.set(`${r.channel}|${r.language}`, { subject: r.subject, body: r.body, provider_template: r.provider_template });
  }
  const isNotify = o.schoolId !== null && o.event in { fee_receipt: 1, fee_reminder: 1, absent: 1, exam_result: 1, notice: 1, admission: 1, birthday: 1, asset_assigned: 1, asset_returned: 1, asset_overdue: 1, leave_decided: 1 };
  const wanted: Channel[] = (o.channels ?? (def.platform ? (["email"] as Channel[]) : CHANNELS)).filter((c) => !isNotify || o.channels || notifyOn(prefs, o.event as NotifyEvent, c));
  const have = new Set<Channel>();
  await Promise.all(wanted.map(async (c) => { if (await resolveIntegration(o.schoolId, c)) have.add(c); }));

  const quiet = o.urgent ? null : quietUntil(prefs);
  const now = new Date();
  const rows: Row[] = [];
  for (const r of o.recipients) {
    const lang: Lang = r.language === "hi" ? "hi" : (prefs?.language === "hi" && !r.language ? "hi" : "en");
    const phone = validMobile(r.phone), email = validEmail(r.email);
    const mk = (ch: Channel): Row => {
      const ov = override.get(`${ch}|${lang}`) ?? override.get(`${ch}|en`);
      const body = render(ov?.body ?? def.text[lang], r.vars);
      const subject = ch === "email" ? render(ov?.subject ?? def.subject[lang], r.vars) : null;
      const at = ch !== "email" && quiet ? quiet : o.sendAt ?? now;
      return {
        school_id: o.schoolId, channel: ch, event: o.event, to_addr: ch === "email" ? email! : phone!, recipient_name: r.name ?? null, student_id: r.studentId ?? null, subject, body,
        provider_template: ov?.provider_template ?? null, variables: def.vars.map((k) => r.vars[k] ?? ""), status: "queued", last_error: null,
        dedupe_key: r.dedupe ? `${r.dedupe}:${ch}` : null, send_after: at.toISOString(), created_by_name: o.by ?? null,
      };
    };
    const made: Row[] = [];
    let why = "";
    if (r.optedOut) why = "The parent asked not to receive automatic messages.";
    else if (!wanted.length) why = "This event is switched off for every channel (Settings → Notifications).";
    else {
      for (const ch of wanted) {
        if (!have.has(ch)) continue;
        if (ch === "email" ? email : phone) made.push(mk(ch));
      }
      if (!made.length) {
        const noAccount = wanted.filter((c) => !have.has(c)).map((c) => CHANNEL_NAME[c]);
        const noContact = !phone && !email;
        why = noContact ? "No valid mobile number or email on record." : noAccount.length === wanted.length ? `No ${noAccount.join(" / ")} account is connected (Settings → Integrations).` : "No channel has both a connected account and a contact for this person.";
      }
    }
    if (made.length) rows.push(...made);
    else if (o.event !== "custom" || why) {
      rows.push({
        school_id: o.schoolId, channel: wanted[0] ?? "sms", event: o.event, to_addr: phone ?? email ?? "—", recipient_name: r.name ?? null, student_id: r.studentId ?? null, subject: null,
        body: render(def.text[lang], r.vars), provider_template: null, variables: [], status: "skipped", last_error: why || "Nothing to send.",
        dedupe_key: r.dedupe ? `${r.dedupe}:skip` : null, send_after: now.toISOString(), created_by_name: o.by ?? null,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const { data, error } = await db.rpc("enqueue_messages", { p_rows: chunk });
    if (error) throw new Error(error.message);
    const n = Number(data ?? 0);
    const skipped = chunk.filter((c) => c.status === "skipped").length;
    out.queued += Math.max(0, n - skipped);
    out.skipped += Math.min(n, skipped);
    out.duplicates += chunk.length - n;
  }
  return out;
}

/* ───────────── worker ───────────── */
const emailHtml = (body: string, school?: string | null) =>
  `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c2333;max-width:560px">${body.split("\n").map((l) => `<p style="margin:0 0 10px">${l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join("")}${school ? `<hr style="border:0;border-top:1px solid #e3e8f0;margin:16px 0"><p style="margin:0;color:#6b7592;font-size:13px">${school.replace(/[&<>]/g, "")}</p>` : ""}</div>`;

type Claimed = {
  id: string; school_id: string | null; channel: Channel; event: string; to_addr: string; recipient_name: string | null; subject: string | null; body: string;
  provider_template: string | null; variables: string[]; attempts: number;
};

/** Sends due messages (a school's, or all). Safe to call from a cron route and from "Send now". */
export async function processOutbox(o: { limit?: number; schoolId?: string | null } = {}) {
  const db = supabaseAdmin();
  const res = { sent: 0, failed: 0, retry: 0, picked: 0 };
  if (!db) return res;
  const { data, error } = await db.rpc("claim_messages", { p_limit: o.limit ?? 25, p_school: o.schoolId ?? null });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Claimed[];
  res.picked = rows.length;
  const dry = process.env.MESSAGES_DRY_RUN === "1";
  const cache = new Map<string, Resolved | null>();
  const account = async (school: string | null, ch: Channel) => {
    const k = `${school}|${ch}`;
    if (!cache.has(k)) cache.set(k, await resolveIntegration(school, ch));
    return cache.get(k)!;
  };
  const names = new Map<string, string>();
  const one = async (m: Claimed) => {
    let ok = false, ref: string | null = null, err: string | null = null, source: string | null = null;
    try {
      const acc = await account(m.school_id, m.channel);
      if (!acc) err = `No ${CHANNEL_NAME[m.channel]} account is connected.`;
      else {
        source = acc.source;
        if (dry) { ok = true; ref = "dry-run"; }
        else if (m.channel === "email") {
          let school: string | null = null;
          if (m.school_id) {
            if (!names.has(m.school_id)) names.set(m.school_id, (await db.from("schools").select("name").eq("id", m.school_id).maybeSingle()).data?.name ?? "");
            school = names.get(m.school_id) || null;
          }
          const r = await sendEmail(acc.config, acc.secrets, { to: m.to_addr, subject: m.subject ?? "Message", html: emailHtml(m.body, school), text: m.body });
          ok = r.ok; ref = r.id ?? null; err = r.ok ? null : r.message;
        } else if (m.channel === "sms") {
          const tpl = m.provider_template || acc.config[`tpl_${m.event}`] || "";
          if (!tpl) err = `No SMS template ID for “${eventDef(m.event)?.name ?? m.event}” — add it in Settings → Integrations → SMS (DLT flow ID).`;
          else {
            const vars: Record<string, string> = {};
            m.variables.forEach((v, i) => { vars[`var${i + 1}`] = String(v).slice(0, 30); });
            const r = await sendSms(acc.config, acc.secrets, { mobile: m.to_addr, templateId: tpl, vars });
            ok = r.ok; err = r.ok ? null : r.message;
          }
        } else {
          const [name, lang] = (m.provider_template || acc.config[`wa_${m.event}`] || "").split(":");
          if (!name) err = `No WhatsApp template name for “${eventDef(m.event)?.name ?? m.event}” — set the approved template in Messages → Templates.`;
          else {
            const r = await sendWhatsAppTemplate(acc.config, acc.secrets, { to: m.to_addr, template: name, lang: lang || "en", params: m.variables.map((v) => String(v).slice(0, 200)) });
            ok = r.ok; err = r.ok ? null : r.message;
          }
        }
      }
    } catch (e) { err = (e as Error).message; }
    const { data: st } = await db.rpc("finish_message", { p_id: m.id, p_ok: ok, p_ref: ref, p_error: err, p_source: source });
    if (st === "sent") res.sent++; else if (st === "failed") res.failed++; else res.retry++;
  };
  for (let i = 0; i < rows.length; i += 5) await Promise.all(rows.slice(i, i + 5).map(one));
  return res;
}
