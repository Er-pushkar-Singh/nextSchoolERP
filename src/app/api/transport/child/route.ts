import { NextResponse, type NextRequest } from "next/server";
import { portalStudent } from "@/lib/portal";
import { todayIST } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Parent link → where is my child's bus. Only that child's own bus is ever returned. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{32}$/.test(token)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { db, s } = await portalStudent(token);
  if (s.blocked_at && (!s.blocked_till || s.blocked_till >= todayIST())) return NextResponse.json({ error: "Not available." }, { status: 403 });
  if (s.status !== "active") return NextResponse.json({ allocated: false });
  const { data, error } = await db.rpc("child_bus", { stu: s.id });
  if (error) return NextResponse.json({ error: "Could not load." }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
