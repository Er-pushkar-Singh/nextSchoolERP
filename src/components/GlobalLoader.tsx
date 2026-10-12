"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * App-wide loading feedback:
 *  - a thin progress bar at the top while a page navigation or form submission is in flight
 *  - the clicked submit button (any form, even plain <button>s) gets a spinner and is disabled
 * Cleared when the URL changes, when the page re-renders after a server action, or after a safety timeout.
 */
export function GlobalLoader() {
  const pathname = usePathname();
  const search = useSearchParams();
  const loc = `${pathname}?${search.toString()}`;
  // Remember where loading started; once the location changes the bar hides by itself
  const [busyAt, setBusyAt] = useState<string | null>(null);
  const busy = busyAt !== null && busyAt === loc;
  const locRef = useRef(loc);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetButtons = () => {
    document.querySelectorAll<HTMLButtonElement>("button[data-gl-loading]").forEach((b) => {
      b.removeAttribute("data-gl-loading");
      b.removeAttribute("data-loading");
      b.disabled = b.dataset.glWasDisabled === "1";
      delete b.dataset.glWasDisabled;
    });
  };
  const clear = () => {
    setBusyAt(null);
    if (timer.current) clearTimeout(timer.current);
    resetButtons();
  };

  // Navigation finished: free any buttons we disabled (DOM only)
  useEffect(() => { locRef.current = loc; resetButtons(); }, [loc]);

  useEffect(() => {
    const start = (ms = 15000) => {
      setBusyAt(locRef.current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(clear, ms);
    };
    const onSubmit = (e: SubmitEvent) => {
      // note: React calls preventDefault() on forms with server actions, so defaultPrevented is not a signal here
      const form = e.target as HTMLFormElement;
      if (form.dataset.noLoader !== undefined) return;
      const btn = (e.submitter as HTMLButtonElement | null) ?? form.querySelector<HTMLButtonElement>("button[type=submit],button:not([type])");
      if (btn) {
        btn.dataset.glWasDisabled = btn.disabled ? "1" : "0";
        btn.setAttribute("data-gl-loading", "");
        btn.setAttribute("data-loading", "");
        // disable after the browser has captured the submitter's name/value
        setTimeout(() => { btn.disabled = true; }, 0);
      }
      start();
      // a server action that re-renders the same URL: clear when the page content changes
      const main = document.querySelector("main") ?? document.body;
      const mo = new MutationObserver(() => { mo.disconnect(); setTimeout(clear, 50); });
      setTimeout(() => mo.observe(main, { childList: true, subtree: true, characterData: true }), 30);
      setTimeout(() => mo.disconnect(), 15000);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.noLoader !== undefined) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || /^(mailto|tel|upi|https?:\/\/wa\.me)/.test(href) || href.includes("/export")) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start(10000);
    };
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("submit", onSubmit, true); document.removeEventListener("click", onClick, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- handlers read refs

  return busy ? <div className="gl-bar" role="progressbar" aria-label="Loading" /> : null;
}
