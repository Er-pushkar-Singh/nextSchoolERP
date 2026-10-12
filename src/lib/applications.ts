export const APP_STATUS: Record<string, string> = {
  submitted: "Received", under_review: "Under review", test_scheduled: "Test / interview set", approved: "Approved", waitlisted: "Waitlisted",
  rejected: "Rejected", admitted: "Admitted", cancelled: "Cancelled",
};
/** Badge tones (see ui.tsx `tone`) */
export const APP_TONE: Record<string, string> = {
  submitted: "new", under_review: "contacted", test_scheduled: "test", approved: "paid", waitlisted: "due", rejected: "lost", admitted: "admitted", cancelled: "cancelled",
};
export const APP_OPEN = ["submitted", "under_review", "test_scheduled", "approved", "waitlisted"];

export const FEE_MODES: [string, string][] = [["cash", "Cash"], ["upi", "UPI"], ["cheque", "Cheque"], ["bank_transfer", "Bank transfer"], ["card", "Card"], ["online", "Online"]];

/** Documents the school normally asks for at admission (the school can add "Other"). */
export const ADMISSION_DOCS = ["birth_certificate", "photo", "previous_marksheet", "transfer_certificate", "address_proof", "caste_certificate", "income_certificate", "disability_certificate", "apaar_consent"] as const;

export type AppForm = Record<string, unknown> & {
  contacts?: { name: string; relation?: string; phone?: string; occupation?: string; is_primary?: boolean; is_emergency?: boolean; can_pickup?: boolean }[];
  prior?: { level: string; board_name?: string; exam_year?: number | string; roll_no?: string; registration_no?: string; school_name?: string; district_code?: string; school_code?: string; result?: string; percentage?: number | string }[];
};
