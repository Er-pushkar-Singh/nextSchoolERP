import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "exam_session";
const ID = /^[0-9a-f-]{36}$/;

/**
 * The student side of online exams. Students have no ERP login: they sign in with school code (or the exam link), admission number
 * and date of birth; the session token lives in an httpOnly cookie. Every rule (time, one attempt, one device, answer key hidden,
 * lock-out after wrong attempts) is in the database functions this route calls with the service role.
 */
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const action = String(b.action ?? "");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60) || "unknown";
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
  const fail = (m: string, status = 400) => NextResponse.json({ error: m.replace(/^.*?:\s*/, "").slice(0, 200) }, { status });
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const exam = ID.test(String(b.exam ?? "")) ? String(b.exam) : "";

  if (action === "info") {
    const t = String(b.token ?? "");
    if (!/^[0-9a-f]{24}$/.test(t)) return fail("This exam link is not valid.", 404);
    const { data, error } = await db.rpc("exam_public_info", { p_token: t });
    return error ? fail(error.message, 404) : NextResponse.json(data);
  }

  if (action === "login") {
    const dob = String(b.dob ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return fail("Enter your date of birth.");
    const { data, error } = await db.rpc("exam_login", { p_school_code: String(b.school ?? "").slice(0, 40), p_adm: String(b.admission ?? "").slice(0, 40), p_dob: dob, p_ip: ip });
    if (error) return fail(error.message);
    const r = data as { token?: string; error?: string; name?: string; school?: string };
    if (r.error || !r.token) return fail(r.error ?? "Could not sign in.", 401);
    const res = NextResponse.json({ name: r.name, school: r.school });
    res.cookies.set(COOKIE, r.token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 4 * 3600 });
    return res;
  }

  if (!token) return fail("Please sign in.", 401);
  const needsSession = async (fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await fn();
    if (error) return fail(error.message, /session has ended/i.test(error.message) ? 401 : 400);
    return NextResponse.json(data);
  };

  if (action === "logout") {
    await db.rpc("exam_logout", { p_token: token });
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(COOKIE);
    return res;
  }
  if (action === "portal") return needsSession(() => db.rpc("exam_portal", { p_token: token }));
  if (!exam) return fail("Choose an exam.");
  if (action === "start") return needsSession(() => db.rpc("exam_start", { p_token: token, p_exam: exam, p_code: String(b.code ?? "").slice(0, 40), p_ip: ip, p_ua: ua }));
  if (action === "state") return needsSession(() => db.rpc("exam_state", { p_token: token, p_exam: exam }));
  if (action === "answer") {
    const q = String(b.question ?? "");
    if (!ID.test(q)) return fail("Bad question.");
    const ans = Array.isArray(b.answer) ? (b.answer as unknown[]).map(String).slice(0, 10) : [];
    return needsSession(() => db.rpc("exam_answer", { p_token: token, p_exam: exam, p_question: q, p_ans: ans }));
  }
  if (action === "event") return needsSession(() => db.rpc("exam_event", { p_token: token, p_exam: exam, p_kind: String(b.kind ?? "").slice(0, 30), p_detail: String(b.detail ?? "").slice(0, 80) }));
  if (action === "submit") return needsSession(() => db.rpc("exam_submit", { p_token: token, p_exam: exam }));
  if (action === "result") return needsSession(() => db.rpc("exam_result", { p_token: token, p_exam: exam }));
  return fail("Unknown action.");
}
