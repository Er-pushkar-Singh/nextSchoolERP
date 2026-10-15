"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the server data every few seconds (live monitoring pages). Pauses while the tab is hidden. */
export function AutoRefresh({ seconds = 15, enabled = true }: { seconds?: number; enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => { if (!document.hidden) router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds, enabled]);
  return null;
}
