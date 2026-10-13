import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The driver's phone talks to this endpoint with the vehicle's private token (the /drive/<token> link).
 * Actions: status · start (pickup | drop) · ping · end. All the rules (token, trip, throttle) are in the database.
 */
export async function POST(req: NextRequest) {
  let b: { action?: string; token?: string; kind?: string; lat?: number; lng?: number; speed?: number | null; heading?: number | null; accuracy?: number | null };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const token = String(b.token ?? "");
  if (!/^[0-9a-f]{24}$/.test(token)) return NextResponse.json({ error: "This driver link is not valid." }, { status: 404 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const fail = (m: string, status = 400) => NextResponse.json({ error: m.replace(/^.*?:\s*/, "").slice(0, 160) }, { status });

  if (b.action === "status") {
    const { data, error } = await db.rpc("driver_status", { p_token: token });
    return error ? fail(error.message, 404) : NextResponse.json(data);
  }
  if (b.action === "start") {
    const { data, error } = await db.rpc("driver_start_trip", { p_token: token, p_kind: b.kind === "drop" ? "drop" : "pickup" });
    return error ? fail(error.message) : NextResponse.json(data);
  }
  if (b.action === "ping") {
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const { data, error } = await db.rpc("driver_ping", { p_token: token, p_lat: num(b.lat), p_lng: num(b.lng), p_speed: num(b.speed), p_heading: num(b.heading), p_accuracy: num(b.accuracy) });
    return error ? fail(error.message) : NextResponse.json(data);
  }
  if (b.action === "end") {
    const { error } = await db.rpc("driver_end_trip", { p_token: token });
    return error ? fail(error.message) : NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
