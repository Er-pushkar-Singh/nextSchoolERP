import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { supabaseConfigured, supabaseServer } from "./supabase/server";
import { supabaseAdmin } from "./supabase/admin";

export type Child = {
  student_id: string; school_id: string; school_name: string; admission_no: string; first_name: string; last_name: string | null;
  class_name: string | null; section_name: string | null; status: string; relation: string | null; is_self: boolean;
};

/** The signed-in family login and the children (or itself) it may open. */
export const getFamily = cache(async () => {
  if (!supabaseConfigured()) redirect("/login");
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?next=/family");
  const { data: kids } = await supabase.rpc("family_children");
  const children = (kids ?? []) as Child[];
  return { supabase, user: data.user, children };
});

/** One child of this family (404 for anyone else's), with the secret-link token the shared student view needs. */
export const requireChild = cache(async (studentId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(studentId)) notFound();
  const fam = await getFamily();
  const child = fam.children.find((c) => c.student_id === studentId);
  if (!child) notFound();
  const { data } = await supabaseAdmin()?.from("students").select("portal_token").eq("id", studentId).maybeSingle() ?? { data: null };
  if (!data?.portal_token) notFound();
  return { ...fam, child, token: data.portal_token as string };
});

export const childName = (c: Pick<Child, "first_name" | "last_name">) => [c.first_name, c.last_name].filter(Boolean).join(" ");
