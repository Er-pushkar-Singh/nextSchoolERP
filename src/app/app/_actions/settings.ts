"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireSchool } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { supabaseServer } from "@/lib/supabase/server";

const S = "/app/settings/school";
const A = "/app/settings/academic";

export async function updateSchool(f: FormData) {
  const { supabase, school } = await requirePerm("settings.school.edit");
  const name = str(f, "name", 150);
  if (!name) go(S, { error: "School name is required." });
  const upi = str(f, "upi_id", 80);
  if (upi && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) go(S, { error: "UPI ID looks wrong (example: schoolname@okhdfcbank)." });
  const uid = str(f, "upmsp_user_id", 6), cno = str(f, "upmsp_center_no", 4);
  if (uid && !/^\d{6}$/.test(uid)) go(S, { error: "The UPMSP user ID is 6 digits." });
  if (cno && !/^\d{4}$/.test(cno)) go(S, { error: "The UPMSP centre number is 4 digits." });
  const { error } = await supabase.from("schools").update({
    upmsp_user_id: uid, upmsp_center_no: cno,
    name, board: oneOf(f, "board", ["CBSE", "ICSE", "UP Board", "State Board", "Other"] as const, "CBSE"),
    address: str(f, "address", 300), city: str(f, "city", 60), state: str(f, "state", 60), pincode: str(f, "pincode", 10),
    phone: str(f, "phone", 20), email: str(f, "email", 120), principal_name: str(f, "principal_name", 100),
    udise_code: str(f, "udise_code", 20), affiliation_no: str(f, "affiliation_no", 30), upi_id: upi, bank_details: str(f, "bank_details", 400),
    receipt_prefix: str(f, "receipt_prefix", 10) ?? "R", next_receipt_no: Math.max(1, num(f, "next_receipt_no") ?? 1),
    admission_prefix: str(f, "admission_prefix", 10) ?? "", next_admission_no: Math.max(1, num(f, "next_admission_no") ?? 1),
    late_fine_per_day: Math.max(0, num(f, "late_fine_per_day") ?? 0), whatsapp_footer: str(f, "whatsapp_footer", 200),
  }).eq("id", school.id);
  revalidatePath("/app", "layout");
  go(S, error ? { error: errMsg(error) } : { ok: "School details saved." });
}

