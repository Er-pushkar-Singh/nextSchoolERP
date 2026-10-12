import { fmtDate, money } from "./format";

export type Defaulter = { student_id: string; admission_no: string; student_name: string; father_name: string | null; guardian_phone: string | null; class_name: string | null; section_name: string | null; overdue: number; oldest_due: string; instalments: number; portal_token: string };

export function feeReminderText(d: Defaulter, school: { name: string; upi_id: string | null; whatsapp_footer: string | null }, link: string) {
  return [
    `Dear Parent,`,
    `This is a gentle reminder that school fees of ${money(d.overdue)} for ${d.student_name} (Class ${d.class_name ?? ""}${d.section_name ? `-${d.section_name}` : ""}, Adm. ${d.admission_no}) are pending since ${fmtDate(d.oldest_due)}.`,
    `View details${school.upi_id ? " and pay by UPI" : ""}: ${link}`,
    `Please ignore if already paid.`,
    school.whatsapp_footer || `— ${school.name}`,
  ].join("\n");
}
