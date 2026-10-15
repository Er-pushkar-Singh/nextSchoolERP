"use client";

import { useState } from "react";
import { EntityPicker } from "@/components/ui/EntityPicker";

type Kind = "location" | "staff" | "student" | "department";
const LABEL: Record<Kind, string> = { location: "Room / place", staff: "Staff member", student: "Student", department: "Department" };

/** Where / to whom: a room (fans, benches, projector), a staff member, a student or a department. Only the chosen field is sent. */
export function HolderFields({ locations, initial = "location", kinds = ["location", "staff", "student", "department"], presetLocation }: {
  locations: [string, string][]; initial?: Kind; kinds?: Kind[]; presetLocation?: string | null;
}) {
  const [kind, setKind] = useState<Kind>(initial);
  return (
    <div className="flex flex-col gap-2.5 sm:col-span-2">
      <input type="hidden" name="holder_kind" value={kind} />
      <span className="text-[13px] font-semibold text-ink">Give to</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Give to">
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold ${kind === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{LABEL[k]}</button>
        ))}
      </div>
      {kind === "location" && (
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Room / place
          <select name="location_id" required defaultValue={presetLocation ?? ""} className="input !min-h-10 !py-2 text-[15px] font-normal">
            <option value="" disabled>Choose…</option>
            {locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          {!locations.length && <span className="text-[12px] font-normal text-muted">No rooms yet — add them under Rooms &amp; places.</span>}
        </label>
      )}
      {kind === "staff" && <EntityPicker kind="staff" name="staff_id" label="Staff member" required />}
      {kind === "student" && <EntityPicker kind="student" name="student_id" label="Student" required />}
      {kind === "department" && (
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Department
          <input name="department" required placeholder="Science lab, Accounts office, Sports…" className="input !min-h-10 !py-2 text-[15px] font-normal" />
        </label>
      )}
    </div>
  );
}
