"use client";

import { useEffect, useState } from "react";
import { saveSubstitution } from "@/app/app/_actions/timetable";

type Slot = { id: string; label: string };
type Free = { staff_id: string; name: string; designation: string | null; periods_that_day: number };

/** Arrange cover for any period of the day (not only for teachers marked absent): pick the period, then a free teacher. */
export function ManualCover({ date, slots }: { date: string; slots: Slot[] }) {
  const [slot, setSlot] = useState("");
  const [free, setFree] = useState<Free[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!slot) return;
    let dead = false;
    fetch(`/api/timetable/free?slot=${slot}&date=${date}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => { if (!dead) { setFree(j.staff ?? []); setBusy(false); } })
      .catch(() => { if (!dead) { setFree([]); setBusy(false); } });
    return () => { dead = true; };
  }, [slot, date]);

  const inp = "input !min-h-10 !py-2 text-[15px] font-normal";
  const lbl = "flex flex-col gap-1 text-[13px] font-semibold text-ink";
  return (
    <form action={saveSubstitution} className="grid gap-3">
      <input type="hidden" name="date" value={date} />
      <label className={lbl}>Period needing cover
        <select name="slot_id" required value={slot} onChange={(e) => { setSlot(e.target.value); setFree(null); setBusy(Boolean(e.target.value)); }} className={inp}>
          <option value="" disabled>Choose class, period and teacher…</option>
          {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label className={lbl}>Covering teacher
        <select name="staff_id" required defaultValue="" disabled={!slot || busy} className={inp}>
          <option value="" disabled>{!slot ? "Choose the period first" : busy || free === null ? "Finding free teachers…" : free.length ? "Choose a free teacher" : "No teacher is free in this period"}</option>
          {(free ?? []).map((f) => <option key={f.staff_id} value={f.staff_id}>{f.name}{f.designation ? ` · ${f.designation}` : ""} ({f.periods_that_day} periods that day)</option>)}
        </select>
      </label>
      <label className={lbl}>Reason (optional)<input name="reason" maxLength={200} placeholder="Training, meeting, half-day…" className={inp} /></label>
      <button className="btn btn-sm btn-primary cursor-pointer border-0" disabled={!slot || !free?.length}>Assign cover</button>
    </form>
  );
}
