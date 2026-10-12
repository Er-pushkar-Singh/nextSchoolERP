import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";

/** The current student list (same filters as the screen), every page, as CSV. */
export async function GET(req: Request) {
  const { supabase, school } = await requirePerm("students.profile.export");
  const u = new URL(req.url);
  const g = (k: string) => u.searchParams.get(k) || null;
  const uuidOk = (v: string | null) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const rows: string[][] = [["Admission no", "Name", "Class", "Section", "Roll", "Gender", "Category", "Father", "Phone", "Status", "Blocked", "Fee dues"]];
  for (let p = 0; p < 50; p++) {
    const { data } = await supabase.rpc("student_list", {
      sid: school.id, p_q: g("q"), p_class: uuidOk(g("class_id")), p_section: uuidOk(g("section_id")), p_status: g("status") ?? "active", p_gender: g("gender"),
      p_category: g("category"), p_blocked: g("blocked"), p_dues: g("dues"), p_sort: g("sort") ?? "name", p_limit: 200, p_offset: p * 200,
    });
    const list = (data ?? []) as { admission_no: string; first_name: string; middle_name: string | null; last_name: string | null; class_name: string | null; section_name: string | null; roll_no: number | null;
      gender: string | null; category: string | null; father_name: string | null; guardian_phone: string | null; status: string; blocked: boolean; balance: number }[];
    for (const s of list) {
      rows.push([s.admission_no, [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" "), s.class_name ?? "", s.section_name ?? "", s.roll_no !== null ? String(s.roll_no) : "",
        s.gender ?? "", s.category ?? "", s.father_name ?? "", s.guardian_phone ?? "", s.status, s.blocked ? "yes" : "", String(s.balance ?? 0)]);
    }
    if (list.length < 200) break;
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="students.csv"`, "Cache-Control": "no-store" } });
}
