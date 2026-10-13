import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";

export async function GET(req: Request) {
  const { supabase, school } = await requirePerm("fees.receipts.export", "fees.collection.export");
  const u = new URL(req.url);
  const d = (k: string) => { const v = u.searchParams.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  const from = d("from") ?? "1900-01-01", to = d("to") ?? "2999-12-31";
  let q = supabase.from("fee_receipts").select("receipt_no,paid_on,amount,mode,reference,collected_by,cancelled,cancelled_reason,note,students(admission_no,first_name,last_name,father_name,classes!class_id(name),sections(name))")
    .eq("school_id", school.id).gte("paid_on", from).lte("paid_on", to);
  const mode = u.searchParams.get("mode");
  if (mode) q = q.eq("mode", mode);
  const rows: string[][] = [["Receipt", "Date", "Adm no", "Student", "Father", "Class", "Mode", "Reference", "Amount", "Collected by", "Cancelled", "Reason", "Note"]];
  for (let p = 0; ; p++) {
    const { data } = await q.order("receipt_no").range(p * 1000, p * 1000 + 999);
    for (const r of (data ?? []) as unknown as { receipt_no: string; paid_on: string; amount: number; mode: string; reference: string | null; collected_by: string | null; cancelled: boolean; cancelled_reason: string | null; note: string | null; students: { admission_no: string; first_name: string; last_name: string | null; father_name: string | null; classes: { name: string } | null; sections: { name: string } | null } | null }[]) {
      const s = r.students;
      rows.push([r.receipt_no, r.paid_on, s?.admission_no ?? "", [s?.first_name, s?.last_name].filter(Boolean).join(" "), s?.father_name ?? "", s?.classes ? `${s.classes.name}-${s.sections?.name ?? ""}` : "", r.mode, r.reference ?? "", String(r.amount), r.collected_by ?? "", r.cancelled ? "yes" : "", r.cancelled_reason ?? "", r.note ?? ""]);
    }
    if ((data ?? []).length < 1000) break;
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="receipts-${from}-to-${to}.csv"`, "Cache-Control": "no-store" } });
}
