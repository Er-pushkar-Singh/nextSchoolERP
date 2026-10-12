"use client";
import { useState } from "react";

type C = { id: string; name: string; sections: { id: string; name: string }[] };

/** Class + section selects; the section list follows the chosen class. */
export function ClassSection({ classes, classId, sectionId, required, allowAll, small }: { classes: C[]; classId?: string | null; sectionId?: string | null; required?: boolean; allowAll?: boolean; small?: boolean }) {
  const [cls, setCls] = useState(classId ?? "");
  const sections = classes.find((c) => c.id === cls)?.sections ?? [];
  const field = `input ${small ? "!min-h-10 !py-2" : "!min-h-10 !py-2"} text-[15px] font-normal`;
  return (
    <>
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        Class
        <select name="class_id" value={cls} required={required} onChange={(e) => setCls(e.target.value)} className={field}>
          <option value="">{allowAll ? "All classes" : "Select class"}</option>
          {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
        Section
        <select key={cls} name="section_id" defaultValue={sections.some((s) => s.id === sectionId) ? sectionId ?? "" : sections[0]?.id ?? ""} className={field}>
          {allowAll && <option value="">All sections</option>}
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
    </>
  );
}
