"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { errMsg, go, oneOf, str, uuid } from "@/lib/action-util";
import { ensureLogin, showPasswordOnce } from "@/lib/logins";
import catalog from "@/lib/catalog.json";

const STAFF = "/app/settings/staff";
const ROLES = "/app/settings/roles";
const SCOPES = ["school", "assigned", "own", "child", "self"] as const;
const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));

/* ───────── Staff ───────── */

export async function addStaff(f: FormData) {
  const { supabase, school } = await requirePerm("settings.users.create");
  const email = str(f, "email", 120)?.toLowerCase();
  const name = str(f, "name", 100);
  const roleIds = ids(f, "role_ids");
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !name) go(STAFF, { error: "Name and a valid email are required." });
  if (!roleIds.length) go(STAFF, { error: "Pick at least one role." });
  const login = await ensureLogin(email!, name);
  if ("error" in login) go(STAFF, { error: login.error });
  const uid = (login as { id: string }).id;
  const { error } = await supabase.from("school_members").insert({ school_id: school.id, user_id: uid, name, email, phone: str(f, "phone", 20) });
  if (error && !/duplicate|unique/i.test(error.message)) go(STAFF, { error: errMsg(error) });
  const { error: re } = await supabase.from("member_roles").insert(roleIds.map((role_id) => ({ school_id: school.id, user_id: uid, role_id })));
  if (re && !/duplicate|unique/i.test(re.message)) go(STAFF, { error: errMsg(re) });
  if ((login as { pw?: string }).pw) await showPasswordOnce(STAFF, email!, (login as { pw: string }).pw);
  revalidatePath(STAFF);
  go(`${STAFF}?user=${uid}`, { ok: (login as { pw?: string }).pw ? `Login created for ${email}.` : `${email} already had a login — added to your school with the chosen roles.` });
}

export async function setStaffRoles(f: FormData) {
  const { supabase, school } = await requirePerm("settings.users.edit");
  const uid = uuid(f, "user_id");
  const want = new Set(ids(f, "role_ids"));
  const back = `${STAFF}?user=${uid}`;
  if (!uid) go(STAFF);
  if (!want.size) go(back, { error: "Keep at least one role. To remove the person, use Remove." });
  const { data: have } = await supabase.from("member_roles").select("role_id").eq("school_id", school.id).eq("user_id", uid!);
  const cur = new Set((have ?? []).map((r) => r.role_id));
  const add = [...want].filter((r) => !cur.has(r));
  const del = [...cur].filter((r) => !want.has(r));
  if (add.length) {
    const { error } = await supabase.from("member_roles").insert(add.map((role_id) => ({ school_id: school.id, user_id: uid, role_id })));
    if (error) go(back, { error: errMsg(error) });
  }
  if (del.length) {
    const { error } = await supabase.from("member_roles").delete().eq("school_id", school.id).eq("user_id", uid!).in("role_id", del);
    if (error) go(back, { error: errMsg(error) });
  }
  revalidatePath(STAFF);
  go(back, { ok: "Roles saved." });
}

export async function removeStaff(f: FormData) {
  const { supabase, school, user } = await requirePerm("settings.users.delete");
  const uid = uuid(f, "user_id");
  if (!uid || uid === user.id) go(STAFF, { error: "You can't remove yourself." });
  const { error } = await supabase.from("member_roles").delete().eq("school_id", school.id).eq("user_id", uid!);
  if (error) go(STAFF, { error: errMsg(error) });
  await supabase.from("staff_assignments").delete().eq("school_id", school.id).eq("user_id", uid!);
  await supabase.from("member_overrides").delete().eq("school_id", school.id).eq("user_id", uid!);
  await supabase.from("school_members").delete().eq("school_id", school.id).eq("user_id", uid!);
  go(STAFF, { ok: "Removed from this school. Their login can no longer open it." });
}

export async function addAssignment(f: FormData) {
  const { supabase, school } = await requirePerm("academics.allocation.create", "academics.allocation.edit");
  const uid = uuid(f, "user_id");
  const back = `${STAFF}?user=${uid}`;
  const sections = ids(f, "section_ids");
  const subject = uuid(f, "subject_id");
  const isCt = f.get("is_class_teacher") === "on";
  if (!uid || !sections.length) go(back, { error: "Pick at least one section." });
  const rows = sections.map((section_id) => ({ school_id: school.id, user_id: uid, section_id, subject_id: isCt ? null : subject, is_class_teacher: isCt }));
  let added = 0;
  for (const r of rows) {
    const { error } = await supabase.from("staff_assignments").insert(r);
    if (!error) added++;
    else if (!/duplicate|unique/i.test(error.message)) go(back, { error: errMsg(error) });
  }
  go(back, { ok: `Assigned ${added} new section(s).` });
}

export async function removeAssignment(f: FormData) {
  const { supabase, school } = await requirePerm("academics.allocation.delete", "academics.allocation.edit");
  const { error } = await supabase.from("staff_assignments").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(`${STAFF}?user=${uuid(f, "user_id")}`, error ? { error: errMsg(error) } : { ok: "Assignment removed." });
}

