/* School preferences (schools.prefs jsonb). Missing keys fall back to these defaults. */

export type Channel = "sms" | "email" | "whatsapp";
export type NotifyEvent = "fee_receipt" | "fee_reminder" | "absent" | "exam_result" | "notice" | "admission" | "birthday" | "asset_assigned" | "asset_returned" | "asset_overdue" | "leave_decided";
export type SchoolPrefs = {
  timezone?: string;
  date_format?: "DD/MM/YYYY" | "DD-MMM-YYYY" | "YYYY-MM-DD";
  week_start?: "mon" | "sun";
  working_days?: number[]; // 1 = Monday … 7 = Sunday
  language?: "en" | "hi";
  notify?: Partial<Record<NotifyEvent, Partial<Record<Channel, boolean>>>>;
  quiet_from?: string; // "21:00" — no automatic SMS/WhatsApp between quiet_from and quiet_to
  quiet_to?: string;
};

export const NOTIFY_EVENTS: { code: NotifyEvent; name: string; who: string; defaults: Record<Channel, boolean> }[] = [
  { code: "fee_receipt", name: "Fee received", who: "Parent — receipt with amount and balance", defaults: { sms: true, email: true, whatsapp: true } },
  { code: "fee_reminder", name: "Fee due reminder", who: "Parent — before and after the due date", defaults: { sms: true, email: true, whatsapp: true } },
  { code: "absent", name: "Absent alert", who: "Parent — same day, after attendance is saved", defaults: { sms: true, email: false, whatsapp: true } },
  { code: "exam_result", name: "Result published", who: "Parent — link to the report card", defaults: { sms: false, email: true, whatsapp: true } },
  { code: "notice", name: "New notice / circular", who: "Parents and staff in the notice's audience", defaults: { sms: false, email: true, whatsapp: false } },
  { code: "admission", name: "Admission confirmed", who: "Parent — admission number and portal link", defaults: { sms: true, email: true, whatsapp: true } },
  { code: "birthday", name: "Birthday wishes", who: "Student and staff — morning of the birthday", defaults: { sms: false, email: false, whatsapp: false } },
  { code: "asset_assigned", name: "School property given", who: "Staff member, or the parent of a student — what was given, until when", defaults: { sms: false, email: true, whatsapp: false } },
  { code: "asset_returned", name: "School property returned", who: "Staff member, or the parent of a student — acknowledgement of the return", defaults: { sms: false, email: true, whatsapp: false } },
  { code: "leave_decided", name: "Leave decision", who: "Parent — when a leave request is approved or rejected", defaults: { sms: false, email: true, whatsapp: true } },
  { code: "asset_overdue", name: "Property not returned on time", who: "Staff member, or the parent of a student — weekly until it is back", defaults: { sms: false, email: true, whatsapp: true } },
];

export const DEFAULT_PREFS = {
  timezone: "Asia/Kolkata", date_format: "DD/MM/YYYY", week_start: "mon", working_days: [1, 2, 3, 4, 5, 6], language: "en", quiet_from: "21:00", quiet_to: "07:00",
} as const;

export function notifyOn(prefs: SchoolPrefs | null | undefined, ev: NotifyEvent, ch: Channel) {
  const v = prefs?.notify?.[ev]?.[ch];
  return v ?? NOTIFY_EVENTS.find((e) => e.code === ev)!.defaults[ch];
}

export const DAYS: [number, string][] = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
