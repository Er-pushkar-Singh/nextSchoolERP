import { Card, Input, Select, Submit, Textarea } from "@/components/ui/ui";
import { StudentFields } from "./StudentFields";
import type { ClassRow } from "@/lib/erp";
import type { AppForm } from "@/lib/applications";

const PRIOR: [string, string][] = [["class8", "Class 8"], ["class9_registration", "Class 9 advance registration"], ["class9", "Class 9 passed"], ["high_school", "High School passed"],
  ["class11_registration", "Class 11 advance registration"], ["intermediate", "Intermediate passed"], ["iti", "ITI"], ["other", "Other"]];

/** One form for a new application and for editing it. `action` is a server action; hidden `id` is added when editing. */
export function ApplicationForm({ action, classes, form, id, enquiryId, appliedClass, rte, rteRef, source, submitLabel }: {
  action: (f: FormData) => void | Promise<void>; classes: ClassRow[]; form: AppForm; id?: string; enquiryId?: string;
  appliedClass?: string | null; rte?: boolean; rteRef?: string | null; source?: string | null; submitLabel: string;
}) {
  const raw = (k: string) => (form[k] ?? null) as string | number | boolean | null;
  const v = (k: string) => { const x = raw(k); return typeof x === "boolean" ? null : x; };
  const contacts = form.contacts ?? [];
  const prior = form.prior?.[0];
  return (
    <form action={action} className="flex flex-col gap-5">
      {id && <input type="hidden" name="id" value={id} />}
      {enquiryId && <input type="hidden" name="enquiry_id" value={enquiryId} />}
      {id && v("aadhaar_enc") ? (
        <>
          <input type="hidden" name="aadhaar_keep" value="1" />
          <input type="hidden" name="keep_aadhaar_enc" value={String(v("aadhaar_enc"))} />
          <input type="hidden" name="keep_aadhaar_last4" value={String(v("aadhaar_last4") ?? "")} />
          <input type="hidden" name="keep_aadhaar_consent" value={String(v("aadhaar_consent") ?? true)} />
        </>
      ) : null}

      <Card title="Application" icon="admissions">
        <div className="grid gap-3 sm:grid-cols-4">
          <Select label="Class applied for" name="applied_class_id" required defaultValue={appliedClass} blank="Select class" options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
          <Input label="Source" name="source" defaultValue={source} placeholder="Walk-in, website, referral…" />
          <label className="flex items-center gap-2 pt-6 text-[14px] font-semibold text-ink"><input type="checkbox" name="rte_applicant" value="1" defaultChecked={rte} className="h-4 w-4" /> RTE (25% quota) applicant</label>
          <Input label="RTE reference / lottery no." name="rte_reference" defaultValue={rteRef} />
        </div>
      </Card>

      <Card title="Student, parents, address & previous school" icon="students">
        <div className="flex flex-col gap-5"><StudentFields v={raw} classes={classes} showClass={false} showAdmission={false} /></div>
      </Card>

      <Card title="Contacts — guardian, emergency and pickup" icon="account" description="One parent is enough; add a legal guardian or anyone allowed to collect the child.">
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => {
            const c = contacts[i];
            return (
              <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-4">
                <Input label={`Contact ${i + 1} name`} name={`c_name_${i}`} defaultValue={c?.name} />
                <Input label="Relation" name={`c_relation_${i}`} defaultValue={c?.relation} placeholder="Father, Uncle…" />
                <Input label="Mobile" name={`c_phone_${i}`} type="tel" defaultValue={c?.phone} />
                <Input label="Occupation" name={`c_occupation_${i}`} defaultValue={c?.occupation} />
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={`c_primary_${i}`} value="1" defaultChecked={c?.is_primary} className="h-4 w-4" /> Primary</label>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={`c_emergency_${i}`} value="1" defaultChecked={c?.is_emergency} className="h-4 w-4" /> Emergency</label>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={`c_pickup_${i}`} value="1" defaultChecked={c?.can_pickup} className="h-4 w-4" /> May collect the child</label>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Earlier examination (one entry; add more later on the student page)" icon="academics">
        <div className="grid gap-3 sm:grid-cols-4">
          <Select label="Stage" name="p_level" defaultValue={prior?.level ?? "class8"} options={PRIOR} />
          <Input label="Board" name="p_board" defaultValue={prior?.board_name} />
          <Input label="Year" name="p_year" defaultValue={prior?.exam_year as string | number | undefined} />
          <Input label="Roll no. (अनुक्रमांक)" name="p_roll" defaultValue={prior?.roll_no} />
          <Input label="Registration no." name="p_reg" defaultValue={prior?.registration_no} />
          <Input label="School name" name="p_school" defaultValue={prior?.school_name} className="sm:col-span-2" />
          <Input label="District code" name="p_dcode" defaultValue={prior?.district_code} />
          <Input label="School code" name="p_scode" defaultValue={prior?.school_code} />
          <Input label="Result" name="p_result" defaultValue={prior?.result} />
        </div>
      </Card>

      <Card title="Identity & health (restricted)" icon="school" description="Stored in the protected section of the student record after admission.">
        <div className="grid gap-3 sm:grid-cols-4">
          <Input label="PEN" name="pen" defaultValue={v("pen")} />
          <Input label="APAAR ID" name="apaar_id" defaultValue={v("apaar_id")} hint="12 digits" />
          <Input label={v("aadhaar_last4") ? `Aadhaar (on file …${v("aadhaar_last4")}) — type to replace` : "Aadhaar number"} name="aadhaar" placeholder="12 digits" />
          <label className="flex items-center gap-2 pt-6 text-[13px] text-ink"><input type="checkbox" name="aadhaar_consent" value="1" className="h-4 w-4" /> Parent consented to Aadhaar being recorded</label>
          <Input label="Allergies" name="allergies" defaultValue={v("allergies")} />
          <Input label="Medical conditions" name="medical_conditions" defaultValue={v("medical_conditions")} />
          <Input label="Medication" name="medication" defaultValue={v("medication")} />
          <Input label="Disability (if any)" name="disability" defaultValue={v("disability")} />
          <Select label="Disability type" name="disability_type" blank="—" defaultValue={v("disability_type")}
            options={[["visual", "Visually impaired"], ["hearing", "Hearing impaired / deaf"], ["speech", "Speech impaired"], ["locomotor", "Locomotor"], ["hand", "Hand disability"], ["multiple", "Multiple"], ["other", "Other"]]} />
          <Input label="Disability %" name="disability_percent" type="number" min={0} max={100} step="0.01" defaultValue={v("disability_percent")} />
          <Input label="Accommodations needed" name="accommodations" defaultValue={v("accommodations")} className="sm:col-span-2" />
        </div>
      </Card>

      {!id && <label className="flex items-center gap-2 text-[13px] text-muted"><input type="checkbox" name="allow_duplicate" value="1" className="h-4 w-4" /> This is a different child even if name, date of birth and father match an existing application</label>}
      <Textarea label="Admission notes" name="admission_notes" defaultValue={v("admission_notes") as string} rows={2} />
      <div><Submit>{submitLabel}</Submit></div>
    </form>
  );
}
