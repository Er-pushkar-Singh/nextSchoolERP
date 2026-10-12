import "server-only";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase/admin";
import { errMsg } from "./action-util";

export function tempPassword() {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(10));
  return `${Array.from(b.slice(0, 6), (x) => a[x % a.length]).join("")}-${1000 + ((b[6] * 256 + b[7]) % 9000)}`;
}

/** Find or create a login by email. Returns its id and, for a new login, the temporary password. */
export async function ensureLogin(email: string, name: string | null): Promise<{ id: string; pw?: string } | { error: string }> {
  const admin = supabaseAdmin();
  if (!admin) return { error: "SUPABASE_SECRET_KEY is not set on the server, so logins can't be created." };
  const pw = tempPassword();
  const { data: c, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { name } });
  if (c?.user) return { id: c.user.id, pw };
  if (error && /already|exists|registered/i.test(error.message)) {
    for (let page = 1; page <= 20; page++) {
      const { data: l } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      const u = l?.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
      if (u) return { id: u.id };
      if (!l || l.users.length < 1000) break;
    }
  }
  return { error: errMsg(error, "Couldn't create the login.") };
}

/** Set a new temporary password for a login (support: "reset password"). */
export async function resetPassword(userId: string) {
  const admin = supabaseAdmin();
  if (!admin) return { error: "SUPABASE_SECRET_KEY is not set." } as const;
  const pw = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: pw });
  return error ? ({ error: errMsg(error) } as const) : ({ pw } as const);
}

/** Show a temporary password once on the next page under `path` (httpOnly cookie, 2 minutes, never in the URL). */
export async function showPasswordOnce(path: string, email: string, pw: string) {
  (await cookies()).set("erp_newpw", JSON.stringify({ email, pw }), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path, maxAge: 120 });
}

export async function readPasswordOnce() {
  const raw = (await cookies()).get("erp_newpw")?.value;
  try { return raw ? (JSON.parse(raw) as { email: string; pw: string }) : null; } catch { return null; }
}
