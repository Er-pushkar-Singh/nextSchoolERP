import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Empty, Flash, PageHeader, Submit } from "@/components/ui/ui";
import { fullName } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { saveMarks } from "../../../_actions/academics";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function Marks({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ class_id?: string; section_id?: string; ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const cls = uid(sp.class_id);
  if (!uid(id) || !cls) notFound();
  const { supabase, school, scope, user } = await requirePerm("exams.marks.create", "exams.marks.edit");
  const [{ data: exam }, classes, { data: es }] = await Promise.all([
    supabase.from("exams").select("id,name").eq("id", id).eq("school_id", school.id).maybeSingle(),
    getClasses(supabase, school.id),
    supabase.from("exam_subjects").select("subject_id,max_marks,subjects(name,sort)").eq("exam_id", id).eq("class_id", cls),
  ]);
  if (!exam) notFound();
  const assignedOnly = scope("exams.marks.create") !== "school";
  const { data: mine } = assignedOnly ? await supabase.from("staff_assignments").select("section_id,subject_id").eq("user_id", user.id).eq("school_id", school.id) : { data: null };
  const fullClass = classes.find((c) => c.id === cls);
  const klass = fullClass && assignedOnly ? { ...fullClass, sections: fullClass.sections.filter((x) => (mine ?? []).some((m) => m.section_id === x.id)) } : fullClass;
  const sec = uid(sp.section_id) ?? (klass && (klass.sections.length === 1 || assignedOnly) ? klass.sections[0]?.id ?? null : null);
  const allowedSub = (sid: string) => !assignedOnly || (mine ?? []).some((m) => m.section_id === sec && (m.subject_id === null || m.subject_id === sid));
  const subs = ((es ?? []) as unknown as { subject_id: string; max_marks: number; subjects: { name: string; sort: number } }[]).filter((x) => allowedSub(x.subject_id)).sort((a, b) => a.subjects.sort - b.subjects.sort);
  let q = supabase.from("students").select("id,first_name,last_name,roll_no").eq("school_id", school.id).eq("class_id", cls).eq("status", "active");
  if (sec) q = q.eq("section_id", sec);
  const { data: students } = await q.order("roll_no", { nullsFirst: false }).order("first_name");
  const ids = (students ?? []).map((s) => s.id);
  const { data: marks } = ids.length ? await supabase.from("marks").select("student_id,subject_id,marks,absent").eq("exam_id", id).in("student_id", ids) : { data: [] };
  const val = new Map((marks ?? []).map((m) => [`${m.student_id}_${m.subject_id}`, m.absent ? "AB" : m.marks === null ? "" : String(Number(m.marks))]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={`${exam.name} · Class ${klass?.name ?? ""}`} subtitle="Type marks; AB = absent. Tab moves across." back={{ href: `/app/exams/${id}`, label: exam.name }} />
      <Flash ok={sp.ok} error={sp.error} />
      {klass && klass.sections.length > 1 && (
        <nav className="flex flex-wrap gap-2">{klass.sections.map((s) => <a key={s.id} href={`/app/exams/${id}/marks?class_id=${cls}&section_id=${s.id}`} className={`chip ${s.id === sec ? "!border-ink" : ""}`}>Section {s.name}</a>)}</nav>
      )}
      {!subs.length ? <Empty>No subjects set for this class in this exam.</Empty> : !(students ?? []).length ? <Empty>No students.</Empty> : (
        <form action={saveMarks} className="flex flex-col gap-4">
          <input type="hidden" name="exam_id" value={id} /><input type="hidden" name="class_id" value={cls} />{sec && <input type="hidden" name="section_id" value={sec} />}
          <div className="overflow-x-auto rounded-[12px] border border-line bg-white">
            <table className="border-collapse text-[14px]">
              <thead><tr className="bg-surface-alt"><th className="sticky left-0 bg-surface-alt px-3 py-2 text-left">Student</th>{subs.map((s) => <th key={s.subject_id} className="px-2 py-2 text-center font-semibold whitespace-nowrap">{s.subjects.name}<div className="text-[11px] font-normal text-muted">/{Number(s.max_marks)}</div></th>)}</tr></thead>
              <tbody>
                {(students ?? []).map((st) => (
                  <tr key={st.id} className="border-t border-line">
                    <td className="sticky left-0 bg-white px-3 py-1.5 whitespace-nowrap">{st.roll_no ? `${st.roll_no}. ` : ""}{fullName(st)}</td>
                    {subs.map((s) => (
                      <td key={s.subject_id} className="px-1 py-1">
                        <input name={`m_${st.id}_${s.subject_id}`} defaultValue={val.get(`${st.id}_${s.subject_id}`) ?? ""} inputMode="decimal" aria-label={`${fullName(st)} ${s.subjects.name}`} className="w-16 rounded-md border border-line px-2 py-1.5 text-center" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sticky bottom-3"><Submit>Save marks</Submit></div>
        </form>
      )}
    </div>
  );
}
