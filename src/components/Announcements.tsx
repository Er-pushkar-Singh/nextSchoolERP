"use client";
import { useSyncExternalStore } from "react";

type A = { id: string; title: string; body: string | null; level: "info" | "warning" | "critical" };
const KEY = "erp_dismissed_announcements";
const read = () => { try { return localStorage.getItem(KEY) ?? "[]"; } catch { return "[]"; } };
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };

/** Platform announcements as banners; info/warning ones can be dismissed (remembered in this browser). */
export function Announcements({ items }: { items: A[] }) {
  const raw = useSyncExternalStore(subscribe, read, () => "[]");
  let dismissed: string[] = [];
  try { dismissed = JSON.parse(raw); } catch { dismissed = []; }
  const show = items.filter((a) => a.level === "critical" || !dismissed.includes(a.id));
  if (!show.length) return null;
  const dismiss = (id: string) => {
    try { localStorage.setItem(KEY, JSON.stringify([...dismissed, id].slice(-50))); } catch { /* private mode */ }
    listeners.forEach((l) => l());
  };
  return (
    <div className="mb-5 flex flex-col gap-2 print:hidden">
      {show.map((a) => (
        <div key={a.id} role="note" className={`flex items-start justify-between gap-3 rounded-[10px] border px-4 py-3 text-[14px] ${a.level === "critical" ? "border-[#f3b8b1] bg-[#fdecea] text-[#7a1a12]" : a.level === "warning" ? "border-[#f1d39a] bg-[#fff4e0] text-[#7a4b00]" : "border-blue/30 bg-blue-tint text-blue-strong"}`}>
          <span><b>{a.title}</b>{a.body ? <span className="block whitespace-pre-line">{a.body}</span> : null}</span>
          {a.level !== "critical" && <button type="button" onClick={() => dismiss(a.id)} aria-label="Dismiss" className="cursor-pointer border-0 bg-transparent px-1 text-[18px] leading-none opacity-70 hover:opacity-100">×</button>}
        </div>
      ))}
    </div>
  );
}
