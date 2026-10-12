import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase/admin";
import { decryptJson } from "./crypto";
import type { Provider } from "./integration-defs";

export type IntegrationRow = {
  id: string; school_id: string | null; provider: Provider; enabled: boolean; config: Record<string, string>;
  secret_hints: Record<string, string>; status: "untested" | "ok" | "failed"; status_message: string | null; tested_at: string | null; updated_at: string;
};
export type Resolved = { id: string; source: "school" | "platform"; config: Record<string, string>; secrets: Record<string, string> };
type Result = { ok: boolean; message: string };

const COLS = "id,school_id,provider,enabled,config,secret_hints,status,status_message,tested_at,updated_at";

/** Rows visible to the signed-in user (RLS) for a school, or the platform when schoolId is null. */
export async function loadIntegrations(supabase: SupabaseClient, schoolId: string | null) {
  const q = supabase.from("integration_settings").select(COLS);
  const { data } = await (schoolId ? q.eq("school_id", schoolId) : q.is("school_id", null));
  return new Map(((data ?? []) as IntegrationRow[]).map((r) => [r.provider, r]));
}

export async function readSecrets(settingId: string): Promise<Record<string, string>> {
  const db = supabaseAdmin();
  if (!db) return {};
  const { data } = await db.from("integration_secrets").select("ciphertext").eq("setting_id", settingId).maybeSingle();
  if (!data?.ciphertext) return {};
  try { return decryptJson(data.ciphertext); } catch { return {}; }
}

/**
 * The account to use for a provider: the school's own (enabled), else the platform's when it is shared.
 * schoolId null = the platform's own account. Server-side only (reads secrets with the secret key).
 */
export async function resolveIntegration(schoolId: string | null, provider: Provider): Promise<Resolved | null> {
  const db = supabaseAdmin();
  if (!db) return null;
  if (schoolId) {
    const { data: own } = await db.from("integration_settings").select("id,config,enabled").eq("school_id", schoolId).eq("provider", provider).maybeSingle();
    if (own?.enabled) return { id: own.id, source: "school", config: own.config ?? {}, secrets: await readSecrets(own.id) };
  }
  const { data: pl } = await db.from("integration_settings").select("id,config,enabled").is("school_id", null).eq("provider", provider).maybeSingle();
  if (!pl?.enabled) return null;
  if (schoolId && String(pl.config?.share_with_schools) !== "true") return null;
  return { id: pl.id, source: "platform", config: pl.config ?? {}, secrets: await readSecrets(pl.id) };
}

const T = () => AbortSignal.timeout(15000);
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;
const why = (e: unknown) => {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  if (err?.name === "TimeoutError") return "No reply within 15 seconds.";
  return err?.cause?.code ? `${err.message} (${err.cause.code})` : err?.message ?? String(e);
};

/* ───────────── Senders ───────────── */

