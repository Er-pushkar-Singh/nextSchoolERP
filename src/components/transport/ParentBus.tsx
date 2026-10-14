"use client";

import { useEffect, useMemo, useState } from "react";
import { LiveMap, type MapMarker } from "./LiveMap";

type Stop = { id: string; name: string; seq: number; lat: number | null; lng: number | null; pickup: string | null; drop: string | null; mine: boolean; visited: boolean };
type Data = {
  allocated: boolean; state?: string; student_trip?: string;
  vehicle?: { reg_no: string; driver: string | null; phone: string | null; attendant: string | null; attendant_phone: string | null };
  route?: string; my_stop?: { name: string; lat: number | null; lng: number | null; pickup: string | null; drop: string | null };
  school?: { name: string; lat: number | null; lng: number | null };
  trip?: { kind: string; started_at: string } | null;
  position?: { lat: number; lng: number; speed: number | null; heading: number | null; age_s: number } | null;
  distance_km?: number | null; eta_min?: number | null; stops?: Stop[]; error?: string;
};

const t12 = (t: string | null | undefined) => { if (!t) return "—"; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const STATE: Record<string, { text: string; tone: string }> = {
  not_started: { text: "Bus has not started yet", tone: "#64748b" }, starting: { text: "Trip started — waiting for the location", tone: "#d97706" },
  on_the_way: { text: "On the way", tone: "#2563eb" }, near: { text: "Almost there", tone: "#16a34a" }, reached: { text: "Bus has reached the stop", tone: "#16a34a" },
  offline: { text: "Location is not updating", tone: "#dc2626" },
};

export function ParentBus({ token, studentName, backHref }: { token: string; studentName: string; backHref: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [fail, setFail] = useState(false);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch(`/api/transport/child?token=${token}`, { cache: "no-store" });
        const j = (await r.json()) as Data;
        if (!dead) { setD(r.ok ? j : { allocated: false, error: j.error }); setFail(!r.ok); }
      } catch { if (!dead) setFail(true); }
      if (!dead) timer = setTimeout(load, document.hidden ? 15000 : 5000);
    };
    void load();
    return () => { dead = true; clearTimeout(timer); };
  }, [token]);

  const stops = useMemo(() => (d?.stops ?? []).filter((s) => s.lat !== null && s.lng !== null), [d]);
  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    for (const s of stops) if (!s.mine) out.push({ id: `s${s.id}`, kind: "stop", lat: s.lat!, lng: s.lng!, seq: s.seq, label: s.name, muted: s.visited });
    if (d?.my_stop?.lat != null && d.my_stop.lng != null) out.push({ id: "home", kind: "home", lat: d.my_stop.lat, lng: d.my_stop.lng, label: `${studentName}'s stop — ${d.my_stop.name}` });
    if (d?.school?.lat != null && d.school.lng != null) out.push({ id: "school", kind: "school", lat: d.school.lat, lng: d.school.lng, label: d.school.name });
    if (d?.position) out.push({ id: "bus", kind: "bus", lat: d.position.lat, lng: d.position.lng, heading: d.position.heading, label: d.vehicle?.reg_no, color: "#2563eb", pulse: true });
    return out;
  }, [d, stops, studentName]);
  const line = useMemo(() => stops.map((s) => [s.lat!, s.lng!] as [number, number]), [stops]);

  if (!d) return <div className="p-8 text-center text-[15px] text-muted">{fail ? "Could not load. Retrying…" : "Loading the map…"}</div>;
  if (!d.allocated) return (
    <div className="mx-auto max-w-md p-6 text-center">
      <p className="text-[16px] text-ink">{d.error ? "Bus tracking is not available." : `${studentName} is not on school transport.`}</p>
      <a href={backHref} className="text-[14px]">← Back</a>
    </div>
  );

  const st = STATE[d.state ?? "not_started"] ?? STATE.not_started;
  const scheduled = d.student_trip === "drop" || d.trip?.kind === "drop" ? d.my_stop?.drop : d.my_stop?.pickup;
  const focus = follow && d.position ? { lat: d.position.lat, lng: d.position.lng, zoom: 15 } : null;

  return (
    <div className="relative mx-auto flex min-h-[100dvh] max-w-2xl flex-col">
      <div className="absolute top-3 right-3 left-3 z-[500] flex items-center justify-between gap-2">
        <a href={backHref} className="rounded-full bg-white px-3 py-2 text-[14px] font-semibold text-ink no-underline shadow-md">← Back</a>
        <button onClick={() => setFollow((f) => !f)} className={`cursor-pointer rounded-full border-0 px-3 py-2 text-[13px] font-semibold shadow-md ${follow ? "bg-[#2563eb] text-white" : "bg-white text-ink"}`}>{follow ? "Following bus" : "Follow bus"}</button>
      </div>
      <LiveMap markers={markers} line={line} fitKey={d.position ? undefined : `${d.route}-${markers.length}`} focus={focus} height="62dvh" className="!rounded-none !border-0" />

      <section className="relative z-[500] -mt-5 flex flex-col gap-3 rounded-t-[22px] bg-white px-4 pt-4 pb-6 shadow-[0_-8px_24px_rgba(15,23,42,.15)]">
        <div className="mx-auto h-1 w-10 rounded-full bg-[#d6dbe3]" />
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="inline-block rounded-full px-2.5 py-0.5 text-[12px] font-bold text-white" style={{ background: st.tone }}>{st.text}</span>
            <p className="mt-2 mb-0 text-[26px] leading-tight font-extrabold text-ink">
              {d.state === "reached" ? "Bus is at the stop" : d.eta_min != null && d.state && ["on_the_way", "near"].includes(d.state) ? `Arriving in ${d.eta_min} min` : d.trip ? "Bus is on its trip" : `Scheduled ${t12(scheduled)}`}
            </p>
            <p className="m-0 text-[13px] text-muted">
              {d.distance_km != null && d.position ? `${d.distance_km} km from ${d.my_stop?.name}` : `${d.my_stop?.name ?? ""}${scheduled ? ` · ${t12(scheduled)}` : ""}`}
              {d.position?.speed ? ` · ${Math.round(d.position.speed)} km/h` : ""}
              {d.position && d.position.age_s > 20 ? ` · updated ${d.position.age_s}s ago` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface p-3">
          <div className="min-w-0">
            <p className="m-0 text-[12px] text-muted">{d.route}</p>
            <p className="m-0 truncate text-[15px] font-bold text-ink">{d.vehicle?.reg_no}</p>
            <p className="m-0 truncate text-[13px] text-ink">{d.vehicle?.driver ?? "Driver"}</p>
          </div>
          <span className="flex gap-2">
            {d.vehicle?.phone && <a href={`tel:${d.vehicle.phone}`} className="rounded-full bg-[#16a34a] px-4 py-2 text-[14px] font-bold text-white no-underline">📞 Call driver</a>}
          </span>
        </div>

        {(d.stops ?? []).length > 0 && (
          <ol className="m-0 list-none p-0">
            {(d.stops ?? []).map((s) => (
              <li key={s.id} className={`flex items-center gap-3 border-t border-line py-2 first:border-0 ${s.mine ? "font-bold" : ""}`}>
                <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${s.visited ? "bg-[#16a34a] text-white" : s.mine ? "bg-[#2563eb] text-white" : "bg-[#e5e8ee] text-muted"}`}>{s.visited ? "✓" : s.seq}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{s.name}{s.mine && <span className="ml-2 rounded bg-blue-tint px-1.5 text-[11px] text-blue-strong">{studentName}</span>}</span>
                <span className="text-[13px] text-muted">{t12(d.student_trip === "drop" ? s.drop : s.pickup)}</span>
              </li>
            ))}
          </ol>
        )}
        {d.school?.lat == null && <p className="m-0 text-[12px] text-muted">The school has not set its location yet, so the destination pin is hidden.</p>}
      </section>
    </div>
  );
}
