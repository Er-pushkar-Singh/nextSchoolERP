import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan, SubState } from "./billing";
import { todayIST } from "./format";

export type TenantRow = {
  id: string; name: string; code: string; subdomain: string | null; custom_domain: string | null; city: string | null; state: string | null; board: string;
  status: string; plan: string; student_limit: number; created_at: string; source: string; group_id: string | null; archived_at: string | null; logo_url: string | null; brand_color: string | null;
};
export type TenantStats = { school_id: string; students: number; staff: number; parents: number; collected_month: number; receipts_month: number; last_activity: string | null; open_tickets: number };
type Sub = { school_id: string; billing_cycle: string; status: string; current_period_end: string; grace_days: number; plans: Plan | null };

/** All tenants with subscription state and usage, for the platform list views. */
export async function loadTenants(supabase: SupabaseClient) {
  const [{ data: schools }, { data: subs }, { data: stats }, { data: groups }] = await Promise.all([
    supabase.from("schools").select("id,name,code,subdomain,custom_domain,city,state,board,status,plan,student_limit,created_at,source,group_id,archived_at,logo_url,brand_color").order("created_at", { ascending: false }),
    supabase.from("school_subscriptions").select("school_id,billing_cycle,status,current_period_end,grace_days,plans(*)"),
    supabase.rpc("platform_tenant_stats"),
    supabase.from("school_groups").select("id,name"),
  ]);
  const subOf = new Map(((subs ?? []) as unknown as Sub[]).map((x) => [x.school_id, x]));
  const statOf = new Map(((stats ?? []) as TenantStats[]).map((x) => [x.school_id, x]));
  const groupOf = new Map((groups ?? []).map((g) => [g.id, g.name as string]));
  const today = todayIST();
  return ((schools ?? []) as TenantRow[]).map((s) => {
    const sub = subOf.get(s.id) ?? null;
    let state: SubState = "ok";
    if (s.status === "pending") state = "pending";
    else if (s.status === "suspended") state = "suspended";
    else if (sub) {
      if (today <= sub.current_period_end) state = sub.status === "trialing" ? "trial" : "ok";
      else {
        const graceEnd = new Date(Date.parse(sub.current_period_end) + sub.grace_days * 86400000).toISOString().slice(0, 10);
        state = sub.status === "active" && today <= graceEnd ? "grace" : "expired";
      }
    }
    return { ...s, sub, state, stats: statOf.get(s.id) ?? null, group: s.group_id ? groupOf.get(s.group_id) ?? null : null };
  });
}
export type Tenant = Awaited<ReturnType<typeof loadTenants>>[number];

export function relTime(iso: string | null) {
  if (!iso) return "never";
  const d = Math.round((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : d < 365 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 365)} years ago`;
}
