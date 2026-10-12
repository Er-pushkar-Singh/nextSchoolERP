import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { platformRazorpay, verifyRazorpaySignature } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * Razorpay → Webhooks: URL https://<app-domain>/api/razorpay/webhook, event payment_link.paid,
 * secret = the webhook secret saved in Super Admin → Settings → Integrations (or RAZORPAY_WEBHOOK_SECRET). A paid subscription invoice extends the school's plan.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const creds = await platformRazorpay();
  if (!verifyRazorpaySignature(raw, req.headers.get("x-razorpay-signature"), creds?.webhookSecret)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const evt = JSON.parse(raw) as { event: string; payload: { payment_link?: { entity: { id: string } }; payment?: { entity: { id: string; method?: string } } } };
  if (evt.event !== "payment_link.paid") return NextResponse.json({ ok: true, ignored: evt.event });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const linkId = evt.payload.payment_link?.entity.id;
  const pay = evt.payload.payment?.entity;
  if (!linkId || !pay) return NextResponse.json({ error: "missing payload" }, { status: 400 });
  const { data: inv } = await db.from("subscription_invoices").select("id").eq("razorpay_link_id", linkId).maybeSingle();
  if (!inv) return NextResponse.json({ ok: true, note: "no matching invoice" });
  const { error } = await db.rpc("mark_subscription_invoice_paid", { inv_id: inv.id, p_ref: `Razorpay ${pay.method ?? ""} ${pay.id}`.trim() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
