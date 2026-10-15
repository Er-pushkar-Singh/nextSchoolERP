import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, PageHeader, Submit } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { getClasses } from "@/lib/erp";
import { DAY_NAMES, DAY_SHORT, hhmm, workingDays, type Period } from "@/lib/timetable";
import { copyDay, saveTimetable } from "../_actions/timetable";

type Slot = { id: string; day: number; period_id: string; subject_id: string | null; staff_id: string | null; room: string | null };
const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function Timetable({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("academics.timetable.view");
  const sp = await searchParams;
  await supabase.rpc("ensure_timetable_defaults", { sid: school.id });
  const classes = await getClasses(supabase, school.id);
  const sections = classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${c.name}-${s.name}` })));
  const section = sections.find((s) => s.id === uid(sp.section)) ?? sections[0] ?? null;
  const days = workingDays(school.prefs);
  const edit = can("academics.timetable.edit");

  const [{ data: periods }, { data: slots }, { data: subjects }, { data: teachers }, { data: others }] = await Promise.all([
    supabase.from("periods").select("*").eq("school_id", school.id).order("no"),
    section ? supabase.from("timetable_slots").select("id,day,period_id,subject_id,staff_id,room").eq("section_id", section.id) : Promise.resolve({ data: [] }),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("name"),
    supabase.from("staff").select("id,name").eq("school_id", school.id).eq("status", "active").eq("kind", "teaching").order("name"),
    section ? supabase.from("timetable_slots").select("staff_id,day,period_id,section:sections(name,class:classes(name))").eq("school_id", school.id).neq("section_id", section.id).not("staff_id", "is", null) : Promise.resolve({ data: [] }),
  ]);
  type OtherSlot = { staff_id: string; day: number; period_id: string; section: { name: string; class: { name: string } | { name: string }[] | null } | { name: string; class: { name: string } | { name: string }[] | null }[] | null };
  const busy = new Map<string, string>();
  for (const o of (others ?? []) as unknown as OtherSlot[]) {
    const sec = Array.isArray(o.section) ? o.section[0] : o.section;
    const c = sec ? (Array.isArray(sec.class) ? sec.class[0] : sec.class) : null;
    busy.set(`${o.staff_id}:${o.day}:${o.period_id}`, `${c?.name ?? ""}-${sec?.name ?? ""}`);
  }
  const P = (periods ?? []) as Period[];
  const S = (slots ?? []) as Slot[];
  const at = (day: number, period: string) => S.find((s) => s.day === day && s.period_id === period);
  const subj = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const teach = new Map((teachers ?? []).map((t) => [t.id, t.name]));
  const sel = "input !min-h-8 !w-full !py-0.5 !px-1.5 text-[12px]";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 print:hidden">
        <PageHeader icon="academics" title="Timetable" subtitle={section ? `Class ${section.label}` : "Class timetable"}
          actions={<><PrintButton /><Link href="/app/timetable/teacher" className="btn btn-sm btn-secondary">By teacher</Link><Link href="/app/timetable/cover" className="btn btn-sm btn-secondary">Cover & substitutes</Link></>} />
        <Flash ok={sp.ok} error={sp.error} />
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Class-section
            <select name="section" defaultValue={section?.id} className="input !min-h-10 !py-2">{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </label>
          <button className="btn btn-sm btn-secondary cursor-pointer">Open</button>
        </form>
      </div>
      <h1 className="hidden text-[18px] font-bold print:block">{school.name} — Timetable, Class {section?.label}</h1>

      {!section ? <Empty>Add classes and sections in Settings first.</Empty> : (
        <form action={saveTimetable} className="flex flex-col gap-3">
          <input type="hidden" name="section_id" value={section.id} />
          <div className="overflow-x-auto rounded-[14px] border border-line bg-white">
            <table className="w-full border-collapse text-[13px]" style={{ minWidth: 160 + days.length * 150 }}>
              <thead>
                <tr className="bg-[#f5f7fb] text-left text-[12px] text-muted">
                  <th className="w-[110px] px-3 py-2">Period</th>
                  {days.map((d) => <th key={d} className="px-2 py-2">{DAY_NAMES[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                {P.map((p) => (
                  p.is_break ? (
                    <tr key={p.id} className="bg-[#fff8e6]">
                      <td className="border-t border-line px-3 py-1.5 text-[12px] font-semibold text-[#7a4b00]">{p.name}<div className="font-normal">{hhmm(p.start_time)}–{hhmm(p.end_time)}</div></td>
                      <td colSpan={days.length} className="border-t border-line px-3 py-1.5 text-center text-[12px] text-[#7a4b00]">Break</td>
                    </tr>
                  ) : (
                    <tr key={p.id}>
                      <td className="border-t border-line px-3 py-2 align-top"><b className="text-ink">{p.name}</b><div className="text-[12px] text-muted">{hhmm(p.start_time)}–{hhmm(p.end_time)}</div></td>
                      {days.map((d) => {
                        const s = at(d, p.id);
                        const key = `${d}_${p.id}`;
                        return (
                          <td key={d} className="border-t border-line px-2 py-1.5 align-top">
                            {edit ? (
                              <div className="flex flex-col gap-1">
                                <select name={`s_${key}`} defaultValue={s?.subject_id ?? ""} aria-label={`Subject, ${DAY_SHORT[d]} ${p.name}`} className={sel}>
                                  <option value="">— subject —</option>{(subjects ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                                </select>
                                <select name={`t_${key}`} defaultValue={s?.staff_id ?? ""} aria-label={`Teacher, ${DAY_SHORT[d]} ${p.name}`} className={sel}>
                                  <option value="">— teacher —</option>{(teachers ?? []).map((x) => { const b = busy.get(`${x.id}:${d}:${p.id}`); return <option key={x.id} value={x.id} disabled={Boolean(b) && s?.staff_id !== x.id}>{x.name}{b ? ` — busy in ${b}` : ""}</option>; })}
                                </select>
                                <input name={`r_${key}`} defaultValue={s?.room ?? ""} placeholder="Room" maxLength={30} aria-label={`Room, ${DAY_SHORT[d]} ${p.name}`} className={sel} />
                              </div>
                            ) : s ? (
                              <div><b className="text-ink">{s.subject_id ? subj.get(s.subject_id) : "—"}</b><div className="text-[12px] text-muted">{s.staff_id ? teach.get(s.staff_id) : ""}{s.room ? ` · ${s.room}` : ""}</div></div>
                            ) : <span className="text-muted">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
          {edit && <div className="flex flex-wrap items-center gap-3 print:hidden"><Submit>Save timetable</Submit><span className="text-[12px] text-muted">A teacher who already has a class in that period is shown as “busy in …” and cannot be picked; the database enforces it too.</span></div>}
        </form>
      )}

      {edit && section && (
        <Card title="Copy a day" description="Copy the periods of one day to other days of this section (a teacher who is busy elsewhere is left out).">
          <form action={copyDay} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="section_id" value={section.id} />
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">From
              <select name="from" className="input !min-h-10 !py-2">{days.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}</select>
            </label>
            <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0 text-[14px]">
              <legend className="mb-1 p-0 text-[13px] font-semibold text-ink">To</legend>
              {days.map((d) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="to" value={d} />{DAY_SHORT[d]}</label>)}
            </fieldset>
            <button className="btn btn-sm btn-secondary cursor-pointer">Copy</button>
          </form>
        </Card>
      )}
      {can("academics.timetable.edit") && <p className="m-0 text-[13px] text-muted print:hidden">Periods and breaks: <Link href="/app/timetable/periods">bell schedule</Link> · Workload: <Link href="/app/timetable/load">teacher load</Link></p>}
    </div>
  );
}
