"use client";

import { useState } from "react";
import { EntityPicker } from "@/components/ui/EntityPicker";

/** One or more students for a discipline incident, each with a role (involved / victim / witness). */
export function IncidentStudents({ max = 8 }: { max?: number }) {
  const [n, setN] = useState(1);
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_150px]">
          <EntityPicker kind="student" name="student_id" label={i === 0 ? "Student" : `Student ${i + 1}`} required={i === 0} placeholder="Type name or admission no." />
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">{i === 0 ? "Role" : <span className="sr-only">Role</span>}
            <select name="role" className="input !min-h-10 !py-2 text-[15px] font-normal" defaultValue="involved" aria-label={`Role of student ${i + 1}`}>
              <option value="involved">Involved</option><option value="victim">Victim</option>
            </select>
          </label>
        </div>
      ))}
      {n < max && <button type="button" onClick={() => setN(n + 1)} className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">+ Add another student</button>}
    </div>
  );
}
