import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { attachPaymentLink } from "@/lib/billing";
import { notifyPlatformInvoice } from "@/lib/message-events";
import { processOutbox } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily billing job (vercel.json cron, or any scheduler): creates renewal invoices
 * 7 days before a subscription ends and attaches a Razorpay payment link when configured.
 * Auth: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const { data, error } = await db.rpc("billing_run");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ids = (data ?? []) as string[];
  const links: Record<string, string> = {};
  for (const id of ids) {
    try { const r = await attachPaymentLink(db, id); links[id] = "url" in r ? r.url : r.skipped; } catch (e) { links[id] = `error: ${(e as Error).message}`; }
    await notifyPlatformInvoice(id, "invoice_issued");
  }
  if (ids.length) await processOutbox({ limit: 50 });
  return NextResponse.json({ ok: true, invoices: ids.length, links });
}
