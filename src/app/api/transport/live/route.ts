import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/school";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Office / principal: every vehicle with its live position, plus stops and the school's location (polled every few seconds). */
export async function GET() {
  const { supabase, school } = await requirePerm("transport.tracking.view");
  const [{ data: vehicles, error }, { data: stops }, { data: sc }] = await Promise.all([
    supabase.rpc("live_vehicles", { sid: school.id }),
    supabase.from("transport_stops").select("id,route_id,name,sort,lat,lng,pickup_time").eq("school_id", school.id).not("lat", "is", null).order("sort"),
    supabase.from("schools").select("lat,lng,name").eq("id", school.id).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vehicles: vehicles ?? [], stops: stops ?? [], school: sc ?? null, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
