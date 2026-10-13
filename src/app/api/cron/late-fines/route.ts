import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily late-fine job (vercel.json cron): applies every school's late-fine rule to its overdue instalments,
 * and marks promises to pay that were not kept as broken.
 * Auth: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const { data, error } = await db.rpc("apply_late_fines_all");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: broken } = await db.rpc("mark_broken_promises");
  return NextResponse.json({ ok: true, instalments_updated: data, promises_broken: broken ?? 0 });
}
