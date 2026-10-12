/** Small single-series bar chart (server-rendered SVG, native hover titles). */
export function BarChart({ data, format = (n) => String(n), label }: { data: { x: string; y: number; tip?: string }[]; format?: (n: number) => string; label: string }) {
  const W = 560, H = 180, padL = 44, padB = 24, padT = 12;
  const max = Math.max(1, ...data.map((d) => d.y));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const bw = (W - padL) / data.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--color-muted)">{format(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const h = Math.max(0, H - padB - y(d.y));
        const x = padL + i * bw + bw * 0.2;
        const w = bw * 0.6;
        return (
          <g key={d.x}>
            <title>{d.tip ?? `${d.x}: ${format(d.y)}`}</title>
            <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
            {h > 0 && <path d={`M${x},${H - padB} V${y(d.y) + Math.min(4, h)} q0,-4 4,-4 H${x + w - 4} q4,0 4,4 V${H - padB} Z`} fill="var(--color-blue)" />}
            {(i % Math.ceil(data.length / 6) === 0 || i === data.length - 1) && <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-muted)">{d.x}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}
