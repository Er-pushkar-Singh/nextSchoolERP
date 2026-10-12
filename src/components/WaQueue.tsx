"use client";
import { useState } from "react";

/**
 * Sends WhatsApp messages one by one (wa.me links). WhatsApp has no free bulk API,
 * so staff tap "Next" for each parent — fast and uses the school's own number.
 */
export function WaQueue({ items }: { items: { id: string; name: string; href: string | null }[] }) {
  const list = items.filter((i) => i.href);
  const [i, setI] = useState(0);
  if (!list.length) return null;
  const cur = list[i];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[#a8d8bc] bg-wa-tint px-4 py-3 text-[14px]">
      <span className="text-[#0b4f2c]">Reminders: <b>{Math.min(i + 1, list.length)}</b> of {list.length} with a phone number</span>
      {i < list.length ? (
        <a href={cur.href!} target="_blank" rel="noopener" onClick={() => setTimeout(() => setI(i + 1), 300)} className="btn btn-sm btn-wa">
          Send to {cur.name} →
        </a>
      ) : (
        <span className="font-semibold text-[#0b4f2c]">All done ✓</span>
      )}
      {i > 0 && <button type="button" onClick={() => setI(0)} className="cursor-pointer border-0 bg-transparent text-[13px] underline">Restart</button>}
    </div>
  );
}
