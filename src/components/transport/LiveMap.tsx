"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type * as Lf from "leaflet";

export type MapMarker = {
  id: string; lat: number; lng: number; kind: "bus" | "stop" | "school" | "home" | "pick";
  label?: string; heading?: number | null; color?: string; muted?: boolean; seq?: number; pulse?: boolean;
};

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function iconHtml(m: MapMarker) {
  const c = m.color ?? "#2563eb";
  if (m.kind === "bus") {
    return `<div class="tm-bus" style="--c:${c}"><div class="tm-bus-arrow" style="transform:rotate(${m.heading ?? 0}deg)"></div><div class="tm-bus-dot">🚌</div>${m.pulse ? '<div class="tm-pulse"></div>' : ""}</div>`;
  }
  if (m.kind === "school") return `<div class="tm-pin" style="--c:#7c3aed"><span>🏫</span></div>`;
  if (m.kind === "home") return `<div class="tm-pin" style="--c:#16a34a"><span>🏠</span></div>`;
  if (m.kind === "pick") return `<div class="tm-pin" style="--c:#dc2626"><span>📍</span></div>`;
  return `<div class="tm-stop${m.muted ? " tm-stop-muted" : ""}" style="--c:${c}">${m.seq ?? ""}</div>`;
}

/**
 * Leaflet map (OpenStreetMap tiles). Markers are keyed by id and glide to new positions, so a bus moves like a cab.
 * `line` draws a route / trace; `fit` re-fits the view when its key changes; `onPick` makes the map clickable.
 */
export function LiveMap({ markers, line, lineColor = "#2563eb", trace, focus, fitKey, height = 420, onPick, onSelect, className = "" }: {
  markers: MapMarker[]; line?: [number, number][]; lineColor?: string; trace?: [number, number][]; focus?: { lat: number; lng: number; zoom?: number } | null;
  fitKey?: string; height?: number | string; onPick?: (lat: number, lng: number) => void; onSelect?: (id: string) => void; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<{
    L: typeof Lf | null; map: Lf.Map | null; layer: Lf.LayerGroup | null; markers: Map<string, Lf.Marker>; poly: Lf.Polyline | null; tr: Lf.Polyline | null; fitted: string | null;
    pos: Map<string, { lat: number; lng: number }>; raf: number | null;
  }>({ L: null, map: null, layer: null, markers: new Map(), poly: null, tr: null, fitted: null, pos: new Map(), raf: null });
  const cb = useRef({ onPick, onSelect });
  useEffect(() => { cb.current = { onPick, onSelect }; });
  const latest = useRef({ markers, line, trace, focus, fitKey, lineColor });
  useEffect(() => { latest.current = { markers, line, trace, focus, fitKey, lineColor }; });

  const sync = () => {
    const s = state.current;
    const { L, map, layer } = s;
    if (!L || !map || !layer) return;
    const { markers: ms, line: ln, trace: tr, focus: fo, fitKey: fk, lineColor: lc } = latest.current;
    const seen = new Set<string>();
    for (const m of ms) {
      seen.add(m.id);
      const html = iconHtml(m);
      const size = m.kind === "stop" ? 24 : m.kind === "bus" ? 44 : 34;
      const existing = s.markers.get(m.id);
      if (!existing) {
        const mk = L.marker([m.lat, m.lng], { icon: L.divIcon({ html, className: "tm-icon", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), title: m.label, zIndexOffset: m.kind === "bus" ? 1000 : 0 });
        if (m.label) mk.bindTooltip(esc(m.label), { direction: "top", offset: [0, -size / 2] });
        mk.on("click", () => cb.current.onSelect?.(m.id));
        mk.addTo(layer);
        s.markers.set(m.id, mk);
        s.pos.set(m.id, { lat: m.lat, lng: m.lng });
      } else {
        existing.setIcon(L.divIcon({ html, className: "tm-icon", iconSize: [size, size], iconAnchor: [size / 2, size / 2] }));
        if (m.label) existing.setTooltipContent(esc(m.label));
        const from = s.pos.get(m.id) ?? { lat: m.lat, lng: m.lng };
        if (from.lat !== m.lat || from.lng !== m.lng) {
          const t0 = performance.now(), dur = 1800;
          const step = (now: number) => {
            const k = Math.min(1, (now - t0) / dur);
            existing.setLatLng([from.lat + (m.lat - from.lat) * k, from.lng + (m.lng - from.lng) * k]);
            if (k < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          s.pos.set(m.id, { lat: m.lat, lng: m.lng });
        }
      }
    }
    for (const [id, mk] of s.markers) if (!seen.has(id)) { mk.remove(); s.markers.delete(id); s.pos.delete(id); }

    s.poly?.remove(); s.poly = null;
    if (ln && ln.length > 1) s.poly = L.polyline(ln, { color: lc, weight: 4, opacity: 0.55, dashArray: "8 8" }).addTo(layer);
    s.tr?.remove(); s.tr = null;
    if (tr && tr.length > 1) s.tr = L.polyline(tr, { color: "#16a34a", weight: 5, opacity: 0.8 }).addTo(layer);

    if (fo) map.flyTo([fo.lat, fo.lng], fo.zoom ?? Math.max(map.getZoom(), 15), { duration: 0.8 });
    else if (fk && s.fitted !== fk) {
      const pts: [number, number][] = [...ms.map((m) => [m.lat, m.lng] as [number, number]), ...(ln ?? [])];
      if (pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 }); s.fitted = fk; }
    }
  };

  useEffect(() => {
    let dead = false;
    const s = state.current;
    (async () => {
      const mod = await import("leaflet");
      const L = ((mod as unknown as { default?: typeof Lf }).default ?? mod) as typeof Lf;
      if (dead || !el.current || s.map) return;
      s.L = L;
      const map = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([26.85, 80.95], 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
      s.map = map; s.layer = L.layerGroup().addTo(map);
      map.on("click", (e: Lf.LeafletMouseEvent) => cb.current.onPick?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
      sync();
    })();
    return () => { dead = true; s.map?.remove(); s.map = null; s.layer = null; s.markers.clear(); s.pos.clear(); s.poly = null; s.tr = null; s.fitted = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { sync(); });

  return (
    <>
      <style>{`
        .tm-icon{background:transparent;border:0}
        .tm-bus{position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center}
        .tm-bus-dot{width:34px;height:34px;border-radius:50%;background:var(--c);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:17px;position:relative;z-index:2}
        .tm-bus-arrow{position:absolute;inset:0;z-index:1}
        .tm-bus-arrow:before{content:"";position:absolute;left:50%;top:-2px;margin-left:-7px;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:12px solid var(--c)}
        .tm-pulse{position:absolute;inset:3px;border-radius:50%;border:2px solid var(--c);animation:tmpulse 1.6s ease-out infinite;z-index:0}
        @keyframes tmpulse{0%{transform:scale(1);opacity:.8}100%{transform:scale(2);opacity:0}}
        .tm-pin{width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--c);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);border:2px solid #fff}
        .tm-pin>*{transform:rotate(45deg)}
        .tm-stop{width:24px;height:24px;border-radius:50%;background:#fff;border:3px solid var(--c);color:#111;font:700 11px/18px system-ui;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.25)}
        .tm-stop-muted{opacity:.55}
      `}</style>
      <div ref={el} className={`z-0 w-full overflow-hidden rounded-[14px] border border-line ${className}`} style={{ height }} role="application" aria-label="Map" />
    </>
  );
}