export async function addClass(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.create");
  const name = str(f, "name", 20)?.replace(/^class\s*/i, "");
  if (!name) go(A, { error: "Class name is required." });
  const { data: max } = await supabase.from("classes").select("sort").eq("school_id", school.id).order("sort", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase.from("classes").insert({ school_id: school.id, name, sort: num(f, "sort") ?? (max?.sort ?? 0) + 1 }).select("id").single();
  if (!error) await supabase.from("sections").insert({ school_id: school.id, class_id: data.id, name: "A" });
  go(A, error ? { error: /unique/i.test(error.message) ? "That class already exists." : errMsg(error) } : { ok: `Class ${name} added with section A.` });
}

export async function deleteClass(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.delete");
  const id = uuid(f, "id")!;
  const { count } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("class_id", id);
  if (count) go(A, { error: `Class has ${count} student(s). Move them first.` });
  const { error } = await supabase.from("classes").delete().eq("id", id).eq("school_id", school.id);
  go(A, error ? { error: errMsg(error) } : { ok: "Class removed." });
}

export async function addSection(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.create");
  const name = str(f, "name", 10)?.toUpperCase();
  const class_id = uuid(f, "class_id");
  if (!name || !class_id) go(A, { error: "Pick a class and a section name." });
  const { error } = await supabase.from("sections").insert({ school_id: school.id, class_id, name });
  go(A, error ? { error: /unique/i.test(error.message) ? "That section already exists." : errMsg(error) } : { ok: `Section ${name} added.` });
}

export async function deleteSection(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.delete");
  const id = uuid(f, "id")!;
  const { count } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("section_id", id);
  if (count) go(A, { error: `Section has ${count} student(s). Move them first.` });
  const { error } = await supabase.from("sections").delete().eq("id", id).eq("school_id", school.id);
  go(A, error ? { error: errMsg(error) } : { ok: "Section removed." });
}

export async function addSubject(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.create");
  const name = str(f, "name", 60);
  if (!name) go(A, { error: "Subject name is required." });
  const { error } = await supabase.from("subjects").insert({ school_id: school.id, name, sort: 50 });
  go(A, error ? { error: /unique/i.test(error.message) ? "That subject already exists." : errMsg(error) } : { ok: "Subject added." });
}

export async function deleteSubject(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.delete");
  const { error } = await supabase.from("subjects").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(A, error ? { error: errMsg(error) } : { ok: "Subject removed (and its marks)." });
}

export async function addSession(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.create");
  const start = date(f, "start_date"), end = date(f, "end_date");
  const name = str(f, "name", 20);
  if (!name || !start || !end || end <= start) go(A, { error: "Enter a name like 2027-28 and valid dates." });
  const { data, error } = await supabase.from("sessions").insert({ school_id: school.id, name, start_date: start, end_date: end }).select("id").single();
  if (error) go(A, { error: /unique/i.test(error.message) ? "That session already exists." : errMsg(error) });
  if (f.get("make_current") === "on") await supabase.rpc("set_current_session", { sid: school.id, sess: data!.id });
  revalidatePath("/app", "layout");
  go(A, { ok: `Session ${name} added.` });
}

export async function makeCurrentSession(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.edit");
  const { error } = await supabase.rpc("set_current_session", { sid: school.id, sess: uuid(f, "id") });
  revalidatePath("/app", "layout");
  go(A, error ? { error: errMsg(error) } : { ok: "Current session changed." });
}

export async function promoteAll(f: FormData) {
  const { supabase, school } = await requirePerm("students.promotion.create");
  if (str(f, "confirm", 20)?.toUpperCase() !== "PROMOTE") go(A, { error: "Type PROMOTE to confirm." });
  // Students to hold back in their class (detained), given as admission numbers
  const nos = (str(f, "detain", 2000) ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  let detain: string[] = [];
  if (nos.length) {
    const { data } = await supabase.from("students").select("id,admission_no").eq("school_id", school.id).in("admission_no", nos);
    const found = new Set((data ?? []).map((d) => d.admission_no));
    const missing = nos.filter((n) => !found.has(n));
    if (missing.length) go(A, { error: `No student with admission no.: ${missing.slice(0, 8).join(", ")}. Nobody was promoted.` });
    detain = (data ?? []).map((d) => d.id);
  }
  const { data, error } = await supabase.rpc("promote_students", { sid: school.id, detain });
  const r = data as { promoted: number; passed_out: number; detained: number } | null;
  go(A, error ? { error: errMsg(error) } : { ok: `Promoted ${r?.promoted} students; ${r?.passed_out} marked passed out${r?.detained ? `; ${r.detained} kept in the same class` : ""}. Last year's class records are kept on each student's page. Roll numbers were cleared — set new ones per class.` });
}

export async function setSubjectCode(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.edit");
  const code = str(f, "code", 12);
  if (code && !/^[A-Za-z0-9\-]{1,12}$/.test(code)) go(A, { error: "Subject code can have letters, digits and “-” only." });
  const { error } = await supabase.from("subjects").update({ code: code?.toUpperCase() ?? null }).eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(A, error ? { error: errMsg(error) } : { ok: "Subject code saved." });
}

/* ───────── Own account ───────── */

export async function changePassword(f: FormData) {
  await requireSchool();
  const pw = String(f.get("password") ?? "");
  if (pw.length < 8) go("/app/account", { error: "Use at least 8 characters." });
  if (pw !== String(f.get("confirm") ?? "")) go("/app/account", { error: "Passwords don't match." });
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: pw });
  go("/app/account", error ? { error: errMsg(error) } : { ok: "Password changed." });
}

export async function setModule(f: FormData) {
  const { supabase, school } = await requirePerm("settings.school.edit");
  const m = str(f, "module", 40);
  const { error } = await supabase.rpc("set_module_enabled", { sid: school.id, m, on_off: f.get("on") === "1" });
  revalidatePath("/app", "layout");
  go(S, error ? { error: errMsg(error) } : { ok: "Module updated." });
}

