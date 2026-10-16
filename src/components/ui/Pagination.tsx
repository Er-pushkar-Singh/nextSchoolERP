import Link from "next/link";

export const PAGE_SIZES = [25, 50, 100] as const;

/** Parses ?page= / ?size= (size is limited to PAGE_SIZES). */
export function pageParams(sp: { page?: string; size?: string }, fallback = 25, sizes: readonly number[] = PAGE_SIZES) {
  const size = sizes.includes(Number(sp.size)) ? Number(sp.size) : fallback;
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
export function Pagination({ total, page, size, basePath, params, sizes = PAGE_SIZES, pageKey = "page", sizeKey = "size" }: {
  total: number; page: number; size: number; basePath: string; params: Record<string, string | undefined>;
  /** page sizes offered (the first is the default and is left out of the URL); `pageKey` / `sizeKey` allow two pagers on one page */
  sizes?: readonly number[]; pageKey?: string; sizeKey?: string;
}) {
  const last = Math.max(1, Math.ceil(total / size));
  const cur = Math.min(page, last);
  const href = (p: number, s = size) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (s !== sizes[0]) q.set(sizeKey, String(s));
    if (p > 1) q.set(pageKey, String(p));
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
        {sizes.map((s) => s === size ? <b key={s} className="text-ink">{s}</b> : <Link key={s} href={href(1, s)}>{s}</Link>)}
      </span>
    </nav>
  );
}

/**
 * One pager among several on the same page (own ?<pageKey>= / ?<sizeKey>=, other query values kept).
 *   const p = pager(sp, "lp", "ls");   query.range(...p.range)   <Pagination {...p.props(total, "/app/x")} />
 */
export function pager(sp: Record<string, string | undefined>, pageKey = "page", sizeKey = "size", fallback = 10, sizes: readonly number[] = [10, 25, 50]) {
  const { page, size, offset } = pageParams({ page: sp[pageKey], size: sp[sizeKey] }, fallback, sizes);
  const params: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) if (v && k !== pageKey && k !== sizeKey && k !== "ok" && k !== "error") params[k] = v;
  return {
    page, size, offset, range: [offset, offset + size - 1] as [number, number],
    props: (total: number, basePath: string) => ({ total, page, size, basePath, params, sizes, pageKey, sizeKey }),
  };
}
