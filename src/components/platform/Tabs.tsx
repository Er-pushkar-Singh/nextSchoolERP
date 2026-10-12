import Link from "next/link";

export function Tabs({ base, tabs, active }: { base: string; tabs: [string, string][]; active: string }) {
  return (
    <nav aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(([k, l]) => (
        <Link key={k} href={`${base}?tab=${k}`} aria-current={active === k ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-[14px] whitespace-nowrap no-underline ${active === k ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}>
          {l}
        </Link>
      ))}
    </nav>
  );
}
