export const CATEGORIES: [string, string][] = [["certificate", "Certificate"], ["id_card", "ID card"], ["letter", "Letter / notice"], ["fees", "Fees"], ["other", "Other"]];
export const AUDIENCES: [string, string][] = [["student", "Student"], ["staff", "Staff"]];

/** Placeholders a template can use ({{group.key}}). The values are built in the database from the school's records. */
export const PLACEHOLDERS: { group: string; items: [string, string][] }[] = [
  { group: "Student", items: [
    ["student.name", "Full name"], ["student.name_hi", "Name in Hindi"], ["student.first_name", "First name"], ["student.admission_no", "Admission no."], ["student.roll_no", "Roll no."],
    ["student.class", "Class"], ["student.section", "Section"], ["student.class_section", "Class-section"], ["student.father_name", "Father's name"], ["student.father_name_hi", "Father (Hindi)"],
    ["student.mother_name", "Mother's name"], ["student.mother_name_hi", "Mother (Hindi)"], ["student.dob", "Date of birth"], ["student.dob_words", "DOB in words"],
    ["student.gender", "Gender"], ["student.son_daughter", "son / daughter"], ["student.he_she", "he / she"], ["student.his_her", "his / her"],
    ["student.category", "Category"], ["student.religion", "Religion"], ["student.nationality", "Nationality"], ["student.blood_group", "Blood group"],
    ["student.address", "Address"], ["student.permanent_address", "Permanent address"], ["student.phone", "Parent phone"], ["student.mobile", "Student mobile"], ["student.email", "Email"],
    ["student.admission_date", "Admission date"], ["student.admission_class", "Class at admission"], ["student.apaar_id", "APAAR ID"], ["student.tc_no", "TC no."],
    ["student.transport_route", "Bus route"], ["student.transport_stop", "Bus stop"], ["student.photo", "Photograph (image)"], ["student.qr", "Attendance QR code (image)"],
  ] },
  { group: "Staff", items: [["staff.name", "Name"], ["staff.designation", "Designation"], ["staff.department", "Department"], ["staff.emp_code", "Employee code"], ["staff.phone", "Phone"],
    ["staff.email", "Email"], ["staff.joining_date", "Joining date"], ["staff.leaving_date", "Leaving date"], ["staff.qualification", "Qualification"], ["staff.qr", "Attendance QR code (image)"]] },
  { group: "School", items: [["school.name", "School name"], ["school.address", "Address"], ["school.city", "City"], ["school.pincode", "PIN"], ["school.phone", "Phone"], ["school.email", "Email"],
    ["school.board", "Board"], ["school.affiliation_no", "Affiliation no."], ["school.udise_code", "UDISE code"], ["school.principal_name", "Principal"], ["school.logo", "Logo (image)"]] },
  { group: "Document", items: [["doc.no", "Document number"], ["doc.date", "Issue date"], ["doc.session", "Session"], ["doc.valid_until", "Valid until"], ["dues.text", "Fee dues sentence"], ["dues.outstanding", "Fee dues amount"]] },
  { group: "Fees (fee templates only)", items: [
    ["fee.receipt_no", "Receipt no."], ["fee.date", "Receipt date"], ["fee.amount", "Amount received"], ["fee.amount_words", "Amount in words"], ["fee.mode", "Mode"], ["fee.payments", "Payment methods (Cash ₹… + Card ₹…)"],
    ["fee.reference", "Reference"], ["fee.note", "Note"], ["fee.collected_by", "Collected by"], ["fee.balance", "Balance after this receipt"], ["fee.advance", "Advance received"],
    ["fee.wallet_used", "Paid from advance"], ["fee.status", "CANCELLED (if cancelled)"], ["fee.lines_html", "Table: what was paid (receipt)"],
    ["fee.total_due", "Total outstanding"], ["fee.overdue", "Overdue amount"], ["fee.due_words", "Outstanding in words"], ["fee.paid_total", "Paid so far"], ["fee.billed_total", "Billed so far"],
    ["fee.as_on", "As on date"], ["fee.dues_html", "Table: instalments (demand / statement)"], ["fee.receipts_html", "Table: receipts (statement)"],
  ] },
  { group: "Asked at issue", items: [["extra.reason", "Reason"], ["extra.remarks", "Remarks"], ["extra.last_exam", "Last exam"], ["extra.result", "Result"], ["extra.promotion", "Promotion"],
    ["extra.conduct", "Conduct"], ["extra.working_days", "Working days"], ["extra.days_present", "Days present"], ["extra.left_on", "Date of leaving"]] },
];

export type TemplateField = { key: string; label: string; type: "text" | "date" | "number"; required?: boolean };

/** "key|Label|text|required" per line  ⇄  fields jsonb */
export function parseFields(text: string): TemplateField[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    const [key, label, type, req] = l.split("|").map((x) => x.trim());
    if (!key || !/^[a-z][a-z0-9_]{1,30}$/.test(key)) return [];
    return [{ key, label: label || key, type: (["text", "date", "number"].includes(type) ? type : "text") as TemplateField["type"], required: /^req/i.test(req ?? "") }];
  }).slice(0, 15);
}
export const fieldsToText = (f: TemplateField[]) => f.map((x) => `${x.key}|${x.label}|${x.type}${x.required ? "|required" : ""}`).join("\n");
