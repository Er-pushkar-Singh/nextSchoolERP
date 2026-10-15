"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * A dialog for forms. Two ways to use it:
 *  - with a button:   <Modal label="Add visitor" title="New visitor">…form…</Modal>
 *  - opened by a URL: <Modal defaultOpen closeHref="/app/x" title="Edit">…</Modal>  (e.g. ?edit=<id>)
 * Forms inside post to server actions, which redirect — the page reloads and the dialog is gone.
 */
export function Modal({ label, title, children, defaultOpen = false, closeHref, size = "md", variant = "primary", className = "" }: {
  label?: string; title: string; children: React.ReactNode; defaultOpen?: boolean; closeHref?: string; size?: "sm" | "md" | "lg"; variant?: "primary" | "secondary" | "link"; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (defaultOpen && ref.current && !ref.current.open) ref.current.showModal();
  }, [defaultOpen]);

  const close = () => {
    ref.current?.close();
    if (closeHref) router.push(closeHref);
  };
  const width = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-4xl" : "max-w-2xl";
  const trigger = variant === "link" ? "cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline" : `btn btn-sm ${variant === "primary" ? "btn-primary" : "btn-secondary"} cursor-pointer`;
  return (
    <>
      {label && <button type="button" onClick={() => ref.current?.showModal()} className={`${trigger} ${className}`}>{label}</button>}
      <dialog ref={ref} onCancel={(e) => { if (closeHref) { e.preventDefault(); close(); } }} onClick={(e) => { if (e.target === ref.current) close(); }}
        className={`m-auto w-[calc(100%-24px)] ${width} rounded-[16px] border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-black/40`}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="m-0 text-[17px] font-bold">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-[20px] leading-none text-muted">×</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </dialog>
    </>
  );
}
