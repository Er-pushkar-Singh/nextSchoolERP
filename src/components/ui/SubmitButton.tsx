"use client";
import { useFormStatus } from "react-dom";

/** Submit button with a built-in pending state (spinner + disabled) while the form's action runs. */
export function Submit({ children, variant = "primary", className = "" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  const v = variant === "primary" ? "btn-primary border-0" : variant === "danger" ? "border border-[#f3b8b1] bg-white text-error hover:bg-[#fdecea]" : "btn-secondary";
  return (
    <button type="submit" disabled={pending} aria-busy={pending} data-loading={pending ? "" : undefined} className={`btn btn-sm cursor-pointer disabled:cursor-wait ${v} ${className}`}>
      {children}
    </button>
  );
}
