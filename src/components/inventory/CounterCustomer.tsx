"use client";

import { useState } from "react";

/** Who is buying: a student, a staff member or a walk-in. Only the chosen fields are shown (and submitted). */
export function CounterCustomer({ student, staff, walkin }: { student: React.ReactNode; staff: React.ReactNode; walkin: React.ReactNode }) {
  const [kind, setKind] = useState<"student" | "staff" | "walkin">("student");
  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-1.5" role="radiogroup" aria-label="Customer type">
        {([["student", "Student"], ["staff", "Staff"], ["walkin", "Walk-in"]] as const).map(([k, t]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold ${kind === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{t}</button>
        ))}
      </div>
      {kind === "student" && student}
      {kind === "staff" && staff}
      {kind === "walkin" && walkin}
    </div>
  );
}
