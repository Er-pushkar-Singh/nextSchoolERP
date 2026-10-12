"use client";
import { LuCircleAlert, LuCircleCheck } from "react-icons/lu";

export function FlashIcon({ kind }: { kind: "ok" | "error" }) {
  const C = kind === "ok" ? LuCircleCheck : LuCircleAlert;
  return <C aria-hidden="true" size={18} className="mt-0.5 flex-none" />;
}
