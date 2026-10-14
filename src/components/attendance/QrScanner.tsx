"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export type ScanResult = { ok: boolean; result: string; kind?: string; name?: string; class?: string; status?: string; time?: string; late?: boolean; message?: string; distance_m?: number };
type Entry = ScanResult & { at: number; code: string };

const LABEL: Record<string, string> = { in: "Marked present", out: "Marked out", already: "Already marked", unknown: "Not recognised", inactive: "Not on roll", far: "Too far", error: "Error" };

function beep(ok: boolean) {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new C(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.3));
    setTimeout(() => ctx.close().catch(() => null), 500);
  } catch { /* sound is optional */ }
}

/**
 * Camera + typed/USB-scanner input. `onScan` talks to the server (a signed-in action, or a kiosk's device token) and returns what happened.
 * The camera is only started when asked; the same code is ignored for 4 seconds so a card held in front of the lens is not punched repeatedly.
 */
export function QrScanner({ onScan, big = false }: { onScan: (code: string) => Promise<ScanResult>; big?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const seen = useRef<Map<string, number>>(new Map());
  const busy = useRef(false);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [last, setLast] = useState<Entry | null>(null);
  const [log, setLog] = useState<Entry[]>([]);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  const handle = useCallback(async (raw: string) => {
    const code = raw.trim().slice(0, 60);
    if (!code) return;
    const t = Date.now();
    const prev = seen.current.get(code);
    if (prev && t - prev < 4000) return;
    seen.current.set(code, t);
    if (busy.current) return;
    busy.current = true;
    let r: ScanResult;
    try { r = await onScan(code); } catch (e) { r = { ok: false, result: "error", message: (e as Error).message || "Could not reach the server." }; }
    busy.current = false;
    const entry: Entry = { ...r, at: Date.now(), code };
    setLast(entry);
    setLog((l) => [entry, ...l].slice(0, 12));
    beep(r.ok);
    if (navigator.vibrate) navigator.vibrate(r.ok ? 40 : [60, 40, 60]);
  }, [onScan]);

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  }, []);

  const start = useCallback(async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) { setErr("This browser cannot open the camera. Use a USB scanner or type the code."); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      setOn(true);
      const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      const det = Detector ? new Detector({ formats: ["qr_code"] }) : null;
      let tick = 0;
      const loop = async () => {
        raf.current = requestAnimationFrame(loop);
        if (v.readyState < 2 || ++tick % 4 !== 0) return;
        try {
          if (det) {
            const codes = await det.detect(v);
            if (codes[0]?.rawValue) void handle(codes[0].rawValue);
          } else {
            const c = canvas.current!;
            const w = Math.min(640, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
            c.width = w; c.height = h;
            const cx = c.getContext("2d", { willReadFrequently: true })!;
            cx.drawImage(v, 0, 0, w, h);
            const img = cx.getImageData(0, 0, w, h);
            const q = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            if (q?.data) void handle(q.data);
          }
        } catch { /* a bad frame is skipped */ }
      };
      raf.current = requestAnimationFrame(loop);
    } catch (e) {
      const n = (e as DOMException).name;
      setErr(n === "NotAllowedError" ? "Camera permission is blocked. Allow the camera for this page and try again." : n === "NotFoundError" ? "No camera was found on this device." : "Could not start the camera.");
    }
  }, [facing, handle]);

  useEffect(() => stop, [stop]);

  const tone = !last ? "border-line bg-white" : last.ok && last.result !== "already" ? (last.late ? "border-[#e0b44a] bg-[#fff8e6]" : "border-[#16a34a] bg-[#f0fdf4]") : last.result === "already" ? "border-[#2563eb] bg-[#eff6ff]" : "border-[#dc2626] bg-[#fef2f2]";

  return (
    <div className={`flex flex-col gap-4 ${big ? "text-[18px]" : ""}`}>
      <div className="overflow-hidden rounded-[16px] border border-line bg-black">
        <div className="relative aspect-[4/3] w-full">
          <video ref={video} playsInline muted className={`h-full w-full object-cover ${on ? "" : "hidden"}`} />
          <canvas ref={canvas} className="hidden" />
          {on && <div className="pointer-events-none absolute inset-[18%] rounded-[18px] border-2 border-white/80" />}
          {!on && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white">
              <p className="m-0 text-[15px]">Point the camera at the QR code on an ID card.</p>
              <button type="button" onClick={start} className="cursor-pointer rounded-[12px] border-0 bg-[#2563eb] px-5 py-3 text-[16px] font-bold text-white">Start camera</button>
            </div>
          )}
        </div>
        {on && (
          <div className="flex items-center justify-between gap-2 bg-[#111] px-3 py-2">
            <button type="button" onClick={stop} className="cursor-pointer rounded-md border border-white/30 bg-transparent px-3 py-1.5 text-[13px] text-white">Stop</button>
            <button type="button" onClick={() => { stop(); setFacing((f) => (f === "environment" ? "user" : "environment")); setTimeout(() => void start(), 50); }}
              className="cursor-pointer rounded-md border border-white/30 bg-transparent px-3 py-1.5 text-[13px] text-white">Switch camera</button>
          </div>
        )}
      </div>
      {err && <p role="alert" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">{err}</p>}

      <form onSubmit={(e) => { e.preventDefault(); void handle(text); setText(""); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="USB scanner or type admission no. / code" aria-label="Code" autoComplete="off" className="input !min-h-11 flex-1" />
        <button className="btn btn-sm btn-secondary cursor-pointer">Mark</button>
      </form>

      <div role="status" aria-live="polite" className={`rounded-[16px] border-2 p-4 ${tone}`}>
        {last ? (
          <>
            <p className="m-0 text-[12px] font-bold uppercase tracking-wide text-muted">{LABEL[last.result] ?? last.result}{last.late && last.ok ? " · late" : ""}</p>
            <p className="my-1 text-[24px] font-extrabold leading-tight text-ink">{last.name ?? (last.ok ? "Done" : "No match")}</p>
            <p className="m-0 text-[14px] text-muted">{[last.class, last.time ? `at ${last.time}` : null, last.message].filter(Boolean).join(" · ") || last.code}</p>
          </>
        ) : <p className="m-0 text-[14px] text-muted">Waiting for the first scan…</p>}
      </div>

      {log.length > 1 && (
        <ul className="m-0 list-none divide-y divide-line rounded-[12px] border border-line bg-white p-0 text-[14px]">
          {log.slice(1).map((l, i) => (
            <li key={`${l.at}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate">{l.name ?? l.code}</span>
              <span className={`shrink-0 text-[12px] font-semibold ${l.ok ? "text-[#15803d]" : "text-[#b91c1c]"}`}>{LABEL[l.result] ?? l.result}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
