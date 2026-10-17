import { Card, Submit } from "@/components/ui/ui";
import { addAssignment, removeAssignment } from "@/app/app/_actions/access";

export type Assignment = { id: string; section_id: string; subject_id: string | null; is_class_teacher: boolean };

/** Which classes a teacher works with. Without this a teacher (permission scope "assigned") sees no students, attendance or marks. */
export function ClassAssignments({ userId, name, back, assignments, sections, subjects, canEdit }: {
  userId: string; name: string; back: string; assignments: Assignment[]; sections: [string, string][]; subjects: { id: string; name: string }[]; canEdit: boolean;
}) {
  const secName = new Map(sections);
  const subName = new Map(subjects.map((s) => [s.id, s.name]));
  const have = new Set(assignments.filter((a) => !a.subject_id).map((a) => a.section_id));
  return (
    <Card id="classes" title="Classes & subjects" icon="academics"
      description="A teacher sees only the students, attendance and marks of the classes assigned here. Make someone the class teacher of a section, or give them a subject in a section.">
      {assignments.length ? (
        <ul className="m-0 mb-4 flex list-none flex-wrap gap-2 p-0 text-[14px]">
          {assignments.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1">
              <b className="text-ink">{secName.get(a.section_id) ?? "?"}</b>
              <span className="text-muted">{a.is_class_teacher ? "class teacher" : a.subject_id ? subName.get(a.subject_id) ?? "subject" : "all subjects"}</span>
              {canEdit && (
                <form action={removeAssignment} className="inline"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="user_id" value={userId} /><input type="hidden" name="back" value={back} />
                  <button aria-label={`Remove ${secName.get(a.section_id)}`} className="cursor-pointer border-0 bg-transparent p-0 text-[16px] leading-none text-error">×</button></form>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="m-0 mb-4 rounded-[10px] bg-[#fff4e0] px-3 py-2 text-[14px] text-[#7a4b00]">{name} is not assigned to any class yet, so {name} will see no students after signing in.</p>}
      {canEdit && sections.length > 0 && (
        <form action={addAssignment} className="flex flex-col gap-3">
          <input type="hidden" name="user_id" value={userId} /><input type="hidden" name="back" value={back} />
          <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-[13px] font-semibold text-ink">Sections</legend>
            <div className="grid max-h-48 grid-cols-3 gap-1 overflow-y-auto sm:grid-cols-6">
              {sections.map(([id, label]) => <label key={id} className={`flex items-center gap-1.5 text-[14px] ${have.has(id) ? "text-muted" : ""}`}><input type="checkbox" name="section_ids" value={id} /> {label}</label>)}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-end gap-4 text-[14px]">
            <label className="flex items-center gap-1.5"><input type="checkbox" name="is_class_teacher" /> Class teacher</label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold">or only for subject
              <select name="subject_id" className="input !min-h-10 !w-auto !py-2 font-normal"><option value="">All subjects</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <Submit variant="secondary">Assign</Submit>
          </div>
        </form>
      )}
    </Card>
  );
}
