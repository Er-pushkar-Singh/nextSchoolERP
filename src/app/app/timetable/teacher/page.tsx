import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Empty, PageHeader } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { DAY_NAMES, hhmm, workingDays, type Period } from "@/lib/timetable";
import { addDays, fmtDate, todayIST } from "@/lib/format";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
type Slot = { id: string; day: number; period_id: string; room: string | null; subject: { name: string } | { name: string }[] | null;
  section: { name: string; class: { name: string } | { name: string }[] | null } | { name: string; class: { name: string } | { name: string }[] | null }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function TeacherTimetable({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, user } = await requirePerm("academics.timetable.view");
  const sp = await searchParams;
  const { data: staff } = await supabase.from("staff").select("id,name,user_id").eq("school_id", school.id).eq("status", "active").eq("kind", "teaching").order("name");
  const mine = (staff ?? []).find((s) => s.user_id === user.id);
  const chosen = (staff ?? []).find((s) => s.id === uid(sp.staff)) ?? mine ?? (staff ?? [])[0] ?? null;
  const days = workingDays(school.prefs);
  const today = todayIST();
  const [{ data: periods }, { data: slots }, { data: duty }] = await Promise.all([
    supabase.from("periods").select("*").eq("school_id", school.id).order("no"),
    chosen ? supabase.from("timetable_slots").select("id,day,period_id,room,subject:subjects(name),section:sections(name,class:classes(name))").eq("staff_id", chosen.id) : Promise.resolve({ data: [] }),
    chosen ? supabase.from("substitutions").select("on_date,slot_id").eq("substitute_staff_id", chosen.id).gte("on_date", today).lte("on_date", addDays(today, 14)) : Promise.resolve({ data: [] }),
  ]);
  const P = ((periods ?? []) as Period[]).filter((p) => !p.is_break);
  const S = (slots ?? []) as unknown as Slot[];
  const dutySlots = (duty ?? []) as { on_date: string; slot_id: string }[];
  const { data: dutyInfo } = dutySlots.length
    ? await supabase.from("timetable_slots").select("id,period_id,subject:subjects(name),section:sections(name,class:classes(name))").in("id", dutySlots.map((d) => d.slot_id))
    : { data: [] };
  const label = (s: Slot["section"]) => { const x = one(s); const c = x ? one(x.class) : null; return x ? `${c?.name ?? ""}-${x.name}` : ""; };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 print:hidden">
        <PageHeader icon="academics" title="Teacher timetable" subtitle={chosen?.name} back={{ href: "/app/timetable", label: "Timetable" }} actions={<PrintButton />} />
        <form className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Teacher
            <select name="staff" defaultValue={chosen?.id} className="input !min-h-10 !py-2">{(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.user_id === user.id ? " (me)" : ""}</option>)}</select>
          </label>
          <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        </form>
      </div>
      <h1 className="hidden text-[18px] font-bold print:block">{school.name} — Timetable, {chosen?.name}</h1>
      {!chosen ? <Empty>No teaching staff yet. Add staff in HR with type “Teaching”.</Empty> : (
        <>
          <div className="overflow-x-auto rounded-[14px] border border-line bg-white">
            <table className="w-full border-collapse text-[13px]" style={{ minWidth: 140 + days.length * 130 }}>
              <thead><tr className="bg-[#f5f7fb] text-left text-[12px] text-muted"><th className="px-3 py-2">Period</th>{days.map((d) => <th key={d} className="px-2 py-2">{DAY_NAMES[d]}</th>)}</tr></thead>
              <tbody>
                {P.map((p) => (
                  <tr key={p.id}>
                    <td className="border-t border-line px-3 py-2"><b className="text-ink">{p.name}</b><div className="text-[12px] text-muted">{hhmm(p.start_time)}–{hhmm(p.end_time)}</div></td>
                    {days.map((d) => {
                      const s = S.find((x) => x.day === d && x.period_id === p.id);
                      return (
                        <td key={d} className={`border-t border-line px-2 py-2 ${s ? "" : "text-muted"}`}>
                          {s ? <><b className="text-ink">{label(s.section)}</b><div className="text-[12px] text-muted">{one(s.subject)?.name ?? ""}{s.room ? ` · ${s.room}` : ""}</div></> : "free"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dutySlots.length > 0 && (
            <div className="rounded-[14px] border border-[#e0b44a] bg-[#fff8e6] p-4 print:hidden">
              <b className="text-[14px] text-ink">Cover duty in the next two weeks</b>
              <ul className="m-0 mt-2 list-disc pl-5 text-[14px]">
                {dutySlots.map((d) => {
                  const info = (dutyInfo ?? []).find((x) => x.id === d.slot_id) as unknown as (Slot & { period_id: string }) | undefined;
                  const pr = ((periods ?? []) as Period[]).find((p) => p.id === info?.period_id);
                  return <li key={d.slot_id + d.on_date}>{fmtDate(d.on_date)} · {pr?.name} · {info ? label(info.section) : ""} {one(info?.subject ?? null)?.name ?? ""}</li>;
                })}
              </ul>
            </div>
          )}
          <p className="m-0 text-[13px] text-muted print:hidden">Free periods are shown as “free”. <Link href="/app/timetable/cover">Cover board</Link></p>
        </>
      )}
    </div>
  );
}
