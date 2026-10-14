"use client";

import { useMemo, useState } from "react";
import { LiveMap, type MapMarker } from "./LiveMap";

/** Click the map (or use the phone's location) to set latitude / longitude of a stop or the school. Posts `lat` and `lng`. */
export function LocationPicker({ lat, lng, others = [], height = 260, hint }: { lat?: number | null; lng?: number | null; others?: MapMarker[]; height?: number; hint?: string }) {
  const [p, setP] = useState<{ lat: number | null; lng: number | null }>({ lat: lat ?? null, lng: lng ?? null });
  const [msg, setMsg] = useState<string | null>(null);
  const markers = useMemo<MapMarker[]>(() => [...others, ...(p.lat != null && p.lng != null ? [{ id: "pick", kind: "pick" as const, lat: p.lat, lng: p.lng, label: "Selected" }] : [])], [others, p]);
  const num = (v: string) => (v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const here = () => {
    if (!navigator.geolocation) { setMsg("This browser cannot give its location."); return; }
    navigator.geolocation.getCurrentPosition(
      (g) => { setP({ lat: Number(g.coords.latitude.toFixed(6)), lng: Number(g.coords.longitude.toFixed(6)) }); setMsg(null); },
      () => setMsg("Location is blocked. Allow it for this site, or click on the map."), { enableHighAccuracy: true, timeout: 15000 });
  };
  return (
    <div className="flex flex-col gap-2">
      <LiveMap markers={markers} height={height} fitKey={p.lat == null ? `x${others.length}` : undefined} focus={p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng, zoom: 16 } : null}
        onPick={(a, b) => setP({ lat: a, lng: b })} />
      <div className="flex flex-wrap items-end gap-2 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink">Latitude
          <input name="lat" type="number" step="0.000001" min={-90} max={90} value={p.lat ?? ""} onChange={(e) => setP({ ...p, lat: num(e.target.value) })} className="input !min-h-9 !w-36 !py-1 font-normal" />
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink">Longitude
          <input name="lng" type="number" step="0.000001" min={-180} max={180} value={p.lng ?? ""} onChange={(e) => setP({ ...p, lng: num(e.target.value) })} className="input !min-h-9 !w-36 !py-1 font-normal" />
        </label>
        <button type="button" onClick={here} className="btn btn-sm btn-secondary cursor-pointer">Use my location</button>
        {p.lat != null && <button type="button" onClick={() => setP({ lat: null, lng: null })} className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Clear</button>}
        <span className="text-muted">{hint ?? "Click on the map to place the pin."}</span>
        {msg && <span className="text-error">{msg}</span>}
      </div>
    </div>
  );
}
