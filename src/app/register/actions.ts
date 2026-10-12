"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

type State = { error?: string; values?: Record<string, string> } | undefined;
const hits = new Map<string, number[]>(); // best-effort per-instance rate limit

export async function registerSchool(_prev: State, f: FormData): Promise<State> {
  const v = (k: string, max = 120) => String(f.get(k) ?? "").trim().slice(0, max);
  const values = { school: v("school"), board: v("board"), city: v("city"), principal: v("principal"), email: v("email").toLowerCase(), phone: v("phone").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") };
  // Bots: honeypot + submitted too fast
  if (v("website") || Date.now() - Number(v("t")) < 3000) return { error: "Please try again.", values };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 5) return { error: "Too many attempts from this network. Try again in an hour.", values };
  hits.set(ip, [...recent, now]);

  if (values.school.length < 3) return { error: "Enter the school's full name.", values };
  if (!values.city) return { error: "Enter the city.", values };
  if (!values.principal) return { error: "Enter the principal / owner name.", values };
  if (!/^\S+@\S+\.\S+$/.test(values.email)) return { error: "Enter a valid email — it becomes your login.", values };
  if (!/^[6-9]\d{9}$/.test(values.phone)) return { error: "Enter a 10-digit Indian mobile number.", values };
  const password = String(f.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters.", values };
  if (!["CBSE", "ICSE", "UP Board", "State Board", "Other"].includes(values.board)) values.board = "CBSE";

  const admin = supabaseAdmin();
  if (!admin) return { error: "Registration is not available right now.", values };
  const { data: cfg } = await admin.from("platform_settings").select("value").eq("key", "signup").maybeSingle();
  if (!(cfg?.value as { enabled?: boolean } | undefined)?.enabled) return { error: "Online registration is closed. Please contact CodersDuniya.", values };

  const { data: created, error: ce } = await admin.auth.admin.createUser({ email: values.email, password, email_confirm: true, user_metadata: { name: values.principal } });
  if (!created?.user) {
    return { error: ce && /already|exists|registered/i.test(ce.message) ? "This email already has a login. Sign in instead, or use another email." : "Could not create the login. Try again.", values };
  }
  const { error } = await admin.rpc("register_school", {
    p_name: values.school, p_board: values.board, p_city: values.city, p_user: created.user.id,
    p_principal: values.principal, p_email: values.email, p_phone: values.phone,
  });
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { error: error.message.replace(/^.*?: /, "").slice(0, 200), values };
  }
  const supabase = await supabaseServer();
  await supabase.auth.signInWithPassword({ email: values.email, password });
  redirect("/app?welcome=1");
}
