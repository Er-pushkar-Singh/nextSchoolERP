"use client";
import { useState } from "react";

const OPTS = [["P", "Present", "bg-wa text-white"], ["A", "Absent", "bg-error text-white"], ["L", "Late", "bg-[#b26a00] text-white"], ["H", "Half day", "bg-blue text-white"], ["LV", "Leave", "bg-muted text-white"]] as const;

export function AttendanceGrid({ students, initial }: { students: { id: string; name: string; roll: number | null }[]; initial: Record<string, string> }) {
  const [st, setSt] = useState<Record<string, string>>(() => Object.fromEntries(students.map((s) => [s.id, initial[s.id] ?? "P"])));
  const count = (k: string) => Object.values(st).filter((v) => v === k).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <button type="button" onClick={() => setSt(Object.fromEntries(students.map((s) => [s.id, "P"])))} className="btn btn-sm btn-secondary cursor-pointer">All present</button>
        <span>Present <b>{count("P") + count("L") + count("H")}</b> · Absent <b className="text-error">{count("A")}</b> · Leave <b>{count("LV")}</b></span>
      </div>
      <ul className="m-0 list-none divide-y divide-line rounded-[12px] border border-line bg-white p-0">
        {students.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-[15px] text-ink"><span className="inline-block w-8 text-muted">{s.roll ?? ""}</span>{s.name}</span>
            <span className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${s.name}`}>
              <input type="hidden" name={`st_${s.id}`} value={st[s.id]} />
              {OPTS.map(([k, label, on]) => (
                <button key={k} type="button" role="radio" aria-checked={st[s.id] === k} title={label}
                  onClick={() => setSt({ ...st, [s.id]: k })}
                  className={`min-h-10 min-w-10 cursor-pointer rounded-md border px-2 text-[13px] font-bold ${st[s.id] === k ? `${on} border-transparent` : "border-line bg-white text-body"}`}>
                  {k}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
