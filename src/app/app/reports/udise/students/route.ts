import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";
import { todayIST } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE = 1000;
const CHECKS: [string, (s: Record<string, unknown>, sens: Record<string, unknown> | undefined) => boolean][] = [
  ["DOB", (s) => !s.dob], ["Gender", (s) => !s.gender], ["Social category", (s) => !s.category], ["Father's name", (s) => !s.father_name], ["Mother's name", (s) => !s.mother_name],
  ["Mobile", (s) => !s.guardian_phone], ["Address", (s) => !(s.permanent_address || s.address)], ["PIN code", (s) => !s.pincode], ["Mother tongue", (s) => !s.mother_tongue],
];

/**
 * UDISE+ student-level working sheet: every active student with the fields the portal's student form asks for that this system holds,
 * and a "Missing" column so the office fixes the record before data entry. It is a working sheet — the official DCF layout can change every year.
 * Aadhaar numbers are never exported (only whether one is on record).
 */
export async function GET() {
  const { supabase, school, can } = await requirePerm("reports.udise.export", "reports.overview.export");
  const seeIdentity = can("students.sensitive.view");
  const head = ["Admission no", "Student name", "Gender", "Date of birth", "Class", "Section", "Roll no", "Social category", "Religion", "Nationality", "Mother tongue", "Father's name", "Mother's name",
    "Guardian mobile", "Address", "District", "Block / tehsil", "PIN code", "State", "Rural / urban", "Distance to school (km)", "Admission date", "Previous school", "PEN", "APAAR ID", "Aadhaar on record", "Disability", "Missing"];
  const rows: (string | number | null)[][] = [head];
  let missingAny = 0, total = 0;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await supabase.from("students")
      .select("id,admission_no,first_name,middle_name,last_name,gender,dob,roll_no,category,religion,nationality,mother_tongue,father_name,mother_name,guardian_phone,address,permanent_address,district,block_tehsil,pincode,state,locality_type,distance_km,admission_date,previous_school,classes!class_id(name),sections(name)")
      .eq("school_id", school.id).eq("status", "active").order("id").range(from, from + PAGE - 1);
    if (error) return new Response(error.message, { status: 400 });
    const list = (data ?? []) as unknown as Record<string, unknown>[];
    const ids = list.map((s) => s.id as string);
    const sens = new Map<string, Record<string, unknown>>();
    if (seeIdentity && ids.length) {
      const { data: sd } = await supabase.from("student_sensitive").select("student_id,pen,apaar_id,disability").in("student_id", ids);
      for (const x of (sd ?? []) as Record<string, unknown>[]) sens.set(x.student_id as string, x);
    }
    const aad = new Set<string>();
    if (seeIdentity && ids.length) {
      const { data: ad } = await supabase.from("student_documents").select("student_id").in("student_id", ids).eq("doc_type", "aadhaar").neq("status", "rejected");
      for (const x of (ad ?? []) as { student_id: string }[]) aad.add(x.student_id);
    }
    for (const s of list) {
      const x = sens.get(s.id as string);
      const miss = CHECKS.filter(([, f]) => f(s, x)).map(([n]) => n);
      if (seeIdentity && !x?.pen && !x?.apaar_id) miss.push("PEN / APAAR");
      if (miss.length) missingAny++;
      total++;
      const cls = s.classes as { name: string } | null, sec = s.sections as { name: string } | null;
      rows.push([s.admission_no as string, [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" "), (s.gender as string) ?? "", (s.dob as string) ?? "", cls?.name ?? "", sec?.name ?? "", (s.roll_no as number) ?? "",
        (s.category as string) ?? "", (s.religion as string) ?? "", (s.nationality as string) ?? "", (s.mother_tongue as string) ?? "", (s.father_name as string) ?? "", (s.mother_name as string) ?? "",
        (s.guardian_phone as string) ?? "", ((s.permanent_address || s.address) as string) ?? "", (s.district as string) ?? "", (s.block_tehsil as string) ?? "", (s.pincode as string) ?? "", (s.state as string) ?? "",
        (s.locality_type as string) ?? "", (s.distance_km as number) ?? "", (s.admission_date as string) ?? "", (s.previous_school as string) ?? "",
        seeIdentity ? ((x?.pen as string) ?? "") : "", seeIdentity ? ((x?.apaar_id as string) ?? "") : "", seeIdentity ? (aad.has(s.id as string) ? "yes" : "no") : "", seeIdentity ? ((x?.disability as string) ?? "") : "", miss.join("; ")]);
    }
    if (list.length < PAGE) break;
  }
  void missingAny; void total;
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${school.code}-udise-students-${todayIST()}.csv"`, "Cache-Control": "no-store" } });
}
