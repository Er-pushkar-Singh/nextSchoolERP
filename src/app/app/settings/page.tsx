import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Flash, PageHeader } from "@/components/ui/ui";
import { Icon, type IconName } from "@/components/shell/icons";

type Tile = { href: string; title: string; text: string; icon: IconName; show: boolean; meta?: string; soon?: boolean };

export default async function SettingsCentre({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const ctx = await requirePerm("settings.school.view", "settings.users.view", "settings.roles.view", "academics.setup.create", "settings.billing.view", "settings.integrations.view", "settings.audit.view");
  const { supabase, school, can, session } = ctx;
  const sp = await searchParams;
  const [{ count: staff }, { count: roles }, { data: eff }] = await Promise.all([
    supabase.from("school_members").select("user_id", { count: "exact", head: true }).eq("school_id", school.id),
    supabase.from("roles").select("id", { count: "exact", head: true }).eq("school_id", school.id),
    supabase.rpc("effective_integrations", { sid: school.id }),
  ]);
  const connected = ((eff ?? []) as { enabled: boolean }[]).filter((e) => e.enabled).length;
  const groups: { name: string; tiles: Tile[] }[] = [
    { name: "School", tiles: [
      { href: "/app/settings/school", title: "School profile & branding", text: "Name, address, logo, receipt numbering, UPI, modules and regional preferences.", icon: "school", show: can("settings.school.view"), meta: school.logo_url ? "Logo set" : "No logo yet" },
      { href: "/app/settings/academic", title: "Classes & sessions", text: "Classes, sections, subjects, academic sessions and promotions.", icon: "academics", show: can("academics.setup.create"), meta: session ? `Session ${session.name}` : "No current session" },
      { href: "/app/settings/notifications", title: "Notifications", text: "Which events reach parents and staff, by SMS, email or WhatsApp.", icon: "notifications", show: can("settings.school.view") },
    ] },
    { name: "People & security", tiles: [
      { href: "/app/settings/staff", title: "Staff & access", text: "Logins for teachers and office staff, password resets, per-person exceptions.", icon: "students", show: can("settings.users.view"), meta: `${staff ?? 0} members` },
      { href: "/app/settings/roles", title: "Roles & permissions", text: "What each role can see and do, module by module.", icon: "team", show: can("settings.roles.view"), meta: `${roles ?? 0} roles` },
      { href: "/app/settings/audit", title: "Audit log", text: "Every change, who made it and when — including support sessions.", icon: "audit", show: can("settings.audit.view") },
    ] },
    { name: "Connections & billing", tiles: [
      { href: "/app/settings/integrations", title: "Integrations", text: "Razorpay, Cloudinary, email, SMS and WhatsApp — keys stored encrypted.", icon: "integrations", show: can("settings.integrations.view"), meta: `${connected} of 5 connected` },
      { href: "/app/settings/billing", title: "Plan & billing", text: "Your subscription, invoices and online payment.", icon: "billing", show: can("settings.billing.view"), meta: `${school.plan.charAt(0).toUpperCase()}${school.plan.slice(1)} plan` },
      { href: "/app/settings", title: "Backups & data export", text: "Nightly backups to Cloudinary and one-click export. Arriving in the next update.", icon: "backups", show: can("settings.backups.view"), soon: true },
    ] },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon="settings" title="Settings centre" subtitle={`Everything about how ${school.name} runs, in one place.`} />
      <Flash ok={sp.ok} error={sp.error} />
      {groups.map((g) => {
        const tiles = g.tiles.filter((t) => t.show);
        if (!tiles.length) return null;
        return (
          <section key={g.name} className="flex flex-col gap-3">
            <h2 className="m-0 text-[13px] font-bold tracking-[0.06em] text-muted uppercase">{g.name}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {tiles.map((t) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <span className="icon-tile h-12 w-12 bg-gradient-to-br from-[#3b82f6] to-[#1e40af] text-white shadow-[0_8px_18px_rgb(37_99_235/0.25)]"><Icon name={t.icon} size={22} /></span>
                      {t.soon ? <span className="rounded-full bg-[#f3efff] px-2.5 py-0.5 text-[12px] font-semibold text-[#5b21b6]">Coming next</span>
                        : t.meta && <span className="rounded-full bg-blue-tint px-2.5 py-0.5 text-[12px] font-semibold text-blue-strong">{t.meta}</span>}
                    </div>
                    <h3 className="m-0 mt-3 text-[16px] font-bold text-ink">{t.title}</h3>
                    <p className="m-0 mt-1 text-[14px] leading-snug text-muted">{t.text}</p>
                  </>
                );
                const cls = "flex flex-col rounded-[16px] border border-line bg-white p-5 shadow-[var(--shadow-card)]";
                return t.soon
                  ? <div key={t.title} className={`${cls} opacity-75`}>{body}</div>
                  : <Link key={t.title} href={t.href} className={`${cls} no-underline transition hover:-translate-y-0.5 hover:border-blue hover:shadow-[var(--shadow-raised)]`}>{body}</Link>;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
