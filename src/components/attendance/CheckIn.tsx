"use client";

import { useState } from "react";
import { staffCheckIn } from "@/app/app/_actions/attendance";
import type { ScanResult } from "./QrScanner";

/** A staff member's own phone: share the location once, the database checks it is within the school's radius. */
export function CheckIn() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ScanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const go = () => {
    setErr(null); setRes(null);
    if (!("geolocation" in navigator)) { setErr("This phone cannot share its location."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try { setRes(await staffCheckIn(p.coords.latitude, p.coords.longitude)); } catch (e) { setErr((e as Error).message); }
        setBusy(false);
      },
      (e) => { setBusy(false); setErr(e.code === 1 ? "Location is blocked. Allow location for this page in the browser settings." : "Could not get your location. Try again outdoors."); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };

  const good = res?.ok;
  return (
    <div className="flex flex-col gap-4">
      <button onClick={go} disabled={busy} className="cursor-pointer rounded-[16px] border-0 bg-[#2563eb] px-5 py-5 text-[20px] font-extrabold text-white disabled:opacity-60">
        {busy ? "Checking your location…" : "I have reached school"}
      </button>
      {err && <p role="alert" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">{err}</p>}
      {res && (
        <div role="status" className={`rounded-[16px] border-2 p-4 ${good ? "border-[#16a34a] bg-[#f0fdf4]" : "border-[#dc2626] bg-[#fef2f2]"}`}>
          <p className="m-0 text-[20px] font-extrabold text-ink">
            {good ? (res.result === "already" ? "Already checked in" : res.result === "out" ? "Out-time recorded" : res.late ? "Checked in — late" : "Checked in") : "Not checked in"}
          </p>
          <p className="m-0 mt-1 text-[14px] text-muted">{good ? `${res.time ?? ""}${res.distance_m != null ? ` · ${res.distance_m} m from school` : ""}` : res.message}</p>
        </div>
      )}
      <p className="m-0 text-[12px] text-muted">Your location is read only when you tap the button and is not stored — only the time and the fact that you were at school.</p>
    </div>
  );
}
