import { requirePerm } from "@/lib/school";
import { Flash, PageHeader } from "@/components/ui/ui";
import { IntegrationCard, StatusPill } from "@/components/settings/IntegrationCard";
import { PROVIDERS } from "@/lib/integration-defs";
import { loadIntegrations } from "@/lib/integrations";
import { encryptionReady } from "@/lib/crypto";
import { removeIntegration, saveIntegration, testIntegrationAction } from "@/app/_actions/integrations";
import { Icon } from "@/components/shell/icons";

export default async function Integrations({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("settings.integrations.view");
  const sp = await searchParams;
  const [rows, { data: eff }] = await Promise.all([loadIntegrations(supabase, school.id), supabase.rpc("effective_integrations", { sid: school.id })]);
  const shared = new Set(((eff ?? []) as { provider: string; source: string }[]).filter((e) => e.source === "platform").map((e) => e.provider));
  const canEdit = can("settings.integrations.edit");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="integrations" title="Integrations" subtitle="Your own payment gateway, storage, email, SMS and WhatsApp accounts. Keys are encrypted; nobody — not even CodersDuniya staff — can read them back." back={{ href: "/app/settings", label: "Settings centre" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {canEdit && !encryptionReady() && <Flash error="The server has no SETTINGS_ENCRYPTION_KEY yet, so keys can't be saved. Ask your administrator to add it." />}
      <nav aria-label="Integrations" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {PROVIDERS.map((p) => {
          const r = rows.get(p.code);
          return (
            <a key={p.code} href={`#${p.code}`} className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3.5 no-underline shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-blue">
              <span className="flex items-center gap-2 text-[14px] font-bold text-ink"><span className="icon-tile h-8 w-8 bg-blue-tint text-blue-strong"><Icon name={p.icon} size={16} /></span>{p.name}</span>
              <span>{!r && shared.has(p.code) ? <span className="inline-flex rounded-full bg-blue-tint px-2.5 py-0.5 text-[12px] font-semibold text-blue-strong">Shared account</span> : <StatusPill saved={!!r} enabled={!!r?.enabled} status={r?.status ?? "untested"} />}</span>
            </a>
          );
        })}
      </nav>
      {PROVIDERS.map((p) => {
        const r = rows.get(p.code);
        return (
          <IntegrationCard key={p.code} save={saveIntegration} test={testIntegrationAction} remove={removeIntegration}
            d={{ provider: p.code, scope: "school", canEdit, saved: !!r, enabled: !!r?.enabled, config: r?.config ?? {}, hints: r?.secret_hints ?? {},
                 status: r?.status ?? "untested", statusMessage: r?.status_message ?? null, testedAt: r?.tested_at ?? null, shared: shared.has(p.code) }} />
        );
      })}
    </div>
  );
}
