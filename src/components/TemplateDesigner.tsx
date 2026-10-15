"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONTS, PAGE_PRESETS, compileDesign, normalizeDesign, withSample, type Design, type Item } from "@/lib/design";
import { PLACEHOLDERS } from "@/lib/documents";

const PX_PER_MM = 96 / 25.4;
const SNAP = 0.5;          // mm
const EDGE = 1.2;          // mm: pull to page edges / centre
const r2 = (n: number) => Math.round(n * 100) / 100;
const uid = () => `e${Math.random().toString(36).slice(2, 9)}`;

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Drag =
  | { kind: "move"; ids: string[]; sx: number; sy: number; orig: Record<string, { x: number; y: number }> }
  | { kind: "resize"; id: string; h: Handle; sx: number; sy: number; o: { x: number; y: number; w: number; h: number } }
  | { kind: "rotate"; id: string; cx: number; cy: number; orig: number }
  | null;

export function TemplateDesigner({ initial, name: initialName, action, templateId, backHref, saveLabel = "Save design" }: {
  initial: Design; name: string; templateId: string; backHref: string; saveLabel?: string;
  action: (f: FormData) => void | Promise<void>;
}) {
  const [design, setDesign] = useState<Design>(() => normalizeDesign(initial));
  const [name, setName] = useState(initialName);
  const [sel, setSel] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [grid, setGrid] = useState(true);
  const [preview, setPreview] = useState(false);
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"add" | "fields" | "layers" | "page">("add");
  const drag = useRef<Drag>(null);
  const designRef = useRef(design);
  const stage = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { designRef.current = design; });
  const S = PX_PER_MM * zoom;

  const items = design.items;
  const selected = items.filter((i) => sel.includes(i.id));
  const one = selected.length === 1 ? selected[0] : null;

  /* ───────── history ───────── */
  const commit = useCallback((next: Design, push = true) => {
    if (push) { setPast((p) => [...p.slice(-60), JSON.stringify(designRef.current)]); setFuture([]); }
    setDesign(next); setDirty(true);
  }, []);
  const undo = () => setPast((p) => {
    if (!p.length) return p;
    setFuture((f) => [JSON.stringify(designRef.current), ...f]);
    setDesign(JSON.parse(p[p.length - 1])); setDirty(true);
    return p.slice(0, -1);
  });
  const redo = () => setFuture((f) => {
    if (!f.length) return f;
    setPast((p) => [...p, JSON.stringify(designRef.current)]);
    setDesign(JSON.parse(f[0])); setDirty(true);
    return f.slice(1);
  });

  const update = (ids: string[], patch: Partial<Item> | ((i: Item) => Partial<Item>), push = true) =>
    commit({ ...designRef.current, items: designRef.current.items.map((i) => (ids.includes(i.id) ? { ...i, ...(typeof patch === "function" ? patch(i) : patch) } : i)) }, push);

  /* ───────── adding ───────── */
  const add = (it: Partial<Item> & { type: Item["type"] }) => {
    const d = designRef.current;
    const base: Item = { id: uid(), x: Math.max(2, d.w / 2 - 20), y: Math.max(2, d.h / 2 - 8), w: 40, h: 12, rot: 0, ...it } as Item;
    commit({ ...d, items: [...d.items, base] });
    setSel([base.id]);
  };
  const addText = (text = "Your text", extra: Partial<Item> = {}) => add({ type: "text", text, size: 12, weight: 400, color: "#111111", align: "left", valign: "top", w: 60, h: 10, lh: 1.25, ...extra });
  const addField = (key: string) => {
    const isImg = key === "student.photo" || key === "school.logo" || key === "student.qr" || key === "school.signature" || key === "school.seal";
    if (key === "student.photo") add({ type: "photo", w: 24, h: 30, radius: 2, name: "Photograph" });
    else if (key === "school.logo") add({ type: "logo", w: 16, h: 16, name: "Logo" });
    else if (key === "school.signature") add({ type: "signature", w: 40, h: 14, name: "Principal signature" });
    else if (key === "school.seal") add({ type: "seal", w: 24, h: 24, name: "School seal" });
    else if (key === "student.qr" || key === "staff.qr") add({ type: "qr", w: 18, h: 18, name: "QR code", text: key });
    else addText(`{{${key}}}`, { w: key.endsWith("_html") ? Math.min(design.w - 20, 120) : 60, h: key.endsWith("_html") ? 40 : 7, size: 11 });
    return isImg;
  };

  /* ───────── actions on the selection ───────── */
  const remove = () => { if (!selected.length) return; commit({ ...design, items: items.filter((i) => !sel.includes(i.id) || i.locked) }); setSel([]); };
  const duplicate = () => {
    if (!selected.length) return;
    const copies = selected.map((i) => ({ ...i, id: uid(), x: r2(i.x + 3), y: r2(i.y + 3), name: i.name ? `${i.name} copy` : undefined, locked: false }));
    commit({ ...design, items: [...items, ...copies] });
    setSel(copies.map((c) => c.id));
  };
  const order = (dir: "front" | "back" | "up" | "down") => {
    if (!selected.length) return;
    const ids = new Set(sel);
    let arr = [...items];
    if (dir === "front") arr = [...arr.filter((i) => !ids.has(i.id)), ...arr.filter((i) => ids.has(i.id))];
    else if (dir === "back") arr = [...arr.filter((i) => ids.has(i.id)), ...arr.filter((i) => !ids.has(i.id))];
    else {
      const k = dir === "up" ? 1 : -1;
      const idx = arr.map((i, n) => (ids.has(i.id) ? n : -1)).filter((n) => n >= 0);
      for (const n of (k > 0 ? [...idx].reverse() : idx)) {
        const m = n + k;
        if (m >= 0 && m < arr.length && !ids.has(arr[m].id)) [arr[n], arr[m]] = [arr[m], arr[n]];
      }
    }
    commit({ ...design, items: arr });
  };
  const align = (how: "l" | "c" | "r" | "t" | "m" | "b") => {
    if (!selected.length) return;
    update(sel, (i) => how === "l" ? { x: 0 } : how === "c" ? { x: r2((design.w - i.w) / 2) } : how === "r" ? { x: r2(design.w - i.w) }
      : how === "t" ? { y: 0 } : how === "m" ? { y: r2((design.h - i.h) / 2) } : { y: r2(design.h - i.h) });
  };

  /* ───────── pointer: move / resize / rotate ───────── */
  const toMm = (px: number) => px / S;
  const snapv = (v: number, size: number, max: number) => {
    let x = grid ? Math.round(v / SNAP) * SNAP : v;
    for (const t of [0, max - size, (max - size) / 2]) if (Math.abs(x - t) < EDGE) x = t;
    return r2(x);
  };
  const onDown = (e: React.PointerEvent, it: Item) => {
    if (preview || it.locked) { if (!preview) setSel([it.id]); return; }
    e.stopPropagation();
    const ids = e.shiftKey ? (sel.includes(it.id) ? sel.filter((s) => s !== it.id) : [...sel, it.id]) : sel.includes(it.id) ? sel : [it.id];
    setSel(ids);
    const orig: Record<string, { x: number; y: number }> = {};
    for (const i of items) if (ids.includes(i.id)) orig[i.id] = { x: i.x, y: i.y };
    drag.current = { kind: "move", ids, sx: e.clientX, sy: e.clientY, orig };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onHandle = (e: React.PointerEvent, it: Item, h: Handle) => {
    e.stopPropagation();
    drag.current = { kind: "resize", id: it.id, h, sx: e.clientX, sy: e.clientY, o: { x: it.x, y: it.y, w: it.w, h: it.h } };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onRotate = (e: React.PointerEvent, it: Item) => {
    e.stopPropagation();
    const box = stage.current!.getBoundingClientRect();
    drag.current = { kind: "rotate", id: it.id, cx: box.left + (it.x + it.w / 2) * S, cy: box.top + (it.y + it.h / 2) * S, orig: it.rot };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const moved = useRef(false);
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const d = designRef.current;
    if (!moved.current) { moved.current = true; setPast((p) => [...p.slice(-60), JSON.stringify(d)]); setFuture([]); }
    if (g.kind === "move") {
      const dx = toMm(e.clientX - g.sx), dy = toMm(e.clientY - g.sy);
      const only = g.ids.length === 1;
      setDesign({ ...d, items: d.items.map((i) => {
        const o = g.orig[i.id];
        if (!o) return i;
        return only ? { ...i, x: snapv(o.x + dx, i.w, d.w), y: snapv(o.y + dy, i.h, d.h) } : { ...i, x: r2(o.x + dx), y: r2(o.y + dy) };
      }) });
    } else if (g.kind === "resize") {
      const dx = toMm(e.clientX - g.sx), dy = toMm(e.clientY - g.sy);
      let { x, y, w, h } = g.o;
      if (g.h.includes("e")) w = Math.max(1, g.o.w + dx);
      if (g.h.includes("s")) h = Math.max(1, g.o.h + dy);
      if (g.h.includes("w")) { w = Math.max(1, g.o.w - dx); x = g.o.x + (g.o.w - w); }
      if (g.h.includes("n")) { h = Math.max(1, g.o.h - dy); y = g.o.y + (g.o.h - h); }
      if (grid) { w = Math.round(w / SNAP) * SNAP; h = Math.round(h / SNAP) * SNAP; }
      setDesign({ ...d, items: d.items.map((i) => (i.id === g.id ? { ...i, x: r2(x), y: r2(y), w: r2(w), h: r2(h) } : i)) });
    } else {
      let a = (Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * 180) / Math.PI + 90;
      if (e.shiftKey || Math.abs(a % 15) < 3) a = Math.round(a / 15) * 15;
      if (a > 180) a -= 360;
      setDesign({ ...d, items: d.items.map((i) => (i.id === g.id ? { ...i, rot: r2(a) } : i)) });
    }
    setDirty(true);
  };
  const onUp = () => { drag.current = null; moved.current = false; };

  /* ───────── keyboard ───────── */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); }
      else if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSel(designRef.current.items.map((i) => i.id)); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
      else if (e.key === "Escape") setSel([]);
      else if (e.key.startsWith("Arrow") && sel.length) {
        e.preventDefault();
        const st = e.shiftKey ? 5 : 0.5;
        update(sel, (i) => ({ x: r2(i.x + (e.key === "ArrowRight" ? st : e.key === "ArrowLeft" ? -st : 0)), y: r2(i.y + (e.key === "ArrowDown" ? st : e.key === "ArrowUp" ? -st : 0)) }));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const html = useMemo(() => compileDesign(design), [design]);
  const designJson = useMemo(() => JSON.stringify(design), [design]);
  const pageKey = PAGE_PRESETS.find((p) => Math.abs(p.w - design.w) < 0.5 && Math.abs(p.h - design.h) < 0.5)?.key ?? "custom";

  const fieldBtn = "cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-left text-[12px] hover:border-blue";
  const lbl = "flex flex-col gap-1 text-[11px] font-semibold text-muted";
  const inp = "input !min-h-8 !py-1 text-[13px] font-normal";
  const num = (v: string) => (v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={templateId} />
      <input type="hidden" name="design" value={designJson} />

      {/* top bar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-white px-3 py-2 shadow-[var(--shadow-card)]">
        <a href={backHref} className="text-[13px]">← Back</a>
        <input name="name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label="Template name" className="input !min-h-9 !w-60 !py-1 text-[14px] font-bold" />
        <span className="mx-1 h-6 w-px bg-line" />
        <button type="button" onClick={undo} disabled={!past.length} className="btn btn-sm btn-secondary cursor-pointer disabled:opacity-40" title="Undo (Ctrl+Z)">↶ Undo</button>
        <button type="button" onClick={redo} disabled={!future.length} className="btn btn-sm btn-secondary cursor-pointer disabled:opacity-40" title="Redo (Ctrl+Y)">↷ Redo</button>
        <span className="mx-1 h-6 w-px bg-line" />
        <button type="button" onClick={() => setZoom((z) => Math.max(0.4, r2(z - 0.1)))} className="btn btn-sm btn-secondary cursor-pointer" aria-label="Zoom out">−</button>
        <span className="w-12 text-center text-[13px]">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(3, r2(z + 0.1)))} className="btn btn-sm btn-secondary cursor-pointer" aria-label="Zoom in">+</button>
        <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Snap</label>
        <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={preview} onChange={(e) => { setPreview(e.target.checked); setSel([]); }} /> Preview with sample data</label>
        <span className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[12px] text-[#7a4b00]">Unsaved changes</span>}
          <button className="btn btn-sm btn-primary cursor-pointer border-0">{saveLabel}</button>
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[250px_minmax(0,1fr)_270px]">
        {/* left: add, fields, layers, page */}
        <aside className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-3">
          <div className="flex flex-wrap gap-1 text-[12px]">
            {(["add", "fields", "layers", "page"] as const).map((t) => (
              <button type="button" key={t} onClick={() => setTab(t)} className={`cursor-pointer rounded-md border px-2 py-1 ${tab === t ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>
                {t === "add" ? "Elements" : t === "fields" ? "Fields" : t === "layers" ? "Layers" : "Page"}
              </button>
            ))}
          </div>

          {tab === "add" && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={fieldBtn} onClick={() => addText("Heading", { size: 22, weight: 800, w: 90, h: 12 })}><b>T</b> Heading</button>
              <button type="button" className={fieldBtn} onClick={() => addText("Your text here")}>Aa Text</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "rect", fill: "#dbeafe", w: 50, h: 20, radius: 0 })}>▭ Rectangle</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "ellipse", fill: "#fde68a", w: 24, h: 24 })}>◯ Circle</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "line", w: 60, h: 0.4, stroke: "#111111", sw: 0.4 })}>— Line</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "image", w: 30, h: 30, src: "", fit: "cover" })}>🖼 Image</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "photo", w: 24, h: 30, radius: 2, name: "Photograph" })}>👤 Student photo</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "logo", w: 16, h: 16, name: "Logo" })}>◈ School logo</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "qr", w: 18, h: 18, name: "QR code" })}>▦ QR code</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "signature", w: 40, h: 14, name: "Principal signature" })}>✍ Principal signature</button>
              <button type="button" className={fieldBtn} onClick={() => add({ type: "seal", w: 24, h: 24, name: "School seal" })}>◎ School seal</button>
              <p className="col-span-2 m-0 text-[11px] text-muted">Drag to move, corners to resize, the round handle to rotate. Shift-click selects several. Delete, Ctrl+D duplicate, arrows nudge.</p>
            </div>
          )}

          {tab === "fields" && (
            <div className="flex max-h-[520px] flex-col gap-3 overflow-y-auto pr-1">
              <p className="m-0 text-[11px] text-muted">Click a field to place it. It is filled with the real record when the document is issued.</p>
              {PLACEHOLDERS.map((g) => (
                <div key={g.group}>
                  <p className="m-0 mb-1 text-[12px] font-bold text-ink">{g.group}</p>
                  <div className="flex flex-wrap gap-1">
                    {g.items.map(([k, l]) => <button type="button" key={k} title={`{{${k}}}`} className={fieldBtn} onClick={() => addField(k)}>{l}</button>)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "layers" && (
            <ul className="m-0 flex max-h-[520px] list-none flex-col gap-1 overflow-y-auto p-0">
              {[...items].reverse().map((i) => (
                <li key={i.id} className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[12px] ${sel.includes(i.id) ? "border-blue bg-blue-tint" : "border-line"}`}>
                  <button type="button" onClick={(e) => setSel(e.shiftKey ? [...sel, i.id] : [i.id])} className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left">
                    {i.type === "text" ? (i.text || "Text").slice(0, 28) : i.name ?? { rect: "Rectangle", ellipse: "Circle", line: "Line", image: "Image", photo: "Photograph", logo: "Logo", qr: "QR code", signature: "Signature", seal: "Seal", text: "Text" }[i.type]}
                  </button>
                  <button type="button" title="Hide" onClick={() => update([i.id], { hidden: !i.hidden })} className="cursor-pointer border-0 bg-transparent p-0">{i.hidden ? "🚫" : "👁"}</button>
                  <button type="button" title="Lock" onClick={() => update([i.id], { locked: !i.locked })} className="cursor-pointer border-0 bg-transparent p-0">{i.locked ? "🔒" : "🔓"}</button>
                </li>
              ))}
              {!items.length && <li className="text-[12px] text-muted">Nothing on the page yet.</li>}
            </ul>
          )}

          {tab === "page" && (
            <div className="grid gap-2">
              <label className={lbl}>Page size
                <select value={pageKey} onChange={(e) => { const p = PAGE_PRESETS.find((x) => x.key === e.target.value); if (p) commit({ ...design, w: p.w, h: p.h }); }} className={inp}>
                  {PAGE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  <option value="custom">Custom size</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className={lbl}>Width (mm)<input type="number" min={30} max={300} value={design.w} onChange={(e) => commit({ ...design, w: Math.min(300, Math.max(30, num(e.target.value))) }, false)} className={inp} /></label>
                <label className={lbl}>Height (mm)<input type="number" min={30} max={300} value={design.h} onChange={(e) => commit({ ...design, h: Math.min(300, Math.max(30, num(e.target.value))) }, false)} className={inp} /></label>
              </div>
              <label className={lbl}>Background colour<input type="color" value={design.bg.startsWith("#") ? design.bg.slice(0, 7) : "#ffffff"} onChange={(e) => commit({ ...design, bg: e.target.value }, false)} className="h-8 w-full" /></label>
              <label className={lbl}>Background image (https link)<input value={design.bgImage ?? ""} onChange={(e) => commit({ ...design, bgImage: e.target.value || undefined }, false)} placeholder="https://…" className={inp} /></label>
            </div>
          )}
        </aside>

        {/* canvas */}
        <div className="overflow-auto rounded-[14px] border border-line bg-[#e9edf3] p-6" onPointerDown={() => !preview && setSel([])}>
          <div className="mx-auto w-fit">
            <div ref={stage} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              style={{ position: "relative", width: design.w * S, height: design.h * S, background: design.bg, boxShadow: "0 6px 24px rgba(15,23,42,.18)", touchAction: "none",
                backgroundImage: design.bgImage ? `url('${design.bgImage}')` : grid && !preview ? `linear-gradient(to right, rgba(100,116,139,.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,.12) 1px, transparent 1px)` : undefined,
                backgroundSize: design.bgImage ? "cover" : `${5 * S}px ${5 * S}px` }}>
              {preview ? (
                <div style={{ transform: `scale(${S / PX_PER_MM})`, transformOrigin: "top left", width: `${design.w}mm`, height: `${design.h}mm` }}
                  dangerouslySetInnerHTML={{ __html: withSample(html) }} />
              ) : items.map((it) => {
                if (it.hidden) return null;
                const on = sel.includes(it.id);
                const common: React.CSSProperties = { position: "absolute", left: it.x * S, top: it.y * S, width: it.w * S, height: it.type === "line" ? Math.max((it.sw ?? 0.4) * S, 2) : it.h * S,
                  transform: it.rot ? `rotate(${it.rot}deg)` : undefined, transformOrigin: it.type === "line" ? "left center" : undefined, opacity: it.opacity ?? 1,
                  cursor: it.locked ? "default" : "move", boxSizing: "border-box", outline: on ? "1.5px solid #2563eb" : undefined, outlineOffset: 1 };
                let body: React.ReactNode = null;
                let style: React.CSSProperties = {};
                if (it.type === "text") {
                  style = { display: "flex", flexDirection: "column", justifyContent: it.valign === "middle" ? "center" : it.valign === "bottom" ? "flex-end" : "flex-start", overflow: "hidden",
                    fontFamily: it.font, fontSize: (it.size ?? 11) * 0.352778 * S, fontWeight: it.weight, fontStyle: it.italic ? "italic" : undefined,
                    textDecoration: it.underline ? "underline" : undefined, textAlign: it.align, color: it.color, lineHeight: it.lh, letterSpacing: it.ls ? `${it.ls / 10}pt` : undefined,
                    textTransform: it.upper ? "uppercase" : undefined, background: it.fill && it.fill !== "transparent" ? it.fill : undefined, borderRadius: (it.radius ?? 0) * S, whiteSpace: "pre-wrap" };
                  body = <div>{it.text}</div>;
                } else if (it.type === "rect" || it.type === "ellipse") {
                  style = { background: it.fill, border: it.sw ? `${it.sw * S}px solid ${it.stroke}` : undefined, borderRadius: it.type === "ellipse" ? "50%" : (it.radius ?? 0) * S };
                } else if (it.type === "line") {
                  style = { background: it.stroke };
                } else if (it.type === "image") {
                  style = { overflow: "hidden", borderRadius: (it.radius ?? 0) * S, background: it.src ? undefined : "repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb 6px,#f3f4f6 6px,#f3f4f6 12px)" };
                  body = it.src ? <img src={it.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: it.fit }} /> : <span style={{ fontSize: 10, color: "#6b7280", padding: 4, display: "block" }}>Image</span>;
                } else {
                  style = { overflow: "hidden", borderRadius: (it.radius ?? 0) * S, border: it.sw ? `${it.sw * S}px solid ${it.stroke}` : undefined,
                    background: it.type === "photo" ? "linear-gradient(135deg,#cbd5e1,#94a3b8)" : it.type === "qr" ? "repeating-conic-gradient(#111 0 25%,#fff 0 50%) 0 0/20% 20%" : "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 };
                  body = it.type === "photo" ? <span style={{ opacity: 0.9 }}>PHOTO</span> : it.type === "qr" ? null : it.type === "signature" ? <span style={{ fontFamily: "cursive" }}>Signature</span> : it.type === "seal" ? <span>SEAL</span> : <span>LOGO</span>;
                }
                return (
                  <div key={it.id} style={{ ...common, ...style }} onPointerDown={(e) => onDown(e, it)} onDoubleClick={() => { setTab("add"); setTimeout(() => textRef.current?.focus(), 0); }}>
                    {body}
                    {on && sel.length === 1 && !it.locked && (
                      <>
                        {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map((h) => (
                          <span key={h} onPointerDown={(e) => onHandle(e, it, h)}
                            style={{ position: "absolute", width: 9, height: 9, background: "#fff", border: "1.5px solid #2563eb", borderRadius: 2, touchAction: "none",
                              left: h.includes("w") ? -5 : h.includes("e") ? undefined : "calc(50% - 5px)", right: h.includes("e") ? -5 : undefined,
                              top: h.includes("n") ? -5 : h.includes("s") ? undefined : "calc(50% - 5px)", bottom: h.includes("s") ? -5 : undefined,
                              cursor: h === "n" || h === "s" ? "ns-resize" : h === "e" || h === "w" ? "ew-resize" : h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize" }} />
                        ))}
                        <span onPointerDown={(e) => onRotate(e, it)} title="Rotate"
                          style={{ position: "absolute", left: "calc(50% - 6px)", top: -26, width: 12, height: 12, borderRadius: "50%", background: "#2563eb", cursor: "grab", touchAction: "none" }} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 mb-0 text-center text-[12px] text-muted">{design.w} × {design.h} mm · {items.length} element(s)</p>
          </div>
        </div>

        {/* right: properties */}
        <aside className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-3">
          {!selected.length && <p className="m-0 text-[13px] text-muted">Select an element to edit it. Nothing selected: use <b>Page</b> on the left for size and background.</p>}
          {selected.length > 1 && <p className="m-0 text-[13px] text-ink">{selected.length} elements selected.</p>}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1 text-[12px]">
              {([["l", "⇤"], ["c", "↔"], ["r", "⇥"], ["t", "⤒"], ["m", "↕"], ["b", "⤓"]] as const).map(([k, g]) => (
                <button type="button" key={k} onClick={() => align(k)} title={{ l: "Align left", c: "Centre horizontally", r: "Align right", t: "Align top", m: "Centre vertically", b: "Align bottom" }[k]} className="cursor-pointer rounded-md border border-line bg-white px-2 py-1">{g}</button>
              ))}
              <button type="button" onClick={() => order("front")} className="cursor-pointer rounded-md border border-line bg-white px-2 py-1" title="Bring to front">⬆ Front</button>
              <button type="button" onClick={() => order("back")} className="cursor-pointer rounded-md border border-line bg-white px-2 py-1" title="Send to back">⬇ Back</button>
              <button type="button" onClick={duplicate} className="cursor-pointer rounded-md border border-line bg-white px-2 py-1">⧉ Duplicate</button>
              <button type="button" onClick={remove} className="cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-error">🗑 Delete</button>
            </div>
          )}

          {one && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className={lbl}>X (mm)<input type="number" step="0.5" value={one.x} onChange={(e) => update([one.id], { x: num(e.target.value) }, false)} className={inp} /></label>
                <label className={lbl}>Y (mm)<input type="number" step="0.5" value={one.y} onChange={(e) => update([one.id], { y: num(e.target.value) }, false)} className={inp} /></label>
                <label className={lbl}>Width<input type="number" step="0.5" min={1} value={one.w} onChange={(e) => update([one.id], { w: Math.max(1, num(e.target.value)) }, false)} className={inp} /></label>
                <label className={lbl}>Height<input type="number" step="0.5" min={0.2} value={one.h} onChange={(e) => update([one.id], { h: Math.max(0.2, num(e.target.value)) }, false)} className={inp} /></label>
                <label className={lbl}>Rotate (°)<input type="number" step="1" value={one.rot} onChange={(e) => update([one.id], { rot: num(e.target.value) }, false)} className={inp} /></label>
                <label className={lbl}>Opacity<input type="range" min={0.1} max={1} step={0.05} value={one.opacity ?? 1} onChange={(e) => update([one.id], { opacity: Number(e.target.value) }, false)} /></label>
              </div>

              {one.type === "text" && (
                <div className="grid gap-2 border-t border-line pt-3">
                  <label className={lbl}>Text (use {"{{field}}"} for data)
                    <textarea ref={textRef} rows={4} value={one.text ?? ""} onChange={(e) => update([one.id], { text: e.target.value }, false)} className={`${inp} font-mono`} />
                  </label>
                  <label className={lbl}>Font
                    <select value={one.font} onChange={(e) => update([one.id], { font: e.target.value })} className={inp}>{FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className={lbl}>Size (pt)<input type="number" min={4} max={120} step="0.5" value={one.size} onChange={(e) => update([one.id], { size: num(e.target.value) }, false)} className={inp} /></label>
                    <label className={lbl}>Line<input type="number" min={0.8} max={3} step="0.05" value={one.lh} onChange={(e) => update([one.id], { lh: num(e.target.value) }, false)} className={inp} /></label>
                    <label className={lbl}>Spacing<input type="number" min={-2} max={20} step="0.5" value={one.ls} onChange={(e) => update([one.id], { ls: num(e.target.value) }, false)} className={inp} /></label>
                  </div>
                  <div className="flex flex-wrap gap-1 text-[12px]">
                    <button type="button" onClick={() => update([one.id], { weight: one.weight && one.weight >= 700 ? 400 : 800 })} className={`cursor-pointer rounded-md border px-2.5 py-1 ${one.weight && one.weight >= 700 ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>B</button>
                    <button type="button" onClick={() => update([one.id], { italic: !one.italic })} className={`cursor-pointer rounded-md border px-2.5 py-1 ${one.italic ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>I</button>
                    <button type="button" onClick={() => update([one.id], { underline: !one.underline })} className={`cursor-pointer rounded-md border px-2.5 py-1 ${one.underline ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>U</button>
                    <button type="button" onClick={() => update([one.id], { upper: !one.upper })} className={`cursor-pointer rounded-md border px-2.5 py-1 ${one.upper ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>AA</button>
                    {(["left", "center", "right", "justify"] as const).map((a) => (
                      <button type="button" key={a} onClick={() => update([one.id], { align: a })} className={`cursor-pointer rounded-md border px-2 py-1 ${one.align === a ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>{{ left: "⯇", center: "≡", right: "⯈", justify: "☰" }[a]}</button>
                    ))}
                    {(["top", "middle", "bottom"] as const).map((v) => (
                      <button type="button" key={v} onClick={() => update([one.id], { valign: v })} className={`cursor-pointer rounded-md border px-2 py-1 ${one.valign === v ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>{{ top: "⤒", middle: "↕", bottom: "⤓" }[v]}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={lbl}>Text colour<input type="color" value={(one.color ?? "#111111").slice(0, 7)} onChange={(e) => update([one.id], { color: e.target.value }, false)} className="h-8 w-full" /></label>
                    <label className={lbl}>Background<input type="color" value={one.fill && one.fill.startsWith("#") ? one.fill.slice(0, 7) : "#ffffff"} onChange={(e) => update([one.id], { fill: e.target.value }, false)} className="h-8 w-full" /></label>
                  </div>
                  {one.fill && one.fill !== "transparent" && <button type="button" onClick={() => update([one.id], { fill: "transparent" })} className="cursor-pointer border-0 bg-transparent p-0 text-left text-[12px] text-blue underline">Remove background</button>}
                </div>
              )}

              {(one.type === "rect" || one.type === "ellipse" || one.type === "line") && (
                <div className="grid gap-2 border-t border-line pt-3">
                  {one.type !== "line" && <label className={lbl}>Fill<input type="color" value={one.fill && one.fill.startsWith("#") ? one.fill.slice(0, 7) : "#e5e7eb"} onChange={(e) => update([one.id], { fill: e.target.value }, false)} className="h-8 w-full" /></label>}
                  <label className={lbl}>{one.type === "line" ? "Colour" : "Border colour"}<input type="color" value={one.stroke && one.stroke.startsWith("#") ? one.stroke.slice(0, 7) : "#111111"} onChange={(e) => update([one.id], { stroke: e.target.value }, false)} className="h-8 w-full" /></label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={lbl}>{one.type === "line" ? "Thickness (mm)" : "Border (mm)"}<input type="number" min={0} max={20} step="0.1" value={one.sw ?? 0} onChange={(e) => update([one.id], { sw: num(e.target.value) }, false)} className={inp} /></label>
                    {one.type === "rect" && <label className={lbl}>Corner radius<input type="number" min={0} max={100} step="0.5" value={one.radius ?? 0} onChange={(e) => update([one.id], { radius: num(e.target.value) }, false)} className={inp} /></label>}
                  </div>
                </div>
              )}

              {one.type === "image" && (
                <div className="grid gap-2 border-t border-line pt-3">
                  <label className={lbl}>Image link (https)<input value={one.src ?? ""} onChange={(e) => update([one.id], { src: e.target.value }, false)} placeholder="https://…/logo.png" className={inp} /></label>
                  <label className={lbl}>Fit
                    <select value={one.fit} onChange={(e) => update([one.id], { fit: e.target.value as "cover" | "contain" })} className={inp}><option value="cover">Fill the box</option><option value="contain">Show whole image</option></select>
                  </label>
                  <label className={lbl}>Corner radius<input type="number" min={0} max={100} step="0.5" value={one.radius ?? 0} onChange={(e) => update([one.id], { radius: num(e.target.value) }, false)} className={inp} /></label>
                </div>
              )}

              {(one.type === "photo" || one.type === "logo" || one.type === "qr" || one.type === "signature" || one.type === "seal") && (
                <div className="grid gap-2 border-t border-line pt-3">
                  <p className="m-0 text-[12px] text-muted">{one.type === "photo" ? "The student's photograph is placed here." : one.type === "qr" ? "The student's (or staff member's) attendance QR code is placed here. Scanning it marks attendance." : one.type === "signature" ? "The principal's signature (Settings → Documents) is placed here." : one.type === "seal" ? "The school seal (Settings → Documents) is placed here." : "The school logo (Settings → School) is placed here."}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={lbl}>Corner radius<input type="number" min={0} max={100} step="0.5" value={one.radius ?? 0} onChange={(e) => update([one.id], { radius: num(e.target.value) }, false)} className={inp} /></label>
                    <label className={lbl}>Border (mm)<input type="number" min={0} max={5} step="0.1" value={one.sw ?? 0} onChange={(e) => update([one.id], { sw: num(e.target.value) }, false)} className={inp} /></label>
                  </div>
                  <label className={lbl}>Border colour<input type="color" value={one.stroke && one.stroke.startsWith("#") ? one.stroke.slice(0, 7) : "#ffffff"} onChange={(e) => update([one.id], { stroke: e.target.value }, false)} className="h-8 w-full" /></label>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </form>
  );
}
