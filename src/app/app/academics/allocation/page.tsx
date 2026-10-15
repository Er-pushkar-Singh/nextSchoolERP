import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Submit } from "@/components/ui/ui";
import { getClasses } from "@/lib/erp";
import { saveAllocation } from "../../_actions/academics2";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function Allocation({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("academics.allocation.view", "academics.setup.view");
  const sp = await searchParams;
  const classes = await getClasses(supabase, school.id);
  const sections = classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, class_id: c.id, label: `${c.name}-${s.name}` })));
  const sec = sections.find((s) => s.id === uid(sp.section)) ?? sections[0] ?? null;
  const edit = can("academics.allocation.edit") || can("academics.allocation.create");
  const [{ data: members }, { data: assigns }, { data: map }, { data: subjects }, { data: sectionRow }] = await Promise.all([
    supabase.from("school_members").select("user_id,name").eq("school_id", school.id).order("name"),
    sec ? supabase.from("staff_assignments").select("user_id,subject_id,is_class_teacher").eq("section_id", sec.id) : Promise.resolve({ data: [] }),
    sec ? supabase.from("class_subjects").select("subject_id,periods_per_week,is_optional").eq("class_id", sec.class_id) : Promise.resolve({ data: [] }),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("name"),
    sec ? supabase.from("sections").select("capacity,room").eq("id", sec.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const subj = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const mapped = (map ?? []).filter((m) => subj.has(m.subject_id)).sort((a, b) => subj.get(a.subject_id)!.localeCompare(subj.get(b.subject_id)!));
  const ct = (assigns ?? []).find((a) => a.is_class_teacher)?.user_id ?? "";
  const teacherOf = (sid: string) => (assigns ?? []).find((a) => a.subject_id === sid && !a.is_class_teacher)?.user_id ?? "";
  const sel = "input !min-h-9 !py-1 text-[14px]";
  const people = (members ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Teacher allocation" subtitle="Class teacher and subject teachers per section — these drive “assigned” permissions" back={{ href: "/app/academics", label: "Academic setup" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Section
          <select name="section" defaultValue={sec?.id} className="input !min-h-10 !py-2">{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Open</button>
      </form>
      {!sec ? <Empty>Add classes and sections first.</Empty> : (
        <Card title={`Class ${sec.label}`}>
          <form action={saveAllocation} className="flex flex-col gap-4">
            <input type="hidden" name="section_id" value={sec.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Class teacher
                <select name="class_teacher" defaultValue={ct} disabled={!edit} className={sel}><option value="">— none —</option>{people}</select>
              </label>
              <Input label="Capacity (seats)" name="capacity" type="number" min={1} defaultValue={sectionRow?.capacity ?? ""} />
              <Input label="Room" name="room" defaultValue={sectionRow?.room ?? ""} />
            </div>
            <div>
              <h3 className="m-0 mb-2 text-[15px] font-bold text-ink">Subject teachers</h3>
              {mapped.length ? (
                <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
                  {mapped.map((m) => (
                    <li key={m.subject_id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                      <span className="w-32 shrink-0 text-[14px] font-semibold text-ink">{subj.get(m.subject_id)}<span className="block text-[11px] font-normal text-muted">{m.periods_per_week} periods{m.is_optional ? " · optional" : ""}</span></span>
                      <select name={`t_${m.subject_id}`} defaultValue={teacherOf(m.subject_id)} disabled={!edit} aria-label={`Teacher of ${subj.get(m.subject_id)}`} className={`${sel} min-w-0 flex-1`}>
                        <option value="">— not assigned —</option>{people}
                      </select>
                    </li>
                  ))}
                </ul>
              ) : <p className="m-0 text-[14px] text-muted">No subjects are mapped to this class yet. Set the <a href="/app/academics/curriculum">curriculum</a> first.</p>}
            </div>
            {edit && <div><Submit>Save allocation</Submit></div>}
          </form>
          <p className="mt-3 mb-0 text-[12px] text-muted">Only people with a school login are listed; an allocated teacher sees this section&apos;s students, attendance, marks and homework (for “assigned” permissions).</p>
        </Card>
      )}
    </div>
  );
}
