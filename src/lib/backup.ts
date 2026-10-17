import "server-only";

/** The tables a school can export, grouped for the Backups screen. `perm` = the permission that also guards the data on its own screen. */
export type BackupTable = { name: string; label: string; group: string; order: string[]; perm?: string; drop?: string[] };

export const BACKUP_TABLES: BackupTable[] = [
  { name: "sessions", label: "Sessions", group: "Setup", order: ["id"] },
  { name: "classes", label: "Classes", group: "Setup", order: ["id"] },
  { name: "sections", label: "Sections", group: "Setup", order: ["id"] },
  { name: "subjects", label: "Subjects", group: "Setup", order: ["id"] },
  { name: "students", label: "Students", group: "Students", order: ["id"], perm: "students.profile.view", drop: ["portal_token"] },
  { name: "guardians", label: "Parents / guardians", group: "Students", order: ["id"], perm: "students.profile.view" },
  { name: "student_guardians", label: "Student ↔ guardian links", group: "Students", order: ["student_id", "guardian_id"], perm: "students.profile.view" },
  { name: "student_enrolments", label: "Class history", group: "Students", order: ["id"], perm: "students.profile.view" },
  { name: "attendance", label: "Student attendance", group: "Attendance", order: ["id"], perm: "attendance.students.view" },
  { name: "student_leaves", label: "Student leave", group: "Attendance", order: ["id"], perm: "attendance.leave.view" },
  { name: "exams", label: "Examinations", group: "Exams", order: ["id"], perm: "exams.setup.view" },
  { name: "exam_subjects", label: "Date sheet & max marks", group: "Exams", order: ["id"], perm: "exams.setup.view" },
  { name: "marks", label: "Marks", group: "Exams", order: ["id"], perm: "exams.marks.view" },
  { name: "exam_results", label: "Declared results", group: "Exams", order: ["id"], perm: "exams.results.view" },
  { name: "fee_heads", label: "Fee heads", group: "Fees", order: ["id"], perm: "fees.structure.view" },
  { name: "fee_dues", label: "Fee dues", group: "Fees", order: ["id"], perm: "fees.collection.view" },
  { name: "fee_receipts", label: "Fee receipts", group: "Fees", order: ["id"], perm: "fees.receipts.view" },
  { name: "fee_receipt_lines", label: "Receipt lines", group: "Fees", order: ["id"], perm: "fees.receipts.view" },
  { name: "vouchers", label: "Accounts vouchers", group: "Accounts", order: ["id"], perm: "accounts.vouchers.view" },
  { name: "staff", label: "Staff", group: "Staff", order: ["id"], perm: "hr.staff.view", drop: ["bank_account", "ifsc", "pan", "uan"] },
  { name: "staff_leaves", label: "Staff leave", group: "Staff", order: ["id"], perm: "hr.leave.view" },
  { name: "payroll_runs", label: "Payroll months", group: "Staff", order: ["id"], perm: "hr.payroll.view" },
  { name: "payslips", label: "Payslips", group: "Staff", order: ["id"], perm: "hr.payroll.view" },
  { name: "issued_documents", label: "Issued documents (TC, certificates, letters)", group: "Documents", order: ["id"], perm: "documents.issue.view", drop: ["html"] },
  { name: "notices", label: "Notices", group: "Communication", order: ["id"], perm: "comms.notices.view" },
  { name: "family_messages", label: "Parent messages", group: "Communication", order: ["id"], perm: "comms.messages.view" },
  { name: "library_books", label: "Library books", group: "Library", order: ["id"], perm: "library.catalogue.view" },
  { name: "library_issues", label: "Library issues", group: "Library", order: ["id"], perm: "library.circulation.view" },
  { name: "visitors", label: "Visitor register", group: "Front office", order: ["id"], perm: "frontdesk.visitors.view" },
];

export const BACKUP_BY_NAME = new Map(BACKUP_TABLES.map((t) => [t.name, t]));
