import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

import { resolveIntegration } from "./integrations";

/* ───────────── Razorpay (Payment Links API) ─────────────
   Keys come from the encrypted settings centre (Super Admin → Settings → Integrations for subscriptions,
   a school's own Settings → Integrations for its fees). Env RAZORPAY_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET
   still work as a fallback for the platform account.
   Docs: https://razorpay.com/docs/api/payments/payment-links/  */

export type RazorpayCreds = { keyId: string; keySecret: string; webhookSecret?: string };

/** CodersDuniya's own Razorpay account (subscriptions). Stored settings win over env vars. */
export async function platformRazorpay(): Promise<RazorpayCreds | null> {
  const r = await resolveIntegration(null, "razorpay");
  if (r?.config.key_id && r.secrets.key_secret) return { keyId: r.config.key_id, keySecret: r.secrets.key_secret, webhookSecret: r.secrets.webhook_secret };
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
    return { keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET };
  return null;
}

export async function createRazorpayLink(creds: RazorpayCreds, opts: {
  amountInr: number; // rupees
  currency: string;
  description: string;
  referenceId: string; // our invoice number (must be unique per link)
  customer: { name: string; email?: string | null; contact?: string | null };
  callbackUrl?: string;
  expireBy?: number; // unix seconds
}) {
  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: Math.round(opts.amountInr * 100), // paise
      currency: opts.currency,
      accept_partial: false,
      description: opts.description.slice(0, 2048),
      reference_id: opts.referenceId.slice(0, 40),
      customer: {
        name: opts.customer.name,
        ...(opts.customer.email ? { email: opts.customer.email } : {}),
        ...(opts.customer.contact ? { contact: opts.customer.contact } : {}),
      },
      notify: { sms: false, email: false }, // we share the link ourselves (WhatsApp/email)
      reminder_enable: true,
      ...(opts.callbackUrl ? { callback_url: opts.callbackUrl, callback_method: "get" } : {}),
      ...(opts.expireBy ? { expire_by: opts.expireBy } : {}),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
  if (!res.ok || !data.id) throw new Error(data.error?.description ?? `Razorpay error ${res.status}`);
  return { id: data.id, url: data.short_url! };
}

/** Verifies X-Razorpay-Signature (HMAC-SHA256 of the raw body with the webhook secret). */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string | null | undefined) {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

