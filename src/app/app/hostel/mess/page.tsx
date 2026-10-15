import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Empty, Flash, PageHeader, Select, Submit } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { todayIST } from "@/lib/format";
import { saveMess } from "../../_actions/hostel";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEALS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["snacks", "Snacks"], ["dinner", "Dinner"]] as const;
type Item = { hostel_id: string | null; weekday: number; meal: string; items: string };

export default async function Mess({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("hostel.mess.view");
  const sp = await searchParams;
  const [{ data: hs }, { data: menu }] = await Promise.all([
    supabase.from("hostels").select("id,name").eq("school_id", school.id).eq("active", true).order("name"),
    supabase.from("mess_menu").select("hostel_id,weekday,meal,items").eq("school_id", school.id),
  ]);
  const hostels = hs ?? [];
  const all = (menu ?? []) as Item[];
  const hostel = hostels.find((h) => h.id === sp.hostel)?.id ?? null; // null = one menu for the whole school
  const mine = all.filter((m) => m.hostel_id === hostel);
  const cell = (d: number, meal: string) => mine.find((m) => m.weekday === d && m.meal === meal)?.items ?? "";
  const todayDow = ((new Date(`${todayIST()}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="hostel" title="Mess menu" subtitle="The weekly menu boarders and parents can rely on" back={{ href: "/app/hostel", label: "Hostel" }}
        actions={can("hostel.mess.edit") ? (
          <Modal label="Edit menu" title="Edit the weekly menu" size="lg">
            <form action={saveMess} className="flex flex-col gap-3">
              <input type="hidden" name="hostel_id" value={hostel ?? ""} />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]" style={{ minWidth: 640 }}>
                  <thead><tr className="text-left text-muted"><th className="p-1.5">Day</th>{MEALS.map(([, t]) => <th key={t} className="p-1.5">{t}</th>)}</tr></thead>
                  <tbody>
                    {DAYS.map((d, i) => (
                      <tr key={d}>
                        <th className="p-1.5 text-left font-semibold text-ink">{d}</th>
                        {MEALS.map(([k]) => <td key={k} className="p-1"><input name={`m_${i + 1}_${k}`} defaultValue={cell(i + 1, k)} maxLength={200} className="input !min-h-9 !py-1 text-[13px]" aria-label={`${d} ${k}`} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="m-0 text-[12px] text-muted">Leave a box empty to show no meal. Saving replaces this menu.</p>
              <Submit>Save menu</Submit>
            </form>
          </Modal>
        ) : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      {hostels.length > 0 && (
        <form className="flex items-end gap-2">
          <Select label="Menu for" name="hostel" defaultValue={hostel} blank="Whole school" options={hostels.map((h) => [h.id, h.name] as [string, string])} />
          <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        </form>
      )}
      {mine.length === 0 ? <Empty>No menu is set for {hostel ? "this hostel" : "the school"} yet.{can("hostel.mess.edit") ? " Use “Edit menu”." : ""} {hostel && <Link href="/app/hostel/mess">See the school menu</Link>}</Empty> : (
        <div className="overflow-x-auto rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse text-[14px]" style={{ minWidth: 760 }}>
            <thead><tr className="bg-blue-soft text-left text-[12.5px] tracking-[0.02em] text-[#3d4f7a] uppercase"><th className="px-3 py-3">Day</th>{MEALS.map(([, t]) => <th key={t} className="px-3 py-3">{t}</th>)}</tr></thead>
            <tbody>
              {DAYS.map((d, i) => (
                <tr key={d} className={i + 1 === todayDow ? "bg-blue-tint" : ""}>
                  <th className="border-t border-line px-3 py-2.5 text-left font-bold text-ink">{d}{i + 1 === todayDow && <span className="ml-2 text-[11px] font-semibold text-blue">today</span>}</th>
                  {MEALS.map(([k]) => <td key={k} className="border-t border-line px-3 py-2.5 align-top">{cell(i + 1, k) || <span className="text-muted">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
