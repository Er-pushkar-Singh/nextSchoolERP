"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { SCHOOL_COOKIE } from "@/lib/school";
import { loginEmail } from "@/lib/logins";

export async function signIn(_prev: { error?: string } | undefined, f: FormData) {
  const email = String(f.get("email") ?? "").trim();
  const password = String(f.get("password") ?? "");
  const next = String(f.get("next") ?? "/app");
  if (!email || !password) return { error: "Enter email and password." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(email), password });
  if (error) return { error: "Wrong email or password." };
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/app");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  (await cookies()).delete(SCHOOL_COOKIE);
  redirect("/login");
}

export async function switchSchool(f: FormData) {
  const id = String(f.get("school_id") ?? "");
  if (/^[0-9a-f-]{36}$/.test(id)) (await cookies()).set(SCHOOL_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
  redirect("/app");
}
