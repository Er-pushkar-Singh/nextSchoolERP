import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";
import { boardLevel } from "@/lib/board";

/** CSV the school can use to key students into the board's portal / check against its own nominal list. */
export async function GET(req: Request) {
  const { supabase, school, session } = await requirePerm("students.board_reg.export");
  const cls = new URL(req.url).searchParams.get("class_id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(cls)) return new Response("Pick a class", { status: 400 });
  if (!session) return new Response("No current session", { status: 400 });
  const { data: c } = await supabase.from("classes").select("name").eq("id", cls).eq("school_id", school.id).maybeSingle();
  const lv = boardLevel(c?.name);
  if (!lv) return new Response("Class 9–12 only", { status: 400 });
  const [{ data: studs }, { data: regs }, { data: subs }] = await Promise.all([
    supabase.from("students").select("id,admission_no,first_name,middle_name,last_name,father_name,mother_name,dob,gender,category,roll_no,sections(name)").eq("school_id", school.id).eq("class_id", cls).eq("status", "active").order("roll_no", { nullsFirst: false }).order("first_name").limit(3000),
    supabase.from("board_registrations").select("student_id,status,challan_no,board_ref,exam_year").eq("school_id", school.id).eq("session_id", session.id).eq("kind", lv.kind).limit(5000),
    supabase.from("student_subjects").select("student_id,is_elective,subjects(name,code,sort)").eq("school_id", school.id).eq("session_id", session.id).limit(30000),
  ]);
  const regOf = new Map((regs ?? []).map((r) => [r.student_id, r]));
  const subOf = new Map<string, string[]>();
  for (const x of (subs ?? []) as unknown as { student_id: string; is_elective: boolean; subjects: { name: string; code: string | null } | null }[]) {
    const a = subOf.get(x.student_id) ?? [];
    a.push(`${x.subjects?.name ?? ""}${x.subjects?.code ? ` [${x.subjects.code}]` : ""}${x.is_elective ? " (E)" : ""}`);
    subOf.set(x.student_id, a);
  }
  type S = { id: string; admission_no: string; first_name: string; middle_name: string | null; last_name: string | null; father_name: string | null; mother_name: string | null; dob: string | null; gender: string | null; category: string | null; roll_no: number | null; sections: { name: string } | null };
  const rows = [["Sr", "Adm no", "Roll", "Section", "Student name", "Father's name", "Mother's name", "DOB", "Gender", "Category", "Subjects", "Status", "Challan", "Board ref", "Exam year"],
    ...((studs ?? []) as unknown as S[]).map((s, i) => {
      const r = regOf.get(s.id);
      return [i + 1, s.admission_no, s.roll_no, s.sections?.name, [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" "), s.father_name, s.mother_name, s.dob, s.gender, s.category,
        (subOf.get(s.id) ?? []).join("; "), r?.status ?? "not started", r?.challan_no, r?.board_ref, r?.exam_year];
    })];
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="board-${lv.level}-${session.name}.csv"`, "Cache-Control": "no-store" } });
}
