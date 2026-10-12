"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LuChevronDown, LuMenu, LuX } from "react-icons/lu";
import { Icon, type IconName } from "./icons";

export type NavLeaf = { href: string; label: string };
export type NavEntry = { key: string; label: string; icon: IconName; href?: string; items?: NavLeaf[]; section?: string };

const matches = (path: string, href: string, root: string) => (href === root ? path === root : path === href || path.startsWith(`${href}/`));

/**
 * App shell: navy-blue sidebar with collapsible groups (dropdowns), mobile drawer, top bar.
 * Group open/closed state: whatever the user toggled, else open when it holds the current page.
 */
export function Shell({ nav, root, brand, sidebarFooter, topbar, children }: {
  nav: NavEntry[]; root: string; brand: React.ReactNode; sidebarFooter?: React.ReactNode; topbar?: React.ReactNode; children: React.ReactNode;
}) {
  const path = usePathname();
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const drawer = drawerFor === path; // navigating closes the drawer without an effect

  // the single most specific link that matches the current path
  const all = nav.flatMap((n) => [...(n.href ? [n.href] : []), ...(n.items ?? []).map((i) => i.href)]);
  const best = all.filter((h) => matches(path, h, root)).sort((a, b) => b.length - a.length)[0];

  const side = (
    <div className="sb sb-scroll flex h-full flex-col overflow-y-auto px-3 pt-5 pb-4">
      <div className="px-2 pb-4">{brand}</div>
      <nav aria-label="Main" className="flex flex-col gap-0.5 pl-3">
        {nav.map((n) => {
          const sectionLabel = n.section ? <p className="sb-label -ml-3">{n.section}</p> : null;
          if (!n.items?.length) {
            return (
              <div key={n.key}>
                {sectionLabel}
                <Link href={n.href!} className="sb-link" aria-current={best === n.href ? "page" : undefined}>
                  <Icon name={n.icon} size={18} className="flex-none opacity-90" />
                  <span className="truncate">{n.label}</span>
                </Link>
              </div>
            );
          }
          const holdsActive = n.items.some((i) => i.href === best) || n.href === best;
          const open = toggled[n.key] ?? holdsActive;
          return (
            <div key={n.key}>
              {sectionLabel}
              <button
                type="button"
                className="sb-link w-full cursor-pointer border-0 bg-transparent text-left"
                aria-expanded={open}
                aria-controls={`grp-${n.key}`}
                onClick={() => setToggled((t) => ({ ...t, [n.key]: !open }))}
                style={holdsActive && !open ? { color: "#fff" } : undefined}
              >
                <Icon name={n.icon} size={18} className="flex-none opacity-90" />
                <span className="flex-1 truncate">{n.label}</span>
                <LuChevronDown aria-hidden="true" size={16} className={`flex-none transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
              </button>
              <div id={`grp-${n.key}`} hidden={!open} className="mt-0.5 mb-1 flex flex-col gap-0.5">
                {n.items.map((i) => (
                  <Link key={i.href} href={i.href} className="sb-sub" aria-current={best === i.href ? "page" : undefined}>{i.label}</Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      {sidebarFooter && <div className="mt-auto border-t border-white/10 pt-4">{sidebarFooter}</div>}
    </div>
  );

  return (
    <div className="page-bg flex min-h-screen">
      <aside className="hidden w-[264px] flex-none lg:block print:!hidden">
        <div className="fixed inset-y-0 left-0 w-[264px]">{side}</div>
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 cursor-default border-0 bg-[#0a1a4a]/50 backdrop-blur-[2px]" onClick={() => setDrawerFor(null)} />
          <div className="drawer-in absolute inset-y-0 left-0 w-[84%] max-w-[300px] shadow-2xl">
            {side}
            <button type="button" aria-label="Close menu" onClick={() => setDrawerFor(null)} className="absolute top-4 right-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-white/10 text-white">
              <LuX size={18} />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-[60px] items-center gap-3 border-b border-line bg-white/85 px-4 backdrop-blur-md sm:px-6 print:hidden">
          <button type="button" aria-label="Open menu" onClick={() => setDrawerFor(path)} className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-lg border border-line bg-white text-ink lg:hidden">
            <LuMenu size={20} />
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{topbar}</div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
