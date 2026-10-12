/** UP Board (UPMSP) registration helpers — Classes 9 to 12. Field rules follow the board's published notices
 *  (name, parents, DOB, gender, subjects, photo); official subject codes are entered by the school, never hard-coded. */

export type RegKind = "advance_registration" | "exam_application";
export const KIND_LABEL: Record<RegKind, string> = { advance_registration: "Advance registration (Class 9 / 11)", exam_application: "Exam application (Class 10 / 12)" };
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", checked: "Checked by principal", submitted: "Submitted to board", correction: "Correction requested", accepted: "Accepted" };

/** Which form a class takes part in. The class name must be exactly 9, 10, 11 or 12. */
export function boardLevel(className: string | null | undefined): { level: 9 | 10 | 11 | 12; kind: RegKind } | null {
  const n = (className ?? "").trim().replace(/^class\s*/i, "");
  if (n === "9" || n === "11") return { level: Number(n) as 9 | 11, kind: "advance_registration" };
  if (n === "10" || n === "12") return { level: Number(n) as 10 | 12, kind: "exam_application" };
  return null;
}

/** Default examination year: session "2026-27" → advance registration for the 2028 exam, exam application for 2027. */
export function defaultExamYear(sessionName: string | null | undefined, kind: RegKind) {
  const m = (sessionName ?? "").match(/^(\d{4})/);
  const start = m ? Number(m[1]) : new Date().getFullYear();
  return start + 1 + (kind === "advance_registration" ? 1 : 0);
}

export type Readiness = { ok: boolean; missing: string[]; warnings: string[] };

export function readiness(s: {
  first_name: string | null; father_name: string | null; mother_name: string | null; dob: string | null; gender: string | null;
  photo: boolean; subjects: number; subjectsWithoutCode: number; apaar: boolean;
}): Readiness {
  const missing: string[] = [];
  if (!s.first_name) missing.push("name");
  if (!s.father_name && !s.mother_name) missing.push("father's or mother's name");
  if (!s.dob) missing.push("date of birth");
  if (!s.gender) missing.push("gender");
  if (!s.photo) missing.push("photograph");
  if (!s.subjects) missing.push("subjects");
  const warnings: string[] = [];
  if (s.subjects && s.subjectsWithoutCode) warnings.push(`${s.subjectsWithoutCode} subject(s) have no board code (Settings → Classes & subjects)`);
  if (!s.apaar) warnings.push("APAAR ID not entered (not mandatory, but the Board requests it)");
  return { ok: missing.length === 0, missing, warnings };
}
