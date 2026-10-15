import { after } from "next/server";
import { notifyFeeReceipt } from "@/lib/message-events";
import { processOutbox } from "@/lib/messages";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveIntegration } from "@/lib/integrations";
import { verifyRazorpaySignature } from "@/lib/razorpay";

export const runtime = "nodejs";

/**
 * School fees: Razorpay (the school's own account) → Webhooks → URL https://<app-domain>/api/razorpay/fees,
 * event payment_link.paid, secret = the "Webhook secret" saved in the school's Settings → Integrations → Razorpay.
 * The school is found from the payment link, then the signature is verified with THAT school's secret
 * before anything is recorded. A repeated webhook never makes a second receipt.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let evt: { event?: string; payload?: { payment_link?: { entity?: { id?: string; amount_paid?: number } }; payment?: { entity?: { id?: string; amount?: number } } } };
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }
  if (evt.event !== "payment_link.paid") return NextResponse.json({ ok: true, ignored: evt.event });
  const linkId = evt.payload?.payment_link?.entity?.id;
  const pay = evt.payload?.payment?.entity;
  if (!linkId || !pay?.id) return NextResponse.json({ error: "missing payload" }, { status: 400 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const { data: order } = await db.from("fee_online_orders").select("id,school_id").eq("link_id", linkId).maybeSingle();
  if (!order) return NextResponse.json({ ok: true, note: "no matching order" });
  const rz = await resolveIntegration(order.school_id, "razorpay");
  if (!rz || rz.source !== "school" || !verifyRazorpaySignature(raw, req.headers.get("x-razorpay-signature"), rz.secrets.webhook_secret))
    return NextResponse.json({ error: "bad signature" }, { status: 401 });

  const paise = Number(pay.amount ?? evt.payload?.payment_link?.entity?.amount_paid ?? 0);
  const { data, error } = await db.rpc("complete_online_order", { p_link: linkId, p_payment: pay.id, p_paise: paise });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // the parent gets the receipt on WhatsApp / SMS / email through the school own accounts
  const done = data as { receipt_id?: string; note?: string } | null;
  if (done?.receipt_id && !done.note) after(async () => { await notifyFeeReceipt(order.school_id, done.receipt_id!, "online"); await processOutbox({ schoolId: order.school_id, limit: 10 }); });
  return NextResponse.json(data);
}
