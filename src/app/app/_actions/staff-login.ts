"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { errMsg, go, str, uuid } from "@/lib/action-util";
import { resetPassword, showPasswordOnce } from "@/lib/logins";
import { assignClassTeacher, grantStaffLogin, passwordResetBlocker, staffBack, validEmail } from "@/lib/staff-login";
import { ensureHrLetters } from "@/lib/hr-letters";

const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));

/** The cookie that carries the one-time password is scoped to the section the person lands on. */
const pwPath = (back: string) => (back.startsWith("/app/settings/staff") ? "/app/settings/staff" : "/app/hr");

/** An ERP login (with roles) for a staff member who has none yet. */
export async function createStaffLogin(f: FormData) {
  const { supabase, school } = await requirePerm("settings.users.create");
  const id = uuid(f, "staff_id");
  const back = staffBack(f, id ? `/app/hr/staff/${id}` : "/app/hr");
  const { data: s } = id ? await supabase.from("staff").select("id,name,phone,email,user_id").eq("id", id).eq("school_id", school.id).maybeSingle() : { data: null };
  if (!s) go(back, { error: "Staff member not found." });
  if (s!.user_id) go(back, { error: "This person already has a login." });
  const email = (str(f, "email", 120) ?? s!.email)?.toLowerCase();
  if (!validEmail(email)) go(back, { error: "A valid email is needed — it is the sign-in name." });
  const roleIds = ids(f, "role_ids");
  if (!roleIds.length) go(back, { error: "Pick at least one role so the person can see something after signing in." });
  const r = await grantStaffLogin(supabase, school.id, { id: s!.id, name: s!.name, phone: s!.phone }, email!, roleIds);
  if ("error" in r) go(back, { error: r.error });
  const ok = r as { uid: string; pw?: string };
  if (ok.pw) await showPasswordOnce(pwPath(back), email!, ok.pw);
  const ctErr = await assignClassTeacher(supabase, school.id, ok.uid, uuid(f, "class_section_id"));
  if (ctErr) go(back, { error: `Login created, but the class could not be assigned: ${ctErr}` });
  await supabase.rpc("log_event", { p_action: "user.login_created", p_school: school.id, p_entity: "staff", p_entity_id: s!.id, p_details: { email } });
  revalidatePath("/app/hr");
  go(back, { ok: ok.pw ? `Login created for ${email}. Copy the sign-in details below and give them to ${s!.name}.` : `${email} already had a sign-in — linked to ${s!.name} with the chosen roles.` });
}

/** A new temporary password for a staff member (from the staff list, the profile or Settings → Staff & access). */
export async function resetStaffPassword(f: FormData) {
  const { supabase, school, user } = await requirePerm("settings.users.edit");
  const sid = uuid(f, "staff_id");
  let uid = uuid(f, "user_id");
  const back = staffBack(f, sid ? `/app/hr/staff/${sid}` : "/app/settings/staff");
  if (sid) {
    const { data: s } = await supabase.from("staff").select("user_id").eq("id", sid).eq("school_id", school.id).maybeSingle();
    uid = s?.user_id ?? null;
    if (!uid) go(back, { error: "This person has no login yet — create one first." });
  }
  if (!uid) go(back, { error: "Choose a person." });
  if (uid === user.id) go(back, { error: "Change your own password under your name → My account." });
  const { data: m } = await supabase.from("school_members").select("email,name").eq("school_id", school.id).eq("user_id", uid!).maybeSingle();
  if (!m) go(back, { error: "That person is not part of this school." });
  const blocked = await passwordResetBlocker(school.id, uid!);
  if (blocked) go(back, { error: blocked });
  const r = await resetPassword(uid!);
  if ("error" in r) go(back, { error: r.error });
  await supabase.rpc("log_event", { p_action: "user.password_reset", p_school: school.id, p_entity: "auth.users", p_entity_id: uid, p_details: { email: m!.email } });
  await showPasswordOnce(pwPath(back), m!.email ?? "", (r as { pw: string }).pw);
  go(back, { ok: `New temporary password set for ${m!.name ?? m!.email}. Copy it below — it is shown only once.` });
}

/** Adds the standard HR letters (offer, appointment, confirmation, …) to the school's templates. */
export async function installHrLetters(f: FormData) {
  const { supabase, school } = await requirePerm("documents.templates.create");
  const back = staffBack(f, "/app/hr");
  const r = await ensureHrLetters(supabase, school.id);
  if (r.error) go(back, { error: errMsg({ message: r.error }) });
  revalidatePath("/app/documents/templates");
  go(back, { ok: r.added ? `${r.added} standard HR letter template(s) added.` : "All standard HR letters are already set up." });
}
