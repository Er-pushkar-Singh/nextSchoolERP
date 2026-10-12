"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-primary btn-sm cursor-pointer border-0 print:hidden">
      Print / Save as PDF
    </button>
  );
}
