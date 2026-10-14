"use client";

import { useEffect, useState } from "react";
import { QrScanner, type ScanResult } from "./QrScanner";

type Info = { name: string; kind: string; school: string | null; today: number };

/** A fixed tablet at the gate: students hold their ID card to the camera (or a USB scanner types the code). */
export function Kiosk({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState("");
  useEffect(() => {
    let dead = false;
    fetch("/api/attendance/punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action: "info" }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); if (!dead) setInfo(j); })
      .catch((e: Error) => !dead && setErr(e.message));
    const t = setInterval(() => setNow(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })), 1000);
    return () => { dead = true; clearInterval(t); };
  }, [token]);

  const onScan = async (code: string): Promise<ScanResult> => {
    const r = await fetch("/api/attendance/punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, result: "error", message: j.error ?? "Something went wrong." };
    return j as ScanResult;
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col gap-4 px-4 py-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[13px] text-muted">{info?.school ?? "School"}</p>
          <h1 className="m-0 text-[24px] font-extrabold text-ink">{info?.name ?? "Attendance"}</h1>
        </div>
        <div className="text-right"><b className="block text-[26px] text-ink">{now}</b><span className="text-[12px] text-muted">{info ? `${info.today} scans today` : ""}</span></div>
      </header>
      {err ? <p role="alert" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[15px] text-[#7a1a12]">{err}</p> : <QrScanner onScan={onScan} big />}
    </div>
  );
}
