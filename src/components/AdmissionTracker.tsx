import { STAGE_HELP } from "@/lib/applications";

export type Step = { n: number; key: string; label: string; done: boolean; detail: string; state: "done" | "current" | "todo" | "skipped" | "closed" };

/** The seven steps of an admission, in order. Shows where the application is and what is still needed. */
export function AdmissionTracker({ steps, stage }: { steps: Step[]; stage: string }) {
  const done = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const pct = Math.round((done / steps.length) * 100);
  const help = STAGE_HELP[stage];
  return (
    <section aria-label="Admission progress" className="rounded-[14px] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[15px] font-bold text-ink">Admission progress</h2>
        <span className="text-[13px] text-muted">{done} of {steps.length} steps · {pct}%</span>
      </div>
      <div className="mb-4 h-2 rounded-full bg-[#eef1f6]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-2 rounded-full bg-wa" style={{ width: `${pct}%` }} />
      </div>
      <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-7">
        {steps.map((s) => {
          const tone = s.state === "done" ? "border-[#bfe3cb] bg-wa-tint" : s.state === "current" ? "border-blue bg-blue-tint" : s.state === "skipped" ? "border-line bg-[#f6f7f9]" : "border-line bg-white";
          const dot = s.state === "done" ? "bg-wa text-white" : s.state === "current" ? "bg-blue text-white" : "bg-[#e5e8ee] text-muted";
          return (
            <li key={s.key} className={`rounded-[12px] border p-3 ${tone}`} aria-current={s.state === "current" ? "step" : undefined}>
              <div className="flex items-center gap-2">
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${dot}`}>{s.state === "done" ? "✓" : s.n}</span>
                <span className="text-[13px] font-bold text-ink">{s.label}</span>
              </div>
              <p className="mt-1.5 mb-0 text-[12px] leading-snug text-muted">{s.detail}</p>
            </li>
          );
        })}
      </ol>
      {help && <p className="mt-4 mb-0 rounded-[10px] bg-surface px-3 py-2 text-[14px] text-ink"><b>Next:</b> {help}</p>}
    </section>
  );
}
