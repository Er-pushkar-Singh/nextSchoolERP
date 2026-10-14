import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Stat } from "@/components/ui/ui";
import { addDays, fmtDate, todayIST } from "@/lib/format";
import { DAY_NAMES, hhmm } from "@/lib/timetable";
import { removeSubstitution, saveSubstitution } from "../../_actions/timetable";

type Need = { slot_id: string; class_name: string; section_name: string; period_id: string; period_name: string; start_time: string; end_time: string; subject_name: string | null;
  teacher_id: string; teacher_name: string; why: string; substitution_id: string | null; substitute_id: string | null; substitute_name: string | null };
type Free = { staff_id: string; name: string; periods_that_day: number };

export default async function Cover({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("academics.timetable.view");
  const sp = await searchParams;
  const today = todayIST();
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const edit = can("academics.timetable.edit");
  const { data } = await supabase.rpc("cover_needed", { sid: school.id, on_day: day });
  const needs = (data ?? []) as Need[];
  const periodIds = [...new Set(needs.map((n) => n.period_id))];
  const free = new Map<string, Free[]>();
  if (edit) {
    await Promise.all(periodIds.map(async (p) => {
      const { data: f } = await supabase.rpc("free_staff", { sid: school.id, on_day: day, p_period: p });
      free.set(p, (f ?? []) as Free[]);
    }));
  }
  const done = needs.filter((n) => n.substitute_id).length;
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Cover & substitutes" subtitle={`${DAY_NAMES[dow]}, ${fmtDate(day)}`} back={{ href: "/app/timetable", label: "Timetable" }}
        actions={<><Link href={`/app/timetable/cover?date=${addDays(day, -1)}`} className="btn btn-sm btn-secondary">← Previous</Link><Link href={`/app/timetable/cover?date=${addDays(day, 1)}`} className="btn btn-sm btn-secondary">Next →</Link></>} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex items-end gap-2"><Input label="Date" name="date" type="date" defaultValue={day} /><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></form>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Periods needing cover" value={needs.length} tone="amber" />
        <Stat label="Covered" value={done} tone="green" />
        <Stat label="Still open" value={needs.length - done} tone={needs.length - done ? "rose" : "blue"} />
      </div>

      {needs.length === 0 ? <Empty>No teacher is on leave or marked absent with periods on this day.</Empty> : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {needs.map((n) => (
            <li key={n.slot_id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <b className="text-[15px] text-ink">{n.period_name} · {hhmm(n.start_time)}–{hhmm(n.end_time)}</b>
                    <p className="m-0 text-[14px] text-body">Class {n.class_name}-{n.section_name}{n.subject_name ? ` · ${n.subject_name}` : ""}</p>
                    <p className="m-0 text-[13px] text-muted">{n.teacher_name} — {n.why}</p>
                  </div>
                  {n.substitute_id ? (
                    <div className="text-right">
                      <Badge value="active" text={`Covered by ${n.substitute_name}`} />
                      {edit && n.substitution_id && (
                        <form action={removeSubstitution} className="mt-1"><input type="hidden" name="id" value={n.substitution_id} /><input type="hidden" name="date" value={day} />
                          <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove</button></form>
                      )}
                    </div>
                  ) : edit ? (
                    <form action={saveSubstitution} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="slot_id" value={n.slot_id} /><input type="hidden" name="date" value={day} /><input type="hidden" name="reason" value={`${n.teacher_name}: ${n.why}`} />
                      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Substitute
                        <select name="staff_id" required defaultValue="" className="input !min-h-10 !py-2">
                          <option value="" disabled>{(free.get(n.period_id) ?? []).length ? "Choose a free teacher" : "No one is free"}</option>
                          {(free.get(n.period_id) ?? []).map((f) => <option key={f.staff_id} value={f.staff_id}>{f.name} ({f.periods_that_day} periods today)</option>)}
                        </select>
                      </label>
                      <button className="btn btn-sm btn-primary cursor-pointer border-0">Assign</button>
                    </form>
                  ) : <Badge value="overdue" text="Not covered" />}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-[12px] text-muted">A period needs cover when its teacher has approved leave or is marked absent / on leave in staff attendance. Free teachers are listed by lightest day first.</p>
    </div>
  );
}
