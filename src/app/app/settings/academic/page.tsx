import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit } from "@/components/ui/ui";
import { fmtDate } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { addClass, addSection, addSession, addSubject, deleteClass, deleteSection, deleteSubject, makeCurrentSession, promoteAll } from "../../_actions/settings";

const x = "cursor-pointer border-0 bg-transparent px-1 text-muted";

export default async function AcademicSettings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("academics.setup.create");
  const sp = await searchParams;
  const [classes, { data: subjects }, { data: sessions }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("sort").order("name"),
    supabase.from("sessions").select("id,name,start_date,end_date,is_current").eq("school_id", school.id).order("start_date", { ascending: false }),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Classes, subjects & sessions" back={{ href: "/app/settings", label: "Settings centre" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <Card title="Classes & sections">
        <ul className="m-0 mb-4 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[14px]">
              <b className="mr-1 text-ink">{c.name}</b>
              {c.sections.map((s) => (
                <span key={s.id} className="flex items-center rounded-full bg-surface-alt px-2 text-[13px]">{s.name}
                  <form action={deleteSection}><input type="hidden" name="id" value={s.id} /><button aria-label={`Remove section ${s.name}`} className={x}>×</button></form>
                </span>
              ))}
              <form action={deleteClass} className="ml-auto"><input type="hidden" name="id" value={c.id} /><button aria-label={`Remove class ${c.name}`} className={`${x} text-[12px] underline`}>remove</button></form>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-6">
          <form action={addSection} className="flex flex-wrap items-end gap-2">
            <Select label="Add section to" name="class_id" options={classes.map((c) => [c.id, c.name] as [string, string])} />
            <Input label="Section" name="name" placeholder="B" className="w-20" />
            <Submit variant="secondary">Add section</Submit>
          </form>
          <form action={addClass} className="flex flex-wrap items-end gap-2">
            <Input label="New class" name="name" placeholder="e.g. Play Group" />
            <Input label="Order" name="sort" type="number" className="w-24" hint="Lower = earlier" />
            <Submit variant="secondary">Add class</Submit>
          </form>
        </div>
      </Card>

      <Card title="Subjects">
        <ul className="m-0 mb-3 flex list-none flex-wrap gap-2 p-0">
          {(subjects ?? []).map((s) => (
            <li key={s.id} className="flex items-center rounded-full border border-line px-3 py-1 text-[14px]">{s.name}
              <form action={deleteSubject}><input type="hidden" name="id" value={s.id} /><button aria-label={`Remove ${s.name}`} className={x}>×</button></form>
            </li>
          ))}
        </ul>
        <form action={addSubject} className="flex flex-wrap items-end gap-2"><Input label="New subject" name="name" /><Submit variant="secondary">Add</Submit></form>
      </Card>

      <Card title="Academic sessions">
        <ul className="m-0 mb-4 list-none p-0">
          {(sessions ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
              <span><b className="text-ink">{s.name}</b> <span className="text-muted">{fmtDate(s.start_date)} – {fmtDate(s.end_date)}</span></span>
              {s.is_current ? <Badge value="active" text="Current" /> : <form action={makeCurrentSession}><input type="hidden" name="id" value={s.id} /><Submit variant="secondary">Make current</Submit></form>}
            </li>
          ))}
        </ul>
        <form action={addSession} className="flex flex-wrap items-end gap-2">
          <Input label="Name" name="name" placeholder="2027-28" />
          <Input label="Starts" name="start_date" type="date" />
          <Input label="Ends" name="end_date" type="date" />
          <label className="flex items-center gap-1.5 pb-2 text-[14px]"><input type="checkbox" name="make_current" /> Make current</label>
          <Submit variant="secondary">Add session</Submit>
        </form>
        <details className="mt-5 border-t border-line pt-4">
          <summary className="cursor-pointer text-[14px] font-semibold text-ink">Year-end: promote all students to the next class</summary>
          <p className="text-[14px]">Moves every active student up one class (Nursery → LKG … 11 → 12) keeping their section; students in the last class become “passed out”. Fee records, attendance and marks of the old session stay. Do this once, after results, then switch to the new session and set its fee structure.</p>
          <form action={promoteAll} className="flex flex-wrap items-end gap-2"><Input label="Type PROMOTE to confirm" name="confirm" /><Submit variant="danger">Promote students</Submit></form>
        </details>
      </Card>    </div>
  );
}