const DAYS_OK = new Set([1, 2, 3, 4, 5, 6, 7]);
export async function savePrefs(f: FormData) {
  const { supabase, school } = await requirePerm("settings.school.edit");
  const days = f.getAll("working_days").map(Number).filter((d) => DAYS_OK.has(d));
  if (!days.length) go(S, { error: "Pick at least one working day." });
  const time = (k: string) => { const v = str(f, k, 5); return v && /^\d{2}:\d{2}$/.test(v) ? v : undefined; };
  const prefs = {
    ...(school.prefs ?? {}),
    timezone: "Asia/Kolkata",
    date_format: oneOf(f, "date_format", ["DD/MM/YYYY", "DD-MMM-YYYY", "YYYY-MM-DD"] as const, "DD/MM/YYYY"),
    week_start: oneOf(f, "week_start", ["mon", "sun"] as const, "mon"),
    language: oneOf(f, "language", ["en", "hi"] as const, "en"),
    working_days: days.sort(),
    quiet_from: time("quiet_from"), quiet_to: time("quiet_to"),
  };
  const { error } = await supabase.from("schools").update({ prefs }).eq("id", school.id);
  revalidatePath("/app", "layout");
  go(`${S}#preferences`, error ? { error: errMsg(error) } : { ok: "Preferences saved." });
}

export async function saveNotifications(f: FormData) {
  const { supabase, school } = await requirePerm("settings.school.edit");
  const { NOTIFY_EVENTS } = await import("@/lib/prefs");
  const notify = Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.code, { sms: f.get(`${e.code}.sms`) === "on", email: f.get(`${e.code}.email`) === "on", whatsapp: f.get(`${e.code}.whatsapp`) === "on" }]));
  const { error } = await supabase.from("schools").update({ prefs: { ...(school.prefs ?? {}), notify } }).eq("id", school.id);
  revalidatePath("/app/settings/notifications");
  go("/app/settings/notifications", error ? { error: errMsg(error) } : { ok: "Notification settings saved." });
}

export async function uploadLogo(f: FormData) {
  const { supabase, school } = await requirePerm("settings.school.edit");
  const file = f.get("logo");
  if (f.get("remove") === "1") {
    const { error } = await supabase.from("schools").update({ logo_url: null }).eq("id", school.id);
    revalidatePath("/app", "layout");
    go(S, error ? { error: errMsg(error) } : { ok: "Logo removed." });
  }
  if (!(file instanceof Blob) || file.size === 0) go(S, { error: "Choose a logo image first." });
  if (file.size > 2 * 1024 * 1024) go(S, { error: "Logo must be under 2 MB." });
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) go(S, { error: "Logo must be a PNG, JPG, WebP or SVG image." });
  const { resolveIntegration, cloudinaryUpload } = await import("@/lib/integrations");
  const cl = await resolveIntegration(school.id, "cloudinary");
  if (!cl) go(S, { error: "No Cloudinary account yet. Add one under Settings → Integrations (or ask CodersDuniya to share theirs)." });
  let url: string;
  try {
    url = await cloudinaryUpload(cl.config, cl.secrets, file, { folder: `${school.code}/branding`, publicId: "logo" });
  } catch (e) {
    go(S, { error: `Upload failed: ${(e as Error).message}` });
  }
  const { error } = await supabase.from("schools").update({ logo_url: url }).eq("id", school.id);
  revalidatePath("/app", "layout");
  go(S, error ? { error: errMsg(error) } : { ok: "Logo uploaded." });
}

export async function saveClassLimits(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.edit");
  const seats = num(f, "seats"), min = num(f, "min_age_years"), max = num(f, "max_age_years");
  if (min !== null && max !== null && min > max) go(A, { error: "The minimum age is more than the maximum age." });
  const { error } = await supabase.from("classes").update({
    seats: seats !== null && seats >= 0 ? Math.round(seats) : null, min_age_years: min !== null && min >= 0 ? min : null, max_age_years: max !== null && max >= 0 ? max : null,
  }).eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(A, error ? { error: errMsg(error) } : { ok: "Seats and age limits saved." });
}
