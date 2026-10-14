import { NextResponse, type NextRequest } from "next/server";
import { requirePerm } from "@/lib/school";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The recorded path of one trip (office / principal). */
export async function GET(req: NextRequest) {
  const { supabase } = await requirePerm("transport.tracking.view");
  const trip = req.nextUrl.searchParams.get("trip") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(trip)) return NextResponse.json({ error: "Bad trip." }, { status: 400 });
  const { data, error } = await supabase.rpc("trip_trace", { p_trip: trip });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ points: ((data ?? []) as { lat: number; lng: number; at: string }[]).map((p) => [Number(p.lat), Number(p.lng)]) }, { headers: { "Cache-Control": "no-store" } });
}
