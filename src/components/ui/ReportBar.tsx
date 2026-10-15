import Link from "next/link";
import { PRESETS, type Range } from "@/lib/report-range";

/** Period chooser + CSV / print for report pages (server-rendered; the period lives in the URL). */
export function ReportBar({ basePath, range, exportKind, extra = {} }: { basePath: string; range: Range; exportKind?: string; extra?: Record<string, string | undefined> }) {
  const keep = Object.entries(extra).filter(([, v]) => v) as [string, string][];
  const href = (p: string) => `${basePath}?${new URLSearchParams([...keep, ...(p === "month" ? [] : [["p", p] as [string, string]])]).toString()}`;
  const csv = exportKind ? `/app/reports/export?${new URLSearchParams([["kind", exportKind], ["from", range.d1], ["to", range.d2], ...keep]).toString()}` : null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
      <nav className="flex flex-wrap gap-1.5" aria-label="Period">
        {PRESETS.map(([k, t]) => (
          <Link key={k} href={href(k)} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${range.preset === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{t}</Link>
        ))}
      </nav>
      <form action={basePath} className="flex flex-wrap items-end gap-2">
        {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">From<input type="date" name="from" defaultValue={range.d1} className="input !min-h-9 !py-1 text-[14px] font-normal" /></label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink">To<input type="date" name="to" defaultValue={range.d2} className="input !min-h-9 !py-1 text-[14px] font-normal" /></label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Apply</button>
        {csv && <a href={csv} className="btn btn-sm btn-secondary">Download CSV</a>}
      </form>
    </div>
  );
}
