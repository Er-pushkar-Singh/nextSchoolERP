import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";

/** PF / ESI / professional-tax statement of one month: employee and employer shares per person, with totals. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Bad id", { status: 400 });
  const { supabase, school } = await requirePerm("hr.payroll.export");
  const { data: run } = await supabase.from("payroll_runs").select("month,status").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!run) return new Response("Not found", { status: 404 });
  const { data } = await supabase.from("payslips")
    .select("working_days,lop_days,gross,pf_employee,esi_employee,prof_tax,advance_recovery,employer_pf,employer_esi,staff(name,emp_code,uan,pan)").eq("run_id", id);
  type Row = { working_days: number; lop_days: number; gross: number; pf_employee: number; esi_employee: number; prof_tax: number; advance_recovery: number; employer_pf: number; employer_esi: number;
    staff: { name: string; emp_code: string | null; uan: string | null; pan: string | null } | null };
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => (a.staff?.name ?? "").localeCompare(b.staff?.name ?? ""));
  const sum = (k: keyof Row) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const csv = toCsv([
    ["Emp code", "Name", "UAN", "PAN", "Days paid", "Gross", "PF employee", "PF employer", "ESI employee", "ESI employer", "Professional tax", "Advance recovered"],
    ...rows.map((r) => [r.staff?.emp_code, r.staff?.name, r.staff?.uan, r.staff?.pan, Number(r.working_days) - Number(r.lop_days), r.gross, r.pf_employee, r.employer_pf, r.esi_employee, r.employer_esi, r.prof_tax, r.advance_recovery]),
    ["", "TOTAL", "", "", "", sum("gross"), sum("pf_employee"), sum("employer_pf"), sum("esi_employee"), sum("employer_esi"), sum("prof_tax"), sum("advance_recovery")],
  ]);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="statutory-${run.month.slice(0, 7)}.csv"`, "Cache-Control": "no-store" } });
}
