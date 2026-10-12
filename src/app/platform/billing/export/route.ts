import { NextResponse } from "next/server";
import { getPlatform } from "@/lib/platform";
import { toCsv } from "@/lib/csv";

export async function GET(req: Request) {
  const { supabase, can } = await getPlatform();
  if (!can("billing")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = new URL(req.url);
  const d = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get(k) ?? "") ? u.searchParams.get(k)! : null);
  let q = supabase.from("subscription_invoices").select("*, schools(name,code,state)").gte("created_at", `${d("from") ?? "2000-01-01"}T00:00:00+05:30`).lte("created_at", `${d("to") ?? "2999-12-31"}T23:59:59+05:30`);
  const st = u.searchParams.get("status");
  if (st && ["due", "paid", "void"].includes(st)) q = q.eq("status", st);
  const { data } = await q.order("created_at").limit(10000);
  const rows = [["Invoice", "Date", "School", "Code", "State", "Plan", "Cycle", "Period start", "Period end", "Students", "Rate", "Amount", "GST %", "GST", "Total", "Status", "Paid at", "Reference"],
    ...((data ?? []) as Record<string, unknown>[]).map((i) => {
      const s = i.schools as { name: string; code: string; state: string | null } | null;
      return [i.number, String(i.created_at).slice(0, 10), s?.name, s?.code, s?.state, i.plan_code, i.billing_cycle, i.period_start, i.period_end, i.students, i.rate, i.amount, i.gst_rate, i.gst_amount, i.total, i.status, i.paid_at ? String(i.paid_at).slice(0, 10) : "", i.payment_ref] as (string | number | null)[];
    })];
  return new NextResponse(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="subscription-invoices.csv"`, "Cache-Control": "no-store" } });
}
