export const CERT_KINDS: [string, string][] = [
  ["transfer", "Transfer certificate (TC)"],
  ["bonafide", "Bonafide certificate"],
  ["character", "Character certificate"],
  ["study", "Study certificate"],
];

export type CertDetails = {
  name?: string; admission_no?: string; father_name?: string | null; mother_name?: string | null; dob?: string | null; gender?: string | null;
  category?: string | null; nationality?: string; class?: string | null; section?: string | null; roll_no?: number | null;
  admission_date?: string | null; admission_class?: string | null; address?: string | null; session?: string; dues_outstanding?: number;
  apaar_id?: string | null; last_exam?: string | null; result?: string | null; promotion?: string | null; conduct?: string;
  reason?: string | null; working_days?: string | null; days_present?: string | null; remarks?: string | null; left_on?: string | null;
};
