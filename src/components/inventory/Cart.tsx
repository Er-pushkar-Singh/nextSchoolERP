"use client";

import { useMemo, useState } from "react";

export type CartItem = { id: string; name: string; variant: string | null; category: string; sku: string | null; price: number; cost: number; on_hand: number; track: boolean; unit: string; cls: string | null };
type Line = { id: string; qty: number; rate: number };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * The counter. Pick items (type to search, or tap a category), set quantities, see the bill. The chosen lines travel in one
 * hidden field (`lines`, JSON) so the surrounding server form stays a plain form. In purchase mode the rate is the cost.
 */
export function Cart({ items, mode, canPrice = false, discountName = "discount" }: { items: CartItem[]; mode: "sale" | "purchase"; canPrice?: boolean; discountName?: string }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("");
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (!cat || i.category === cat) && (!s || `${i.name} ${i.variant ?? ""} ${i.sku ?? ""} ${i.category}`.toLowerCase().includes(s))).slice(0, 60);
  }, [items, q, cat]);

  const add = (i: CartItem) => setLines((ls) => {
    const at = ls.findIndex((l) => l.id === i.id);
    if (at >= 0) return ls.map((l, k) => (k === at ? { ...l, qty: l.qty + 1 } : l));
    return [...ls, { id: i.id, qty: 1, rate: mode === "sale" ? i.price : i.cost }];
  });
  const set = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const drop = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id));
  const sub = lines.reduce((t, l) => t + l.qty * l.rate, 0);
  const disc = mode === "sale" ? Math.min(Math.max(Number(discount) || 0, 0), sub) : 0;
  const total = sub - disc;
  const over = lines.filter((l) => { const it = byId.get(l.id); return mode === "sale" && it?.track && l.qty > it.on_hand; });
  const payload = JSON.stringify(lines.map((l) => (mode === "sale" ? { item: l.id, qty: l.qty, price: canPrice ? l.rate : null } : { item: l.id, qty: l.qty, unit_cost: l.rate })));

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, size or SKU…" aria-label="Search items" className="input !min-h-11 !py-2 text-[15px]" />
        <div className="flex flex-wrap gap-1.5">
          {["", ...cats].map((c) => (
            <button key={c || "all"} type="button" onClick={() => setCat(c)} className={`cursor-pointer rounded-full border px-3 py-1 text-[13px] font-semibold ${cat === c ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{c || "All"}</button>
          ))}
        </div>
        <ul className="m-0 grid max-h-[460px] list-none gap-2 overflow-y-auto p-0 sm:grid-cols-2">
          {shown.map((i) => {
            const out = mode === "sale" && i.track && i.on_hand <= 0;
            return (
              <li key={i.id}>
                <button type="button" disabled={out} onClick={() => add(i)} className="flex h-full w-full cursor-pointer flex-col items-start gap-0.5 rounded-[12px] border border-line bg-white px-3 py-2.5 text-left transition hover:border-blue disabled:cursor-not-allowed disabled:opacity-50">
                  <span className="text-[14px] font-bold text-ink">{i.name}{i.variant ? <span className="font-normal text-muted"> · {i.variant}</span> : null}</span>
                  <span className="text-[12px] text-muted">{i.category}{i.cls ? ` · Class ${i.cls}` : ""}{i.sku ? ` · ${i.sku}` : ""}</span>
                  <span className="mt-1 flex w-full items-center justify-between text-[13px]">
                    <b className="text-ink">{inr(mode === "sale" ? i.price : i.cost)}</b>
                    {i.track ? <span className={i.on_hand <= 0 ? "font-semibold text-error" : "text-muted"}>{i.on_hand <= 0 ? "Out of stock" : `${i.on_hand} ${i.unit}`}</span> : <span className="text-muted">no stock count</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="text-[14px] text-muted">No item matches.</li>}
        </ul>
      </div>

      <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
        <h3 className="m-0 text-[15px] font-bold text-ink">{mode === "sale" ? "Bill" : "Purchase"} <span className="font-normal text-muted">· {lines.length} line{lines.length === 1 ? "" : "s"}</span></h3>
        <input type="hidden" name="lines" value={payload} />
        {lines.length === 0 && <p className="m-0 text-[13.5px] text-muted">Tap items on the left to add them.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {lines.map((l) => {
            const it = byId.get(l.id)!;
            const bad = over.includes(l);
            return (
              <li key={l.id} className={`rounded-[10px] border px-3 py-2 ${bad ? "border-[#f3b8b1] bg-[#fdecea]" : "border-line"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[14px] font-semibold text-ink">{it.name}{it.variant ? <span className="font-normal text-muted"> · {it.variant}</span> : null}</span>
                  <button type="button" onClick={() => drop(l.id)} aria-label={`Remove ${it.name}`} className="cursor-pointer border-0 bg-transparent px-1 text-[18px] leading-none text-muted">×</button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="inline-flex items-center overflow-hidden rounded-lg border border-line">
                    <button type="button" onClick={() => set(l.id, { qty: Math.max(1, l.qty - 1) })} className="cursor-pointer border-0 bg-surface-alt px-2.5 py-1 text-[15px]" aria-label="Less">−</button>
                    <input value={l.qty} onChange={(e) => set(l.id, { qty: Math.max(1, Math.round(Number(e.target.value) || 1)) })} inputMode="numeric" className="w-12 border-0 bg-white py-1 text-center text-[14px] outline-none" aria-label="Quantity" />
                    <button type="button" onClick={() => set(l.id, { qty: l.qty + 1 })} className="cursor-pointer border-0 bg-surface-alt px-2.5 py-1 text-[15px]" aria-label="More">+</button>
                  </span>
                  <span className="text-muted">×</span>
                  {mode === "purchase" || canPrice ? (
                    <input value={l.rate} onChange={(e) => set(l.id, { rate: Math.max(0, Number(e.target.value) || 0) })} inputMode="decimal" className="input !min-h-8 !w-24 !py-1 text-[14px]" aria-label="Rate" />
                  ) : <span>{inr(l.rate)}</span>}
                  <b className="ml-auto text-ink">{inr(l.qty * l.rate)}</b>
                </div>
                {bad && <p className="m-0 mt-1 text-[12px] font-semibold text-error">Only {it.on_hand} in stock.</p>}
              </li>
            );
          })}
        </ul>
        <div className="border-t border-line pt-3 text-[14px]">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{inr(sub)}</span></div>
          {mode === "sale" && (
            <label className="mt-1.5 flex items-center justify-between gap-3"><span className="text-muted">Discount{canPrice ? "" : " (needs permission)"}</span>
              <input name={discountName} value={discount} onChange={(e) => setDiscount(e.target.value)} disabled={!canPrice} inputMode="decimal" placeholder="0" className="input !min-h-8 !w-24 !py-1 text-right text-[14px]" /></label>
          )}
          <div className="mt-2 flex items-baseline justify-between"><span className="font-bold text-ink">Total</span><span className="text-[22px] font-extrabold text-ink">{inr(total)}</span></div>
          {mode === "purchase" && (
            <button type="button" onClick={(e) => { const f = e.currentTarget.form; const p = f?.elements.namedItem("paid") as HTMLInputElement | null; if (p) p.value = String(total); }}
              className="mt-2 cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Set “amount paid” to the full total</button>
          )}
        </div>
        <button type="submit" disabled={!lines.length || over.length > 0} className="btn btn-primary cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50">
          {mode === "sale" ? "Save bill" : "Save purchase"} · {inr(total)}
        </button>
      </div>
    </div>
  );
}
