import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";

export async function GET() {
  const { supabase, school, session } = await requirePerm("fees.collection.export", "fees.receipts.export", "fees.defaulters.export");
  const rows: string[][] = [["Class", "Fee head", "Students", "Billed", "Concession", "Collected", "Outstanding"]];
  if (session) {
    const { data } = await supabase.rpc("fee_outstanding", { sid: school.id, sess: session.id });
    for (const r of (data ?? []) as { class_name: string | null; head_name: string; students: number; billed: number; concession: number; collected: number; outstanding: number }[]) {
      rows.push([r.class_name ?? "", r.head_name, String(r.students), String(r.billed), String(r.concession), String(r.collected), String(r.outstanding)]);
    }
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fee-outstanding.csv"`, "Cache-Control": "no-store" } });
}
