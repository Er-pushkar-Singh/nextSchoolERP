import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Teachers who are free in the period of one timetable slot on a date (for the manual "add cover" form). */
export async function GET(req: Request) {
  const { supabase, school } = await requirePerm("academics.timetable.edit");
  const u = new URL(req.url);
  const slot = u.searchParams.get("slot") ?? "";
  const date = u.searchParams.get("date") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(slot) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ staff: [] }, { status: 400 });
  const { data: s } = await supabase.from("timetable_slots").select("period_id,staff_id").eq("id", slot).eq("school_id", school.id).maybeSingle();
  if (!s) return NextResponse.json({ staff: [] });
  const { data } = await supabase.rpc("free_staff", { sid: school.id, on_day: date, p_period: s.period_id });
  return NextResponse.json({ staff: ((data ?? []) as { staff_id: string; name: string; designation: string | null; periods_that_day: number }[]).filter((x) => x.staff_id !== s.staff_id) });
}
