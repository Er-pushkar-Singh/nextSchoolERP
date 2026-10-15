"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import { notifyPlatformInvoice } from "@/lib/message-events";
import { processOutbox } from "@/lib/messages";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SCHOOL_COOKIE } from "@/lib/school";
import { requirePlatform } from "@/lib/platform";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { attachPaymentLink } from "@/lib/billing";
import { ensureLogin, resetPassword, showPasswordOnce } from "@/lib/logins";

const BOARDS = ["CBSE", "ICSE", "UP Board", "State Board", "Other"] as const;
const tenantPath = (id: string | null, tab = "overview") => `/platform/tenants/${id}?tab=${tab}`;
const slug = (v: string | null) => (v ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

async function setSchoolCookie(id: string) {
  (await cookies()).set(SCHOOL_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

/** Give a user a role in a school (creating the login if needed). */
async function addSchoolUser(supabase: Awaited<ReturnType<typeof requirePlatform>>["supabase"], sid: string, email: string, name: string | null, phone: string | null, roleCode: string) {
  const login = await ensureLogin(email, name);
  if ("error" in login) return { error: login.error };
  await supabase.from("school_members").upsert({ school_id: sid, user_id: login.id, name, email, phone }, { onConflict: "school_id,user_id" });
  const { data: role } = await supabase.from("roles").select("id").eq("school_id", sid).eq("code", roleCode).single();
  if (!role) return { error: `Role ${roleCode} not found in this school.` };
  const { error } = await supabase.from("member_roles").insert({ school_id: sid, user_id: login.id, role_id: role.id });
  if (error && !/duplicate|unique/i.test(error.message)) return { error: errMsg(error) };
  return { id: login.id, pw: login.pw };
}

/* ═════════ Tenants ═════════ */

export async function createTenant(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const name = str(f, "name", 150);
  const code = slug(str(f, "code", 40) ?? name);
  const back = "/platform/tenants/new";
  if (!name || code.length < 3) go(back, { error: "School name and a short code (a–z, 0–9, -) are required." });
  const { data: sid, error } = await supabase.rpc("create_school", {
    p_name: name, p_code: code, p_board: oneOf(f, "board", BOARDS, "CBSE"), p_city: str(f, "city", 60) ?? "Lucknow",
    p_plan: str(f, "plan", 30) ?? "trial", p_cycle: oneOf(f, "cycle", ["monthly", "yearly"] as const, "yearly"),
  });
  if (error) go(back, { error: /unique|duplicate/i.test(error.message) ? "That code / subdomain is already used." : errMsg(error) });
  const id = sid as string;
  await supabase.from("schools").update({
    state: str(f, "state", 60) ?? "Uttar Pradesh", phone: str(f, "phone", 20), email: str(f, "email", 120), principal_name: str(f, "admin_name", 100),
    logo_url: str(f, "logo_url", 500), brand_color: /^#[0-9a-fA-F]{6}$/.test(str(f, "brand_color", 7) ?? "") ? str(f, "brand_color", 7) : null,
    custom_domain: str(f, "custom_domain", 120)?.toLowerCase() ?? null, group_id: uuid(f, "group_id"), source: "platform",
  }).eq("id", id);
  const adminEmail = str(f, "admin_email", 120)?.toLowerCase();
  if (adminEmail) {
    const r = await addSchoolUser(supabase, id, adminEmail, str(f, "admin_name", 100), str(f, "phone", 20), "principal");
    if ("error" in r) go(tenantPath(id, "users"), { error: `School created, but the admin login failed: ${r.error}` });
    if (r.pw) await showPasswordOnce("/platform", adminEmail, r.pw);
  }
  go(tenantPath(id), { ok: `${name} is ready${adminEmail ? ` — admin ${adminEmail}` : ""}.` });
}

export async function updateTenant(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const id = uuid(f, "id");
  const color = str(f, "brand_color", 7);
  const sub = slug(str(f, "subdomain", 42));
  const { error } = await supabase.from("schools").update({
    name: str(f, "name", 150), board: oneOf(f, "board", BOARDS, "CBSE"), city: str(f, "city", 60), state: str(f, "state", 60),
    phone: str(f, "phone", 20), email: str(f, "email", 120), principal_name: str(f, "principal_name", 100), principal_phone: str(f, "principal_phone", 20),
    logo_url: str(f, "logo_url", 500), brand_color: color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
    subdomain: sub || null, custom_domain: str(f, "custom_domain", 120)?.toLowerCase() ?? null, group_id: uuid(f, "group_id"), notes: str(f, "notes", 4000),
  }).eq("id", id!);
  go(tenantPath(id), error ? { error: /subdomain|custom_domain|unique/i.test(error.message) ? "That subdomain or domain is already used by another school." : errMsg(error) } : { ok: "Saved." });
}

export async function setSchoolStatus(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const sid = uuid(f, "school_id");
  const status = oneOf(f, "status", ["active", "suspended", "approve"] as const, "active");
  const { error } = status === "approve" ? await supabase.rpc("approve_school", { sid }) : await supabase.from("schools").update({ status }).eq("id", sid!);
  go(tenantPath(sid), error ? { error: errMsg(error) } : { ok: status === "approve" ? "Approved — trial started today." : `School ${status}.` });
}

export async function archiveTenant(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const sid = uuid(f, "school_id");
  const { error } = await supabase.rpc("archive_school", { sid, p_reason: str(f, "reason", 300) });
  go(tenantPath(sid, "danger"), error ? { error: errMsg(error) } : { ok: "Archived: logins stopped, data kept. Restore any time." });
}

export async function restoreTenant(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const sid = uuid(f, "school_id");
  const { error } = await supabase.rpc("restore_school", { sid });
  go(tenantPath(sid, "danger"), error ? { error: errMsg(error) } : { ok: "Restored." });
}

export async function deleteTenant(f: FormData) {
  const { supabase, role } = await requirePlatform("tenants", true);
  const sid = uuid(f, "school_id");
  if (role !== "owner") go(tenantPath(sid, "danger"), { error: "Only the platform owner can delete a school." });
  const { data: s } = await supabase.from("schools").select("code,archived_at").eq("id", sid!).single();
  if (!s?.archived_at) go(tenantPath(sid, "danger"), { error: "Archive the school first, then delete." });
  if (str(f, "confirm", 60) !== s!.code) go(tenantPath(sid, "danger"), { error: `Type the school code (${s!.code}) to confirm.` });
  const { error } = await supabase.from("schools").delete().eq("id", sid!);
  go("/platform/tenants", error ? { error: errMsg(error) } : { ok: "School and all its data deleted permanently." });
}

export async function setLicence(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const sid = uuid(f, "school_id");
  const { error } = await supabase.from("school_modules").upsert({ school_id: sid, module_code: str(f, "module", 40), licensed: f.get("on") === "1", enabled: true });
  go(tenantPath(sid, "modules"), error ? { error: errMsg(error) } : { ok: "Licence updated." });
}

export async function syncRoles(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const sid = uuid(f, "school_id");
  const { data, error } = await supabase.rpc("sync_role_templates", { sid });
  go(tenantPath(sid, "modules"), error ? { error: errMsg(error) } : { ok: `Default roles synced (${data} added).` });
}

/* ═════════ Entering a school ═════════ */

/** Read-only look inside a school (no reason needed). */
export async function viewSchool(f: FormData) {
  await requirePlatform("tenants");
  const id = uuid(f, "id");
  if (id) await setSchoolCookie(id);
  redirect("/app");
}

/** Support session: lets platform staff change this school's data for a limited time. Logged with the reason. */
export async function startSupport(f: FormData) {
  const { supabase } = await requirePlatform("impersonate", true);
  const sid = uuid(f, "school_id");
  const { error } = await supabase.rpc("start_support_session", { sid, p_reason: str(f, "reason", 300), p_minutes: num(f, "minutes") ?? 60 });
  if (error) go(tenantPath(sid), { error: errMsg(error) });
  await setSchoolCookie(sid!);
  redirect("/app");
}

export async function endSupport(f: FormData) {
  const { supabase } = await requirePlatform();
  const sid = uuid(f, "school_id");
  await supabase.rpc("end_support_session", { sid });
  redirect(tenantPath(sid));
}

/* ═════════ Tenant users ═════════ */

export async function addTenantUser(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const sid = uuid(f, "school_id");
  const email = str(f, "email", 120)?.toLowerCase();
  if (!sid || !email || !/^\S+@\S+\.\S+$/.test(email)) go(tenantPath(sid, "users"), { error: "Enter a valid email." });
  const r = await addSchoolUser(supabase, sid!, email!, str(f, "name", 100), str(f, "phone", 20), str(f, "role", 40) ?? "principal");
  if ("error" in r) go(tenantPath(sid, "users"), { error: r.error });
  if (r.pw) await showPasswordOnce("/platform", email!, r.pw);
  go(tenantPath(sid, "users"), { ok: r.pw ? `Login created for ${email}.` : `${email} added with the chosen role.` });
}

export async function resetTenantUserPassword(f: FormData) {
  const { supabase } = await requirePlatform("impersonate", true);
  const sid = uuid(f, "school_id");
  const uid = uuid(f, "user_id");
  const { data: m } = await supabase.from("school_members").select("email").eq("school_id", sid!).eq("user_id", uid!).maybeSingle();
  if (!m) go(tenantPath(sid, "users"), { error: "User not found in this school." });
  const r = await resetPassword(uid!);
  if ("error" in r) go(tenantPath(sid, "users"), { error: r.error });
  await supabase.rpc("log_event", { p_action: "user.password_reset", p_school: sid, p_entity: "auth.users", p_entity_id: uid, p_details: { email: m!.email } });
  await showPasswordOnce("/platform", m!.email ?? "", (r as { pw: string }).pw);
  go(tenantPath(sid, "users"), { ok: `New temporary password set for ${m!.email}.` });
}

export async function removeTenantUser(f: FormData) {
  const { supabase } = await requirePlatform("tenants", true);
  const sid = uuid(f, "school_id");
  const uid = uuid(f, "user_id");
  const { error } = await supabase.from("member_roles").delete().eq("school_id", sid!).eq("user_id", uid!);
  if (error) go(tenantPath(sid, "users"), { error: errMsg(error) });
  await supabase.from("school_members").delete().eq("school_id", sid!).eq("user_id", uid!);
  go(tenantPath(sid, "users"), { ok: "Removed from the school." });
}

/* ═════════ Subscription & billing ═════════ */

export async function changePlan(f: FormData) {
  const { supabase } = await requirePlatform("billing", true);
  const sid = uuid(f, "school_id");
  const { error } = await supabase.rpc("apply_plan", { sid, p_plan: str(f, "plan", 30), p_cycle: oneOf(f, "cycle", ["monthly", "yearly"] as const, "yearly"), p_start: date(f, "start"), p_period_end: date(f, "end") });
  go(tenantPath(sid, "subscription"), error ? { error: errMsg(error) } : { ok: "Plan applied: modules, limits and period updated." });
}

export async function updateSubscription(f: FormData) {
  const { supabase } = await requirePlatform("billing", true);
  const sid = uuid(f, "school_id");
  const end = date(f, "end");
  const patch: Record<string, unknown> = { grace_days: Math.max(0, num(f, "grace") ?? 7), auto_renew: f.get("auto_renew") === "on", notes: str(f, "notes", 500), updated_at: new Date().toISOString() };
  if (end) patch.current_period_end = end;
  if (f.get("cancel") === "on") patch.status = "cancelled";
  const { error } = await supabase.from("school_subscriptions").update(patch).eq("school_id", sid!);
  go(tenantPath(sid, "subscription"), error ? { error: errMsg(error) } : { ok: "Subscription updated." });
}

export async function createInvoice(f: FormData) {
  const { supabase } = await requirePlatform("billing", true);
  const sid = uuid(f, "school_id");
  const { data: inv, error } = await supabase.rpc("create_subscription_invoice", { sid, p_start: date(f, "start") });
  if (error) go(tenantPath(sid, "subscription"), { error: errMsg(error) });
  let note = "";
  try { const r = await attachPaymentLink(supabase, inv as string); note = "url" in r ? " Razorpay link created." : ` (${r.skipped}.)`; } catch (e) { note = ` Razorpay link failed: ${(e as Error).message}`; }
  after(async () => { await notifyPlatformInvoice(inv as string, "invoice_issued"); await processOutbox({ limit: 10 }); });
  go(tenantPath(sid, "subscription"), { ok: `Invoice created.${note} The school is being told by email / WhatsApp.` });
}

export async function markInvoicePaid(f: FormData) {
  const { supabase } = await requirePlatform("billing", true);
  const sid = uuid(f, "school_id");
  const back = str(f, "back", 200)?.startsWith("/platform") ? str(f, "back", 200)! : tenantPath(sid, "subscription");
  const invId = uuid(f, "id");
  const { error } = await supabase.rpc("mark_subscription_invoice_paid", { inv_id: invId, p_ref: str(f, "ref", 80) });
  if (!error && invId) after(async () => { await notifyPlatformInvoice(invId, "invoice_paid"); await processOutbox({ limit: 10 }); });
  go(back, error ? { error: errMsg(error) } : { ok: "Marked paid — subscription extended." });
}

export async function voidInvoice(f: FormData) {
  const { supabase } = await requirePlatform("billing", true);
  const sid = uuid(f, "school_id");
  const back = str(f, "back", 200)?.startsWith("/platform") ? str(f, "back", 200)! : tenantPath(sid, "subscription");
  const { error } = await supabase.from("subscription_invoices").update({ status: "void" }).eq("id", uuid(f, "id")!).eq("status", "due");
  go(back, error ? { error: errMsg(error) } : { ok: "Invoice voided." });
}

export async function savePlan(f: FormData) {
  const { supabase } = await requirePlatform("plans", true);
  const id = uuid(f, "id");
  const code = str(f, "code", 30)?.toLowerCase();
  const row = {
    name: str(f, "name", 60), description: str(f, "description", 300),
    price_type: oneOf(f, "price_type", ["per_student", "flat"] as const, "per_student"),
    price_monthly: Math.max(0, num(f, "price_monthly") ?? 0), price_yearly: Math.max(0, num(f, "price_yearly") ?? 0),
    min_students: Math.max(0, num(f, "min_students") ?? 0), student_limit: Math.max(1, num(f, "student_limit") ?? 500),
    storage_mb: Math.max(0, num(f, "storage_mb") ?? 1024), trial_days: Math.max(0, num(f, "trial_days") ?? 0),
    modules: f.getAll("modules").map(String).filter((m) => /^[a-z_]+$/.test(m)),
    is_public: f.get("is_public") === "on", active: f.get("active") === "on", sort: num(f, "sort") ?? 9,
  };
  if (!row.name) go("/platform/plans", { error: "Plan name is required." });
  const { error } = id ? await supabase.from("plans").update(row).eq("id", id) : await supabase.from("plans").insert({ ...row, code });
  revalidatePath("/platform/plans");
  go("/platform/plans", error ? { error: errMsg(error) } : { ok: "Plan saved. Existing schools keep their licences until the plan is re-applied to them." });
}

/* ═════════ Platform settings ═════════ */

export async function savePlatformSettings(f: FormData) {
  const { supabase } = await requirePlatform("settings", true);
  const signup = { enabled: f.get("signup_enabled") === "on", require_approval: f.get("require_approval") === "on", trial_plan: str(f, "trial_plan", 30) ?? "trial" };
  const billing = {
    gst_rate: num(f, "gst_rate") ?? 18, invoice_prefix: str(f, "invoice_prefix", 10) ?? "CDS", grace_days: num(f, "grace_days") ?? 7,
    renew_days_before: num(f, "renew_days_before") ?? 7, seller_name: str(f, "seller_name", 100) ?? "CodersDuniya",
    seller_gstin: str(f, "seller_gstin", 20) ?? "", seller_state: str(f, "seller_state", 2) ?? "09", seller_address: str(f, "seller_address", 300) ?? "",
  };
  const tenancy = { root_domain: (str(f, "root_domain", 120) ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""), app_host: (str(f, "app_host", 120) ?? "").toLowerCase() };
  const branding = { product_name: str(f, "product_name", 80) ?? "CodersDuniya School ERP", support_whatsapp: str(f, "support_whatsapp", 20) ?? "", support_email: str(f, "support_email", 120) ?? "", support_phone: str(f, "support_phone", 20) ?? "" };
  const { error } = await supabase.from("platform_settings").upsert([
    { key: "signup", value: signup }, { key: "billing", value: billing }, { key: "tenancy", value: tenancy }, { key: "branding", value: branding },
  ]);
  go("/platform/settings", error ? { error: errMsg(error) } : { ok: "Platform settings saved." });
}
