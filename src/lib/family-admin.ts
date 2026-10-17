import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureLogin, mobileLoginEmail, resetPassword, studentLoginEmail } from "./logins";
import { errMsg } from "./action-util";
import { passwordResetBlocker } from "./staff-login";

export type Provisioned = {
  student_id: string; student: string; cls: string; adm: string;
  who: string; loginId: string; mobile: string | null; pw?: string; note?: string; error?: string;
};

type StudentRow = {
  id: string; admission_no: string; first_name: string; last_name: string | null; father_name: string | null; guardian_phone: string | null; user_id: string | null;
  classes: { name: string } | null; sections: { name: string } | null;
  student_guardians: { is_primary: boolean; guardians: { id: string; name: string; relation: string | null; phone: string | null; email: string | null; user_id: string | null } | null }[];
};
export const FAMILY_STUDENT_SELECT = "id,admission_no,first_name,last_name,father_name,guardian_phone,user_id,classes!class_id(name),sections(name),student_guardians(is_primary,guardians(id,name,relation,phone,email,user_id))";

const validMobile = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
};
const validEmail = (e: string | null | undefined) => (e && /^\S+@\S+\.\S+$/.test(e) ? e.toLowerCase() : null);

/** Role ids of this school's parent / student roles. */
export async function familyRoleIds(supabase: SupabaseClient, schoolId: string) {
  const { data } = await supabase.from("roles").select("id,code").eq("school_id", schoolId).in("code", ["parent", "student"]);
  return { parent: data?.find((r) => r.code === "parent")?.id as string | undefined, student: data?.find((r) => r.code === "student")?.id as string | undefined };
}

async function member(supabase: SupabaseClient, schoolId: string, uid: string, name: string, email: string | null, phone: string | null, roleId: string) {
  const { error: me } = await supabase.from("school_members").insert({ school_id: schoolId, user_id: uid, name, email, phone });
  if (me && !/duplicate|unique/i.test(me.message)) return errMsg(me);
  const { error: re } = await supabase.from("member_roles").insert({ school_id: schoolId, user_id: uid, role_id: roleId });
  if (re && !/duplicate|unique/i.test(re.message)) return errMsg(re);
  return null;
}

/**
 * Gives a student's family a login: one login per parent mobile number (so brothers and sisters share it), and optionally the student its own.
 * A parent who already has a login is left alone (use reset password). New logins come back with their temporary password.
 */
export async function provisionFamily(supabase: SupabaseClient, school: { id: string; code: string }, s: StudentRow, roles: { parent?: string; student?: string }, opts: { student: boolean }): Promise<Provisioned[]> {
  const out: Provisioned[] = [];
  const base = { student_id: s.id, student: [s.first_name, s.last_name].filter(Boolean).join(" "), cls: `${s.classes?.name ?? "—"}${s.sections ? `-${s.sections.name}` : ""}`, adm: s.admission_no };
  if (!roles.parent) return [{ ...base, who: "", loginId: "", mobile: null, error: "This school has no Parent role." }];

  // the guardian to log in: the primary one, else any with a contact, else build one from the student's own contact fields
  const links = [...s.student_guardians].sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).filter((l) => l.guardians);
  let g = links.map((l) => l.guardians!).find((x) => validMobile(x.phone) || validEmail(x.email)) ?? null;
  if (!g) {
    const mob = validMobile(s.guardian_phone);
    if (!mob) { out.push({ ...base, who: s.father_name ?? "", loginId: "", mobile: null, error: "No mobile number or e-mail on the record." }); }
    else {
      const { data, error } = await supabase.from("guardians").insert({ school_id: school.id, name: s.father_name || "Parent", relation: "Father", phone: mob }).select("id,name,relation,phone,email,user_id").single();
      if (error) out.push({ ...base, who: "", loginId: "", mobile: mob, error: errMsg(error) });
      else {
        await supabase.from("student_guardians").insert({ school_id: school.id, student_id: s.id, guardian_id: data.id, is_primary: links.length === 0 });
        g = data;
      }
    }
  }
  if (g) {
    const mobile = validMobile(g.phone);
    const email = validEmail(g.email) ?? (mobile ? mobileLoginEmail(mobile) : null);
    const loginId = validEmail(g.email) ?? mobile ?? "";
    if (g.user_id) out.push({ ...base, who: g.name, loginId, mobile, note: "Already has a login" });
    else if (!email) out.push({ ...base, who: g.name, loginId: "", mobile, error: "No mobile number or e-mail." });
    else {
      const login = await ensureLogin(email, g.name);
      if ("error" in login) out.push({ ...base, who: g.name, loginId, mobile, error: login.error });
      else {
        const err = await member(supabase, school.id, login.id, g.name, validEmail(g.email), mobile, roles.parent);
        if (err) out.push({ ...base, who: g.name, loginId, mobile, error: err });
        else {
          // every guardian row of this family with the same contact points to the same login (brothers and sisters)
          await supabase.from("guardians").update({ user_id: login.id }).eq("school_id", school.id).eq("id", g.id);
          if (mobile) await supabase.from("guardians").update({ user_id: login.id }).eq("school_id", school.id).eq("phone", mobile).is("user_id", null);
          out.push({ ...base, who: g.name, loginId, mobile, pw: login.pw, note: login.pw ? undefined : "Same login as a brother / sister (or an existing account)" });
        }
      }
    }
  }
  if (opts.student && roles.student) {
    const sEmail = studentLoginEmail(school.code, s.admission_no);
    const sLogin = `${school.code}/${s.admission_no}`;
    if (s.user_id) out.push({ ...base, who: `${base.student} (student)`, loginId: sLogin, mobile: null, note: "Already has a login" });
    else {
      const login = await ensureLogin(sEmail, base.student);
      if ("error" in login) out.push({ ...base, who: `${base.student} (student)`, loginId: sLogin, mobile: null, error: login.error });
      else {
        const err = await member(supabase, school.id, login.id, base.student, null, null, roles.student);
        if (err) out.push({ ...base, who: `${base.student} (student)`, loginId: sLogin, mobile: null, error: err });
        else {
          const { error } = await supabase.from("students").update({ user_id: login.id }).eq("id", s.id).eq("school_id", school.id);
          out.push({ ...base, who: `${base.student} (student)`, loginId: sLogin, mobile: null, pw: login.pw, error: error ? errMsg(error) : undefined });
        }
      }
    }
  }
  return out;
}

/** New temporary password for a family or student login (the same safety rules as for staff). */
export async function resetFamilyPassword(schoolId: string, userId: string) {
  const blocked = await passwordResetBlocker(schoolId, userId);
  if (blocked) return { error: blocked } as const;
  return resetPassword(userId);
}
