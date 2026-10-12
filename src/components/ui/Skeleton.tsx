/** Placeholder shown by loading.tsx files while a page's data loads. */
export function PageSkeleton({ stats = 4, cards = 2, title = "Loading" }: { stats?: number; cards?: number; title?: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{title}…</span>
      <div className="flex flex-col gap-2">
        <div className="skeleton h-7 w-64 max-w-full" />
        <div className="skeleton h-4 w-96 max-w-full" />
      </div>
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="rounded-[12px] border border-line bg-white p-4"><div className="skeleton h-3 w-24" /><div className="skeleton mt-3 h-6 w-20" /></div>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="rounded-[12px] border border-line bg-white p-5">
            <div className="skeleton h-4 w-40" />
            {Array.from({ length: 5 }, (_, j) => <div key={j} className="skeleton mt-4 h-3" style={{ width: `${90 - j * 12}%` }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="skeleton h-7 w-56" />
      <div className="skeleton h-10 w-full max-w-md" />
      <div className="rounded-[12px] border border-line bg-white p-4">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton mt-3 h-4 first:mt-0" style={{ width: `${100 - (i % 3) * 8}%` }} />)}
      </div>
    </div>
  );
}
