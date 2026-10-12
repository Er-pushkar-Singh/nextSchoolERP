import Link from "next/link";

export const PAGE_SIZES = [25, 50, 100] as const;

/** Parses ?page= / ?size= (size is limited to PAGE_SIZES). */
export function pageParams(sp: { page?: string; size?: string }, fallback = 25) {
  const size = (PAGE_SIZES as readonly number[]).includes(Number(sp.size)) ? Number(sp.size) : fallback;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  return { page, size, offset: (page - 1) * size };
}

/** Compact page list: 1 … 4 5 [6] 7 8 … 20 */
function pages(cur: number, last: number): (number | "…")[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const set = new Set([1, 2, last - 1, last, cur - 1, cur, cur + 1]);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const n of [...set].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b)) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * Server-rendered pager. `params` are the current filters (page and size are managed here).
 * Everything is in the URL, so a filtered / paged view can be bookmarked or shared.
 */
export function Pagination({ total, page, size, basePath, params }: { total: number; page: number; size: number; basePath: string; params: Record<string, string | undefined> }) {
  const last = Math.max(1, Math.ceil(total / size));
  const cur = Math.min(page, last);
  const href = (p: number, s = size) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (s !== PAGE_SIZES[0]) q.set("size", String(s));
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  if (total === 0) return null;
  const from = (cur - 1) * size + 1, to = Math.min(cur * size, total);
  const cell = "inline-flex min-w-9 items-center justify-center rounded-[8px] border px-2 py-1.5 text-[14px]";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-[14px] print:hidden">
      <span className="text-muted">Showing {from}–{to} of {total}</span>
      {last > 1 && (
        <span className="flex flex-wrap items-center gap-1">
          {cur > 1 ? <Link href={href(cur - 1)} rel="prev" className={`${cell} border-line bg-white`}>← Prev</Link> : <span className={`${cell} border-transparent text-muted`}>← Prev</span>}
          {pages(cur, last).map((p, i) => p === "…"
            ? <span key={`e${i}`} className="px-1 text-muted">…</span>
            : p === cur
              ? <span key={p} aria-current="page" className={`${cell} border-ink bg-ink font-bold text-white`}>{p}</span>
              : <Link key={p} href={href(p)} className={`${cell} border-line bg-white`}>{p}</Link>)}
          {cur < last ? <Link href={href(cur + 1)} rel="next" className={`${cell} border-line bg-white`}>Next →</Link> : <span className={`${cell} border-transparent text-muted`}>Next →</span>}
        </span>
      )}
      <span className="flex items-center gap-2 text-muted">Per page
        {PAGE_SIZES.map((s) => s === size ? <b key={s} className="text-ink">{s}</b> : <Link key={s} href={href(1, s)}>{s}</Link>)}
      </span>
    </nav>
  );
}
