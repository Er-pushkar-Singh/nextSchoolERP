"use client";

import { useState } from "react";

/**
 * Prints the page after every image on it (photographs, logo, signature, QR) has loaded — otherwise the print preview
 * can open before a photograph arrives and the paper comes out with an empty box.
 */
export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const imgs = Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0);
    await Promise.race([
      Promise.all(imgs.map((i) => new Promise<void>((res) => { i.loading = "eager"; i.addEventListener("load", () => res(), { once: true }); i.addEventListener("error", () => res(), { once: true }); }))),
      new Promise<void>((res) => setTimeout(res, 6000)),
    ]);
    setBusy(false);
    window.print();
  };
  return (
    <button type="button" onClick={go} disabled={busy} className="btn btn-primary btn-sm cursor-pointer border-0 print:hidden">
      {busy ? "Preparing…" : label}
    </button>
  );
}
