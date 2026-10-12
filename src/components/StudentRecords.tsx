import Link from "next/link";
import { Badge, Card, Input, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { fmtDate, todayIST } from "@/lib/format";
import { DOC_TYPES } from "@/lib/student-docs";
import { addContact, deleteDocument, deletePriorExam, markDocumentPending, removeContact, reviewDocument, saveIdentity, savePriorExam, uploadDocument } from "@/app/app/_actions/student-records";
import { maskAadhaar } from "@/lib/aadhaar";

export type Sensitive = {
  pen: string | null; apaar_id: string | null; apaar_status: string; apaar_consent: boolean; apaar_consent_by: string | null; apaar_consent_on: string | null;
  identity_verified_on: string | null; identity_note: string | null; allergies: string | null; medical_conditions: string | null; medication: string | null;
  disability: string | null; accommodations: string | null; doctor_name: string | null; doctor_phone: string | null; internal_notes: string | null;
  aadhaar_last4?: string | null; aadhaar_consent?: boolean; disability_type?: string | null; disability_percent?: number | null;
};
export type Prior = { id: string; level: string; board_name: string | null; exam_year: number | null; roll_no: string | null; registration_no: string | null; school_name: string | null; district_code: string | null; school_code: string | null; result: string | null; percentage: number | null };
export type Doc = {
  id: string; doc_type: string; title: string | null; status: string; file_name: string | null; due_by: string | null; uploaded_by_name: string | null;
  uploaded_at: string | null; verified_by_name: string | null; verified_at: string | null; reject_reason: string | null; remark: string | null; size_bytes: number | null;
};
export type Contact = { guardian_id: string; is_primary: boolean; guardians: { name: string; relation: string | null; phone: string | null; occupation: string | null; is_emergency: boolean; can_pickup: boolean } | null };
export type Enrolment = { id: string; class_name: string | null; section_name: string | null; roll_no: number | null; started_on: string; ended_on: string | null; outcome: string; sessions: { name: string } | null };

const docTone: Record<string, string> = { uploaded: "sent", verified: "paid", rejected: "overdue", pending: "due", not_applicable: "cancelled" };
const APAAR = [["not_created", "Not created"], ["requested", "Requested (consent taken)"], ["generated", "Generated"], ["verified", "Verified against records"], ["mismatch", "Mismatch — correction needed"]] as [string, string][];

export function IdentityCard({ studentId, s, canEdit }: { studentId: string; s: Sensitive | null; canEdit: boolean }) {
  const f = <T extends keyof Sensitive>(k: T) => s?.[k] ?? null;
  return (
    <Card title="Identity & health" icon="students" className="scroll-mt-4" description="Restricted: only people with the sensitive-data permission can see this section.">
      <span id="identity" />
      <form action={saveIdentity} className="flex flex-col gap-4">
        <input type="hidden" name="student_id" value={studentId} />
        <fieldset disabled={!canEdit} className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="mb-1 text-[14px] font-bold text-ink">Identifiers</legend>
          <Input label="PEN" name="pen" defaultValue={f("pen")} hint="Permanent Enrolment Number (UDISE+)" />
          <Input label="APAAR ID" name="apaar_id" defaultValue={f("apaar_id")} hint="12 digits" />
          <Select label="APAAR status" name="apaar_status" defaultValue={s?.apaar_status ?? "not_created"} options={APAAR} />
          <Input label="Identity checked on" name="identity_verified_on" type="date" defaultValue={f("identity_verified_on")} hint="Name / DOB / gender matched" />
          <label className="flex items-center gap-2 text-[14px] font-semibold text-ink sm:col-span-2">
            <input type="checkbox" name="apaar_consent" value="1" defaultChecked={s?.apaar_consent} className="h-4 w-4" /> Parent / guardian consent taken for the APAAR ID
          </label>
          <Input label="Consent given by" name="apaar_consent_by" defaultValue={f("apaar_consent_by")} />
          <Input label="Consent date" name="apaar_consent_on" type="date" defaultValue={f("apaar_consent_on")} />
          <Input label="Identity note" name="identity_note" defaultValue={f("identity_note")} className="sm:col-span-4" hint="e.g. spelling correction requested, reason" />
        </fieldset>
        <fieldset disabled={!canEdit} className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="mb-1 text-[14px] font-bold text-ink">Aadhaar <span className="font-normal text-muted">(asked on the UP Board form; stored encrypted)</span></legend>
          <div className="text-[14px] sm:col-span-2">
            <p className="m-0 text-muted">On file</p>
            <p className="m-0 font-mono font-semibold text-ink">{maskAadhaar(s?.aadhaar_last4)}</p>
          </div>
          <Input label={s?.aadhaar_last4 ? "Replace Aadhaar number" : "Aadhaar number"} name="aadhaar" placeholder="12 digits" hint="Leave blank to keep what is on file" />
          <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" name="aadhaar_consent" value="1" defaultChecked={s?.aadhaar_consent} className="h-4 w-4" /> Parent / guardian consented</label>
          {s?.aadhaar_last4 && <label className="flex items-center gap-2 text-[13px] text-error"><input type="checkbox" name="aadhaar_remove" value="1" className="h-4 w-4" /> Remove the stored number</label>}
        </fieldset>
        <fieldset disabled={!canEdit} className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-1 text-[14px] font-bold text-ink">Health & safety</legend>
          <Input label="Allergies" name="allergies" defaultValue={f("allergies")} />
          <Input label="Medical conditions" name="medical_conditions" defaultValue={f("medical_conditions")} />
          <Input label="Medication instructions" name="medication" defaultValue={f("medication")} />
          <Input label="Disability (if any)" name="disability" defaultValue={f("disability")} />
          <Select label="Disability type" name="disability_type" blank="—" defaultValue={s?.disability_type}
            options={[["visual", "Visually impaired"], ["hearing", "Hearing impaired / deaf"], ["speech", "Speech impaired"], ["locomotor", "Locomotor (cannot walk fully)"], ["hand", "Hand disability"], ["multiple", "Multiple"], ["other", "Other"]]} />
          <Input label="Disability %" name="disability_percent" type="number" min={0} max={100} step="0.01" defaultValue={s?.disability_percent ?? null} />
          <Input label="Accommodations needed" name="accommodations" defaultValue={f("accommodations")} className="sm:col-span-2" />
          <Input label="Family doctor" name="doctor_name" defaultValue={f("doctor_name")} />
          <Input label="Doctor phone" name="doctor_phone" type="tel" defaultValue={f("doctor_phone")} />
          <Textarea label="Internal notes" name="internal_notes" defaultValue={f("internal_notes") as string} rows={2} className="sm:col-span-2" />
        </fieldset>
        {canEdit && <div><Submit>Save identity & health</Submit></div>}
      </form>
    </Card>
  );
}

export function DocumentsCard({ studentId, docs, can }: { studentId: string; docs: Doc[]; can: (k: string) => boolean }) {
  const byType = new Map(docs.filter((d) => d.doc_type !== "other").map((d) => [d.doc_type, d]));
  const others = docs.filter((d) => d.doc_type === "other");
  const today = todayIST();
  const rows = [...DOC_TYPES.filter(([k]) => k !== "other").map(([k, name]) => ({ key: k, name, d: byType.get(k) ?? null })), ...others.map((d) => ({ key: d.id, name: d.title || "Other", d }))];
  return (
    <Card title="Documents" icon="layers" description="Stored privately. A missing document can be marked pending — it never blocks the admission.">
      <span id="documents" />
      <Table head={["Document", "Status", "Details", ""]} minWidth={760}>
        {rows.filter((r) => r.d || can("students.documents.create")).map(({ key, name, d }) => (
          <tr key={key}>
            <td className={`${td} font-semibold text-ink`}>{name}</td>
            <td className={td}>{d ? <Badge value={docTone[d.status] ?? "neutral"} text={d.status.replace("_", " ")} /> : <span className="text-[13px] text-muted">not recorded</span>}</td>
            <td className={`${td} text-[13px]`}>
              {d?.file_name && <div>{d.file_name}{d.size_bytes ? ` · ${Math.round(d.size_bytes / 1024)} KB` : ""}</div>}
              {d?.uploaded_at && <div className="text-muted">uploaded {fmtDate(d.uploaded_at)}{d.uploaded_by_name ? ` by ${d.uploaded_by_name}` : ""}</div>}
              {d?.verified_at && <div className="text-muted">{d.status} {fmtDate(d.verified_at)}{d.verified_by_name ? ` by ${d.verified_by_name}` : ""}</div>}
              {d?.reject_reason && <div className="text-error">Reason: {d.reject_reason}</div>}
              {d?.status === "pending" && d.due_by && <div className={d.due_by < today ? "font-semibold text-error" : "text-muted"}>to be submitted by {fmtDate(d.due_by)}</div>}
            </td>
            <td className={`${td} whitespace-nowrap text-[13px]`}>
              {d?.file_name && can("students.documents.view") && <a href={`/app/students/${studentId}/documents/${d.id}`} className="mr-3">Download</a>}
              {d && d.status === "uploaded" && can("students.documents.approve") && (
                <form action={reviewDocument} className="mt-1 flex flex-wrap items-center gap-1">
                  <input type="hidden" name="id" value={d.id} /><input type="hidden" name="student_id" value={studentId} />
                  <button name="status" value="verified" className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Verify</button>
                  <input name="reject_reason" placeholder="Reason to reject" aria-label="Reason to reject" className="input !min-h-8 w-32 !py-1 text-[13px]" />
                  <button name="status" value="rejected" className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Reject</button>
                </form>
              )}
              {d && can("students.documents.delete") && (
                <form action={deleteDocument} className="mt-1"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="student_id" value={studentId} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Remove</button></form>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {can("students.documents.create") && (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <form action={uploadDocument} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="student_id" value={studentId} />
            <p className="m-0 text-[14px] font-bold text-ink sm:col-span-2">Upload a document</p>
            <Select label="Type" name="doc_type" options={DOC_TYPES} defaultValue="birth_certificate" />
            <Input label="Title (for “Other”)" name="title" />
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink sm:col-span-2">File — PDF, JPG or PNG (photo: JPG/PNG, max 1 MB; others max 5 MB)
              <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="input !min-h-10 !py-1.5 text-[14px] font-normal" />
            </label>
            <div><Submit>Upload</Submit></div>
          </form>
          <form action={markDocumentPending} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="student_id" value={studentId} />
            <p className="m-0 text-[14px] font-bold text-ink sm:col-span-2">Not available now</p>
            <Select label="Type" name="doc_type" options={DOC_TYPES} defaultValue="transfer_certificate" />
            <Input label="Will submit by" name="due_by" type="date" />
            <Input label="Remark" name="remark" className="sm:col-span-2" />
            <label className="flex items-center gap-2 text-[13px] text-ink sm:col-span-2"><input type="checkbox" name="not_applicable" value="1" className="h-4 w-4" /> Not applicable for this student</label>
            <div><Submit variant="secondary">Record as pending</Submit></div>
          </form>
        </div>
      )}
    </Card>
  );
}

export function ContactsCard({ studentId, contacts, canEdit }: { studentId: string; contacts: Contact[]; canEdit: boolean }) {
  return (
    <Card title="Guardians, emergency & pickup contacts" icon="account" description="Add a legal guardian or anyone allowed to collect the child. One parent is enough.">
      <span id="contacts" />
      {contacts.length ? (
        <Table head={["Name", "Relation", "Phone", "Roles", ""]} minWidth={640}>
          {contacts.map((c) => (
            <tr key={c.guardian_id}>
              <td className={`${td} font-semibold text-ink`}>{c.guardians?.name}{c.guardians?.occupation && <div className="text-[12px] font-normal text-muted">{c.guardians.occupation}</div>}</td>
              <td className={td}>{c.guardians?.relation ?? "—"}</td>
              <td className={td}>{c.guardians?.phone ?? "—"}</td>
              <td className={td}><span className="flex flex-wrap gap-1">
                {c.is_primary && <Badge value="active" text="Primary" />}
                {c.guardians?.is_emergency && <Badge value="overdue" text="Emergency" />}
                {c.guardians?.can_pickup && <Badge value="contacted" text="Pickup allowed" />}
              </span></td>
              <td className={td}>{canEdit && <form action={removeContact}><input type="hidden" name="student_id" value={studentId} /><input type="hidden" name="guardian_id" value={c.guardian_id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove</button></form>}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="m-0 text-[14px] text-muted">No extra contacts yet. The parents' names and WhatsApp number are on the student form.</p>}
      {canEdit && (
        <form action={addContact} className="mt-4 grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="student_id" value={studentId} />
          <Input label="Name" name="name" required />
          <Input label="Relation" name="relation" placeholder="Mother, Guardian, Uncle…" />
          <Input label="Mobile" name="phone" type="tel" />
          <Input label="Occupation" name="occupation" />
          <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" name="is_primary" value="1" className="h-4 w-4" /> Primary contact</label>
          <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" name="is_emergency" value="1" className="h-4 w-4" /> Emergency contact</label>
          <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" name="can_pickup" value="1" className="h-4 w-4" /> May collect the child</label>
          <div><Submit variant="secondary">Add contact</Submit></div>
        </form>
      )}
    </Card>
  );
}

export function EnrolmentHistoryCard({ rows }: { rows: Enrolment[] }) {
  if (!rows.length) return null;
  return (
    <Card title="Class history" icon="academics" description="Every class this student has been in — promotion never overwrites it.">
      <Table head={["Session", "Class", "Roll", "From", "To", "Outcome"]} minWidth={560}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={td}>{r.sessions?.name ?? "—"}</td>
            <td className={`${td} font-semibold text-ink`}>{r.class_name ?? "—"}{r.section_name ? `-${r.section_name}` : ""}</td>
            <td className={td}>{r.roll_no ?? "—"}</td>
            <td className={td}>{fmtDate(r.started_on)}</td>
            <td className={td}>{r.ended_on ? fmtDate(r.ended_on) : <span className="text-muted">current</span>}</td>
            <td className={td}><Badge value={r.outcome === "continuing" ? "active" : r.outcome === "promoted" ? "paid" : r.outcome === "detained" ? "due" : "cancelled"} text={r.outcome.replace("_", " ")} /></td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 mb-0 text-[12px] text-muted"><Link href="/app/settings/academic">Year-end promotion</Link> adds a row here for every student.</p>
    </Card>
  );
}

const PRIOR_LABEL: [string, string][] = [
  ["class8", "Class 8 (or earlier school)"], ["class9_registration", "Class 9 advance registration"], ["class9", "Class 9 passed"], ["high_school", "High School (Class 10) passed"],
  ["class11_registration", "Class 11 advance registration"], ["intermediate", "Intermediate (Class 12) passed"], ["iti", "ITI"], ["other", "Other"],
];

export function PriorExamsCard({ studentId, rows, canEdit }: { studentId: string; rows: Prior[]; canEdit: boolean }) {
  const name = new Map(PRIOR_LABEL);
  return (
    <Card title="Earlier examinations & registrations" icon="academics" description="As asked on the UP Board exam form: year, roll number (अनुक्रमांक), school and board codes.">
      <span id="prior" />
      {rows.length ? (
        <Table head={["Stage", "Board / school", "Year", "Roll no. / reg. no.", "Codes (district / school)", "Result", ""]} minWidth={760}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={`${td} font-semibold text-ink`}>{name.get(r.level)}</td>
              <td className={td}>{r.board_name ?? "—"}<div className="text-[12px] text-muted">{r.school_name ?? ""}</div></td>
              <td className={td}>{r.exam_year ?? "—"}</td>
              <td className={td}>{[r.roll_no, r.registration_no].filter(Boolean).join(" / ") || "—"}</td>
              <td className={td}>{[r.district_code, r.school_code].filter(Boolean).join(" / ") || "—"}</td>
              <td className={td}>{[r.result, r.percentage !== null ? `${r.percentage}%` : null].filter(Boolean).join(" · ") || "—"}</td>
              <td className={td}>{canEdit && <form action={deletePriorExam}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="student_id" value={studentId} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove</button></form>}</td>
            </tr>
          ))}
        </Table>
      ) : <p className="m-0 text-[14px] text-muted">None recorded.</p>}
      {canEdit && (
        <form action={savePriorExam} className="mt-4 grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="student_id" value={studentId} />
          <Select label="Stage" name="level" options={PRIOR_LABEL} defaultValue="class8" />
          <Input label="Board" name="board_name" placeholder="UP Board / CBSE …" />
          <Input label="Year" name="exam_year" placeholder="2025" />
          <Input label="Roll no. (अनुक्रमांक)" name="roll_no" />
          <Input label="Registration no." name="registration_no" />
          <Input label="School name" name="school_name" className="sm:col-span-2" />
          <Input label="District code" name="district_code" />
          <Input label="School code" name="school_code" />
          <Input label="Result" name="result" placeholder="Passed" />
          <Input label="Percentage" name="percentage" type="number" step="0.01" min={0} max={100} />
          <div className="flex items-end"><Submit variant="secondary">Save (replaces the same stage)</Submit></div>
        </form>
      )}
    </Card>
  );
}
