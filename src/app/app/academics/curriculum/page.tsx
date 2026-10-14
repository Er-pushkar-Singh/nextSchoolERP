import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, PageHeader, Submit } from "@/components/ui/ui";
import { getClasses } from "@/lib/erp";
import { saveCurriculum } from "../../_actions/academics2";

export default async function Curriculum({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("academics.setup.view");
  const sp = await searchParams;
  const [classes, { data: subjects }, { data: map }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("sort").order("name"),
    supabase.from("class_subjects").select("class_id,subject_id,periods_per_week,is_optional").eq("school_id", school.id),
  ]);
  const edit = can("academics.setup.edit");
  const m = new Map((map ?? []).map((r) => [`${r.class_id}:${r.subject_id}`, r]));
  const input = "input !min-h-8 !w-16 !py-0.5 text-[13px]";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Curriculum" subtitle="Which subjects each class studies, and how many periods a week" back={{ href: "/app/academics", label: "Academic setup" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {!(subjects ?? []).length ? <Empty>Add subjects first in Classes, subjects & sessions.</Empty> : classes.map((c) => {
        const count = (subjects ?? []).filter((s) => m.has(`${c.id}:${s.id}`)).length;
        const total = (subjects ?? []).reduce((t, s) => t + (m.get(`${c.id}:${s.id}`)?.periods_per_week ?? 0), 0);
        return (
          <Card key={c.id} title={`Class ${c.name}`} description={`${count} subjects · ${total} periods a week`}>
            <form action={saveCurriculum} className="flex flex-col gap-3">
              <input type="hidden" name="class_id" value={c.id} />
              <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {(subjects ?? []).map((s) => {
                  const r = m.get(`${c.id}:${s.id}`);
                  return (
                    <li key={s.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[14px]">
                      <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" name={`sub_${s.id}`} defaultChecked={Boolean(r)} disabled={!edit} /><span className="truncate font-semibold text-ink">{s.name}</span></label>
                      <input name={`ppw_${s.id}`} type="number" min={0} max={20} defaultValue={r?.periods_per_week ?? 5} disabled={!edit} aria-label={`Periods a week of ${s.name}`} className={input} />
                      <label className="flex items-center gap-1 text-[12px] text-muted"><input type="checkbox" name={`opt_${s.id}`} value="1" defaultChecked={r?.is_optional} disabled={!edit} />opt.</label>
                    </li>
                  );
                })}
              </ul>
              {edit && <div><Submit variant="secondary">Save class {c.name}</Submit></div>}
            </form>
          </Card>
        );
      })}
    </div>
  );
}
