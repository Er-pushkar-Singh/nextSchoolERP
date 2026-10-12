import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getMe } from "./school";

export type PlatformRole = "owner" | "admin" | "support" | "billing" | "sales" | "viewer";
export type Area = "tenants" | "billing" | "plans" | "support" | "team" | "settings" | "audit" | "announcements" | "impersonate";

/** Mirror of public.platform_can() — the database enforces the same rules. */
export function platformCan(role: PlatformRole | null, area: Area, write = false) {
  if (!role) return false;
  if (role === "owner") return true;
  if (role === "admin") return area !== "team" || !write;
  if (role === "viewer") return !write && area !== "impersonate";
  if (role === "support") return area === "support" || area === "impersonate" || (!write && ["tenants", "plans", "audit", "announcements", "settings"].includes(area));
  if (role === "billing") return area === "billing" || (!write && ["tenants", "plans", "audit", "support", "settings"].includes(area));
  if (role === "sales") return area === "tenants" || (!write && ["plans", "support", "billing", "settings"].includes(area));
  return false;
}

export const ROLE_LABEL: Record<PlatformRole, string> = {
  owner: "Owner — everything, incl. team", admin: "Admin — everything except team", support: "Support — tickets, support sessions, read tenants",
  billing: "Billing — invoices & payments, read tenants", sales: "Sales — create & approve schools", viewer: "Viewer — read-only",
};

export const getPlatform = cache(async () => {
  const me = await getMe();
  if (!me.isPlatform) redirect("/app");
  const { data } = await me.supabase.from("platform_admins").select("role,name").eq("user_id", me.user.id).maybeSingle();
  const role = (data?.role ?? null) as PlatformRole | null;
  return { ...me, role, platformName: data?.name ?? me.user.email ?? "", can: (area: Area, write = false) => platformCan(role, area, write) };
});

/** Page / action guard for the platform panel. */
export async function requirePlatform(area?: Area, write = false) {
  const p = await getPlatform();
  if (area && !p.can(area, write)) redirect("/platform?denied=1");
  return p;
}
