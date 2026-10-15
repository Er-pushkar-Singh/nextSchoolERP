import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { fmtDate, todayIST } from "@/lib/format";
import { addCheckup, saveHealthRecord } from "../../_actions/wellbeing";

type Stu = { first_name: string; last_name: string | null; admission_no: string; class: { name: string } | { name: string }[] | null };
type Rec = {
  student_id: string; blood_group: string | null; allergies: string | null; conditions: string | null; medications: string | null; vision: string | null; disability: string | null;
  emergency_name: string | null; emergency_phone: string | null; doctor_name: string | null; doctor_phone: string | null; insurance: string | null; notes: string | null; updated_at: string;
  student: Stu | Stu[] | null;
};
type Check = { student_id: string; on_date: string; height_cm: number | null; weight_kg: number | null; bmi: number | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function RecordForm({ r, back, studentName }: { r?: Rec | null; back: string; studentName?: string }) {
  return (
    <form action={saveHealthRecord} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      {r ? <><input type="hidden" name="student_id" value={r.student_id} /><p className="m-0 text-[15px] font-bold text-ink sm:col-span-2">{studentName}</p></>
        : <EntityPicker kind="student" name="student_id" label="Student" required className="sm:col-span-2" placeholder="Type name or admission no." />}
      <Select label="Blood group" name="blood_group" blank="Not known" defaultValue={r?.blood_group} options={BLOOD} />
      <Input label="Vision" name="vision" defaultValue={r?.vision} placeholder="Spectacles, −1.5 …" />
      <Input label="Allergies" name="allergies" defaultValue={r?.allergies} className="sm:col-span-2" placeholder="Peanuts, dust, penicillin…" />
      <Input label="Medical conditions" name="conditions" defaultValue={r?.conditions} className="sm:col-span-2" placeholder="Asthma, epilepsy, diabetes…" />
      <Input label="Regular medication" name="medications" defaultValue={r?.medications} className="sm:col-span-2" />
      <Input label="Disability / special need" name="disability" defaultValue={r?.disability} className="sm:col-span-2" />
      <Input label="Emergency contact" name="emergency_name" defaultValue={r?.emergency_name} />
      <Input label="Emergency phone" name="emergency_phone" defaultValue={r?.emergency_phone} type="tel" />
      <Input label="Family doctor" name="doctor_name" defaultValue={r?.doctor_name} />
      <Input label="Doctor's phone" name="doctor_phone" defaultValue={r?.doctor_phone} type="tel" />
      <Input label="Insurance / policy no." name="insurance" defaultValue={r?.insurance} className="sm:col-span-2" />
      <Textarea label="Notes" name="notes" defaultValue={r?.notes} rows={2} className="sm:col-span-2" />
      <div className="sm:col-span-2"><Submit>Save record</Submit></div>
    </form>
  );
}

export default async function HealthRecords({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("wellbeing.medical.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = (sp.q ?? "").replace(/[%,()*]/g, "").trim().slice(0, 40);
  const alert = sp.alert === "1";
  const editId = sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) ? sp.edit : null;

  let query = supabase.from("student_health")
    .select("*,student:students!inner(first_name,last_name,admission_no,class:classes!class_id(name))", { count: "exact" })
    .eq("school_id", school.id).order("updated_at", { ascending: false }).range(offset, offset + size - 1);
  if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,admission_no.ilike.%${q}%`, { referencedTable: "students" });
  if (alert) query = query.or("allergies.not.is.null,conditions.not.is.null");
  const { data, count } = await query;
  const R = (data ?? []) as unknown as Rec[];
  const ids = R.map((r) => r.student_id);
  const { data: checks } = ids.length
    ? await supabase.from("health_checkups").select("student_id,on_date,height_cm,weight_kg,bmi").in("student_id", ids).order("on_date", { ascending: false }).limit(ids.length * 3)
    : { data: [] };
  const last = new Map<string, Check>();
  for (const c of (checks ?? []) as Check[]) if (!last.has(c.student_id)) last.set(c.student_id, c);
  const edit = editId ? R.find((r) => r.student_id === editId) ?? null : null;
  const params = { q: q || undefined, alert: alert ? "1" : undefined };
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  const base = `/app/health/records${qs ? `?${qs}` : ""}`;
  const today = todayIST();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="health" title="Health records" subtitle="Blood group, allergies, conditions, emergency contact and check-ups" back={{ href: "/app/health", label: "Medical room" }}
        actions={<>
          {can("wellbeing.medical.create") && (
            <Modal label="+ Health check-up" variant="secondary" title="Record a check-up" size="sm">
              <form action={addCheckup} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="back" value={base} />
                <EntityPicker kind="student" name="student_id" label="Student" required className="sm:col-span-2" />
                <Input label="Date" name="on_date" type="date" defaultValue={today} max={today} />
                <Input label="Camp / drive" name="camp" placeholder="Annual health camp" />
                <Input label="Height (cm)" name="height_cm" type="number" step="0.1" min={40} max={230} />
                <Input label="Weight (kg)" name="weight_kg" type="number" step="0.1" min={5} max={200} />
                <Input label="Vision — left" name="vision_left" placeholder="6/6" />
                <Input label="Vision — right" name="vision_right" placeholder="6/9" />
                <Input label="Dental" name="dental" className="sm:col-span-2" />
                <Input label="Remarks" name="remarks" className="sm:col-span-2" />
                <div className="sm:col-span-2"><Submit>Save check-up</Submit></div>
              </form>
            </Modal>
          )}
          {can("wellbeing.medical.create") && <Modal label="+ Health record" title="New health record"><RecordForm back={base} /></Modal>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Student
          <input name="q" defaultValue={q} placeholder="Name or admission no." className="input !min-h-10 w-64 !py-2 text-[15px] font-normal" /></label>
        <label className="flex items-center gap-2 pb-2.5 text-[14px]"><input type="checkbox" name="alert" value="1" defaultChecked={alert} /> Only allergies / conditions</label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        {(q || alert) && <Link href="/app/health/records" className="pb-2 text-[14px]">Clear</Link>}
      </form>

      {R.length ? (
        <Table head={["Student", "Blood", "Allergies & conditions", "Emergency contact", "Last check-up", ""]} minWidth={940}>
          {R.map((r) => {
            const s = one(r.student);
            const c = last.get(r.student_id);
            return (
              <tr key={r.student_id}>
                <td className={td}><Link href={`/app/students/${r.student_id}`} className="font-semibold">{s ? `${s.first_name} ${s.last_name ?? ""}`.trim() : "—"}</Link>
                  <div className="text-[12px] text-muted">{s?.admission_no}{one(s?.class ?? null) ? ` · Class ${one(s!.class!)!.name}` : ""}</div></td>
                <td className={td}><b className="text-ink">{r.blood_group ?? "—"}</b></td>
                <td className={td}>{r.allergies ? <div className="text-[#9a3412]"><b>Allergy:</b> {r.allergies}</div> : null}{r.conditions ? <div>{r.conditions}</div> : null}
                  {!r.allergies && !r.conditions && <span className="text-muted">None recorded</span>}
                  {r.medications && <div className="text-[12px] text-muted">Medication: {r.medications}</div>}</td>
                <td className={td}>{r.emergency_name ?? "—"}<div className="text-[12px] text-muted">{r.emergency_phone}{r.doctor_name ? ` · Dr ${r.doctor_name}` : ""}</div></td>
                <td className={td}>{c ? <>{fmtDate(c.on_date)}<div className="text-[12px] text-muted">{[c.height_cm && `${c.height_cm} cm`, c.weight_kg && `${c.weight_kg} kg`, c.bmi && `BMI ${c.bmi}`].filter(Boolean).join(" · ")}</div></> : <span className="text-muted">—</span>}</td>
                <td className={`${td} whitespace-nowrap text-[13px]`}>{can("wellbeing.medical.edit") && <Link href={`${base}${qs ? "&" : "?"}edit=${r.student_id}`}>Edit</Link>}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{q || alert ? "No health record matches." : "No health records yet. Add the first one — start with students who have an allergy or a medical condition."}</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/health/records" params={params} />

      {edit && (
        <Modal defaultOpen closeHref={base} title="Edit health record">
          <RecordForm r={edit} back={base} studentName={(() => { const s = one(edit.student); return s ? `${s.first_name} ${s.last_name ?? ""}`.trim() : ""; })()} />
        </Modal>
      )}
    </div>
  );
}
