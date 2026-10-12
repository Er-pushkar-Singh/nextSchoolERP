"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { parseCsv } from "@/lib/csv";
import { getClasses } from "@/lib/erp";

const GENDERS = ["M", "F", "O"] as const;
const CATEGORIES = ["General", "OBC", "SC", "ST", "EWS", "Other"] as const;
const phone = (v: string | null) => (v ? v.replace(/[^\d+]/g, "").replace(/^\+?91(?=\d{10}$)/, "").slice(0, 15) || null : null);

function studentFields(f: FormData) {
  const g = str(f, "gender", 1);
  const cat = str(f, "category", 20);
  return {
    first_name: str(f, "first_name", 80),
    last_name: str(f, "last_name", 80),
    gender: g && (GENDERS as readonly string[]).includes(g) ? g : null,
    dob: date(f, "dob"),
    class_id: uuid(f, "class_id"),
    section_id: uuid(f, "section_id"),
    roll_no: num(f, "roll_no"),
    father_name: str(f, "father_name", 100),
    mother_name: str(f, "mother_name", 100),
    guardian_phone: phone(str(f, "guardian_phone", 20)),
    alt_phone: phone(str(f, "alt_phone", 20)),
    email: str(f, "email", 120),
    address: str(f, "address", 400),
    city: str(f, "city", 60),
    admission_date: date(f, "admission_date"),
    category: cat && (CATEGORIES as readonly string[]).includes(cat) ? cat : null,
    blood_group: str(f, "blood_group", 5),
    transport_route: str(f, "transport_route", 60),
    notes: str(f, "notes", 1000),
  };
}

export async function saveStudent(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.create", "students.profile.edit");
  const id = uuid(f, "id");
  const row = studentFields(f);
  const back = id ? `/app/students/${id}` : "/app/students/new";
  if (!row.first_name) go(back, { error: "Student name is required." });
  if (row.guardian_phone && !/^\d{10}$/.test(row.guardian_phone)) go(back, { error: "Guardian phone should be a 10-digit mobile number." });
  // Section must belong to the chosen class
  if (row.section_id && row.class_id) {
    const { data: sec } = await supabase.from("sections").select("class_id").eq("id", row.section_id).single();
    if (sec?.class_id !== row.class_id) row.section_id = null;
  }
  if (row.class_id && !row.section_id) {
    const { data: first } = await supabase.from("sections").select("id").eq("class_id", row.class_id).order("name").limit(1).maybeSingle();
    row.section_id = first?.id ?? null;
  }
  if (id) {
    const admission_no = str(f, "admission_no", 30);
    const { error } = await supabase.from("students").update({ ...row, ...(admission_no ? { admission_no } : {}) }).eq("id", id).eq("school_id", school.id);
    if (error) go(back, { error: /unique/i.test(error.message) ? "That admission number is already used." : errMsg(error) });
    revalidatePath(`/app/students/${id}`);
    go(back, { ok: "Saved." });
  }
  let admission_no = str(f, "admission_no", 30);
  if (!admission_no) {
    const { data, error } = await supabase.rpc("next_school_number", { sid: school.id, kind: "admission" });
    if (error) go(back, { error: errMsg(error) });
    admission_no = data as string;
  }
  const { data, error } = await supabase.from("students").insert({ ...row, admission_no, school_id: school.id }).select("id").single();
  if (error) go(back, { error: /unique/i.test(error.message) ? "That admission number is already used." : errMsg(error) });
  // Link back to the enquiry it came from
  const enquiry = uuid(f, "enquiry_id");
  if (enquiry) await supabase.from("enquiries").update({ status: "admitted", student_id: data!.id }).eq("id", enquiry).eq("school_id", school.id);
  go(`/app/students/${data!.id}`, { ok: `Admitted. Admission no. ${admission_no}` });
}

export async function setStudentStatus(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.edit");
  const id = uuid(f, "id");
  const status = oneOf(f, "status", ["active", "left", "passed_out"] as const, "active");
  const { error } = await supabase.from("students").update({ status }).eq("id", id!).eq("school_id", school.id);
  go(`/app/students/${id}`, error ? { error: errMsg(error) } : { ok: `Marked ${status.replace("_", " ")}.` });
}

export async function newPortalLink(f: FormData) {
  const { supabase, school } = await requirePerm("students.parent_link.edit");
  const id = uuid(f, "id");
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await supabase.from("students").update({ portal_token: token }).eq("id", id!).eq("school_id", school.id);
  go(`/app/students/${id}`, error ? { error: errMsg(error) } : { ok: "New parent link created. The old link no longer works." });
}

export async function addConcession(f: FormData) {
  const { supabase, school } = await requirePerm("fees.concessions.create");
  const student_id = uuid(f, "student_id");
  const value = num(f, "value");
  const kind = oneOf(f, "kind", ["percent", "amount"] as const, "percent");
  const back = `/app/students/${student_id}`;
  if (!student_id || value === null || value <= 0 || (kind === "percent" && value > 100)) go(back, { error: "Enter a valid concession." });
  const { error } = await supabase.from("student_concessions").insert({ school_id: school.id, student_id, fee_head_id: uuid(f, "fee_head_id"), kind, value, reason: str(f, "reason", 200) });
  go(back, error ? { error: errMsg(error) } : { ok: "Concession added. It applies to instalments generated from now on; use “Apply to unpaid” to update existing ones." });
}