export async function setOverride(f: FormData) {
  const { supabase, school } = await requirePerm("settings.roles.edit");
  const uid = uuid(f, "user_id");
  const key = str(f, "perm_key", 80);
  const back = `${STAFF}?user=${uid}`;
  const effect = oneOf(f, "effect", ["grant", "deny", "remove"] as const, "remove");
  if (!uid || !key) go(back, { error: "Pick a permission." });
  const { error } = effect === "remove"
    ? await supabase.from("member_overrides").delete().eq("school_id", school.id).eq("user_id", uid!).eq("perm_key", key!)
    : await supabase.from("member_overrides").upsert({ school_id: school.id, user_id: uid, perm_key: key, effect, scope: oneOf(f, "scope", SCOPES, "school") });
  go(back, error ? { error: errMsg(error) } : { ok: effect === "remove" ? "Exception removed." : `Exception saved: ${effect} ${key}.` });
}

/* ───────── Roles ───────── */

export async function createRole(f: FormData) {
  const { supabase, school } = await requirePerm("settings.roles.create");
  const name = str(f, "name", 60);
  const from = uuid(f, "copy_from");
  if (!name) go(ROLES, { error: "Role name is required." });
  const code = `custom_${name!.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24)}_${Math.random().toString(36).slice(2, 6)}`;
  const { data: src } = from ? await supabase.from("roles").select("kind").eq("id", from).maybeSingle() : { data: null };
  const { data, error } = await supabase.from("roles").insert({ school_id: school.id, code, name, description: str(f, "description", 200), kind: src?.kind ?? "staff" }).select("id").single();
  if (error) go(ROLES, { error: errMsg(error) });
  if (from) {
    const { data: perms } = await supabase.from("role_permissions").select("perm_key,scope").eq("role_id", from);
    if (perms?.length) {
      const { error: pe } = await supabase.from("role_permissions").insert(perms.map((p) => ({ ...p, role_id: data!.id })));
      if (pe) go(`${ROLES}/${data!.id}`, { error: errMsg(pe) });
    }
  }
  go(`${ROLES}/${data!.id}`, { ok: "Role created. Tick what it may do, then Save." });
}

/** Save the whole permission matrix of one role. Form fields: p:<perm key> = on, s:<module.sub> = scope */
export async function saveRolePermissions(f: FormData) {
  const { supabase } = await requirePerm("settings.roles.edit");
  const rid = uuid(f, "role_id");
  const back = `${ROLES}/${rid}`;
  const { data: role } = await supabase.from("roles").select("id,locked,name").eq("id", rid!).maybeSingle();
  if (!role) go(ROLES, { error: "Role not found." });
  if (role!.locked) go(back, { error: `${role!.name} always has every permission.` });
  const valid = new Set(catalog.modules.flatMap((m) => m.submodules.flatMap((s) => s.actions.map((a) => `${m.code}.${s.code}.${a}`))));
  const want = new Map<string, string>();
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("p:") || v !== "on") continue;
    const key = k.slice(2);
    if (!valid.has(key)) continue;
    const sub = key.split(".").slice(0, 2).join(".");
    const sc = String(f.get(`s:${sub}`) ?? "school");
    want.set(key, (SCOPES as readonly string[]).includes(sc) ? sc : "school");
  }
  const { data: have } = await supabase.from("role_permissions").select("perm_key,scope").eq("role_id", rid!);
  const cur = new Map((have ?? []).map((p) => [p.perm_key, p.scope]));
  const del = [...cur.keys()].filter((k) => !want.has(k) || want.get(k) !== cur.get(k));
  const add = [...want.entries()].filter(([k, sc]) => cur.get(k) !== sc).map(([perm_key, scope]) => ({ role_id: rid, perm_key, scope }));
  if (del.length) {
    const { error } = await supabase.from("role_permissions").delete().eq("role_id", rid!).in("perm_key", del);
    if (error) go(back, { error: errMsg(error) });
  }
  if (add.length) {
    const { error } = await supabase.from("role_permissions").insert(add);
    if (error) go(back, { error: errMsg(error) });
  }
  const name = str(f, "name", 60);
  if (name) await supabase.from("roles").update({ name, description: str(f, "description", 200) }).eq("id", rid!);
  revalidatePath("/app", "layout");
  go(back, { ok: `Saved: ${want.size} permissions (${add.length} added or changed, ${del.length - add.filter((a) => cur.has(a.perm_key)).length} removed).` });
}

export async function resetRole(f: FormData) {
  const { supabase } = await requirePerm("settings.roles.edit");
  const rid = uuid(f, "role_id");
  const { error } = await supabase.rpc("reset_role_to_template", { rid });
  go(`${ROLES}/${rid}`, error ? { error: errMsg(error) } : { ok: "Reset to the default permissions." });
}

export async function deleteRole(f: FormData) {
  const { supabase, school } = await requirePerm("settings.roles.delete");
  const rid = uuid(f, "role_id");
  const { count } = await supabase.from("member_roles").select("user_id", { count: "exact", head: true }).eq("role_id", rid!);
  if (count) go(`${ROLES}/${rid}`, { error: `${count} person(s) still have this role. Change their roles first.` });
  const { error } = await supabase.from("roles").delete().eq("id", rid!).eq("school_id", school.id);
  if (error) go(`${ROLES}/${rid}`, { error: errMsg(error) });
  go(ROLES, { ok: "Role deleted." });
}
