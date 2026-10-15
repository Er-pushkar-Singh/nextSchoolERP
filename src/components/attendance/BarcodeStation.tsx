"use client";

import { useEffect, useRef, useState } from "react";
import { scanBarcode, type ScanResult } from "@/app/app/_actions/attendance-scan";

type Feed = { at: string; name: string | null; class_name: string | null; result: string; status: string | null };
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

const TONE: Record<string, string> = {
  in: "border-[#86efac] bg-[#f0fdf4] text-[#14532d]", late: "border-[#fcd34d] bg-[#fffbeb] text-[#78350f]", out: "border-[#93c5fd] bg-[#eff6ff] text-[#1e3a8a]",
  already: "border-line bg-[#f8fafc] text-body", bad: "border-[#fca5a5] bg-[#fef2f2] text-[#7f1d1d]",
};
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });

function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = ok ? 1046 : 220; o.type = ok ? "sine" : "square"; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.4));
  } catch { /* no sound */ }
}

/**
 * The gate station. A USB / Bluetooth barcode scanner works like a keyboard: it types the card code and presses Enter, so the
 * input box keeps the focus all the time. The camera (where the browser can read barcodes) is the fallback.
 */
export function BarcodeStation({ feed: initial, strength, present: present0 }: { feed: Feed[]; strength: number; present: number }) {
  const [code, setCode] = useState("");
  const [last, setLast] = useState<ScanResult | null>(null);
  const [feed, setFeed] = useState<Feed[]>(initial);
  const [present, setPresent] = useState(present0);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const recent = useRef<Map<string, number>>(new Map());

  const submit = async (raw: string) => {
    const c = raw.trim();
    if (!c || busy) return;
    // a camera sees the same card many times a second: ignore repeats within 4 seconds
    const seen = recent.current.get(c);
    if (seen && Date.now() - seen < 4000) return;
    recent.current.set(c, Date.now());
    setBusy(true);
    const r = await scanBarcode(c).catch(() => ({ ok: false, result: "error", message: "Network problem — try again.", at: new Date().toISOString() }) as ScanResult);
    setBusy(false);
    setLast(r);
    setCode("");
    beep(r.ok && r.result !== "already");
    if (r.ok) {
      if (r.result === "in" && r.kind === "student") setPresent((p) => p + 1);
      setFeed((f) => [{ at: r.at, name: r.name ?? null, class_name: r.class ?? null, result: r.result, status: r.status ?? null }, ...f].slice(0, 25));
    }
    input.current?.focus();
  };

  // keep the cursor in the box (a scanner types wherever the focus is)
  useEffect(() => {
    const t = setInterval(() => { if (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "SELECT" && !document.querySelector("dialog[open]")) input.current?.focus(); }, 1500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!camera) return;
    let stop = false, stream: MediaStream | null = null, timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      if (!BD) { setCamError("This browser cannot read barcodes with the camera — use Chrome on Android / desktop, or a USB scanner."); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new BD({ formats: ["code_128", "qr_code", "code_39", "ean_13"] });
        const loop = async () => {
          if (stop || !video.current) return;
          try { const found = await det.detect(video.current); if (found[0]?.rawValue) await submit(found[0].rawValue); } catch { /* frame not ready */ }
          timer = setTimeout(loop, 250);
        };
        loop();
      } catch { setCamError("The camera could not be opened. Allow camera access, or use a USB scanner."); }
    })();
    return () => { stop = true; if (timer) clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const tone = !last ? "already" : !last.ok ? "bad" : last.result === "out" ? "out" : last.result === "already" ? "already" : last.late ? "late" : "in";
  const pct = strength ? Math.round((100 * present) / strength) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-3">
        <form onSubmit={(e) => { e.preventDefault(); submit(code); }} className="flex gap-2">
          <input ref={input} value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off" inputMode="text" aria-label="Scanned code"
            placeholder="Scan an ID card barcode (or type the admission no.) and press Enter" className="input !min-h-14 flex-1 !py-3 text-[18px] font-mono" />
          <button className="btn btn-primary cursor-pointer border-0" disabled={busy}>{busy ? "…" : "Mark"}</button>
        </form>
        <div className={`flex min-h-[150px] items-center gap-4 rounded-[16px] border-2 p-4 transition ${TONE[tone]}`} aria-live="polite">
          {last?.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={last.photo} alt="" className="h-28 w-22 shrink-0 rounded-lg border border-white object-cover shadow" />
          ) : <div className="flex h-28 w-22 shrink-0 items-center justify-center rounded-lg bg-white/70 text-[36px]">{!last ? "▮▯▮" : last.ok ? "✓" : "✕"}</div>}
          <div className="min-w-0">
            {!last ? <p className="m-0 text-[16px] font-semibold">Ready. Scan the first card.</p> : !last.ok ? (
              <><p className="m-0 text-[20px] font-extrabold">Not marked</p><p className="m-0 mt-1 text-[15px]">{last.message ?? "Unknown card."}</p></>
            ) : (
              <>
                <p className="m-0 truncate text-[24px] leading-tight font-extrabold">{last.name}</p>
                <p className="m-0 mt-0.5 text-[15px]">{last.kind === "staff" ? last.class ?? "Staff" : `Class ${last.class ?? "—"}`}{last.admission_no ? ` · ${last.admission_no}` : ""}</p>
                <p className="m-0 mt-1.5 text-[16px] font-bold">
                  {last.result === "in" ? (last.late ? `Late — in at ${last.time}` : `Present — in at ${last.time}`) : last.result === "out" ? `Out at ${last.time}` : `Already marked (${last.status})`}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <button type="button" onClick={() => { setCamError(null); setCamera((c) => !c); }} className="btn btn-sm btn-secondary cursor-pointer">{camera ? "Stop camera" : "Use the camera instead"}</button>
          {camError && <span className="text-error">{camError}</span>}
        </div>
        {camera && !camError && <video ref={video} muted playsInline className="aspect-video w-full max-w-md rounded-[12px] border border-line bg-black object-cover" />}
      </div>
      <div className="flex flex-col gap-3">
        <div className="rounded-[14px] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
          <p className="m-0 text-[13px] text-muted">Students present today</p>
          <p className="m-0 text-[30px] font-extrabold text-ink">{present} <span className="text-[16px] font-semibold text-muted">/ {strength} · {pct}%</span></p>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#eef1f6]"><div className="h-full rounded-full bg-[#16a34a]" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="rounded-[14px] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
          <h3 className="m-0 mb-2 text-[14px] font-bold text-ink">Last scans</h3>
          {feed.length ? (
            <ul className="m-0 flex max-h-[360px] list-none flex-col gap-1 overflow-y-auto p-0 text-[13.5px]">
              {feed.map((f, i) => (
                <li key={`${f.at}-${i}`} className="flex items-center justify-between gap-2 border-t border-line py-1.5 first:border-0">
                  <span className="min-w-0 truncate"><b className="text-ink">{f.name ?? "Unknown"}</b> <span className="text-muted">{f.class_name ?? ""}</span></span>
                  <span className="shrink-0 text-muted">{time(f.at)} · {f.result === "out" ? "out" : f.result === "already" ? "repeat" : f.status === "L" ? "late" : "in"}</span>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[13px] text-muted">No scans yet today.</p>}
        </div>
      </div>
    </div>
  );
}
