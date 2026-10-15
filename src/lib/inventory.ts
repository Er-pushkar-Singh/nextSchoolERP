import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignableItem } from "@/components/inventory/AssetForms";

/** Items that can be given out (not shop items) and the school's rooms, for the assign / move forms. */
export async function loadAssignables(supabase: SupabaseClient, sid: string) {
  const [{ data: items }, { data: locs }] = await Promise.all([
    supabase.rpc("inventory_item_list", { sid, p_active: "yes", p_limit: 200, p_offset: 0 }),
    supabase.from("inventory_locations").select("id,name").eq("school_id", sid).eq("active", true).order("name").limit(500),
  ]);
  return {
    items: ((items ?? []) as AssignableItem[]).filter((i) => i.kind !== "shop"),
    locations: (locs ?? []).map((l) => [l.id, l.name] as [string, string]),
  };
}

export const HOLDER: Record<string, string> = { location: "Room", staff: "Staff", student: "Student", department: "Department" };
export const ASSET_STATUS: Record<string, [string, string]> = {
  active: ["active", "With them"], returned: ["done", "Returned"], repair: ["high", "In repair"], damaged: ["overdue", "Damaged"], lost: ["overdue", "Lost"],
};