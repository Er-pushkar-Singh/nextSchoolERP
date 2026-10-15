"use client";

import { useState } from "react";
import { EntityPicker } from "@/components/ui/EntityPicker";

/** Who takes the child: a staff member chosen from the school's staff, or a guardian / other person typed in. */
export function PickupFields() {
  const [kind, setKind] = useState<"staff" | "guardian">("guardian");
  const inp = "input !min-h-10 !py-2 text-[15px] font-normal";
  const lbl = "flex flex-col gap-1 text-[13px] font-semibold text-ink";
  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <input type="hidden" name="pickup_kind" value={kind} />
      <div role="radiogroup" aria-label="Taken by" className="flex flex-wrap gap-2">
        {([["guardian", "Parent / guardian / other"], ["staff", "School staff member"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`cursor-pointer rounded-full border px-4 py-1.5 text-[14px] font-semibold ${kind === k ? "border-blue bg-blue text-white" : "border-line bg-white text-body"}`}>{l}</button>
        ))}
      </div>
      {kind === "staff" ? (
        <EntityPicker kind="staff" name="pickup_staff_id" label="Taken by (staff)" required />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={lbl}>Taken by<input name="pickup_name" required className={inp} /></label>
          <label className={lbl}>Relation<input name="pickup_relation" placeholder="Father, uncle…" className={inp} /></label>
          <label className={lbl}>Phone<input name="pickup_phone" type="tel" className={inp} /></label>
        </div>
      )}
    </div>
  );
}
