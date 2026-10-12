import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";

/** Salary bank sheet for one month: one row per payslip (name, account, IFSC, net pay). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Bad id", { status: 400 });
  const { supabase, school } = await requirePerm("hr.payroll.export");
  const { data: run } = await supabase.from("payroll_runs").select("month").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!run) return new Response("Not found", { status: 404 });
  const { data } = await supabase.from("payslips")
    .select("working_days,lop_days,gross,total_deductions,adjustment,net,paid_on,pay_ref,staff(name,emp_code,designation,bank_name,bank_account,ifsc,pan,uan)").eq("run_id", id);
  type Row = { working_days: number; lop_days: number; gross: number; total_deductions: number; adjustment: number; net: number; paid_on: string | null; pay_ref: string | null;
    staff: { name: string; emp_code: string | null; designation: string | null; bank_name: string | null; bank_account: string | null; ifsc: string | null; pan: string | null; uan: string | null } | null };
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => (a.staff?.name ?? "").localeCompare(b.staff?.name ?? ""));
  const csv = toCsv([
    ["Emp code", "Name", "Designation", "Bank", "Account no.", "IFSC", "PAN", "UAN", "Days paid", "Gross", "Deductions", "Adjustment", "Net pay", "Paid on", "Reference"],
    ...rows.map((r) => [r.staff?.emp_code, r.staff?.name, r.staff?.designation, r.staff?.bank_name, r.staff?.bank_account, r.staff?.ifsc, r.staff?.pan, r.staff?.uan,
      Number(r.working_days) - Number(r.lop_days), r.gross, r.total_deductions, r.adjustment, r.net, r.paid_on, r.pay_ref]),
  ]);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="salary-${run.month.slice(0, 7)}.csv"`, "Cache-Control": "no-store" } });
}
