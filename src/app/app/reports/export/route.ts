import { requireSchool } from "@/lib/school";
import { toCsv } from "@/lib/csv";
import { todayIST } from "@/lib/format";
import { reportRange } from "@/lib/report-range";

export const dynamic = "force-dynamic";

const S = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const NEEDS: Record<string, string[]> = {
  enrolment: ["reports.overview.export", "reports.academic.export"],
  attendance: ["reports.overview.export", "reports.academic.export"],
  fees: ["reports.fees.export", "reports.overview.export"],
  ageing: ["reports.fees.export", "reports.overview.export"],
  exam: ["reports.academic.export"],
  udise: ["reports.udise.export", "reports.overview.export"],
};

/** CSV of one report. The database function behind it checks the report permission again. */
export async function GET(req: Request) {
  const { supabase, school, session, canAny } = await requireSchool();
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") ?? "";
  if (!NEEDS[kind] || !canAny(...NEEDS[kind])) return new Response("Not allowed", { status: 403 });
  const range = reportRange({ from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined }, todayIST(), session?.start_date);
  const rows: string[][] = [];
  const fail = (e: { message: string }) => new Response(e.message.slice(0, 200), { status: 403 });
  let name = kind;

  if (kind === "enrolment") {
    const { data, error } = await supabase.rpc("report_enrolment", { sid: school.id });
    if (error) return fail(error);
    rows.push(["Class", "Sections", "Seats", "Boys", "Girls", "Other", "Total", "General", "OBC", "SC", "ST", "EWS", "RTE", "New this session"]);
    for (const r of (data ?? []) as Record<string, unknown>[]) rows.push([r.class_name, r.sections, r.seats, r.boys, r.girls, r.other, r.total, r.general, r.obc, r.sc, r.st, r.ews, r.rte, r.new_this_session].map(S));
  } else if (kind === "attendance") {
    const { data, error } = await supabase.rpc("report_attendance_by_class", { sid: school.id, d1: range.d1, d2: range.d2 });
    if (error) return fail(error);
    rows.push(["Class", "Students", "Marks", "Present", "Absent", "Attendance %", "Students below 75%"]);
    for (const r of (data ?? []) as Record<string, unknown>[]) rows.push([r.class_name, r.students, r.marked, r.present, r.absent, r.pct, r.low_students].map(S));
    name = `attendance-${range.d1}-to-${range.d2}`;
  } else if (kind === "fees") {
    const { data, error } = await supabase.rpc("report_fee_by_class", { sid: school.id });
    if (error) return fail(error);
    rows.push(["Class", "Students", "Billed", "Received", "Outstanding", "Past due", "Collected %"]);
    for (const r of (data ?? []) as Record<string, unknown>[]) rows.push([r.class_name, r.students, r.billed, r.paid, r.outstanding, r.overdue, r.pct].map(S));
  } else if (kind === "ageing") {
    const { data, error } = await supabase.rpc("report_defaulter_ageing", { sid: school.id });
    if (error) return fail(error);
    rows.push(["Age of due", "Students", "Amount"]);
    for (const r of (data ?? []) as Record<string, unknown>[]) rows.push([r.bucket, r.students, r.amount].map(S));
  } else if (kind === "exam") {
    const exam = u.searchParams.get("exam") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(exam)) return new Response("Choose an exam", { status: 400 });
    const { data, error } = await supabase.rpc("report_exam_by_class", { sid: school.id, p_exam: exam });
    if (error) return fail(error);
    rows.push(["Class", "Students", "Average %", "Pass %", "Failed", "Absent", "Topper", "Topper %"]);
    for (const r of (data ?? []) as Record<string, unknown>[]) rows.push([r.class_name, r.students, r.avg_percent, r.pass_percent, r.failed, r.absent, r.topper, r.topper_percent].map(S));
    const { data: sb } = await supabase.rpc("report_exam_by_subject", { sid: school.id, p_exam: exam });
    rows.push([], ["Class", "Subject", "Students", "Average %", "Below pass", "Highest"]);
    for (const r of (sb ?? []) as Record<string, unknown>[]) rows.push([r.class_name, r.subject_name, r.students, r.avg_percent, r.below_pass, r.highest].map(S));
    name = "exam-analysis";
  } else {
    const { data, error } = await supabase.rpc("report_udise_strength", { sid: school.id });
    if (error) return fail(error);
    rows.push(["Class", "Category", "Boys", "Girls", "Total"]);
    for (const r of (data ?? []) as Record<string, unknown>[]) rows.push([r.class_name, r.category, r.boys, r.girls, r.total].map(S));
    name = "udise-strength";
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
}
