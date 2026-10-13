import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";
import { APP_STATUS } from "@/lib/applications";

export async function GET(req: Request) {
  const { supabase, school, session } = await requirePerm("frontdesk.admissions.export", "frontdesk.admissions.view");
  const u = new URL(req.url);
  const status = u.searchParams.get("status");
  const cls = u.searchParams.get("class_id");
  let q = supabase.from("admission_applications")
    .select("application_no,applicant_name,father_name,phone,status,rte_applicant,source,applied_on,test_on,test_marks,test_max,waitlist_no,decision_note,fee_amount,fee_paid_on,offer_valid_till,admitted_on,classes!class_id(name)")
    .eq("school_id", school.id);
  if (session) q = q.eq("session_id", session.id);
  const stage = u.searchParams.get("stage");
  if (stage && session) {
    const { data: ids } = await supabase.rpc("application_board", { sid: school.id, sess: session.id, p_stage: stage, p_q: null, p_class: null, p_limit: 200, p_offset: 0 });
    q = q.in("id", ((ids ?? []) as { id: string }[]).map((x) => x.id));
  }
  if (status && Object.keys(APP_STATUS).includes(status)) q = q.eq("status", status);
  if (cls && /^[0-9a-f-]{36}$/.test(cls)) q = q.eq("class_id", cls);
  const rows: string[][] = [["Application", "Applicant", "Class", "Father", "Phone", "Status", "Waitlist", "RTE", "Source", "Applied on", "Test date", "Marks", "Out of", "Offer valid till", "Fee", "Fee paid on", "Admitted on", "Note"]];
  for (let p = 0; ; p++) {
    const { data } = await q.order("application_no").range(p * 1000, p * 1000 + 999);
    for (const a of (data ?? []) as unknown as { application_no: string; applicant_name: string; father_name: string | null; phone: string | null; status: string; rte_applicant: boolean; source: string | null; applied_on: string;
      test_on: string | null; test_marks: number | null; test_max: number | null; waitlist_no: number | null; decision_note: string | null; fee_amount: number | null; fee_paid_on: string | null; offer_valid_till: string | null; admitted_on: string | null; classes: { name: string } | null }[]) {
      rows.push([a.application_no, a.applicant_name, a.classes?.name ?? "", a.father_name ?? "", a.phone ?? "", APP_STATUS[a.status] ?? a.status, a.waitlist_no ? String(a.waitlist_no) : "", a.rte_applicant ? "yes" : "", a.source ?? "",
        a.applied_on, a.test_on ?? "", a.test_marks !== null ? String(a.test_marks) : "", a.test_max !== null ? String(a.test_max) : "", a.offer_valid_till ?? "", a.fee_amount !== null ? String(a.fee_amount) : "", a.fee_paid_on ?? "", a.admitted_on ?? "", a.decision_note ?? ""]);
    }
    if ((data ?? []).length < 1000) break;
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="admission-applications.csv"`, "Cache-Control": "no-store" } });
}
