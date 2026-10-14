import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { ClassSection } from "@/components/ClassSection";
import { getClasses } from "@/lib/erp";
import { addDays, cleanSearch, fmtDate, todayIST, waLink } from "@/lib/format";

type Row = { student_id: string; admission_no: string; student_name: string; class_name: string | null; section_name: string | null; guardian_phone: string | null;
  father_name: string | null; marked: number; present: number; absent: number; pct: number; total: number };
const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
const dt = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function Low({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school } = await requirePerm("attendance.students.view");
  const sp = await searchParams;
  const today = todayIST();
  const d2 = dt(sp.to) ?? today;
  const d1 = dt(sp.from) ?? addDays(d2, -29);
  const thr = Math.min(100, Math.max(1, Number(sp.below) || 75));
  const cls = uid(sp.class_id), sec = uid(sp.section_id);
  const q = cleanSearch(sp.q ?? "").trim();
  const { page, size, offset } = pageParams(sp);
  const classes = await getClasses(supabase, school.id);
  const { data, error } = await supabase.rpc("attendance_low", { sid: school.id, d1, d2, thr, cls, sec, p_q: q || null, p_limit: size, p_offset: offset });
  const rows = (data ?? []) as Row[];
  const total = rows[0] ? Number(rows[0].total) : 0;
  const params = { from: d1, to: d2, below: String(thr), class_id: cls ?? undefined, section_id: sec ?? undefined, q: q || undefined };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="attendance" title="Low attendance" subtitle={`Students below ${thr}% between ${fmtDate(d1)} and ${fmtDate(d2)}`} back={{ href: "/app/attendance", label: "Attendance" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input label="From" name="from" type="date" defaultValue={d1} />
        <Input label="To" name="to" type="date" max={today} defaultValue={d2} />
        <Select label="Below" name="below" defaultValue={String(thr)} options={[["60", "60%"], ["75", "75%"], ["85", "85%"], ["90", "90%"]]} />
        <ClassSection key={`${cls}-${sec}`} classes={classes} classId={cls} sectionId={sec} />
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name or admission no." />
        <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Show</button></div>
      </form>
      {error && <Flash error={`Could not load the report: ${error.message}`} />}
      {rows.length ? (
        <Table head={["Student", "Class", "Present", "Absent", "Attendance", "Parent"]} minWidth={760}>
          {rows.map((r) => (
            <tr key={r.student_id}>
              <td className={td}><b className="text-ink">{r.student_name}</b><div className="text-[12px] text-muted">{r.admission_no}</div></td>
              <td className={td}>{[r.class_name, r.section_name].filter(Boolean).join("-")}</td>
              <td className={td}>{r.present} / {r.marked}</td>
              <td className={td}>{r.absent}</td>
              <td className={td}><b className={Number(r.pct) < 60 ? "text-error" : "text-[#b26a00]"}>{r.pct}%</b></td>
              <td className={`${td} text-[13px]`}>
                {r.father_name ?? ""}
                {r.guardian_phone && (
                  <div className="flex gap-3">
                    <a href={`tel:${r.guardian_phone}`}>{r.guardian_phone}</a>
                    <a href={waLink(r.guardian_phone, `Dear Parent, ${r.student_name}'s attendance is ${r.pct}% (${r.present} of ${r.marked} days) between ${fmtDate(d1)} and ${fmtDate(d2)}, below the required level. Please ensure regular attendance.\n— ${school.name}`) ?? undefined} target="_blank" rel="noreferrer">WhatsApp</a>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{error ? "—" : "No student is below this level in the chosen period."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/attendance/low" params={params} />
      <Card title="About this report"><p className="m-0 text-[14px] text-muted">Percent = present, late and half-day marks ÷ days marked. Only days on which attendance was taken count, so a holiday does not hurt anyone.</p></Card>
    </div>
  );
}
