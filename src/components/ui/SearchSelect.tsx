"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Opt = { value: string; label: string; hint?: string };

/**
 * A select you can type in: filters a long list (subjects, codes…) as you type and submits the chosen value under `name`.
 * Works with the keyboard (↑ ↓ Enter Esc) and inside a disabled fieldset.
 */
export function SearchSelect({ name, options, defaultValue = "", placeholder = "Search…", disabled = false, className = "", emptyLabel = "— none —" }: {
  name: string; options: Opt[]; defaultValue?: string; placeholder?: string; disabled?: boolean; className?: string; emptyLabel?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? null;

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? options.filter((o) => `${o.value} ${o.label} ${o.hint ?? ""}`.toLowerCase().includes(t)) : options;
    return list.slice(0, 60);
  }, [q, options]);

  useEffect(() => {
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setQ(""); } };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const pick = (v: string) => { setValue(v); setOpen(false); setQ(""); };

  return (
    <div ref={box} className={`relative ${className}`}>
      <input type="hidden" name={name} value={value} />
      <input
        role="combobox" aria-expanded={open} aria-controls="search-select-list" aria-autocomplete="list" disabled={disabled} autoComplete="off"
        value={open ? q : current ? `${current.value ? current.value + " — " : ""}${current.label}` : ""}
        placeholder={current ? "" : placeholder}
        onFocus={() => { setOpen(true); setCursor(0); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && open) { e.preventDefault(); pick(cursor === 0 ? "" : shown[cursor - 1]?.value ?? value); }
          else if (e.key === "Escape") { setOpen(false); setQ(""); }
        }}
        className="input !min-h-10 !py-2 text-[15px] font-normal" />
      {open && !disabled && (
        <ul id="search-select-list" role="listbox" className="absolute top-full right-0 left-0 z-20 m-0 mt-1 max-h-60 list-none overflow-y-auto rounded-[10px] border border-line bg-white p-1 text-[14px] shadow-lg">
          <li><button type="button" onClick={() => pick("")} className={`block w-full cursor-pointer rounded-md border-0 px-3 py-1.5 text-left text-muted ${cursor === 0 ? "bg-blue-tint" : "bg-transparent"}`}>{emptyLabel}</button></li>
          {shown.map((o, i) => (
            <li key={o.value}>
              <button type="button" role="option" aria-selected={o.value === value} onClick={() => pick(o.value)}
                className={`block w-full cursor-pointer rounded-md border-0 px-3 py-1.5 text-left text-ink hover:bg-blue-tint ${cursor === i + 1 ? "bg-blue-tint" : "bg-transparent"}`}>
                <b>{o.value}</b> — {o.label}{o.hint ? <span className="block text-[12px] text-muted">{o.hint}</span> : null}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-2 text-muted">No subject matches “{q}”.</li>}
        </ul>
      )}
    </div>
  );
}