/** Re-apply concessions to this student's unpaid instalments. */
export async function applyConcessions(f: FormData) {
  const { supabase, school } = await requirePerm("fees.concessions.create");
  const student_id = uuid(f, "student_id")!;
  const back = `/app/students/${student_id}`;
  const [{ data: cons }, { data: dues }] = await Promise.all([
    supabase.from("student_concessions").select("fee_head_id,kind,value").eq("student_id", student_id).eq("school_id", school.id),
    supabase.from("fee_dues").select("id,fee_head_id,amount,paid,status").eq("student_id", student_id).eq("school_id", school.id).neq("status", "paid"),
  ]);
  let n = 0;
  for (const d of dues ?? []) {
    const amount = Number(d.amount);
    const c = (cons ?? []).filter((x) => !x.fee_head_id || x.fee_head_id === d.fee_head_id)
      .reduce((s, x) => s + (x.kind === "percent" ? (amount * Number(x.value)) / 100 : Number(x.value)), 0);
    const concession = Math.min(amount, Math.round(c * 100) / 100);
    const { error } = await supabase.from("fee_dues").update({ concession }).eq("id", d.id);
    if (error) go(back, { error: errMsg(error) });
    n++;
  }
  go(back, { ok: `Updated ${n} unpaid instalment(s).` });
}

export async function removeConcession(f: FormData) {
  const { supabase, school } = await requirePerm("fees.concessions.delete");
  const id = uuid(f, "id");
  const student_id = uuid(f, "student_id");
  const { error } = await supabase.from("student_concessions").delete().eq("id", id!).eq("school_id", school.id);
  go(`/app/students/${student_id}`, error ? { error: errMsg(error) } : { ok: "Concession removed." });
}

const HEADERS = ["admission_no", "first_name", "last_name", "class", "section", "roll_no", "gender", "dob", "father_name", "mother_name", "guardian_phone", "address"] as const;

/** Bulk import from CSV (Excel → Save as CSV). */
export async function importStudents(f: FormData) {
  const { supabase, school } = await requirePerm("students.import.create");
  const file = f.get("file");
  let text = str(f, "csv", 2_000_000) ?? "";
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) go("/app/students/import", { error: "File is larger than 2 MB. Split it into parts." });
    text = await file.text();
  }
  const rows = parseCsv(text);
  if (rows.length < 2) go("/app/students/import", { error: "No rows found. The first row must be the column headings." });
  const head = rows[0].map((h) => h.toLowerCase().replace(/[^a-z_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""));
  const idx = Object.fromEntries(HEADERS.map((h) => [h, head.indexOf(h)]));
  if (idx.first_name < 0) go("/app/students/import", { error: "Missing column: first_name" });
  const classes = await getClasses(supabase, school.id);
  const byClass = new Map(classes.map((c) => [c.name.toLowerCase(), c]));
  const errors: string[] = [];
  const insert: Record<string, unknown>[] = [];
  for (const [i, r] of rows.slice(1).entries()) {
    const get = (k: (typeof HEADERS)[number]) => (idx[k] >= 0 ? r[idx[k]]?.trim() || null : null);
    const line = i + 2;
    const first_name = get("first_name");
    if (!first_name) { errors.push(`Row ${line}: first_name is empty`); continue; }
    const cname = get("class")?.replace(/^class\s*/i, "").toLowerCase();
    const cls = cname ? byClass.get(cname) : undefined;
    if (cname && !cls) { errors.push(`Row ${line}: class “${get("class")}” doesn't exist`); continue; }
    const sec = cls ? cls.sections.find((s) => s.name.toLowerCase() === (get("section") ?? "").toLowerCase()) ?? cls.sections[0] : undefined;
    let dob = get("dob");
    const m = dob?.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY (Indian)
    if (m) dob = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) dob = null;
    const g = get("gender")?.toUpperCase().slice(0, 1);
    const ph = phone(get("guardian_phone"));
    insert.push({
      school_id: school.id, admission_no: get("admission_no"), first_name, last_name: get("last_name"),
      class_id: cls?.id ?? null, section_id: sec?.id ?? null, roll_no: Number(get("roll_no")) || null,
      gender: g === "M" || g === "F" ? g : g === "O" ? "O" : null, dob, father_name: get("father_name"), mother_name: get("mother_name"),
      guardian_phone: ph && /^\d{10}$/.test(ph) ? ph : null, address: get("address"),
    });
  }
  if (insert.length > 3000) go("/app/students/import", { error: "Import at most 3,000 students at a time." });
  let ok = 0;
  for (const s of insert) {
    if (!s.admission_no) {
      const { data, error } = await supabase.rpc("next_school_number", { sid: school.id, kind: "admission" });
      if (error) go("/app/students/import", { error: errMsg(error) });
      s.admission_no = data;
    }
  }
  for (let i = 0; i < insert.length; i += 200) {
    const chunk = insert.slice(i, i + 200);
    const { error } = await supabase.from("students").insert(chunk);
    if (!error) { ok += chunk.length; continue; }
    // Fall back row by row to report exactly which ones failed
    for (const s of chunk) {
      const { error: e } = await supabase.from("students").insert(s);
      if (e) errors.push(`${s.first_name} (${s.admission_no}): ${/unique/i.test(e.message) ? "admission no. already exists" : errMsg(e)}`);
      else ok++;
    }
  }
  revalidatePath("/app/students");
  const msg = `Imported ${ok} student(s).${errors.length ? ` Skipped ${errors.length}: ${errors.slice(0, 8).join("; ")}${errors.length > 8 ? "…" : ""}` : ""}`;
  go("/app/students/import", errors.length && !ok ? { error: msg } : { ok: msg });
}
