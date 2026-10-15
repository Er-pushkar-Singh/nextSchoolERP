import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Submit, td } from "@/components/ui/ui";
import { fmtDate, todayIST } from "@/lib/format";
import { saveRollcall } from "../../_actions/hostel";

type Al = { student_id: string; student_name: string; admission_no: string; class_name: string | null; room_no: string; bed_no: number };
type Mark = { student_id: string; status: string; note: string | null; marked_by_name: string | null };

export default async function Rollcall({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("hostel.rollcall.view");
  const sp = await searchParams;
  const today = todayIST();
  const on = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") && sp.date! <= today ? sp.date! : today;
  const slot = sp.slot === "morning" ? "morning" : "night";
  const { data: hs } = await supabase.from("hostels").select("id,name").eq("school_id", school.id).eq("active", true).order("name");
  const hostels = hs ?? [];
  const cur = hostels.find((h) => h.id === sp.hostel) ?? hostels[0] ?? null;
  const [{ data: al }, { data: mk }] = cur ? await Promise.all([
    supabase.rpc("hostel_allocation_list", { sid: school.id, p_hostel: cur.id, p_status: "active", p_limit: 200, p_offset: 0 }),
    supabase.from("hostel_attendance").select("student_id,status,note,marked_by_name").eq("hostel_id", cur.id).eq("on_date", on).eq("slot", slot),
  ]) : [{ data: [] }, { data: [] }];
  const A = ((al ?? []) as Al[]).sort((a, b) => a.room_no.localeCompare(b.room_no, undefined, { numeric: true }) || a.bed_no - b.bed_no);
  const marks = new Map(((mk ?? []) as Mark[]).map((m) => [m.student_id, m]));
  const saved = marks.size > 0;
  const count = (s: string) => [...marks.values()].filter((m) => m.status === s).length;
  const edit = can("hostel.rollcall.create");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="hostel" title="Night roll call" subtitle="Mark every boarder present, absent or on leave" back={{ href: "/app/hostel", label: "Hostel" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <Select label="Hostel" name="hostel" defaultValue={cur?.id} options={hostels.map((h) => [h.id, h.name] as [string, string])} />
        <Input label="Date" name="date" type="date" defaultValue={on} max={today} />
        <Select label="Roll call" name="slot" defaultValue={slot} options={[["night", "Night"], ["morning", "Morning"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Open</button>
      </form>

      {!cur ? <Empty>No hostel yet.</Empty> : A.length === 0 ? <Empty>No student lives in {cur.name}.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Boarders" value={A.length} icon="hostel" />
            <Stat label="Present" value={saved ? count("P") : "—"} icon="attendance" tone="green" />
            <Stat label="Absent" value={saved ? count("A") : "—"} icon="notifications" tone={count("A") ? "rose" : "green"} />
            <Stat label="On leave" value={saved ? count("LV") : "—"} icon="route" tone="amber" />
          </div>
          {saved && <p className="m-0 text-[13px] text-muted">Saved for {fmtDate(on)} · {slot} roll call. You can change it and save again.</p>}
          <form action={saveRollcall} className="flex flex-col gap-3">
            <input type="hidden" name="hostel_id" value={cur.id} /><input type="hidden" name="on_date" value={on} /><input type="hidden" name="slot" value={slot} />
            <div className="overflow-x-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
              <table className="w-full border-collapse text-[14px]" style={{ minWidth: 720 }}>
                <thead><tr className="bg-blue-soft text-left text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase">
                  <th className="px-3 py-3 font-bold">Room · bed</th><th className="px-3 py-3 font-bold">Student</th><th className="px-3 py-3 font-bold">Status</th><th className="px-3 py-3 font-bold">Note</th></tr></thead>
                <tbody>
                  {A.map((s) => {
                    const m = marks.get(s.student_id);
                    const v = m?.status ?? "P";
                    return (
                      <tr key={s.student_id}>
                        <td className={`${td} whitespace-nowrap`}>{s.room_no} · {s.bed_no}</td>
                        <td className={td}><Link href={`/app/students/${s.student_id}`} className="font-semibold">{s.student_name}</Link><div className="text-[12px] text-muted">{s.admission_no} · {s.class_name}</div></td>
                        <td className={td}>
                          <div className="flex gap-1.5" role="radiogroup" aria-label={`Status of ${s.student_name}`}>
                            {([["P", "Present"], ["A", "Absent"], ["LV", "Leave"]] as const).map(([k, t]) => (
                              <label key={k} className="cursor-pointer">
                                <input type="radio" name={`st_${s.student_id}`} value={k} defaultChecked={v === k} disabled={!edit} className="peer sr-only" />
                                <span className={`inline-block rounded-full border border-line px-3 py-1 text-[13px] font-semibold text-body peer-checked:text-white peer-focus-visible:ring-2 ${k === "P" ? "peer-checked:border-[#15803d] peer-checked:bg-[#15803d]" : k === "A" ? "peer-checked:border-[#dc2626] peer-checked:bg-[#dc2626]" : "peer-checked:border-[#d97706] peer-checked:bg-[#d97706]"}`}>{t}</span>
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className={td}><input name={`note_${s.student_id}`} defaultValue={m?.note ?? ""} disabled={!edit} placeholder="Reason, if any" className="input !min-h-9 !py-1 text-[14px]" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {edit ? <div className="flex items-center gap-3"><Submit>Save roll call</Submit>{saved && m_by(marks) && <span className="text-[13px] text-muted">Last saved by {m_by(marks)}</span>}</div>
              : <Badge value="muted" text="View only" />}
          </form>
        </>
      )}
    </div>
  );
}

function m_by(marks: Map<string, Mark>) {
  for (const m of marks.values()) if (m.marked_by_name) return m.marked_by_name;
  return null;
}
