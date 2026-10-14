"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LiveMap, type MapMarker } from "./LiveMap";

type V = { vehicle_id: string; reg_no: string; kind: string; driver_name: string | null; driver_phone: string | null; route_id: string | null; route_name: string | null;
  trip_id: string | null; trip_kind: string | null; trip_started: string | null; lat: number | null; lng: number | null; speed_kmh: number | null; heading: number | null;
  updated_at: string | null; age_s: number | null; state: "idle" | "waiting" | "offline" | "stopped" | "moving"; riders: number };
type Stop = { id: string; route_id: string; name: string; sort: number; lat: number; lng: number };
type Payload = { vehicles: V[]; stops: Stop[]; school: { lat: number | null; lng: number | null; name: string } | null };

const STATE: Record<string, { label: string; color: string }> = {
  moving: { label: "Moving", color: "#16a34a" }, stopped: { label: "Stopped", color: "#d97706" }, offline: { label: "No signal", color: "#dc2626" },
  waiting: { label: "Starting", color: "#2563eb" }, idle: { label: "Not on a trip", color: "#94a3b8" },
};
const PAGE = 8;
const ROUTE_COLORS = ["#2563eb", "#db2777", "#ea580c", "#0d9488", "#7c3aed", "#ca8a04", "#0891b2", "#be123c"];

