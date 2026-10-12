export type Line = { name: string; amount: number };

export type Staff = {
  id: string; user_id: string | null; emp_code: string | null; name: string; designation: string | null; department: string | null; kind: string;
  gender: string | null; dob: string | null; phone: string | null; email: string | null; address: string | null; qualification: string | null;
  joining_date: string | null; leaving_date: string | null; status: string; pan: string | null; uan: string | null;
  bank_name: string | null; bank_account: string | null; ifsc: string | null;
  earnings: Line[]; deductions: Line[]; leave_quota: Record<string, number>;
  blocked_at?: string | null; blocked_till?: string | null; block_reason?: string | null; blocked_by_name?: string | null;
};

export const STAFF_KINDS: [string, string][] = [["teaching", "Teaching"], ["non_teaching", "Non-teaching (office)"], ["support", "Support (driver, guard, helper)"]];

export const LEAVE_KINDS: [string, string][] = [
  ["CL", "Casual leave"], ["SL", "Sick leave"], ["EL", "Earned leave"], ["LWP", "Leave without pay"], ["OD", "On duty"], ["other", "Other"],
];
/** Kinds that have a yearly quota (balance shown) */
export const QUOTA_KINDS = ["CL", "SL", "EL"] as const;

export const sumLines = (l: Line[] | null | undefined) => (l ?? []).reduce((t, x) => t + Number(x.amount || 0), 0);

/** "2026-10-01" → "October 2026" */
export const monthName = (d: string) =>
  new Date(`${d.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Default salary heads offered on a new staff form */
export const DEFAULT_EARNINGS = ["Basic", "DA", "HRA", "Conveyance", "Special allowance"];
export const DEFAULT_DEDUCTIONS = ["PF", "ESI", "Professional tax", "TDS"];
