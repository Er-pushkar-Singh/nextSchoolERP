"use server";

import { revalidatePath } from "next/cache";
import { requireSchool } from "@/lib/school";
import { requirePlatform } from "@/lib/platform";
import { errMsg, go, str } from "@/lib/action-util";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptJson, encryptionReady, hint } from "@/lib/crypto";
import { providerDef, type Provider } from "@/lib/integration-defs";
import { readSecrets, testIntegration } from "@/lib/integrations";

/** Who is acting, on which account (a school or the platform), and where to return to. */
async function ctx(f: FormData, write: boolean) {
  const provider = str(f, "provider", 20) as Provider | null;
  const def = provider ? providerDef(provider) : undefined;
  if (str(f, "scope", 10) === "platform") {
    const p = await requirePlatform("settings", write);
    return { supabase: p.supabase, schoolId: null as string | null, def, back: `/platform/settings/integrations${def ? `#${def.code}` : ""}`, userId: p.user.id };
  }
  const s = await requireSchool();
  const back = `/app/settings/integrations${def ? `#${def.code}` : ""}`;
  if (!s.can(write ? "settings.integrations.edit" : "settings.integrations.view")) go(back, { error: "You don't have permission to change integrations." });
  return { supabase: s.supabase, schoolId: s.school.id as string | null, def, back, userId: s.user.id };
}

async function existing(supabase: Awaited<ReturnType<typeof ctx>>["supabase"], schoolId: string | null, provider: Provider) {
  const q = supabase.from("integration_settings").select("id,config,secret_hints").eq("provider", provider);
  const { data } = await (schoolId ? q.eq("school_id", schoolId) : q.is("school_id", null)).maybeSingle();
  return data as { id: string; config: Record<string, string>; secret_hints: Record<string, string> } | null;
}

export async function saveIntegration(f: FormData) {
  const { supabase, schoolId, def, back } = await ctx(f, true);
  if (!def) go(back, { error: "Unknown integration." });
  const db = supabaseAdmin();
  if (!db) go(back, { error: "SUPABASE_SECRET_KEY is not set on the server, so secrets can't be stored." });
  if (!encryptionReady()) go(back, { error: "SETTINGS_ENCRYPTION_KEY is not set on the server. Add it (32 random bytes, base64) and redeploy — see README." });

  const prev = await existing(supabase, schoolId, def.code);
  const prevSecrets = prev ? await readSecrets(prev.id) : {};
  const fields = def.fields.filter((x) => !(x.platformOnly && schoolId) && !(x.schoolOnly && !schoolId));
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = { ...prevSecrets };
  const visible = (x: (typeof fields)[number]) => !x.when || (str(f, x.when[0], 40) ?? "") === x.when[1];
  for (const x of fields) {
    if (x.secret) {
      const v = str(f, x.name, 2000);
      if (f.get(`clear_${x.name}`) === "1") delete secrets[x.name];
      else if (v) secrets[x.name] = v;
      if (x.required && visible(x) && !secrets[x.name]) go(back, { error: `${def.name}: ${x.label} is required.` });
      continue;
    }
    if (x.type === "checkbox") { config[x.name] = f.get(x.name) === "on" ? "true" : "false"; continue; }
    const v = str(f, x.name, 300);
    if (v) config[x.name] = v;
    if (x.required && visible(x) && !v) go(back, { error: `${def.name}: ${x.label} is required.` });
  }
  if (config.from_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.from_email)) go(back, { error: "From email looks wrong." });
  if (config.sender_id && !/^[A-Za-z]{6}$/.test(config.sender_id)) go(back, { error: "SMS sender ID must be exactly 6 letters." });
  if (config.key_id && !/^rzp_(test|live)_\w+$/.test(config.key_id)) go(back, { error: "Razorpay Key ID should start with rzp_test_ or rzp_live_." });

  const secret_hints = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, hint(v)]));
  const changed = JSON.stringify(prev?.config ?? {}) !== JSON.stringify(config) || JSON.stringify(prevSecrets) !== JSON.stringify(secrets);
  const row = { enabled: f.get("enabled") === "on", config, secret_hints, ...(changed ? { status: "untested", status_message: null, tested_at: null } : {}) };
  // The signed-in user's client: row-level security decides whether they may change this account.
  const { data, error } = prev
    ? await supabase.from("integration_settings").update(row).eq("id", prev.id).select("id").single()
    : await supabase.from("integration_settings").insert({ ...row, school_id: schoolId, provider: def.code }).select("id").single();
  if (error || !data) go(back, { error: errMsg(error) });
  // Secrets: written with the server key only after the permitted change above.
  const { error: e2 } = Object.keys(secrets).length
    ? await db.from("integration_secrets").upsert({ setting_id: data.id, ciphertext: encryptJson(secrets), updated_at: new Date().toISOString() })
    : await db.from("integration_secrets").delete().eq("setting_id", data.id);
  revalidatePath(back.split("#")[0]);
  go(back, e2 ? { error: errMsg(e2) } : { ok: `${def.name} settings saved${row.enabled ? " and switched on" : ""}.${changed ? " Use “Test connection” to check them." : ""}` });
}

export async function testIntegrationAction(f: FormData) {
  const { supabase, schoolId, def, back, userId } = await ctx(f, true);
  if (!def) go(back, { error: "Unknown integration." });
  const prev = await existing(supabase, schoolId, def.code);
  if (!prev) go(back, { error: `Save the ${def.name} settings first.` });
  const target = str(f, "target", 120) ?? undefined;
  if (target && def.testSend === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) go(back, { error: "Test email address looks wrong." });
  if (target && def.testSend === "mobile" && target.replace(/\D/g, "").length < 10) go(back, { error: "Enter a 10-digit mobile number for the test." });
  const secrets = await readSecrets(prev.id);
  const r = await testIntegration(def.code, prev.config, secrets, target);
  await supabase.from("integration_settings").update({ status: r.ok ? "ok" : "failed", status_message: r.message.slice(0, 300), tested_at: new Date().toISOString() }).eq("id", prev.id);
  if (target && (def.code === "email" || def.code === "sms" || def.code === "whatsapp")) {
    await supabaseAdmin()?.from("message_log").insert({ school_id: schoolId, channel: def.code, event: "test", recipient: target, subject: "Connection test",
      status: r.ok ? "sent" : "failed", error: r.ok ? null : r.message.slice(0, 300), created_by: userId });
  }
  revalidatePath(back.split("#")[0]);
  go(back, r.ok ? { ok: `${def.name}: ${r.message}` } : { error: `${def.name}: ${r.message}` });
}

export async function removeIntegration(f: FormData) {
  const { supabase, schoolId, def, back } = await ctx(f, true);
  if (!def) go(back, { error: "Unknown integration." });
  const prev = await existing(supabase, schoolId, def.code);
  if (!prev) go(back);
  const { error } = await supabase.from("integration_settings").delete().eq("id", prev.id);
  revalidatePath(back.split("#")[0]);
  go(back, error ? { error: errMsg(error) } : { ok: `${def.name} settings removed (keys deleted).` });
}
