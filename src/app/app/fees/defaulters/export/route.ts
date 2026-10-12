import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";
import { todayIST } from "@/lib/format";
import type { Defaulter } from "@/lib/reminders";

export async function GET(req: Request) {
  const { supabase, school, session } = await requirePerm("fees.defaulters.export");
  if (!session) return new Response("No current session", { status: 400 });
  const u = new URL(req.url);
  const on = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get("on") ?? "") ? u.searchParams.get("on")! : todayIST();
  const cls = /^[0-9a-f-]{36}$/.test(u.searchParams.get("class_id") ?? "") ? u.searchParams.get("class_id") : null;
  const { data } = await supabase.rpc("defaulters", { sid: school.id, sess: session.id, on_day: on, cls, min_amount: Math.max(1, Number(u.searchParams.get("min")) || 1) }).limit(10000);
  const rows = [["Adm no", "Student", "Class", "Section", "Father", "Phone", "Overdue", "Since", "Instalments"],
    ...((data ?? []) as Defaulter[]).map((r) => [r.admission_no, r.student_name, r.class_name ?? "", r.section_name ?? "", r.father_name ?? "", r.guardian_phone ?? "", String(r.overdue), r.oldest_due, String(r.instalments)])];
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="defaulters-${on}.csv"`, "Cache-Control": "no-store" } });
}
