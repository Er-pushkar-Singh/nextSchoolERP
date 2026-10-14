import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attendance devices talk to this endpoint with their private token: the gate kiosk page (/scan/<token>), a biometric or RFID
 * machine's push (JSON or form body: token, code, at?, direction?). All the rules (token, who the code belongs to,
 * late / out / duplicate) are in the database function `device_scan`.
 */
export async function POST(req: NextRequest) {
  let b: Record<string, unknown> = {};
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) b = await req.json();
    else if (type.includes("form")) b = Object.fromEntries((await req.formData()).entries());
    else return NextResponse.json({ error: "Send JSON or a form." }, { status: 415 });
  } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }

  const token = String(b.token ?? "");
  if (!/^[0-9a-f]{24}$/.test(token)) return NextResponse.json({ error: "This device link is not valid." }, { status: 404 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const fail = (m: string, status = 400) => NextResponse.json({ error: m.replace(/^.*?:\s*/, "").slice(0, 160) }, { status });

  if (b.action === "info") {
    const { data, error } = await db.rpc("device_info", { p_token: token });
    return error ? fail(error.message, 404) : NextResponse.json(data);
  }
  const code = String(b.code ?? b.user ?? b.card ?? "").trim().slice(0, 60);
  if (!code) return fail("Nothing was scanned.");
  let at: string | null = null;
  if (b.at) {
    const t = new Date(String(b.at));
    if (!Number.isNaN(t.getTime()) && t.getTime() <= Date.now() + 60_000 && t.getTime() > Date.now() - 31 * 86_400_000) at = t.toISOString();
  }
  const dir = b.direction === "out" ? "out" : b.direction === "in" ? "in" : null;
  const { data, error } = await db.rpc("device_scan", { p_token: token, p_code: code, p_at: at, p_dir: dir, p_raw: code });
  return error ? fail(error.message) : NextResponse.json(data);
}
