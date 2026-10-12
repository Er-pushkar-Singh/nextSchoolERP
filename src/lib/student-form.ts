import "server-only";
import { date, num, str, uuid } from "./action-util";
import { todayIST } from "./format";

const GENDERS = ["M", "F", "O"] as const;
const CATEGORIES = ["General", "OBC", "SC", "ST", "EWS", "Other"] as const;
const ADMISSION_CATEGORIES = ["general", "rte", "staff_ward", "sibling", "other"] as const;
const LOCALITY = ["rural", "urban"] as const;
const MEDIUM = ["hindi", "english"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const phone10 = (v: string | null) => (v ? v.replace(/[^\d+]/g, "").replace(/^\+?91(?=\d{10}$)/, "").slice(0, 15) || null : null);
const pick = <T extends readonly string[]>(v: string | null, list: T) => (v && (list as readonly string[]).includes(v) ? v : null);

/** Reads the shared student profile fields from a form. Returns the row and the first validation problem, if any. */
export function parseStudentFields(f: FormData) {
  const dist = num(f, "distance_km");
  const pct = num(f, "previous_year_percent");
  const days = num(f, "previous_year_days");
  const bpl = str(f, "bpl", 1);
  const row = {
    first_name: str(f, "first_name", 80),
    middle_name: str(f, "middle_name", 80),
    last_name: str(f, "last_name", 80),
    gender: pick(str(f, "gender", 1), GENDERS),
    dob: date(f, "dob"),
    name_hi: str(f, "name_hi", 120),
    father_name: str(f, "father_name", 100),
    father_name_hi: str(f, "father_name_hi", 120),
    mother_name: str(f, "mother_name", 100),
    mother_name_hi: str(f, "mother_name_hi", 120),
    guardian_phone: phone10(str(f, "guardian_phone", 20)),
    alt_phone: phone10(str(f, "alt_phone", 20)),
    mobile: phone10(str(f, "mobile", 20)),
    email: str(f, "email", 120),
    address: str(f, "address", 400),
    permanent_address: str(f, "permanent_address", 400),
    street: str(f, "street", 120),
    city: str(f, "city", 60),
    post_office: str(f, "post_office", 80),
    block_tehsil: str(f, "block_tehsil", 60),
    district: str(f, "district", 60),
    state: str(f, "state", 60),
    pincode: str(f, "pincode", 6),
    locality_type: pick(str(f, "locality_type", 10), LOCALITY),
    distance_km: dist !== null && dist >= 0 && dist < 1000 ? dist : null,
    mother_tongue: str(f, "mother_tongue", 40),
    nationality: str(f, "nationality", 40),
    religion: str(f, "religion", 40),
    caste: str(f, "caste", 60),
    category: pick(str(f, "category", 20), CATEGORIES),
    admission_category: pick(str(f, "admission_category", 20), ADMISSION_CATEGORIES),
    medium: pick(str(f, "medium", 10), MEDIUM),
    bpl: bpl === "1" ? true : bpl === "0" ? false : null,
    blood_group: str(f, "blood_group", 5),
    previous_school: str(f, "previous_school", 150),
    previous_board: str(f, "previous_board", 60),
    previous_class: str(f, "previous_class", 20),
    previous_year_percent: pct !== null && pct >= 0 && pct <= 100 ? pct : null,
    previous_year_days: days !== null && days >= 0 && days <= 400 ? Math.round(days) : null,
    class_id: uuid(f, "class_id"),
    section_id: uuid(f, "section_id"),
    roll_no: num(f, "roll_no"),
    admission_date: date(f, "admission_date"),
  };
  let error: string | null = null;
  const mobile = /^[6-9]\d{9}$/;
  if (!row.first_name) error = "Student name is required.";
  else if (row.guardian_phone && !mobile.test(row.guardian_phone)) error = "Guardian phone should be a 10-digit mobile number.";
  else if (row.alt_phone && !mobile.test(row.alt_phone)) error = "The other phone should be a 10-digit mobile number.";
  else if (row.mobile && !mobile.test(row.mobile)) error = "The student's mobile should be a 10-digit number.";
  else if (row.email && !EMAIL.test(row.email)) error = "That email address doesn't look right.";
  else if (row.pincode && !/^[1-9]\d{5}$/.test(row.pincode)) error = "PIN code must be 6 digits.";
  else if (row.dob) {
    const t = todayIST();
    const age = (Date.parse(t) - Date.parse(row.dob)) / (365.25 * 86400000);
    if (row.dob > t) error = "Date of birth can't be in the future.";
    else if (age < 2 || age > 30) error = "Date of birth doesn't look right — the student's age should be between 2 and 30 years.";
  }
  return { row, error };
}

/** Age in years on a given date (for class age limits). */
export function ageOn(dob: string, on: string) {
  return (Date.parse(on) - Date.parse(dob)) / (365.25 * 86400000);
}

/** Warning text when the applicant's age on the session start is outside the class limits (never blocks). */
export function ageWarning(dob: string | null | undefined, min: number | null | undefined, max: number | null | undefined, on: string | null | undefined) {
  if (!dob || !on) return null;
  const age = ageOn(dob, on);
  if (min != null && age < min) return `Age ${age.toFixed(1)} years on ${on} is below the minimum (${min}).`;
  if (max != null && age > max) return `Age ${age.toFixed(1)} years on ${on} is above the maximum (${max}).`;
  return null;
}