export async function sendEmail(cfg: Record<string, string>, sec: Record<string, string>, m: { to: string; subject: string; html: string; text?: string }): Promise<Result & { id?: string }> {
  const from = `${cfg.from_name ?? ""} <${cfg.from_email}>`.trim();
  try {
    if (cfg.transport === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: T(), headers: { Authorization: `Bearer ${sec.resend_api_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(cfg.reply_to ? { reply_to: cfg.reply_to } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      return res.ok ? { ok: true, message: `Sent to ${m.to}`, id: j.id } : { ok: false, message: j.message ?? `Resend error ${res.status}` };
    }
    const nodemailer = await import("nodemailer");
    const port = Number(cfg.smtp_port || (cfg.smtp_security === "ssl" ? 465 : 587));
    const t = nodemailer.createTransport({ host: cfg.smtp_host, port, secure: cfg.smtp_security === "ssl", auth: { user: cfg.smtp_user, pass: sec.smtp_password }, connectionTimeout: 15000 });
    const info = await t.sendMail({ from, to: m.to, subject: m.subject, html: m.html, text: m.text, replyTo: cfg.reply_to || undefined });
    return { ok: true, message: `Sent to ${m.to}`, id: info.messageId };
  } catch (e) { return { ok: false, message: why(e) }; }
}

/** MSG91 Flow API (DLT template). vars → var1, var2 … in the template. */
export async function sendSms(cfg: Record<string, string>, sec: Record<string, string>, m: { mobile: string; templateId: string; vars?: Record<string, string> }): Promise<Result> {
  const mobile = m.mobile.replace(/\D/g, "").replace(/^0+/, "");
  const to = mobile.length === 10 ? `91${mobile}` : mobile;
  try {
    const res = await fetch("https://control.msg91.com/api/v5/flow", {
      method: "POST", signal: T(), headers: { authkey: sec.auth_key, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ template_id: m.templateId, short_url: "0", recipients: [{ mobiles: to, ...(m.vars ?? {}) }] }),
    });
    const j = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    return res.ok && j.type !== "error" ? { ok: true, message: `Sent to +${to}` } : { ok: false, message: j.message ?? `MSG91 error ${res.status}` };
  } catch (e) { return { ok: false, message: why(e) }; }
}

export async function sendWhatsAppTemplate(cfg: Record<string, string>, sec: Record<string, string>, m: { to: string; template: string; lang?: string; params?: string[] }): Promise<Result> {
  const v = cfg.api_version || "v23.0";
  const digits = m.to.replace(/\D/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;
  try {
    const res = await fetch(`https://graph.facebook.com/${v}/${cfg.phone_number_id}/messages`, {
      method: "POST", signal: T(), headers: { Authorization: `Bearer ${sec.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: { name: m.template, language: { code: m.lang ?? "en_US" }, ...(m.params?.length ? { components: [{ type: "body", parameters: m.params.map((t) => ({ type: "text", text: t })) }] } : {}) },
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return res.ok ? { ok: true, message: `Sent to +${to}` } : { ok: false, message: j.error?.message ?? `WhatsApp error ${res.status}` };
  } catch (e) { return { ok: false, message: why(e) }; }
}

/** Signed upload to Cloudinary. Returns the https URL. */
export async function cloudinaryUpload(cfg: Record<string, string>, sec: Record<string, string>, file: Blob, opts: { folder: string; publicId: string }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = [cfg.folder || "school-erp", opts.folder].filter(Boolean).join("/");
  const params: Record<string, string> = { folder, overwrite: "true", public_id: opts.publicId, timestamp };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const signature = createHash("sha1").update(toSign + sec.api_secret).digest("hex");
  const body = new FormData();
  body.append("file", file);
  Object.entries(params).forEach(([k, v]) => body.append(k, v));
  body.append("api_key", cfg.api_key);
  body.append("signature", signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloud_name)}/image/upload`, { method: "POST", body, signal: AbortSignal.timeout(60000) });
  const j = (await res.json().catch(() => ({}))) as { secure_url?: string; error?: { message?: string } };
  if (!res.ok || !j.secure_url) throw new Error(j.error?.message ?? `Cloudinary error ${res.status}`);
  return j.secure_url;
}

/* ───────────── Connection tests ───────────── */

export async function testIntegration(provider: Provider, cfg: Record<string, string>, sec: Record<string, string>, target?: string): Promise<Result> {
  try {
    switch (provider) {
      case "razorpay": {
        if (cfg.mode === "live" && cfg.key_id?.startsWith("rzp_test_")) return { ok: false, message: "Live mode needs a live key (rzp_live_…)." };
        if (cfg.mode === "test" && cfg.key_id?.startsWith("rzp_live_")) return { ok: false, message: "Test mode needs a test key (rzp_test_…)." };
        const res = await fetch("https://api.razorpay.com/v1/payments?count=1", { headers: { Authorization: basic(cfg.key_id, sec.key_secret) }, signal: T() });
        if (res.ok) return { ok: true, message: `Connected to Razorpay (${cfg.mode === "live" ? "live" : "test"} mode).` };
        const j = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
        return { ok: false, message: j.error?.description ?? `Razorpay said ${res.status}` };
      }
      case "cloudinary": {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloud_name)}/ping`, { headers: { Authorization: basic(cfg.api_key, sec.api_secret) }, signal: T() });
        const j = (await res.json().catch(() => ({}))) as { status?: string; error?: { message?: string } };
        return res.ok && j.status === "ok" ? { ok: true, message: `Connected to Cloudinary cloud “${cfg.cloud_name}”.` } : { ok: false, message: j.error?.message ?? `Cloudinary said ${res.status}` };
      }
      case "email": {
        if (target) {
          const r = await sendEmail(cfg, sec, { to: target, subject: "Test email from School ERP", html: "<p>Your email settings work. 🎉</p><p>— School ERP</p>", text: "Your email settings work. — School ERP" });
          return r.ok ? { ok: true, message: `Test email sent to ${target}.` } : r;
        }
        if (cfg.transport === "resend") {
          const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${sec.resend_api_key}` }, signal: T() });
          const j = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
          if (res.ok || j.name === "restricted_api_key") return { ok: true, message: "Resend API key accepted." };
          return { ok: false, message: j.message ?? `Resend said ${res.status}` };
        }
        const nodemailer = await import("nodemailer");
        const port = Number(cfg.smtp_port || (cfg.smtp_security === "ssl" ? 465 : 587));
        await nodemailer.createTransport({ host: cfg.smtp_host, port, secure: cfg.smtp_security === "ssl", auth: { user: cfg.smtp_user, pass: sec.smtp_password }, connectionTimeout: 15000 }).verify();
        return { ok: true, message: `SMTP login to ${cfg.smtp_host}:${port} works.` };
      }
      case "sms": {
        const tpl = cfg.tpl_fee_receipt || cfg.tpl_notice || Object.entries(cfg).find(([k, v]) => k.startsWith("tpl_") && v)?.[1];
        if (!target) return { ok: false, message: "Enter a mobile number to send a test SMS (MSG91 has no free credential check)." };
        if (!tpl) return { ok: false, message: "Add at least one DLT flow template ID first." };
        const r = await sendSms(cfg, sec, { mobile: target, templateId: tpl, vars: { var1: "Test", var2: "School ERP" } });
        return r.ok ? { ok: true, message: `Test SMS sent to ${target}.` } : r;
      }
      case "whatsapp": {
        const v = cfg.api_version || "v23.0";
        const res = await fetch(`https://graph.facebook.com/${v}/${cfg.phone_number_id}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${sec.access_token}` }, signal: T() });
        const j = (await res.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
        if (!res.ok) return { ok: false, message: j.error?.message ?? `Meta said ${res.status}` };
        if (target) {
          const r = await sendWhatsAppTemplate(cfg, sec, { to: target, template: cfg.test_template || "hello_world" });
          if (!r.ok) return { ok: false, message: `Number OK (${j.display_phone_number}), but the test message failed: ${r.message}` };
        }
        return { ok: true, message: `Connected: ${j.verified_name ?? ""} ${j.display_phone_number ?? ""}`.trim() + (target ? ` — test message sent to ${target}.` : ".") };
      }
    }
  } catch (e) { return { ok: false, message: why(e) }; }
}
