import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseConfigured, supabaseServer } from "./supabase/server";
import type { SchoolPrefs } from "./prefs";

export type Scope = "school" | "assigned" | "own" | "child" | "self";
export type School = {
  id: string; name: string; code: string; board: string; address: string | null; city: string | null; state: string | null; pincode: string | null;
  phone: string | null; email: string | null; principal_name: string | null; udise_code: string | null; affiliation_no: string | null;
  upi_id: string | null; bank_details: string | null; receipt_prefix: string; admission_prefix: string; late_fine_per_day: number;
  next_receipt_no: number; next_admission_no: number;
  grade_scale: { min: number; grade: string }[]; whatsapp_footer: string | null; plan: string; student_limit: number; status: string;
  logo_url: string | null; brand_color: string | null; prefs: SchoolPrefs;
};

export const SCHOOL_COOKIE = "erp_school";

type Membership = { school_id: string; school_name: string; roles: string[]; viaGroup?: boolean };

/** Signed-in user + the schools they belong to (through roles). */
export const getMe = cache(async () => {
  if (!supabaseConfigured()) redirect("/login");
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const [{ data: rows }, { data: pa }, { data: groups }] = await Promise.all([
    supabase.from("member_roles").select("school_id, roles(name), schools(name)").eq("user_id", data.user.id),
    supabase.from("platform_admins").select("user_id").eq("user_id", data.user.id).eq("active", true).maybeSingle(),
    supabase.from("group_members").select("group_id, role, school_groups(name)").eq("user_id", data.user.id),
  ]);
  const map = new Map<string, Membership>();
  for (const r of (rows ?? []) as unknown as { school_id: string; roles: { name: string } | null; schools: { name: string } | null }[]) {
    const m = map.get(r.school_id) ?? { school_id: r.school_id, school_name: r.schools?.name ?? "School", roles: [] };
    if (r.roles?.name) m.roles.push(r.roles.name);
    map.set(r.school_id, m);
  }
  const G = (groups ?? []) as unknown as { group_id: string; role: string; school_groups: { name: string } | null }[];
  if (G.length) {
    // Group owners / viewers see every branch of their group (read-only unless they also hold a school role)
    const { data: branches } = await supabase.from("schools").select("id,name,group_id").in("group_id", G.map((g) => g.group_id)).is("archived_at", null);
    for (const b of branches ?? []) {
      const m: Membership = map.get(b.id) ?? { school_id: b.id, school_name: b.name, roles: [] };
      if (!m.roles.length) { m.roles.push(G.find((g) => g.group_id === b.group_id)?.role === "owner" ? "Group owner" : "Group viewer"); m.viaGroup = true; }
      map.set(b.id, m);
    }
  }
  return { supabase, user: data.user, memberships: [...map.values()], isPlatform: Boolean(pa), groups: G.map((g) => ({ id: g.group_id, name: g.school_groups?.name ?? "Group", role: g.role })) };
});

/** Current school (cookie, else first membership), current session and the user's permissions there. */
export const requireSchool = cache(async () => {
  const me = await getMe();
  const jar = await cookies();
  // A school's own subdomain / custom domain wins over the remembered choice
  const host = (await headers()).get("host") ?? "";
  const { data: tenant } = host ? await me.supabase.rpc("tenant_by_host", { h: host }) : { data: null };
  const hostSchool = ((tenant ?? []) as { id: string }[])[0]?.id ?? null;
  const wanted = hostSchool ?? jar.get(SCHOOL_COOKIE)?.value;
  // Group owners without a school role start on the group overview until they pick a branch
  if (!wanted && me.memberships.length && me.memberships.every((x) => x.viaGroup)) redirect("/group");
  const m = me.memberships.find((x) => x.school_id === wanted) ?? (hostSchool ? undefined : me.memberships[0]);
  let schoolId = m?.school_id ?? null;
  if (!schoolId && me.isPlatform && wanted) schoolId = wanted;
  if (!schoolId) redirect(me.isPlatform ? "/platform" : hostSchool ? "/no-access?school=1" : me.groups.length ? "/group" : "/no-access");
  const [{ data: school }, { data: session }, { data: perms }, { data: member }, { data: subState }, { data: sub }] = await Promise.all([
    me.supabase.from("schools").select("*").eq("id", schoolId).single(),
    me.supabase.from("sessions").select("id,name,start_date,end_date").eq("school_id", schoolId).eq("is_current", true).maybeSingle(),
    me.supabase.rpc("my_permissions", { sid: schoolId }),
    me.supabase.from("school_members").select("name").eq("school_id", schoolId).eq("user_id", me.user.id).maybeSingle(),
    me.supabase.rpc("subscription_state", { sid: schoolId }),
    me.supabase.from("school_subscriptions").select("current_period_end,grace_days,status").eq("school_id", schoolId).maybeSingle(),
  ]);
  const { data: support } = me.isPlatform
    ? await me.supabase.from("support_sessions").select("id,reason,expires_at").eq("school_id", schoolId).eq("user_id", me.user.id).is("ended_at", null).gt("expires_at", new Date().toISOString()).order("started_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  if (!school) redirect("/no-access");
  const map = new Map<string, Scope>(((perms ?? []) as { perm_key: string; scope: Scope }[]).map((p) => [p.perm_key, p.scope]));
  const can = (key: string) => map.has(key);
  const roleNames = me.memberships.find((x) => x.school_id === schoolId)?.roles ?? (me.isPlatform ? ["Platform admin"] : []);
  return {
    ...me,
    school: school as School,
    session: session as { id: string; name: string; start_date: string; end_date: string } | null,
    perms: map,
    /** true when the user holds this permission (any scope) */
    can,
    /** true when the user holds any of these permissions */
    canAny: (...keys: string[]) => keys.some(can),
    /** the scope of a permission, or null */
    scope: (key: string) => map.get(key) ?? null,
    /** holds the permission for the whole school */
    canSchool: (key: string) => map.get(key) === "school",
    roleNames,
    myName: member?.name ?? me.user.email ?? "",
    /** platform staff inside a school: the active support session, if any (writes need one) */
    support: support as { id: string; reason: string; expires_at: string } | null,
    /** trial | ok | grace | expired | pending | suspended */
    subState: (subState ?? "ok") as "trial" | "ok" | "grace" | "expired" | "pending" | "suspended",
    subEnd: (sub?.current_period_end ?? null) as string | null,
    subGrace: (sub?.grace_days ?? 0) as number,
  };
});

/** Page / action guard: the user needs at least one of the given permissions. */
export async function requirePerm(...keys: string[]) {
  const ctx = await requireSchool();
  if (!keys.some(ctx.can)) redirect("/app?denied=1");
  return ctx;
}
