import { requirePlatform } from "@/lib/platform";
import { Flash, PageHeader } from "@/components/ui/ui";
import { IntegrationCard, StatusPill } from "@/components/settings/IntegrationCard";
import { PROVIDERS } from "@/lib/integration-defs";
import { loadIntegrations } from "@/lib/integrations";
import { encryptionReady } from "@/lib/crypto";
import { removeIntegration, saveIntegration, testIntegrationAction } from "@/app/_actions/integrations";
import { Icon } from "@/components/shell/icons";

export default async function PlatformIntegrations({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, can } = await requirePlatform("settings");
  const sp = await searchParams;
  const rows = await loadIntegrations(supabase, null);
  const canEdit = can("settings", true);
  const envRazorpay = Boolean(process.env.RAZORPAY_KEY_ID);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="integrations" title="Platform integrations" subtitle="CodersDuniya's own accounts: subscription payments, shared storage and backups, platform emails and the shared SMS / WhatsApp senders." />
      <Flash ok={sp.ok} error={sp.error} />
      {!encryptionReady() && <Flash error="SETTINGS_ENCRYPTION_KEY is not set on the server. Generate one with: node -e &quot;console.log(require('crypto').randomBytes(32).toString('base64'))&quot; and add it to the environment (Vercel → Settings → Environment Variables), then redeploy." />}
      {envRazorpay && !rows.get("razorpay") && <Flash ok="Razorpay keys are currently read from environment variables. Save them here once to manage them from this screen; the stored keys take priority." />}
      <nav aria-label="Integrations" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {PROVIDERS.map((p) => {
          const r = rows.get(p.code);
          return (
            <a key={p.code} href={`#${p.code}`} className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3.5 no-underline shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-blue">
              <span className="flex items-center gap-2 text-[14px] font-bold text-ink"><span className="icon-tile h-8 w-8 bg-blue-tint text-blue-strong"><Icon name={p.icon} size={16} /></span>{p.name}</span>
              <span className="flex flex-wrap gap-1"><StatusPill saved={!!r} enabled={!!r?.enabled} status={r?.status ?? "untested"} />{r?.config.share_with_schools === "true" && <span className="inline-flex rounded-full bg-blue-tint px-2.5 py-0.5 text-[12px] font-semibold text-blue-strong">Shared</span>}</span>
            </a>
          );
        })}
      </nav>
      {PROVIDERS.map((p) => {
        const r = rows.get(p.code);
        return (
          <IntegrationCard key={p.code} save={saveIntegration} test={testIntegrationAction} remove={removeIntegration}
            d={{ provider: p.code, scope: "platform", canEdit, saved: !!r, enabled: !!r?.enabled, config: r?.config ?? {}, hints: r?.secret_hints ?? {},
                 status: r?.status ?? "untested", statusMessage: r?.status_message ?? null, testedAt: r?.tested_at ?? null }} />
        );
      })}
    </div>
  );
}
