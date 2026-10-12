"use client";
import { useState } from "react";
import { LuCircleCheck, LuCircleAlert, LuHourglass, LuExternalLink, LuKeyRound, LuSend, LuTrash2, LuPower } from "react-icons/lu";
import { Icon } from "@/components/shell/icons";
import { Submit } from "@/components/ui/SubmitButton";
import { providerDef, type Provider } from "@/lib/integration-defs";

type Action = (f: FormData) => Promise<void>;
export type CardData = {
  provider: Provider; scope: "school" | "platform"; canEdit: boolean; saved: boolean; enabled: boolean;
  config: Record<string, string>; hints: Record<string, string>; status: "untested" | "ok" | "failed"; statusMessage: string | null; testedAt: string | null;
  shared?: boolean; // school only: the platform's shared account is available
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function StatusPill({ saved, enabled, status }: { saved: boolean; enabled: boolean; status: string }) {
  if (!saved) return <span className="inline-flex items-center gap-1 rounded-full bg-[#eef1f6] px-2.5 py-0.5 text-[12px] font-semibold text-muted">Not set up</span>;
  if (!enabled) return <span className="inline-flex items-center gap-1 rounded-full bg-[#eef1f6] px-2.5 py-0.5 text-[12px] font-semibold text-body"><LuPower size={12} />Off</span>;
  if (status === "ok") return <span className="inline-flex items-center gap-1 rounded-full bg-wa-tint px-2.5 py-0.5 text-[12px] font-semibold text-[#0b4f2c]"><LuCircleCheck size={12} />Connected</span>;
  if (status === "failed") return <span className="inline-flex items-center gap-1 rounded-full bg-[#fdecea] px-2.5 py-0.5 text-[12px] font-semibold text-[#7a1a12]"><LuCircleAlert size={12} />Check failed</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4e0] px-2.5 py-0.5 text-[12px] font-semibold text-[#7a4b00]"><LuHourglass size={12} />On · not tested</span>;
}

export function IntegrationCard({ d, save, test, remove }: { d: CardData; save: Action; test: Action; remove: Action }) {
  const def = providerDef(d.provider)!;
  const [vals, setVals] = useState<Record<string, string>>(d.config);
  const fields = def.fields.filter((x) => !(x.platformOnly && d.scope === "school") && !(x.schoolOnly && d.scope === "platform"));
  const valueOf = (name: string) => vals[name] ?? def.fields.find((y) => y.name === name)?.options?.[0]?.[0] ?? "";
  const shown = (x: (typeof fields)[number]) => !x.when || valueOf(x.when[0]) === x.when[1];
  const ro = !d.canEdit;
  const input = "input !min-h-10 !py-2 text-[15px] font-normal disabled:bg-surface-alt";
  return (
    <section id={def.code} className="scroll-mt-24 overflow-hidden rounded-[16px] border border-line bg-white shadow-[var(--shadow-card)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-gradient-to-r from-blue-soft to-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="icon-tile h-11 w-11 bg-gradient-to-br from-[#3b82f6] to-[#1e40af] text-white"><Icon name={def.icon} size={20} /></span>
          <div className="min-w-0">
            <h2 className="m-0 flex flex-wrap items-center gap-2 text-[17px] font-bold text-ink">{def.name} <StatusPill saved={d.saved} enabled={d.enabled} status={d.status} /></h2>
            <p className="m-0 text-[13px] text-muted">{def.tagline}</p>
          </div>
        </div>
        <a href={def.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold no-underline">Setup guide <LuExternalLink size={13} /></a>
      </header>
      <div className="px-5 py-4">
        <p className="m-0 mb-3 text-[14px] text-body">{d.scope === "school" ? def.schoolUse : def.platformUse}</p>
        {d.scope === "school" && !d.enabled && d.shared && (
          <p className="m-0 mb-3 rounded-lg border border-[#bfd3fb] bg-blue-soft px-3 py-2 text-[13px] text-blue-strong">Until you add your own, the shared CodersDuniya account is used.</p>
        )}
        {d.statusMessage && (
          <p role="note" className={`m-0 mb-3 rounded-lg px-3 py-2 text-[13px] ${d.status === "ok" ? "bg-wa-tint text-[#0b4f2c]" : "bg-[#fdecea] text-[#7a1a12]"}`}>
            {d.statusMessage} <span className="opacity-70">· {when(d.testedAt)}</span>
          </p>
        )}
        <form action={save} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="provider" value={def.code} />
          <input type="hidden" name="scope" value={d.scope} />
          {fields.filter(shown).map((x) => {
            if (x.type === "checkbox") {
              return (
                <label key={x.name} className="flex items-center gap-2 text-[14px] text-ink sm:col-span-2">
                  <input type="checkbox" name={x.name} defaultChecked={d.config[x.name] === "true"} disabled={ro} className="h-4 w-4 accent-[#2563eb]" />{x.label}
                </label>
              );
            }
            const wide = x.wide ? "sm:col-span-2" : "";
            if (x.type === "select") {
              return (
                <label key={x.name} className={`flex flex-col gap-1 text-[13px] font-semibold text-ink ${wide}`}>
                  {x.label}
                  <select name={x.name} value={vals[x.name] ?? x.options?.[0]?.[0] ?? ""} disabled={ro} onChange={(e) => setVals((v) => ({ ...v, [x.name]: e.target.value }))} className={input}>
                    {x.options!.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </label>
              );
            }
            if (x.secret) {
              const saved = d.hints[x.name];
              return (
                <label key={x.name} className={`flex flex-col gap-1 text-[13px] font-semibold text-ink ${wide}`}>
                  <span className="flex items-center gap-1.5"><LuKeyRound size={13} className="text-muted" />{x.label}{x.required && <span className="sr-only"> (required)</span>}</span>
                  <input name={x.name} type="password" autoComplete="new-password" disabled={ro} placeholder={saved ? `Saved ${saved} — leave blank to keep` : "Paste here"} className={input} />
                  <span className="text-[12px] font-normal text-muted">{saved ? "Stored encrypted. Only the server can read it." : x.hint ?? "Stored encrypted."}</span>
                </label>
              );
            }
            return (
              <label key={x.name} className={`flex flex-col gap-1 text-[13px] font-semibold text-ink ${wide}`}>
                {x.label}
                <input name={x.name} type={x.type ?? "text"} defaultValue={d.config[x.name] ?? ""} placeholder={x.placeholder} disabled={ro} required={x.required} className={input} />
                {x.hint && <span className="text-[12px] font-normal text-muted">{x.hint}</span>}
              </label>
            );
          })}
          {!ro && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-ink">
                <input type="checkbox" name="enabled" defaultChecked={d.enabled || !d.saved} className="peer sr-only" />
                <span aria-hidden="true" className="relative h-6 w-11 rounded-full bg-line-strong transition peer-checked:bg-blue after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5 peer-focus-visible:ring-[3px] peer-focus-visible:ring-[#c7d6fb]" />
                Use this {def.name} account
              </label>
              <Submit>Save {def.name}</Submit>
            </div>
          )}
        </form>
        {!ro && d.saved && (
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-[12px] bg-surface-alt p-3">
            <form action={test} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="provider" value={def.code} />
              <input type="hidden" name="scope" value={d.scope} />
              {def.testSend && (
                <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">
                  {def.testSend === "email" ? "Send a test email to" : "Send a test message to"}{def.code === "email" || def.code === "whatsapp" ? " (optional)" : ""}
                  <input name="target" type={def.testSend === "email" ? "email" : "tel"} placeholder={def.testSend === "email" ? "you@school.in" : "98XXXXXXXX"} className="input !min-h-9 !w-56 !py-1.5 text-[14px] font-normal" />
                </label>
              )}
              <Submit variant="secondary"><LuSend size={15} aria-hidden="true" />Test connection</Submit>
            </form>
            <form action={remove}>
              <input type="hidden" name="provider" value={def.code} />
              <input type="hidden" name="scope" value={d.scope} />
              <Submit variant="danger"><LuTrash2 size={15} aria-hidden="true" />Remove</Submit>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
