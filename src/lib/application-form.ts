import "server-only";
import { num, str } from "./action-util";
import { parseStudentFields } from "./student-form";
import { validAadhaar } from "./aadhaar";
import { encryptJson, encryptionReady } from "./crypto";

const mobile10 = /^[6-9]\d{9}$/;

/** Everything the application form posts → the `form` jsonb that `admit_application()` turns into a student. */
export function buildApplicationForm(f: FormData, opts: { allowAadhaar?: boolean } = { allowAadhaar: true }) {
  const { row, error } = parseStudentFields(f);
  if (error) return { form: null, error };
  // fields that belong to the admission stage, not the application
  const { class_id: _c, section_id: _s, roll_no: _r, admission_date: _d, ...profile } = row;
  void _c; void _s; void _r; void _d;
  const form: Record<string, unknown> = { ...profile };
  const text = (k: string, max = 300) => str(f, k, max);
  for (const k of ["pen", "apaar_id", "allergies", "medical_conditions", "medication", "disability", "accommodations"]) {
    const v = text(k);
    if (v) form[k] = v;
  }
  const apaar = form.apaar_id as string | undefined;
  if (apaar && !/^\d{12}$/.test(apaar)) return { form: null, error: "APAAR ID is a 12-digit number." };
  const dt = text("disability_type", 20);
  if (dt && ["visual", "hearing", "speech", "locomotor", "hand", "multiple", "other"].includes(dt)) form.disability_type = dt;
  const dp = num(f, "disability_percent");
  if (dp !== null && dp >= 0 && dp <= 100) form.disability_percent = dp;
  const aad = opts.allowAadhaar === false ? "" : (text("aadhaar", 20) ?? "").replace(/\D/g, "");
  if (aad) {
    if (!validAadhaar(aad)) return { form: null, error: "That Aadhaar number is not valid. Check the 12 digits." };
    if (f.get("aadhaar_consent") !== "1") return { form: null, error: "Tick that the parent / guardian consented to the Aadhaar number being recorded." };
    if (!encryptionReady()) return { form: null, error: "The server's SETTINGS_ENCRYPTION_KEY is not set, so the Aadhaar number cannot be stored safely." };
    form.aadhaar_enc = encryptJson({ n: aad });
    form.aadhaar_last4 = aad.slice(-4);
    form.aadhaar_consent = true;
  } else if (f.get("aadhaar_keep")) {
    for (const k of ["aadhaar_enc", "aadhaar_last4", "aadhaar_consent"]) { const v = text(`keep_${k}`, 600); if (v) form[k] = k === "aadhaar_consent" ? v === "true" : v; }
  }
  const contacts: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    const name = text(`c_name_${i}`, 100);
    if (!name) continue;
    const phone = (text(`c_phone_${i}`, 20) ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (phone && !mobile10.test(phone)) return { form: null, error: `Contact “${name}”: the phone should be a 10-digit mobile number.` };
    contacts.push({
      name, relation: text(`c_relation_${i}`, 40), phone: phone || undefined, occupation: text(`c_occupation_${i}`, 80),
      is_primary: f.get(`c_primary_${i}`) === "1", is_emergency: f.get(`c_emergency_${i}`) === "1", can_pickup: f.get(`c_pickup_${i}`) === "1",
    });
  }
  if (contacts.length) form.contacts = contacts;
  const prior: unknown[] = [];
  const level = text("p_level", 30), year = text("p_year", 4);
  if (level && (text("p_school", 150) || text("p_roll", 30) || year)) {
    if (year && !/^(19|20)\d{2}$/.test(year)) return { form: null, error: "Earlier exam year should be like 2025." };
    prior.push({ level, board_name: text("p_board", 80), exam_year: year ? Number(year) : undefined, roll_no: text("p_roll", 30), registration_no: text("p_reg", 30),
      school_name: text("p_school", 150), district_code: text("p_dcode", 10), school_code: text("p_scode", 12), result: text("p_result", 40) });
  }
  if (prior.length) form.prior = prior;
  const notes = text("admission_notes", 500);
  if (notes) form.admission_notes = notes;
  return { form, error: null as string | null };
}

