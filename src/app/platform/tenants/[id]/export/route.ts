import { NextResponse } from "next/server";
import { getPlatform } from "@/lib/platform";

export const dynamic = "force-dynamic";

// Every table that belongs to a school (school_id column), in dependency order.
const TABLES = [
  "schools", "school_subscriptions", "subscription_invoices", "school_modules", "sessions", "classes", "sections", "subjects",
  "roles", "school_members", "member_roles", "member_overrides", "staff_assignments", "students", "guardians", "student_guardians",
  "enquiries", "fee_heads", "fee_plans", "student_concessions", "fee_dues", "fee_receipts", "fee_receipt_lines", "fee_settings", "fee_receipt_payments", "fee_wallet_entries", "fee_cheques", "fee_adjustments", "fee_refunds", "fee_day_close", "fee_online_orders", "fee_followups", "admission_settings", "application_followups",
  "attendance", "exams", "exam_subjects", "marks", "notices", "tickets",
  "homework", "transport_vehicles", "transport_routes", "transport_stops", "transport_allocations",
  "staff", "staff_leaves", "payroll_runs", "payslips", "library_books", "library_issues",
  "student_enrolments", "student_sensitive", "student_documents", "student_subjects", "board_registrations", "board_registration_events", "student_certificates",
  "admission_applications", "admission_application_events", "application_documents", "student_prior_exams", "student_board_subjects", "online_admission_settings", "document_templates", "issued_documents",
];

/** Full JSON export of one school (platform staff with tenant access). Logged in the audit trail. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const { supabase, can } = await getPlatform();
  if (!can("tenants")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let page = 0; ; page++) {
      const q = supabase.from(t).select("*").range(page * 1000, page * 1000 + 999);
      const { data, error } = await (t === "schools" ? q.eq("id", id) : q.eq("school_id", id));
      if (error) { out[`${t}__error`] = [error.message]; break; }
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    out[t] = rows;
  }
  const { data: role_permissions } = await supabase.from("role_permissions").select("*").in("role_id", (out.roles as { id: string }[]).map((r) => r.id));
  out.role_permissions = role_permissions ?? [];
  await supabase.rpc("log_event", { p_action: "school.exported", p_school: id, p_entity: "schools", p_entity_id: id, p_details: { tables: TABLES.length } });
  const code = (out.schools[0] as { code?: string } | undefined)?.code ?? id;
  return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), format: "codersduniya-school-erp/v1", school_id: id, data: out }, null, 1), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${code}-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
  });
}
