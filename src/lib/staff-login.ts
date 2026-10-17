import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureLogin } from "./logins";
import { supabaseAdmin } from "./supabase/admin";
import { errMsg } from "./action-util";

export const validEmail = (e: string | null | undefined): e is string => Boolean(e && /^\S+@\S+\.\S+$/.test(e));

/**
 * Gives a staff member an ERP login: finds / creates the sign-in, makes them a member of this school with the chosen roles
 * and links it to their staff record. A new login comes back with its temporary password.
 */
export async function grantStaffLogin(supabase: SupabaseClient, schoolId: string, staff: { id: string; name: string; phone?: string | null }, email: string, roleIds: string[]):
  Promise<{ error: string } | { uid: string; pw?: string }> {
  const login = await ensureLogin(email, staff.name);
  if ("error" in login) return { error: login.error };
  const uid = login.id;
  const { error: me } = await supabase.from("school_members").insert({ school_id: schoolId, user_id: uid, name: staff.name, email, phone: staff.phone ?? null });
  if (me && !/duplicate|unique/i.test(me.message)) return { error: errMsg(me) };
  if (roleIds.length) {
    const { error: re } = await supabase.from("member_roles").insert(roleIds.map((role_id) => ({ school_id: schoolId, user_id: uid, role_id })));
    if (re && !/duplicate|unique/i.test(re.message)) return { error: errMsg(re) };
  }
  const { error: le } = await supabase.from("staff").update({ user_id: uid, email }).eq("id", staff.id).eq("school_id", schoolId);
  if (le) return { error: /staff_school_id_user_id_key/.test(le.message) ? "That login is already linked to another staff member." : errMsg(le) };
  return { uid, pw: login.pw };
}

/**
 * A school may only reset the password of a person who belongs to this school alone: a login that also works in another school,
 * or on the platform team, is not the school's to take over.
 */
export async function passwordResetBlocker(schoolId: string, uid: string): Promise<string | null> {
  const admin = supabaseAdmin();
  if (!admin) return "SUPABASE_SECRET_KEY is not set on the server, so passwords can't be reset.";
  const [{ data: ms, error }, { data: pa }] = await Promise.all([
    admin.from("school_members").select("school_id").eq("user_id", uid),
    admin.from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle(),
  ]);
  if (error) return errMsg(error);
  if (pa) return "This login belongs to the platform team, so its password can't be reset from a school.";
  if (!(ms ?? []).some((m) => m.school_id === schoolId)) return "That person is not part of this school.";
  if ((ms ?? []).length > 1) return "This person also has a login at another school, so the password can't be reset from here. Ask the platform team.";
  return null;
}

/** The staff page to come back to (filters and page number kept, an earlier flash message dropped). */
export function staffBack(f: FormData, fallback: string) {
  const raw = String(f.get("back") ?? "");
  if (!/^\/app\/(hr|settings\/staff)(\/|\?|#|$)/.test(raw) || raw.includes("//")) return fallback;
  const [path, hash] = raw.split("#");
  const [base, query = ""] = path.split("?");
  const q = new URLSearchParams(query);
  q.delete("ok"); q.delete("error");
  return `${base}${q.size ? `?${q}` : ""}${hash ? `#${hash}` : ""}`;
}

/** Makes the login the class teacher of a section — without an assignment an "assigned"-scope teacher sees no students at all. */
export async function assignClassTeacher(supabase: SupabaseClient, schoolId: string, uid: string, sectionId: string | null): Promise<string | null> {
  if (!sectionId) return null;
  const { error } = await supabase.from("staff_assignments").insert({ school_id: schoolId, user_id: uid, section_id: sectionId, subject_id: null, is_class_teacher: true });
  if (error && !/duplicate|unique/i.test(error.message)) return /row-level security|permission denied/i.test(error.message) ? "you can't assign classes — an admin can do it under Settings → Staff & access" : errMsg(error);
  return null;
}
