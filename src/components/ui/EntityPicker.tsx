"use client";

import { useEffect, useRef, useState } from "react";

type Hit = { id: string; label: string; sub?: string };

/**
 * Type a name (or admission no. / employee code), pick from this school's people only. Submits the chosen id under `name`.
 * kind: student | staff | member (anyone with a login)
 */
export function EntityPicker({ kind, name, label, required = false, placeholder, initial, className = "" }: {
  kind: "student" | "staff" | "member" | "applicant" | "book"; name: string; label: string; required?: boolean; placeholder?: string; initial?: Hit | null; className?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Hit | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chosen || q.trim().length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/lookup?kind=${kind}&q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal, cache: "no-store" });
        const j = r.ok ? await r.json() : { hits: [] };
        setHits(j.hits ?? []);
        setOpen(true);
      } catch { /* aborted */ }
      setBusy(false);
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, kind, chosen]);

  useEffect(() => {
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  return (
    <div ref={box} className={`relative flex flex-col gap-1 text-[13px] font-semibold text-ink ${className}`}>
      <span>{label}{required && <span className="sr-only"> (required)</span>}</span>
      <input type="hidden" name={name} value={chosen?.id ?? ""} required={required} />
      {chosen ? (
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-[10px] border border-line bg-blue-tint px-3 py-1.5 font-normal">
          <span className="min-w-0 truncate"><b className="text-ink">{chosen.label}</b>{chosen.sub ? <span className="text-muted"> · {chosen.sub}</span> : null}</span>
          <button type="button" onClick={() => { setChosen(null); setQ(""); setHits([]); }} className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-blue underline">Change</button>
        </div>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} placeholder={placeholder ?? "Type at least 2 letters…"} autoComplete="off"
            aria-label={label} required={required && !chosen} className="input !min-h-10 !py-2 text-[15px] font-normal" />
          {open && (
            <ul role="listbox" className="absolute top-full right-0 left-0 z-20 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-[10px] border border-line bg-white p-1 shadow-lg">
              {busy && <li className="px-3 py-2 text-[13px] font-normal text-muted">Searching…</li>}
              {!busy && hits.length === 0 && <li className="px-3 py-2 text-[13px] font-normal text-muted">No match in this school.</li>}
              {hits.map((h) => (
                <li key={h.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => { setChosen(h); setOpen(false); }} className="block w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left text-[14px] font-normal text-ink hover:bg-blue-tint">
                    <b>{h.label}</b>{h.sub ? <span className="block text-[12px] text-muted">{h.sub}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
