import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";

/** The current staff list (same filters as the screen), every page, as CSV. Salary columns only with payroll permission. */
export async function GET(req: Request) {
  const { supabase, school, can } = await requirePerm("hr.staff.export");
  const u = new URL(req.url);
  const g = (k: string) => u.searchParams.get(k) || null;
  const pay = can("hr.payroll.view");
  const rows: string[][] = [["Employee code", "Name", "Designation", "Department", "Type", "Phone", "Email", "Joined", "Status", "Has login", "Blocked", ...(pay ? ["Monthly gross"] : [])]];
  for (let p = 0; p < 50; p++) {
    const { data } = await supabase.rpc("staff_list", {
      sid: school.id, p_q: g("q"), p_kind: g("kind"), p_department: g("department"), p_status: g("status") ?? "active", p_login: g("login"), p_blocked: g("blocked"),
      p_sort: g("sort") ?? "name", p_limit: 200, p_offset: p * 200,
    });
    const list = (data ?? []) as { emp_code: string | null; name: string; designation: string | null; department: string | null; kind: string; phone: string | null; email: string | null;
      joining_date: string | null; status: string; user_id: string | null; blocked: boolean; gross: number }[];
    for (const s of list) {
      rows.push([s.emp_code ?? "", s.name, s.designation ?? "", s.department ?? "", s.kind, s.phone ?? "", s.email ?? "", s.joining_date ?? "", s.status, s.user_id ? "yes" : "", s.blocked ? "yes" : "", ...(pay ? [String(s.gross)] : [])]);
    }
    if (list.length < 200) break;
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="staff.csv"`, "Cache-Control": "no-store" } });
}
