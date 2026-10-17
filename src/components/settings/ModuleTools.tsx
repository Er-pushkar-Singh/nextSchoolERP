"use client";

/** Tick or clear every permission of one module in the role matrix (the checkboxes of the same <tbody>). */
export function ModuleTools({ label }: { label: string }) {
  const set = (el: HTMLElement, on: boolean) => {
    el.closest("tbody")?.querySelectorAll<HTMLInputElement>("input[type=checkbox]:not(:disabled)").forEach((c) => { c.checked = on; });
  };
  const btn = "cursor-pointer rounded-md border border-line bg-white px-2 py-0.5 text-[12px] font-semibold text-ink hover:bg-blue-soft";
  return (
    <span className="ml-3 inline-flex gap-1 align-middle">
      <button type="button" className={btn} aria-label={`Tick everything in ${label}`} onClick={(e) => set(e.currentTarget, true)}>All</button>
      <button type="button" className={btn} aria-label={`Clear everything in ${label}`} onClick={(e) => set(e.currentTarget, false)}>None</button>
    </span>
  );
}
