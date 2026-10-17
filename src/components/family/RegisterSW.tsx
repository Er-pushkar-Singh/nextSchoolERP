"use client";

import { useEffect } from "react";

/** Registers the small service worker that makes the family portal installable and gives an offline page. */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js", { scope: "/family/" }).catch(() => {});
  }, []);
  return null;
}
