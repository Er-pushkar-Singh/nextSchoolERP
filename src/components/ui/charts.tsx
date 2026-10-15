/**
 * Small server-rendered charts (inline SVG, no client JavaScript) for dashboards and reports.
 * They scale to the width of their card and print cleanly.
 */

const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#e11d48", "#7c3aed", "#0891b2", "#64748b"];

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 10_000_000) return `${(n / 10_000_000).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (a >= 100_000) return `${(n / 100_000).toFixed(1).replace(/\.0$/, "")}L`;
  if (a >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n * 10) / 10);
};

export type Point = { label: string; value: number; value2?: number };

/** Vertical bars; with `value2` it draws two series side by side (e.g. billed vs collected). */
export function BarChart({ data, height = 190, names, format = compact, colors = [PALETTE[0], PALETTE[1]] }: {
  data: Point[]; height?: number; names?: [string, string]; format?: (n: number) => string; colors?: string[];
}) {
  const W = 640, padL = 8, padR = 8, padT = 18, padB = 28;
  const max = Math.max(1, ...data.flatMap((d) => [d.value, d.value2 ?? 0]));
  const two = data.some((d) => d.value2 !== undefined);
  const slot = (W - padL - padR) / Math.max(1, data.length);
  const bw = Math.min(46, (slot * 0.72) / (two ? 2 : 1));
  const y = (v: number) => padT + (height - padT - padB) * (1 - v / max);
  const base = height - padB;
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={names ? `${names[0]} and ${names[1]}` : "Bar chart"} className="block h-auto w-full">
        <line x1={padL} x2={W - padR} y1={base} y2={base} stroke="#d9dee8" />
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const bars = two ? [d.value, d.value2 ?? 0] : [d.value];
          return (
            <g key={`${d.label}-${i}`}>
              {bars.map((v, k) => {
                const x = cx - (bw * bars.length) / 2 + bw * k;
                return (
                  <g key={k}>
                    <rect x={x + 1} y={y(v)} width={Math.max(2, bw - 2)} height={Math.max(0, base - y(v))} rx={3} fill={colors[k % colors.length]} />
                    {data.length <= 14 && v > 0 && <text x={x + bw / 2} y={y(v) - 4} textAnchor="middle" fontSize="11" fill="#475569">{format(v)}</text>}
                  </g>
                );
              })}
              <text x={cx} y={height - 9} textAnchor="middle" fontSize="11.5" fill="#64748b">{d.label.length > 9 ? `${d.label.slice(0, 8)}…` : d.label}</text>
            </g>
          );
        })}
      </svg>
      {names && (
        <figcaption className="mt-1 flex flex-wrap gap-4 text-[12px] text-muted">
          {names.map((n, i) => <span key={n} className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />{n}</span>)}
        </figcaption>
      )}
    </figure>
  );
}

/** A line with a soft area under it — trends over days or months. */
export function LineChart({ data, height = 170, color = PALETTE[0], format = compact, min = 0, max: fixedMax }: {
  data: Point[]; height?: number; color?: string; format?: (n: number) => string; min?: number; max?: number;
}) {
  const W = 640, padL = 34, padR = 12, padT = 14, padB = 26;
  if (data.length === 0) return null;
  const hi = fixedMax ?? Math.max(1, ...data.map((d) => d.value));
  const lo = Math.min(min, ...data.map((d) => d.value));
  const span = Math.max(1e-6, hi - lo);
  const x = (i: number) => padL + ((W - padL - padR) * (data.length === 1 ? 0.5 : i / (data.length - 1)));
  const y = (v: number) => padT + (height - padT - padB) * (1 - (v - lo) / span);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = `${path} L${x(data.length - 1).toFixed(1)},${height - padB} L${x(0).toFixed(1)},${height - padB} Z`;
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Trend" className="block h-auto w-full">
      {[0, 0.5, 1].map((t) => {
        const v = lo + span * t;
        return (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e5e9f0" />
            <text x={padL - 5} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#64748b">{format(v)}</text>
          </g>
        );
      })}
      <path d={area} fill={color} opacity="0.1" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={`${d.label}-${i}`}>
          {data.length <= 40 && <circle cx={x(i)} cy={y(d.value)} r={2.6} fill={color} />}
          {i % every === 0 && <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="#64748b">{d.label}</text>}
        </g>
      ))}
    </svg>
  );
}

/** Ring with a legend — shares of a whole (gender, categories, payment modes). */
export function Donut({ data, size = 150, centre }: { data: { label: string; value: number; color?: string }[]; size?: number; centre?: React.ReactNode }) {
  const total = data.reduce((t, d) => t + Math.max(0, d.value), 0);
  const r = 52, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 140 140" className="block h-full w-full -rotate-90" role="img" aria-label="Share chart">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#eef1f6" strokeWidth="18" />
          {total > 0 && data.map((d, i) => {
            const len = (Math.max(0, d.value) / total) * c;
            const el = <circle key={d.label} cx="70" cy="70" r={r} fill="none" stroke={d.color ?? PALETTE[i % PALETTE.length]} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} />;
            acc += len;
            return el;
          })}
        </svg>
        {centre && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{centre}</div>}
      </div>
      <ul className="m-0 flex min-w-[140px] list-none flex-col gap-1.5 p-0 text-[13.5px]">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <i className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} />
            <span className="text-body">{d.label}</span>
            <b className="ml-auto pl-3 text-ink">{d.value}{total > 0 ? <span className="font-normal text-muted"> · {Math.round((100 * d.value) / total)}%</span> : null}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars in a list — rankings (top books, classes with most absences). */
export function HBars({ data, format = (n: number) => String(n), color = PALETTE[0], max }: { data: { label: string; value: number; hint?: string }[]; format?: (n: number) => string; color?: string; max?: number }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="m-0 text-[13px] text-muted">Nothing to show yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {data.map((d) => (
        <li key={d.label} className="text-[13.5px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ink">{d.label}{d.hint ? <span className="text-muted"> · {d.hint}</span> : null}</span>
            <b className="shrink-0 text-ink">{format(d.value)}</b>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#eef1f6]"><div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (100 * d.value) / top))}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}
