import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { ApplicationForm } from "@/components/ApplicationForm";
import { ClassSection } from "@/components/ClassSection";
import { fmtDate, money, todayIST } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { ageWarning } from "@/lib/student-form";
import { DOC_TYPES } from "@/lib/student-docs";
import { ADMISSION_DOCS, APP_STATUS, APP_TONE, FEE_MODES, type AppForm } from "@/lib/applications";
import { maskAadhaar } from "@/lib/aadhaar";
import {
  admitApplication, deleteApplicationDocument, markApplicationDocPending, recordApplicationFee, reviewApplicationDocument, saveTest, setApplicationStatus,
  updateApplication, uploadApplicationDocument,
} from "../../../_actions/applications";

type Doc = { id: string; doc_type: string; title: string | null; status: string; file_name: string | null; due_by: string | null; uploaded_by_name: string | null; uploaded_at: string | null; verified_by_name: string | null; verified_at: string | null; reject_reason: string | null };
const docTone: Record<string, string> = { uploaded: "sent", verified: "paid", rejected: "overdue", pending: "due", not_applicable: "cancelled" };
const dn = new Map(DOC_TYPES);

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; ok?: string; error?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session, can } = await requirePerm("frontdesk.admissions.view");
  const sp = await searchParams;
  const { data: a } = await supabase.from("admission_applications").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!a) notFound();
  const [classes, { data: docs }, { data: events }, seatsQ] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("application_documents").select("id,doc_type,title,status,file_name,due_by,uploaded_by_name,uploaded_at,verified_by_name,verified_at,reject_reason").eq("application_id", id).order("created_at"),
    supabase.from("admission_application_events").select("id,at,actor_name,event,details").eq("application_id", id).order("id", { ascending: false }).limit(40),
    session ? supabase.rpc("admission_seats", { sid: school.id, sess: a.session_id ?? session.id }) : Promise.resolve({ data: [] }),
  ]);
  const f = (a.form ?? {}) as AppForm;
  const cls = classes.find((c) => c.id === a.class_id);
  const D = (docs ?? []) as Doc[];
  const byType = new Map(D.filter((d) => d.doc_type !== "other").map((d) => [d.doc_type, d]));
  const open = !["admitted", "cancelled"].includes(a.status);
  const edit = can("frontdesk.admissions.edit") && open;
  const approve = can("frontdesk.admissions.approve");
  const seat = ((seatsQ.data ?? []) as { class_id: string; seats: number | null; active_students: number; approved: number }[]).find((s) => s.class_id === a.class_id);
  const free = seat && seat.seats !== null ? seat.seats - seat.active_students - seat.approved : null;
  const sess = session && a.session_id === session.id ? session : null;
  const warn = ageWarning(f.dob as string | undefined, cls?.min_age_years, cls?.max_age_years, sess?.start_date ?? null);
  const missingDocs = ADMISSION_DOCS.filter((k) => !byType.get(k) || !["uploaded", "verified", "not_applicable"].includes(byType.get(k)!.status));
  const g = (k: string) => (f[k] as string | number | null | undefined) ?? "—";
  const rows: [string, string | number | null | undefined][] = [
    ["Name", [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(" ")], ["Name (Hindi)", f.name_hi as string], ["Date of birth", f.dob ? fmtDate(f.dob as string) : null],
    ["Gender", f.gender === "M" ? "Male" : f.gender === "F" ? "Female" : f.gender === "O" ? "Transgender / other" : null], ["Category", f.category as string], ["Medium", f.medium as string],
    ["Father", f.father_name as string], ["Mother", f.mother_name as string], ["Parent phone", f.guardian_phone as string], ["Student mobile", f.mobile as string], ["Email", f.email as string],
    ["Address", [f.street, f.address, f.city, f.post_office, f.block_tehsil, f.district, f.state, f.pincode].filter(Boolean).join(", ")],
    ["Previous school", [f.previous_school, f.previous_class, f.previous_board].filter(Boolean).join(" · ")], ["Aadhaar", f.aadhaar_last4 ? maskAadhaar(f.aadhaar_last4 as string) : null],
    ["PEN / APAAR", [f.pen, f.apaar_id].filter(Boolean).join(" / ")],
  ];

  if (sp.edit === "1" && edit) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader icon="admissions" title={`Edit ${a.application_no}`} back={{ href: `/app/admissions/applications/${id}`, label: "Application" }} />
        <Flash ok={sp.ok} error={sp.error} />
        <ApplicationForm action={updateApplication} classes={classes} form={f} id={id} appliedClass={a.class_id} rte={a.rte_applicant} rteRef={a.rte_reference} source={a.source} submitLabel="Save changes" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title={a.applicant_name} back={{ href: "/app/admissions/applications", label: "Applications" }}
        subtitle={<><span className="font-mono">{a.application_no}</span> · Class {cls?.name ?? "—"} · applied {fmtDate(a.applied_on)} <Badge value={APP_TONE[a.status]} text={APP_STATUS[a.status] + (a.waitlist_no ? ` #${a.waitlist_no}` : "")} />{a.rte_applicant && <> <Badge value="contacted" text={`RTE${a.rte_reference ? ` · ${a.rte_reference}` : ""}`} /></>}</>}
        actions={<>
          <Link href={`/app/admissions/applications/${id}/print`} className="btn btn-sm btn-secondary">Print application</Link>
          {edit && <Link href={`/app/admissions/applications/${id}?edit=1`} className="btn btn-sm btn-secondary">Edit</Link>}
          {a.student_id && <Link href={`/app/students/${a.student_id}`} className="btn btn-sm btn-primary">Open student</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Documents" value={`${ADMISSION_DOCS.length - missingDocs.length}/${ADMISSION_DOCS.length}`} hint={missingDocs.length ? `${missingDocs.length} pending` : "all received"} icon="layers" tone={missingDocs.length ? "amber" : "green"} />
        <Stat label="Entrance test" value={a.test_marks !== null ? `${a.test_marks}/${a.test_max ?? "?"}` : a.test_on ? fmtDate(a.test_on) : "—"} icon="exams" tone="violet" />
        <Stat label="Application fee" value={a.fee_amount !== null ? money(a.fee_amount) : "—"} hint={a.fee_paid_on ? fmtDate(a.fee_paid_on) : undefined} icon="fees" tone="green" />
        <Stat label="Seats left" value={free === null ? "—" : free} hint={cls ? `Class ${cls.name}` : undefined} icon="school" tone={free !== null && free <= 0 ? "rose" : "cyan"} />
      </div>
      {warn && <p role="note" className="m-0 rounded-[12px] border border-[#f1d39a] bg-[#fff4e0] px-4 py-3 text-[14px] text-[#7a4b00]">{warn} The principal can still approve.</p>}
      {free !== null && free <= 0 && a.status !== "admitted" && <p role="note" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">No free seats in Class {cls?.name}. Waitlist this application or raise the seats in settings.</p>}

      <Card title="Application details" icon="students" actions={edit ? <Link href={`/app/admissions/applications/${id}?edit=1`} className="text-[14px] font-semibold">Edit →</Link> : undefined}>
        <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-3">
          {rows.map(([k, v]) => <div key={k}><dt className="text-[12px] text-muted">{k}</dt><dd className="m-0 text-[14px] font-semibold text-ink">{v || <span className="font-normal text-muted">—</span>}</dd></div>)}
        </dl>
        {(f.contacts ?? []).length > 0 && <p className="mt-3 mb-0 text-[13px] text-muted">Contacts: {(f.contacts ?? []).map((c) => `${c.name}${c.relation ? ` (${c.relation})` : ""}${c.phone ? ` ${c.phone}` : ""}${c.is_emergency ? " · emergency" : ""}${c.can_pickup ? " · pickup" : ""}`).join("; ")}</p>}
        {g("admission_notes") !== "—" && <p className="mt-2 mb-0 text-[13px]">Notes: {g("admission_notes")}</p>}
      </Card>

      <Card title="Documents" icon="layers" description="A missing document can be marked pending — it does not hold up the admission. It moves to the student record on admit.">
        <span id="documents" />
        <Table head={["Document", "Status", "Details", ""]} minWidth={720}>
          {[...ADMISSION_DOCS.map((k) => ({ key: k, name: dn.get(k) ?? k, d: byType.get(k) ?? null })), ...D.filter((d) => d.doc_type === "other").map((d) => ({ key: d.id, name: d.title || "Other", d }))].map(({ key, name, d }) => (
            <tr key={key}>
              <td className={`${td} font-semibold text-ink`}>{name}</td>
              <td className={td}>{d ? <Badge value={docTone[d.status] ?? "neutral"} text={d.status.replace("_", " ")} /> : <span className="text-[13px] text-muted">not received</span>}</td>
              <td className={`${td} text-[13px]`}>
                {d?.file_name && <div>{d.file_name}</div>}
                {d?.uploaded_at && <div className="text-muted">uploaded {fmtDate(d.uploaded_at)}{d.uploaded_by_name ? ` by ${d.uploaded_by_name}` : ""}</div>}
                {d?.verified_at && <div className="text-muted">{d.status} {fmtDate(d.verified_at)}{d.verified_by_name ? ` by ${d.verified_by_name}` : ""}</div>}
                {d?.reject_reason && <div className="text-error">Reason: {d.reject_reason}</div>}
                {d?.status === "pending" && d.due_by && <div className={d.due_by < todayIST() ? "font-semibold text-error" : "text-muted"}>to be submitted by {fmtDate(d.due_by)}</div>}
              </td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>
                {d?.file_name && <a href={`/app/admissions/applications/${id}/documents/${d.id}`} className="mr-3">Download</a>}
                {d && d.status === "uploaded" && edit && (
                  <form action={reviewApplicationDocument} className="mt-1 flex flex-wrap items-center gap-1">
                    <input type="hidden" name="id" value={d.id} /><input type="hidden" name="application_id" value={id} />
                    <button name="status" value="verified" className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Verify</button>
                    <input name="reject_reason" placeholder="Reason to reject" aria-label="Reason to reject" className="input !min-h-8 w-32 !py-1 text-[13px]" />
                    <button name="status" value="rejected" className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Reject</button>
                  </form>
                )}
                {d && edit && <form action={deleteApplicationDocument} className="mt-1"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="application_id" value={id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Remove</button></form>}
              </td>
            </tr>
          ))}
        </Table>
        {edit && (
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <form action={uploadApplicationDocument} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="application_id" value={id} />
              <p className="m-0 text-[14px] font-bold text-ink sm:col-span-2">Upload a document</p>
              <Select label="Type" name="doc_type" options={DOC_TYPES} defaultValue="birth_certificate" />
              <Input label="Title (for “Other”)" name="title" />
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink sm:col-span-2">File — PDF, JPG or PNG (photo: max 1 MB; others max 5 MB)
                <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="input !min-h-10 !py-1.5 text-[14px] font-normal" />
              </label>
              <div><Submit>Upload</Submit></div>
            </form>
            <form action={markApplicationDocPending} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="application_id" value={id} />
              <p className="m-0 text-[14px] font-bold text-ink sm:col-span-2">Not available now</p>
              <Select label="Type" name="doc_type" options={DOC_TYPES} defaultValue="transfer_certificate" />
              <Input label="Will submit by" name="due_by" type="date" />
              <Input label="Remark" name="remark" className="sm:col-span-2" />
              <label className="flex items-center gap-2 text-[13px] text-ink sm:col-span-2"><input type="checkbox" name="not_applicable" value="1" className="h-4 w-4" /> Not applicable for this applicant</label>
              <div><Submit variant="secondary">Record as pending</Submit></div>
            </form>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Entrance test & interview" icon="exams">
          <form action={saveTest} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={id} />
            <fieldset disabled={!edit} className="m-0 contents border-0 p-0">
              <Input label="Test date" name="test_on" type="date" defaultValue={a.test_on} />
              <Input label="Interview date" name="interview_on" type="date" defaultValue={a.interview_on} />
              <Input label="Marks obtained" name="test_marks" type="number" step="0.01" min={0} defaultValue={a.test_marks} />
              <Input label="Out of" name="test_max" type="number" step="0.01" min={0} defaultValue={a.test_max} />
              <Textarea label="Interview note" name="interview_note" defaultValue={a.interview_note} rows={2} className="sm:col-span-2" />
            </fieldset>
            {edit && <div><Submit variant="secondary">Save</Submit></div>}
          </form>
        </Card>

        <Card title="Application fee" icon="fees" description="Record the fee taken with the form (the admission fee itself is billed after admit).">
          <form action={recordApplicationFee} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={id} />
            <fieldset disabled={!edit} className="m-0 contents border-0 p-0">
              <Input label="Amount (₹)" name="fee_amount" type="number" step="0.01" min={0} defaultValue={a.fee_amount} />
              <Input label="Received on" name="fee_paid_on" type="date" defaultValue={a.fee_paid_on ?? todayIST()} />
              <Select label="Mode" name="fee_mode" defaultValue={a.fee_mode ?? "cash"} options={FEE_MODES} />
              <Input label="Reference / UTR" name="fee_ref" defaultValue={a.fee_ref} />
            </fieldset>
            {edit && <div><Submit variant="secondary">Record</Submit></div>}
          </form>
        </Card>
      </div>

      {open && (can("frontdesk.admissions.edit") || approve) && (
        <Card title="Decision" icon="school" description="Approving, waitlisting and rejecting are done by the principal.">
          <form action={setApplicationStatus} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={id} />
            <Textarea label="Note / reason (required to reject)" name="decision_note" defaultValue={a.decision_note} rows={2} />
            <div className="flex flex-wrap gap-2">
              {a.status === "submitted" && <button name="status" value="under_review" className="btn btn-sm btn-secondary cursor-pointer">Start review</button>}
              {["submitted", "under_review"].includes(a.status) && <button name="status" value="test_scheduled" className="btn btn-sm btn-secondary cursor-pointer">Test scheduled (set date above first)</button>}
              {approve && a.status !== "approved" && <button name="status" value="approved" className="btn btn-sm btn-primary cursor-pointer">Approve</button>}
              {approve && a.status !== "waitlisted" && <button name="status" value="waitlisted" className="btn btn-sm btn-secondary cursor-pointer">Waitlist</button>}
              {approve && <button name="status" value="rejected" className="btn btn-sm btn-secondary cursor-pointer">Reject</button>}
              <button name="status" value="cancelled" className="btn btn-sm cursor-pointer border border-line bg-white text-error">Cancel application</button>
            </div>
          </form>
        </Card>
      )}
      {a.status === "rejected" && a.decision_note && <p className="m-0 text-[14px] text-error">Rejected: {a.decision_note}</p>}

      {a.status === "approved" && approve && (
        <Card title="Admit" icon="students" description="Creates the student record, class history, documents, contacts and fee dues from this application.">
          <form action={admitApplication} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="id" value={id} />
            <ClassSection classes={classes} classId={a.class_id} required />
            <Input label="Roll no." name="roll_no" type="number" min={1} />
            <Input label="Admission no." name="admission_no" hint="Blank = next number" />
            <Input label="Admission date" name="admission_date" type="date" defaultValue={todayIST()} />
            <div className="flex items-end sm:col-span-4"><Submit>Admit student</Submit></div>
          </form>
        </Card>
      )}

      <Card title="History" icon="notifications">
        {(events ?? []).length ? (
          <Table head={["When", "Who", "What"]} minWidth={480}>
            {(events ?? []).map((e) => (
              <tr key={e.id}><td className={td}>{fmtDate(e.at)}</td><td className={`${td} text-[13px]`}>{e.actor_name || "—"}</td>
                <td className={td}>{e.event}{(e.details as { note?: string })?.note ? <div className="text-[12px] text-muted">{(e.details as { note?: string }).note}</div> : null}</td></tr>
            ))}
          </Table>
        ) : <Empty>No history.</Empty>}
      </Card>
    </div>
  );
}
