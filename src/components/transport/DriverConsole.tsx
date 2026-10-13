"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = { vehicle: string; driver: string | null; route: string | null; school: string | null; trip: { id: string; kind: string; started_at: string } | null; last_ping: string | null };

/** The driver's phone: start a trip, keep the page open, location goes to the school every few seconds. */
export function DriverConsole({ token }: { token: string }) {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ at: number; n: number; acc: number | null } | null>(null);
  const [gps, setGps] = useState<"idle" | "waiting" | "ok" | "denied">("idle");
  const [now, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const watch = useRef<number | null>(null);
  const last = useRef(0);
  const pos = useRef<GeolocationPosition | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const count = useRef(0);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/transport/driver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "Something went wrong.");
    return j;
  }, [token]);

  const send = useCallback(async (p: GeolocationPosition) => {
    try {
      await call({ action: "ping", lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed !== null ? Math.round(p.coords.speed * 3.6 * 10) / 10 : null,
        heading: p.coords.heading, accuracy: p.coords.accuracy });
      count.current += 1;
      setSent({ at: Date.now(), n: count.current, acc: p.coords.accuracy ?? null });
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [call]);

  const stopWatch = useCallback(() => {
    if (watch.current !== null) { navigator.geolocation.clearWatch(watch.current); watch.current = null; }
    wake.current?.release().catch(() => null); wake.current = null;
    setGps("idle");
  }, []);

  const startWatch = useCallback(async () => {
    if (!("geolocation" in navigator)) { setErr("This phone cannot share its location."); return; }
    setGps("waiting");
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      wake.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch { /* optional */ }
    watch.current = navigator.geolocation.watchPosition(
      (p) => { pos.current = p; setGps("ok"); if (Date.now() - last.current >= 4000) { last.current = Date.now(); void send(p); } },
      (e) => { setGps(e.code === 1 ? "denied" : "waiting"); if (e.code === 1) setErr("Location is blocked. Allow location for this page in the browser settings, then reload."); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  }, [send]);

  // first load: who am I, and is a trip already running (the page was reopened)?
  useEffect(() => {
    let dead = false;
    call({ action: "status" }).then((s: Status) => { if (!dead) { setSt(s); if (s.trip) void startWatch(); } }).catch((e: Error) => !dead && setErr(e.message));
    return () => { dead = true; stopWatch(); };
  }, [call, startWatch, stopWatch]);

  // keep the parent's map alive when the bus is standing still
  useEffect(() => {
    if (!st?.trip) return;
    const t = setInterval(() => { if (pos.current && Date.now() - last.current >= 15000) { last.current = Date.now(); void send(pos.current); } }, 5000);
    return () => clearInterval(t);
  }, [st?.trip, send]);

  const start = async (kind: "pickup" | "drop") => {
    setErr(null);
    try {
      await call({ action: "start", kind });
      count.current = 0; setSent(null);
      setSt(await call({ action: "status" }));
      await startWatch();
    } catch (e) { setErr((e as Error).message); }
  };
  const end = async () => {
    try { await call({ action: "end" }); stopWatch(); setSt(await call({ action: "status" })); setSent(null); } catch (e) { setErr((e as Error).message); }
  };

  const running = Boolean(st?.trip);
  const ago = sent && now ? Math.max(0, Math.round((now - sent.at) / 1000)) : 0;

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 px-4 py-6">
      <header className="text-center">
        <p className="m-0 text-[13px] text-muted">{st?.school ?? "School bus"}</p>
        <h1 className="m-0 text-[24px] font-extrabold text-ink">{st?.vehicle ?? "Driver"}</h1>
        <p className="m-0 text-[14px] text-muted">{st?.route ? `Route: ${st.route}` : "No route is assigned to this vehicle yet"}{st?.driver ? ` · ${st.driver}` : ""}</p>
      </header>

      <section className={`rounded-[18px] border-2 p-5 text-center ${running ? "border-[#16a34a] bg-[#f0fdf4]" : "border-line bg-white"}`}>
        {running ? (
          <>
            <p className="m-0 text-[13px] font-semibold uppercase tracking-wide text-[#15803d]">Trip running · {st!.trip!.kind === "pickup" ? "Morning pickup" : "Evening drop"}</p>
            <p className="my-3 text-[34px] font-extrabold text-ink">{gps === "ok" ? "Sharing location" : gps === "denied" ? "Location blocked" : "Finding GPS…"}</p>
            <p className="m-0 text-[14px] text-muted">
              {sent ? `Last sent ${ago}s ago · ${sent.n} updates${sent.acc ? ` · accuracy ${Math.round(sent.acc)} m` : ""}` : "Waiting for the first location…"}
            </p>
            <button onClick={end} className="mt-5 w-full cursor-pointer rounded-[14px] border-0 bg-[#dc2626] px-4 py-4 text-[18px] font-bold text-white">End trip</button>
            <p className="mt-3 mb-0 text-[12px] text-muted">Keep this page open and the screen on. Parents and the school see the bus live.</p>
          </>
        ) : (
          <>
            <p className="m-0 text-[15px] text-ink">Choose the trip you are starting.</p>
            <button onClick={() => start("pickup")} disabled={!st} className="mt-4 w-full cursor-pointer rounded-[14px] border-0 bg-[#2563eb] px-4 py-4 text-[18px] font-bold text-white disabled:opacity-50">Start morning pickup</button>
            <button onClick={() => start("drop")} disabled={!st} className="mt-3 w-full cursor-pointer rounded-[14px] border-0 bg-[#7c3aed] px-4 py-4 text-[18px] font-bold text-white disabled:opacity-50">Start evening drop</button>
          </>
        )}
      </section>

      {err && <p role="alert" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">{err}</p>}
      <p className="m-0 text-center text-[12px] text-muted">Your phone shares its location only while a trip is running. Do not share this link with anyone.</p>
    </div>
  );
}
