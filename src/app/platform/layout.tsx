import type { Metadata } from "next";
import { LuShieldCheck } from "react-icons/lu";
import { getPlatform, ROLE_LABEL, type Area } from "@/lib/platform";
import { Logo } from "@/components/ui/Logo";
import { Shell, type NavEntry } from "@/components/shell/Shell";
import { UserMenu } from "@/components/shell/UserMenu";
import type { IconName } from "@/components/shell/icons";
import { brand } from "@/lib/brand";
import { signOut } from "../actions";
import { NewPassword } from "@/components/platform/NewPassword";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Super Admin" };

type Leaf = { href: string; label: string; area: Area; write?: boolean };
type Entry = { key: string; label: string; icon: IconName; section?: string; href?: string; area?: Area; items?: Leaf[] };

const NAV: Entry[] = [
  { key: "dash", label: "Dashboard", icon: "dashboard", href: "/platform", area: "tenants", section: "Overview" },
  { key: "tenants", label: "Schools", icon: "tenants", section: "Tenants", items: [
    { href: "/platform/tenants", label: "All schools", area: "tenants" },
    { href: "/platform/tenants/new", label: "Onboard a school", area: "tenants", write: true },
    { href: "/platform/groups", label: "Groups & branches", area: "tenants" },
  ] },
  { key: "revenue", label: "Revenue", icon: "revenue", section: "Business", items: [
    { href: "/platform/billing", label: "Invoices & payments", area: "billing" },
    { href: "/platform/plans", label: "Plans & pricing", area: "plans" },
  ] },
  { key: "care", label: "Customer care", icon: "support", items: [
    { href: "/platform/support", label: "Support desk", area: "support" },
    { href: "/platform/announcements", label: "Announcements", area: "announcements" },
  ] },
  { key: "team", label: "Team & roles", icon: "team", href: "/platform/team", area: "team", section: "Administration" },
  { key: "audit", label: "Audit log", icon: "audit", href: "/platform/audit", area: "audit" },
  { key: "modules", label: "Module map", icon: "modules", href: "/platform/modules", area: "plans" },
  { key: "settings", label: "Settings", icon: "settings", items: [
    { href: "/platform/settings", label: "General", area: "settings" },
    { href: "/platform/settings/integrations", label: "Integrations", area: "settings" },
  ] },
];

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { user, role, can, platformName } = await getPlatform();
  const seen = new Set<string>();
  let current: string | undefined;
  const nav: NavEntry[] = [];
  for (const n of NAV) {
    if (n.section) current = n.section;
    let entry: NavEntry | null = null;
    if (n.items) {
      const items = n.items.filter((i) => can(i.area, i.write)).map(({ href, label }) => ({ href, label }));
      if (items.length) entry = { key: n.key, label: n.label, icon: n.icon, items };
    } else if (can(n.area!)) entry = { key: n.key, label: n.label, icon: n.icon, href: n.href };
    if (!entry) continue;
    if (current && !seen.has(current)) { entry.section = current; seen.add(current); }
    nav.push(entry);
  }
  const roleName = role ? ROLE_LABEL[role].split(" — ")[0] : "";
  return (
    <Shell
      root="/platform"
      nav={nav}
      brand={<Logo name="Super Admin" sub={brand.product} href="/platform" dark />}
      sidebarFooter={
        <div className="rounded-xl bg-white/[0.06] px-3 py-2.5 text-[12px] text-[#aebde3]">
          <p className="m-0 flex items-center gap-1.5 font-semibold text-white"><LuShieldCheck aria-hidden="true" size={14} />Platform {roleName.toLowerCase()}</p>
          <p className="m-0 mt-0.5">Changes here affect every school.</p>
        </div>
      }
      topbar={<UserMenu name={platformName} email={user.email ?? ""} role={`Platform ${roleName.toLowerCase()}`} links={[]} signOut={signOut} />}
    >
      <NewPassword />
      {children}
    </Shell>
  );
}