/** Office / principal: all buses on one map, with a filterable, paged list. Polls every 5 seconds. */
export function LiveBoard() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [route, setRoute] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<{ trip: string; points: [number, number][] } | null>(null);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch("/api/transport/live", { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 401 || r.redirected ? "Not allowed." : "Could not load.");
        const j = (await r.json()) as Payload;
        if (!dead) { setData(j); setErr(null); }
      } catch (e) { if (!dead) setErr((e as Error).message); }
      if (!dead) timer = setTimeout(load, document.hidden ? 20000 : 5000);
    };
    void load();
    return () => { dead = true; clearTimeout(timer); };
  }, []);

  const vehicles = useMemo(() => data?.vehicles ?? [], [data]);
  const routes = useMemo(() => [...new Map(vehicles.filter((v) => v.route_id).map((v) => [v.route_id!, v.route_name!])).entries()], [vehicles]);
  const colorOf = useMemo(() => new Map(routes.map(([id], i) => [id, ROUTE_COLORS[i % ROUTE_COLORS.length]])), [routes]);
  const filtered = vehicles.filter((v) =>
    (!route || v.route_id === route) && (!state || (state === "live" ? v.state === "moving" || v.state === "stopped" : v.state === state))
    && (!q || `${v.reg_no} ${v.driver_name ?? ""} ${v.route_name ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = filtered.slice((cur - 1) * PAGE, cur * PAGE);
  const selV = vehicles.find((v) => v.vehicle_id === sel) ?? null;

  const tripId = selV?.trip_id ?? null;
  const stamp = selV?.updated_at ? Math.floor(new Date(selV.updated_at).getTime() / 30000) : 0;
  useEffect(() => {
    if (!tripId) return;
    let dead = false;
    fetch(`/api/transport/trace?trip=${tripId}`, { cache: "no-store" }).then((r) => r.json()).then((j) => !dead && setTraceData({ trip: tripId, points: (j.points ?? []) as [number, number][] })).catch(() => null);
    return () => { dead = true; };
  }, [tripId, stamp]);
  const trace = traceData && traceData.trip === tripId ? traceData.points : null;

  const markers: MapMarker[] = (() => {
    const out: MapMarker[] = [];
    for (const v of filtered) {
      if (v.lat == null || v.lng == null || v.state === "idle") continue;
      out.push({ id: `v${v.vehicle_id}`, kind: "bus", lat: Number(v.lat), lng: Number(v.lng), heading: v.heading, color: STATE[v.state].color, label: `${v.reg_no}${v.route_name ? ` · ${v.route_name}` : ""}`, pulse: v.state === "moving" });
    }
    const routeIds = new Set(selV ? [selV.route_id] : filtered.map((v) => v.route_id));
    for (const s of data?.stops ?? []) if (routeIds.has(s.route_id) && (selV || route)) out.push({ id: `s${s.id}`, kind: "stop", lat: Number(s.lat), lng: Number(s.lng), seq: s.sort, label: s.name, color: colorOf.get(s.route_id) });
    if (data?.school?.lat != null && data.school.lng != null) out.push({ id: "school", kind: "school", lat: Number(data.school.lat), lng: Number(data.school.lng), label: data.school.name });
    return out;
  })();
  const line = selV?.route_id ? (data?.stops ?? []).filter((s) => s.route_id === selV.route_id).map((s) => [Number(s.lat), Number(s.lng)] as [number, number]) : undefined;
  const focus = selV && auto && selV.lat != null && selV.lng != null ? { lat: Number(selV.lat), lng: Number(selV.lng), zoom: 15 } : null;
  const counts = { live: vehicles.filter((v) => v.state === "moving" || v.state === "stopped").length, offline: vehicles.filter((v) => v.state === "offline").length, idle: vehicles.filter((v) => v.state === "idle").length };

  const sel_ = "input !min-h-9 !w-auto !py-1 text-[13px]";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3 text-center text-[13px]">
        <div className="rounded-[12px] border border-line bg-white p-3"><b className="block text-[22px] text-[#16a34a]">{counts.live}</b>on the road</div>
        <div className="rounded-[12px] border border-line bg-white p-3"><b className="block text-[22px] text-[#dc2626]">{counts.offline}</b>no signal</div>
        <div className="rounded-[12px] border border-line bg-white p-3"><b className="block text-[22px] text-muted">{counts.idle}</b>not on a trip</div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3">
          <div className="flex flex-wrap gap-2">
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Vehicle, driver, route" aria-label="Search vehicles" className={`${sel_} !w-full`} />
            <select value={route} onChange={(e) => { setRoute(e.target.value); setPage(1); }} aria-label="Route" className={sel_}>
              <option value="">All routes</option>{routes.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
            <select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} aria-label="Status" className={sel_}>
              <option value="">Any status</option><option value="live">On the road</option><option value="offline">No signal</option><option value="idle">Not on a trip</option>
            </select>
          </div>
          {err && <p className="m-0 text-[12px] text-error">{err}</p>}
          {!data && !err && <p className="m-0 text-[13px] text-muted">Loading…</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {shown.map((v) => {
              const s = STATE[v.state];
              return (
                <li key={v.vehicle_id}>
                  <button onClick={() => { setSel(v.vehicle_id === sel ? null : v.vehicle_id); setAuto(true); }}
                    className={`w-full cursor-pointer rounded-[12px] border p-3 text-left ${sel === v.vehicle_id ? "border-blue bg-blue-tint" : "border-line bg-white"}`}>
                    <span className="flex items-center justify-between gap-2">
                      <b className="text-[14px] text-ink">{v.reg_no}</b>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: s.color }}>{s.label}</span>
                    </span>
                    <span className="block text-[12px] text-muted">{v.route_name ?? "No route"} · {v.riders} students</span>
                    <span className="block text-[12px] text-muted">
                      {v.trip_kind ? `${v.trip_kind === "pickup" ? "Pickup" : "Drop"} trip` : "Idle"}
                      {v.speed_kmh != null && v.state !== "idle" ? ` · ${Math.round(Number(v.speed_kmh))} km/h` : ""}
                      {v.age_s != null && v.state !== "idle" ? ` · ${v.age_s < 60 ? `${v.age_s}s` : `${Math.round(v.age_s / 60)} min`} ago` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
            {data && shown.length === 0 && <li className="text-[13px] text-muted">No vehicle matches.</li>}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between text-[13px]">
              <button disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="cursor-pointer rounded-md border border-line bg-white px-2 py-1 disabled:opacity-40">← Prev</button>
              <span className="text-muted">Page {cur} of {pages} · {filtered.length} vehicles</span>
              <button disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="cursor-pointer rounded-md border border-line bg-white px-2 py-1 disabled:opacity-40">Next →</button>
            </div>
          )}
        </aside>

        <div className="flex flex-col gap-2">
          <LiveMap markers={markers} line={line} lineColor={selV?.route_id ? colorOf.get(selV.route_id) : undefined} trace={trace ?? undefined} focus={focus}
            fitKey={`${route}-${vehicles.length}-${data?.school?.lat ?? ""}`} height="68vh" onSelect={(id) => id.startsWith("v") && setSel(id.slice(1))} />
          {selV && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-white p-3 text-[14px]">
              <span><b className="text-ink">{selV.reg_no}</b> · {selV.route_name ?? "No route"} · {selV.driver_name ?? "Driver"}</span>
              <span className="flex flex-wrap items-center gap-3">
                {selV.driver_phone && <a href={`tel:${selV.driver_phone}`}>📞 {selV.driver_phone}</a>}
                {selV.route_id && <Link href={`/app/transport/routes/${selV.route_id}`}>Route</Link>}
                <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Follow</label>
              </span>
            </div>
          )}
          <p className="m-0 text-[12px] text-muted">Positions come from the driver&apos;s phone every few seconds. A green line is the path travelled on the current trip.</p>
        </div>
      </div>
    </div>
  );
}
