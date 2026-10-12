"use server";

import { revalidatePath } from "next/cache";
import { requirePlatform } from "@/lib/platform";
import { errMsg, go, oneOf, str, uuid } from "@/lib/action-util";
import { ensureLogin, showPasswordOnce } from "@/lib/logins";

/* ═════════ Support desk ═════════ */

export async function replyTicket(f: FormData) {
  const { supabase, user, platformName } = await requirePlatform("support", true);
  const id = uuid(f, "ticket_id");
  const body = str(f, "body", 8000);
  const back = `/platform/support/${id}`;
  if (!body) go(back, { error: "Write a message." });
  const { error } = await supabase.from("ticket_messages").insert({ ticket_id: id, author: user.id, author_name: platformName, from_platform: true, internal: f.get("internal") === "on", body });
  go(back, error ? { error: errMsg(error) } : { ok: f.get("internal") === "on" ? "Internal note added." : "Reply sent." });
}

export async function updateTicket(f: FormData) {
  const { supabase } = await requirePlatform("support", true);
  const id = uuid(f, "ticket_id");
  const { error } = await supabase.from("tickets").update({
    status: oneOf(f, "status", ["open", "pending", "resolved", "closed"] as const, "open"),
    priority: oneOf(f, "priority", ["low", "normal", "high", "urgent"] as const, "normal"),
    assigned_to: uuid(f, "assigned_to"), updated_at: new Date().toISOString(),
  }).eq("id", id!);
  go(`/platform/support/${id}`, error ? { error: errMsg(error) } : { ok: "Ticket updated." });
}

/* ═════════ Announcements ═════════ */

export async function saveAnnouncement(f: FormData) {
  const { supabase, user } = await requirePlatform("announcements", true);
  const id = uuid(f, "id");
  const title = str(f, "title", 150);
  if (!title) go("/platform/announcements", { error: "Title is required." });
  const toTs = (k: string) => { const v = str(f, k, 20); return v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00+05:30`).toISOString() : null; };
  const row = {
    title, body: str(f, "body", 2000), level: oneOf(f, "level", ["info", "warning", "critical"] as const, "info"),
    audience: oneOf(f, "audience", ["all", "plan", "schools"] as const, "all"),
    plan_codes: f.getAll("plan_codes").map(String).filter((x) => /^[a-z0-9_]+$/.test(x)),
    school_ids: f.getAll("school_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)),
    starts_at: toTs("starts_at") ?? new Date().toISOString(), ends_at: toTs("ends_at"),
  };
  const { error } = id ? await supabase.from("announcements").update(row).eq("id", id) : await supabase.from("announcements").insert({ ...row, created_by: user.id });
  go("/platform/announcements", error ? { error: errMsg(error) } : { ok: "Announcement saved." });
}

export async function deleteAnnouncement(f: FormData) {
  const { supabase } = await requirePlatform("announcements", true);
  const { error } = await supabase.from("announcements").delete().eq("id", uuid(f, "id")!);
  go("/platform/announcements", error ? { error: errMsg(error) } : { ok: "Announcement removed." });
}

/* ═════════ Team (platform staff) ═════════ */

const ROLES = ["owner", "admin", "support", "billing", "sales", "viewer"] as const;

export async function addTeamMember(f: FormData) {
  const { supabase } = await requirePlatform("team", true);
  const email = str(f, "email", 120)?.toLowerCase();
  const name = str(f, "name", 100);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) go("/platform/team", { error: "Enter a valid email." });
  const login = await ensureLogin(email!, name);
  if ("error" in login) go("/platform/team", { error: login.error });
  const { error } = await supabase.from("platform_admins").upsert({ user_id: (login as { id: string }).id, role: oneOf(f, "role", ROLES, "viewer"), name, email, active: true });
  if (error) go("/platform/team", { error: errMsg(error) });
  if ((login as { pw?: string }).pw) await showPasswordOnce("/platform", email!, (login as { pw: string }).pw);
  go("/platform/team", { ok: `${email} added to the platform team.` });
}

export async function updateTeamMember(f: FormData) {
  const { supabase, user } = await requirePlatform("team", true);
  const uid = uuid(f, "user_id");
  if (uid === user.id) go("/platform/team", { error: "You can't change your own access." });
  const { error } = await supabase.from("platform_admins").update({ role: oneOf(f, "role", ROLES, "viewer"), active: f.get("active") === "on" }).eq("user_id", uid!);
  go("/platform/team", error ? { error: errMsg(error) } : { ok: "Team member updated." });
}

/* ═════════ Groups (trusts / chains) ═════════ */

export async function saveGroup(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const id = uuid(f, "id");
  const name = str(f, "name", 120);
  if (!name) go("/platform/groups", { error: "Group name is required." });
  const row = { name, city: str(f, "city", 60), contact_name: str(f, "contact_name", 100), contact_phone: str(f, "contact_phone", 20), contact_email: str(f, "contact_email", 120) };
  const { data, error } = id ? await supabase.from("school_groups").update(row).eq("id", id).select("id").single() : await supabase.from("school_groups").insert(row).select("id").single();
  if (error) go("/platform/groups", { error: errMsg(error) });
  const schools = f.getAll("school_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (f.get("set_schools") === "1") {
    await supabase.from("schools").update({ group_id: null }).eq("group_id", data!.id).not("id", "in", `(${schools.join(",") || "00000000-0000-0000-0000-000000000000"})`);
    if (schools.length) await supabase.from("schools").update({ group_id: data!.id }).in("id", schools);
  }
  revalidatePath("/platform/groups");
  go(`/platform/groups?group=${data!.id}`, { ok: "Group saved." });
}

export async function deleteGroup(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const id = uuid(f, "id");
  await supabase.from("schools").update({ group_id: null }).eq("group_id", id!);
  const { error } = await supabase.from("school_groups").delete().eq("id", id!);
  go("/platform/groups", error ? { error: errMsg(error) } : { ok: "Group removed (its schools stay)." });
}

export async function addGroupMember(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const gid = uuid(f, "group_id");
  const email = str(f, "email", 120)?.toLowerCase();
  const name = str(f, "name", 100);
  const back = `/platform/groups?group=${gid}`;
  if (!gid || !email || !/^\S+@\S+\.\S+$/.test(email)) go(back, { error: "Enter a valid email." });
  const login = await ensureLogin(email!, name);
  if ("error" in login) go(back, { error: login.error });
  const { error } = await supabase.from("group_members").upsert({ group_id: gid, user_id: (login as { id: string }).id, name, email, role: oneOf(f, "role", ["owner", "viewer"] as const, "owner") });
  if (error) go(back, { error: errMsg(error) });
  if ((login as { pw?: string }).pw) await showPasswordOnce("/platform", email!, (login as { pw: string }).pw);
  go(back, { ok: `${email} can now see every branch of this group at /group.` });
}

export async function removeGroupMember(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const gid = uuid(f, "group_id");
  const { error } = await supabase.from("group_members").delete().eq("group_id", gid!).eq("user_id", uuid(f, "user_id")!);
  go(`/platform/groups?group=${gid}`, error ? { error: errMsg(error) } : { ok: "Removed from the group." });
}
