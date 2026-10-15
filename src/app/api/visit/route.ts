import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public visitor self check-in (the school's QR). All rules — token, rate limit, duplicate check — are in the database. */
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const token = String(b.token ?? "");
  if (!/^[0-9a-f]{24}$/.test(token)) return NextResponse.json({ error: "This visitor link is not valid." }, { status: 404 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const fail = (m: string, status = 400) => NextResponse.json({ error: m.replace(/^.*?:\s*/, "").slice(0, 160) }, { status });
  if (b.action === "info") {
    const { data, error } = await db.rpc("visit_school", { p_token: token });
    return error ? fail(error.message, 404) : NextResponse.json(data);
  }
  if (b.website) return NextResponse.json({ pass_no: "—" });   // honeypot field: bots fill it, people never see it
  const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const { data, error } = await db.rpc("visitor_self_checkin", {
    p_token: token, p_name: s(b.name, 80), p_phone: s(b.phone, 20), p_purpose: s(b.purpose, 20), p_to_meet: s(b.to_meet, 80), p_org: s(b.organisation, 80),
    p_people: Math.min(20, Math.max(1, Math.round(Number(b.people) || 1))), p_vehicle: s(b.vehicle_no, 20), p_note: s(b.note, 300),
  });
  return error ? fail(error.message) : NextResponse.json(data);
}
