"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LuChevronDown, LuLogOut } from "react-icons/lu";
import { Icon, type IconName } from "./icons";

/** Avatar button with a dropdown: account links + sign out. Closes on outside click and Escape. */
export function UserMenu({ name, email, role, links, signOut }: {
  name: string; email: string; role?: string; links: { href: string; label: string; icon: IconName }[]; signOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const initials = (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white py-1 pr-2.5 pl-1 text-left hover:border-blue">
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#1e3a8a] text-[12px] font-bold text-white">{initials}</span>
        <span className="hidden max-w-[160px] min-w-0 sm:block">
          <span className="block truncate text-[13px] leading-tight font-bold text-ink">{name || email}</span>
          {role && <span className="block truncate text-[11px] leading-tight text-muted">{role}</span>}
        </span>
        <LuChevronDown aria-hidden="true" size={14} className="text-muted" />
      </button>
      {open && (
        <div role="menu" className="pop-in absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-[14px] border border-line bg-white shadow-[var(--shadow-raised)]">
          <div className="border-b border-line bg-blue-soft px-4 py-3">
            <p className="m-0 truncate text-[14px] font-bold text-ink">{name || email}</p>
            <p className="m-0 truncate text-[12px] text-muted">{email}</p>
          </div>
          <div className="p-1.5">
            {links.map((l) => (
              <Link key={l.href} role="menuitem" href={l.href} onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] text-ink no-underline hover:bg-blue-soft hover:text-blue-strong">
                <Icon name={l.icon} size={16} className="text-muted" />{l.label}
              </Link>
            ))}
            <form action={signOut}>
              <button role="menuitem" className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[14px] text-[#b42318] hover:bg-[#fdecea]">
                <LuLogOut aria-hidden="true" size={16} />Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
