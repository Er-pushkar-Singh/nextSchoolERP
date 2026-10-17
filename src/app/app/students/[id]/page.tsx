import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { StudentForm, type Student } from "@/components/StudentForm";
import { CopyButton } from "@/components/CopyButton";
import { fmtDate, fullName, money, todayIST, waLink } from "@/lib/format";
import { balance, getClasses, pct, type Due } from "@/lib/erp";
import { appUrl } from "@/lib/brand";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DOC_BUCKET } from "@/lib/student-docs";
import { ContactsCard, DocumentsCard, EnrolmentHistoryCard, IdentityCard, PriorExamsCard, type Contact, type Doc, type Enrolment, type Prior, type Sensitive } from "@/components/StudentRecords";
import { fmtTime } from "@/lib/transport";
import { addConcession, applyConcessions, newPortalLink, removeConcession, setStudentStatus } from "../../_actions/students";
import { blockStudent, deleteStudent, unblockStudent } from "../../_actions/people";
import { setMessageOptOut } from "../../_actions/messages";
import { ClearanceCard, PropertyCard } from "@/components/inventory/PropertyCard";
import { FamilyLoginCard } from "@/components/family/FamilyLoginCard";
import { CredentialsBanner } from "@/components/hr/StaffActions";
import { readPasswordOnce } from "@/lib/logins";

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session, can } = await requirePerm("students.profile.view");
  const { data: s } = await supabase.from("students").select("*, classes!class_id(name), sections(name)").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!s) notFound();
  const fees = can("fees.collection.view");
  const feeWrite = can("fees.concessions.create");
  const canEdit = can("students.profile.edit");
  const today = todayIST();

  const [classes, duesQ, receiptsQ, consQ, headsQ, attQ] = await Promise.all([
    getClasses(supabase, school.id),
    fees ? supabase.from("fee_dues").select("id,label,due_date,amount,concession,fine,paid,status").eq("student_id", id).order("due_date") : Promise.resolve({ data: [] }),
    fees ? supabase.from("fee_receipts").select("id,receipt_no,paid_on,amount,mode,cancelled").eq("student_id", id).order("paid_on", { ascending: false }) : Promise.resolve({ data: [] }),
    fees ? supabase.from("student_concessions").select("id,kind,value,reason,fee_heads(name)").eq("student_id", id) : Promise.resolve({ data: [] }),
    feeWrite ? supabase.from("fee_heads").select("id,name").eq("school_id", school.id).order("sort") : Promise.resolve({ data: [] }),
    session ? supabase.from("attendance").select("status").eq("student_id", id).gte("date", session.start_date).lte("date", session.end_date) : Promise.resolve({ data: [] }),
  ]);
  const [{ data: ride }, { data: books }] = await Promise.all([
    session && can("transport.allocation.view")
      ? supabase.from("transport_allocations").select("trip,monthly_fee,end_date,transport_stops(name,pickup_time,monthly_fee),transport_routes(id,name)").eq("student_id", id).eq("session_id", session.id).maybeSingle()
      : Promise.resolve({ data: null }),
    can("library.circulation.view") ? supabase.from("library_issues").select("id,due_on,library_books(title)").eq("student_id", id).is("returned_on", null).order("due_on") : Promise.resolve({ data: [] }),
  ]);
  const cred = await readPasswordOnce();
  const [{ data: sensRow }, { data: docRows }, { data: contactRows }, { data: enrolRows }] = await Promise.all([
    can("students.sensitive.view") ? supabase.from("student_sensitive").select("*").eq("student_id", id).maybeSingle() : Promise.resolve({ data: null }),
    can("students.documents.view") ? supabase.from("student_documents").select("id,doc_type,title,status,file_name,due_by,uploaded_by_name,uploaded_at,verified_by_name,verified_at,reject_reason,remark,size_bytes,file_path").eq("student_id", id).order("created_at") : Promise.resolve({ data: [] }),
    supabase.from("student_guardians").select("guardian_id,is_primary,guardians(name,relation,phone,occupation,is_emergency,can_pickup)").eq("student_id", id),
    supabase.from("student_enrolments").select("id,class_name,section_name,roll_no,started_on,ended_on,outcome,sessions(name)").eq("student_id", id).order("started_on", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  const { data: certRows } = can("students.certificates.view")
    ? await supabase.from("student_certificates").select("id,kind,cert_no,issued_on,status,is_duplicate").eq("student_id", id).order("created_at", { ascending: false })
    : { data: [] };
  const { data: priorRows } = await supabase.from("student_prior_exams").select("id,level,board_name,exam_year,roll_no,registration_no,school_name,district_code,school_code,result,percentage").eq("student_id", id).order("exam_year");
  const { data: issuedRows } = can("documents.issue.view")
    ? await supabase.from("issued_documents").select("id,doc_no,template_name,issued_on,status,is_duplicate").eq("student_id", id).order("created_at", { ascending: false }).limit(20)
    : { data: [] };
  const { data: tplRows } = can("documents.issue.create")
    ? await supabase.from("document_templates").select("id,name").eq("school_id", school.id).eq("audience", "student").eq("active", true).order("name")
    : { data: [] };
  const photoPath = ((docRows ?? []) as { doc_type: string; file_path: string | null; status: string }[]).find((d) => d.doc_type === "photo" && d.file_path && d.status !== "rejected")?.file_path;
  const photoUrl = photoPath ? (await supabaseAdmin()?.storage.from(DOC_BUCKET).createSignedUrl(photoPath, 300))?.data?.signedUrl ?? null : null;
  const seeHealth = can("wellbeing.medical.view"), seeDiscipline = can("wellbeing.discipline.view"), seeHostel = can("hostel.allocation.view");
  const [{ data: healthRow }, { data: wellbeing }, { data: bedRow }] = await Promise.all([
    seeHealth ? supabase.from("student_health").select("blood_group,allergies,conditions,emergency_name,emergency_phone").eq("student_id", id).maybeSingle() : Promise.resolve({ data: null }),
    seeHealth || seeDiscipline ? supabase.rpc("student_wellbeing", { sid: school.id, p_student: id }) : Promise.resolve({ data: null }),
    seeHostel ? supabase.from("hostel_allocations").select("bed_no,start_date,hostel_rooms(room_no,hostels(name))").eq("student_id", id).eq("status", "active").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const health = healthRow as { blood_group: string | null; allergies: string | null; conditions: string | null; emergency_name: string | null; emergency_phone: string | null } | null;
  const wb = (wellbeing ?? {}) as { visits_90?: number | null; incidents_180?: number | null };
  const bed = bedRow as unknown as { bed_no: number; start_date: string; hostel_rooms: { room_no: string; hostels: { name: string } | null } | null } | null;
  const canLink = can("students.parent_link.view");
  const canBlock = can("students.profile.block");
  const canDelete = can("students.profile.delete");
  const isBlocked = Boolean(s.blocked_at) && (!s.blocked_till || s.blocked_till >= todayIST());
  const transport = ride as unknown as { trip: string; monthly_fee: number | null; end_date: string | null; transport_stops: { name: string; pickup_time: string | null; monthly_fee: number } | null; transport_routes: { id: string; name: string } | null } | null;
  const libBooks = (books ?? []) as unknown as { id: string; due_on: string; library_books: { title: string } | null }[];
  const dues = (duesQ.data ?? []) as Due[];
  const due = dues.reduce((t, d) => t + balance(d), 0);
  const overdue = dues.filter((d) => d.due_date <= today).reduce((t, d) => t + balance(d), 0);
  const att = (attQ.data ?? []) as { status: string }[];
  const present = att.filter((a) => ["P", "L", "H"].includes(a.status)).length;
  const link = canLink ? appUrl(`/p/${s.portal_token}`) : "";
  const name = fullName(s);
  const cls = s.classes ? `${s.classes.name}-${s.sections?.name ?? ""}` : "—";
  const wa = canLink ? waLink(s.guardian_phone, `Dear Parent, here is ${name}'s page for fees, attendance and results at ${school.name}:
${link}`) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={name}
        subtitle={<>Adm. no. <span className="font-mono">{s.admission_no}</span> · Class {cls}{s.roll_no ? ` · Roll ${s.roll_no}` : ""} · {s.father_name ?? "—"} · {s.guardian_phone ?? "no phone"} {s.status !== "active" && <Badge value={s.status} />}{isBlocked && <> <Badge value="overdue" text="Blocked" /></>}</>}
        back={{ href: "/app/students", label: "Students" }}
        actions={fees && !isNaN(due) && can("fees.collection.create") && due > 0 ? <Link href={`/app/fees/collect?student=${id}`} className="btn btn-sm btn-primary">Collect fee</Link> : undefined}
      />
      <Flash ok={sp.ok} error={sp.error} />
      <CredentialsBanner cred={cred} school={school.name} />
      {s.status === "admission_pending" && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#cfd9f7] bg-blue-tint px-4 py-3 text-[14px] text-blue-strong">
          <span><b>Admission in progress.</b> No class or section yet — they are given at the last step, after the admission fee is paid.</span>
          {s.application_id && <Link href={`/app/admissions/applications/${s.application_id}`} className="btn btn-sm btn-primary">Open admission file</Link>}
        </div>
      )}
      {isBlocked && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">
          <span><b>Blocked</b>{s.blocked_till ? ` until ${fmtDate(s.blocked_till)}` : ""} — {s.block_reason}{s.blocked_by_name ? ` (by ${s.blocked_by_name})` : ""}. The parent link shows a notice instead of the student&apos;s page.</span>
          {canBlock && <form action={unblockStudent}><input type="hidden" name="id" value={id} /><button className="btn btn-sm btn-secondary cursor-pointer">Unblock</button></form>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {fees && <Stat label="Total due (session)" value={money(due)} />}
        {fees && <Stat label="Overdue now" value={money(overdue)} />}
        <Stat label="Attendance (session)" value={att.length ? `${pct(present, att.length)}%` : "—"} hint={`${present}/${att.length} days`} />
        <Stat label="Admitted" value={fmtDate(s.admission_date)} />
      </div>

      {(can("settings.users.view") || canLink) && s.status === "active" && (
        <FamilyLoginCard supabase={supabase} studentId={id} schoolCode={school.code} admissionNo={s.admission_no} studentUserId={s.user_id ?? null} canCreate={can("settings.users.create") && can("students.profile.edit")} canReset={can("settings.users.edit")} />
      )}

      {canLink && <Card title="Parent page">
        <p className="mt-0 text-[14px]">One private link for parents — fees due with UPI pay, receipts, attendance, results and notices. No app or password needed.</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded bg-surface-alt px-2 py-1 text-[12px]">{link}</code>
          <CopyButton text={link} />
          {wa && <a href={wa} target="_blank" rel="noopener" className="btn btn-sm btn-wa">Send on WhatsApp</a>}
          {can("students.parent_link.edit") && (
            <form action={newPortalLink}><input type="hidden" name="id" value={id} /><button className="cursor-pointer border-0 bg-transparent text-[13px] text-blue underline">Reset link</button></form>
          )}
        </div>
        {can("students.profile.edit") && (
          <form action={setMessageOptOut} className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[13.5px]">
            <input type="hidden" name="student_id" value={id} /><input type="hidden" name="opt_out" value={s.msg_opt_out ? "0" : "1"} />
            <span>Automatic messages (fee receipts, absence, results): <b className={s.msg_opt_out ? "text-error" : "text-[#15803d]"}>{s.msg_opt_out ? "switched off — parent opted out" : "on"}</b></span>
            <button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">{s.msg_opt_out ? "Switch on" : "Parent asked to stop"}</button>
          </form>
        )}
      </Card>}

      {(can("transport.allocation.view") || can("library.circulation.view")) && (
        <div className="grid gap-5 md:grid-cols-2">
          {can("transport.allocation.view") && (
            <Card title="Transport" icon="transport" actions={can("transport.allocation.create") ? <Link href={`/app/transport/students?student=${id}`} className="text-[14px] font-semibold">{transport ? "Change" : "Add"} →</Link> : undefined}>
              {transport ? (
                <p className="m-0 text-[14px]">
                  {transport.transport_routes ? <Link href={`/app/transport/routes/${transport.transport_routes.id}`}>{transport.transport_routes.name}</Link> : "—"} › <b className="text-ink">{transport.transport_stops?.name}</b>
                  {transport.transport_stops?.pickup_time ? ` · pickup ${fmtTime(transport.transport_stops.pickup_time)}` : ""} · {money(transport.monthly_fee ?? transport.transport_stops?.monthly_fee ?? 0)}/month
                  {transport.end_date && <span className="text-error"> · stopped {fmtDate(transport.end_date)}</span>}
                </p>
              ) : <p className="m-0 text-[14px] text-muted">Doesn't use school transport.</p>}
            </Card>
          )}
          {can("library.circulation.view") && (
            <Card title="Library" icon="library">
              {libBooks.length ? (
                <ul className="m-0 list-none p-0 text-[14px]">
                  {libBooks.map((b) => <li key={b.id} className="flex justify-between gap-2"><span>{b.library_books?.title}</span><span className={b.due_on < today ? "font-semibold text-error" : "text-muted"}>due {fmtDate(b.due_on)}</span></li>)}
                </ul>
              ) : <p className="m-0 text-[14px] text-muted">No books issued.</p>}
            </Card>
          )}
        </div>
      )}

      {(seeHealth || seeDiscipline || seeHostel) && (
        <div className="grid gap-5 md:grid-cols-2">
          {(seeHealth || seeDiscipline) && (
            <Card title="Health & discipline" icon="health" actions={seeHealth ? <Link href={`/app/health/records?q=${encodeURIComponent(s.admission_no)}`} className="text-[14px] font-semibold">Record →</Link> : undefined}>
              <div className="flex flex-col gap-1.5 text-[14px]">
                {seeHealth && (health ? (
                  <>
                    <p className="m-0"><b className="text-ink">{health.blood_group ?? "Blood group not recorded"}</b>{health.emergency_name ? ` · emergency: ${health.emergency_name}${health.emergency_phone ? ` (${health.emergency_phone})` : ""}` : ""}</p>
                    {health.allergies && <p className="m-0 font-semibold text-[#9a3412]">⚠ Allergy: {health.allergies}</p>}
                    {health.conditions && <p className="m-0">{health.conditions}</p>}
                  </>
                ) : <p className="m-0 text-muted">No health record yet.</p>)}
                <p className="m-0 text-muted">
                  {seeHealth && wb.visits_90 !== null && wb.visits_90 !== undefined ? <>{wb.visits_90} medical-room visit{wb.visits_90 === 1 ? "" : "s"} in 90 days</> : null}
                  {seeHealth && seeDiscipline ? " · " : ""}
                  {seeDiscipline && wb.incidents_180 !== null && wb.incidents_180 !== undefined ? <Link href="/app/discipline">{wb.incidents_180} incident{wb.incidents_180 === 1 ? "" : "s"} in 6 months</Link> : null}
                </p>
              </div>
            </Card>
          )}
          {seeHostel && (
            <Card title="Hostel" icon="hostel" actions={<Link href="/app/hostel/allocation" className="text-[14px] font-semibold">{bed ? "Manage" : "Allot a bed"} →</Link>}>
              {bed ? (
                <p className="m-0 text-[14px]"><b className="text-ink">{bed.hostel_rooms?.hostels?.name}</b> · room {bed.hostel_rooms?.room_no} · bed {bed.bed_no} <span className="text-muted">since {fmtDate(bed.start_date)}</span></p>
              ) : <p className="m-0 text-[14px] text-muted">Not a hostel boarder.</p>}
            </Card>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <ClearanceCard supabase={supabase} sid={school.id} studentId={id} />
        {(can("inventory.assign.view") || can("inventory.items.view")) && <PropertyCard supabase={supabase} sid={school.id} kind="student" id={id} />}
      </div>

      {photoUrl && (
        <div className="flex items-center gap-3 print:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
          <img src={photoUrl} alt={`Photograph of ${name}`} className="h-24 w-20 rounded-lg border border-line object-cover" />
          <p className="m-0 text-[13px] text-muted">Photograph on file</p>
        </div>
      )}

      {can("students.sensitive.view") && <IdentityCard studentId={id} s={sensRow as Sensitive | null} canEdit={can("students.sensitive.edit")} />}
      {can("students.documents.view") && <DocumentsCard studentId={id} docs={(docRows ?? []) as unknown as Doc[]} can={can} />}
      <PriorExamsCard studentId={id} rows={(priorRows ?? []) as unknown as Prior[]} canEdit={canEdit} />
      <ContactsCard studentId={id} contacts={(contactRows ?? []) as unknown as Contact[]} canEdit={canEdit} />
      {can("documents.issue.view") && (
        <Card title="Documents issued (templates)" icon="academics">
          {(tplRows ?? []).length > 0 && (
            <p className="mt-0 mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {(tplRows ?? []).map((t) => <Link key={t.id} href={`/app/documents/issue?template=${t.id}&student=${id}`}>Issue {t.name.replace(/ \(.*\)/, "")}</Link>)}
            </p>
          )}
          {(issuedRows ?? []).length ? (
            <ul className="m-0 list-none p-0 text-[14px]">
              {(issuedRows ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-0">
                  <Link href={`/app/documents/${c.id}`} className="font-mono text-[13px]">{c.doc_no}</Link>
                  <span className="text-muted">{c.template_name}{c.is_duplicate ? " (duplicate)" : ""} · {fmtDate(c.issued_on)}</span>
                  <Badge value={c.status === "issued" ? "paid" : "cancelled"} text={c.status} />
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[14px] text-muted">Nothing issued yet.</p>}
        </Card>
      )}
      {can("students.certificates.view") && (
        <Card title="Certificates" icon="academics" actions={can("students.certificates.create") ? (
          <span className="flex flex-wrap gap-3 text-[13px]">
            <Link href={`/app/certificates/new?student=${id}&kind=transfer`}>Issue TC</Link>
            <Link href={`/app/certificates/new?student=${id}&kind=bonafide`}>Bonafide</Link>
            <Link href={`/app/certificates/new?student=${id}&kind=character`}>Character</Link>
          </span>) : undefined}>
          {(certRows ?? []).length ? (
            <ul className="m-0 list-none p-0 text-[14px]">
              {(certRows ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-0">
                  <Link href={`/app/certificates/${c.id}`} className="font-mono text-[13px]">{c.cert_no}</Link>
                  <span className="text-muted capitalize">{c.kind}{c.is_duplicate ? " (duplicate)" : ""} · {fmtDate(c.issued_on)}</span>
                  <Badge value={c.status === "issued" ? "paid" : "cancelled"} text={c.status} />
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[14px] text-muted">No certificates issued.</p>}
        </Card>
      )}
      <EnrolmentHistoryCard rows={(enrolRows ?? []) as unknown as Enrolment[]} />

      {fees && (
        <Card title="Fee ledger" actions={<span className="text-[13px] text-muted">Instalments come from the fee structure → “Generate dues”.</span>}>
          {dues.length ? (
            <Table head={["Instalment", "Due date", "Amount", "Concession", "Fine", "Paid", "Balance", ""]} minWidth={700}>
              {dues.map((d) => (
                <tr key={d.id}>
                  <td className={td}>{d.label}</td>
                  <td className={td}>{fmtDate(d.due_date)}</td>
                  <td className={td}>{money(d.amount)}</td>
                  <td className={td}>{Number(d.concession) ? money(d.concession) : "—"}</td>
                  <td className={td}>{Number(d.fine) ? money(d.fine) : "—"}</td>
                  <td className={td}>{money(d.paid)}</td>
                  <td className={`${td} font-semibold text-ink`}>{money(balance(d))}</td>
                  <td className={td}><Badge value={d.status === "paid" ? "paid" : d.due_date <= today ? "overdue" : d.status} /></td>
                </tr>
              ))}
            </Table>
          ) : <p className="m-0 text-[14px] text-muted">No instalments yet for this student.</p>}
        </Card>
      )}

      {fees && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Receipts">
            <ul className="m-0 list-none p-0">
              {((receiptsQ.data ?? []) as { id: string; receipt_no: string; paid_on: string; amount: number; mode: string; cancelled: boolean }[]).map((r) => (
                <li key={r.id} className="flex justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
                  <Link href={`/app/fees/receipts/${r.id}`} className="font-mono text-[13px]">{r.receipt_no}</Link>
                  <span className="text-muted">{fmtDate(r.paid_on)} · {r.mode.replace("_", " ")}</span>
                  <span className={r.cancelled ? "text-muted line-through" : "font-semibold text-ink"}>{money(r.amount)}</span>
                </li>
              ))}
              {!receiptsQ.data?.length && <li className="text-[14px] text-muted">No receipts.</li>}
            </ul>
          </Card>
          <Card title="Concessions / scholarships">
            <ul className="m-0 mb-3 list-none p-0">
              {((consQ.data ?? []) as unknown as { id: string; kind: string; value: number; reason: string | null; fee_heads: { name: string } | null }[]).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
                  <span><b>{c.kind === "percent" ? `${Number(c.value)}%` : money(c.value)}</b> on {c.fee_heads?.name ?? "all heads"}{c.reason ? ` · ${c.reason}` : ""}</span>
                  {can("fees.concessions.delete") && <form action={removeConcession}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="student_id" value={id} /><button className="cursor-pointer border-0 bg-transparent text-[13px] text-error underline">Remove</button></form>}
                </li>
              ))}
              {!consQ.data?.length && <li className="text-[14px] text-muted">None.</li>}
            </ul>
            {feeWrite && (
              <>
                <form action={addConcession} className="grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="student_id" value={id} />
                  <Select label="Type" name="kind" options={[["percent", "Percent %"], ["amount", "Fixed ₹ per instalment"]]} />
                  <Input label="Value" name="value" type="number" step="0.01" min={0} required />
                  <Select label="Fee head" name="fee_head_id" blank="All heads" options={((headsQ.data ?? []) as { id: string; name: string }[]).map((h) => [h.id, h.name] as [string, string])} />
                  <Input label="Reason" name="reason" placeholder="Sibling, staff ward, RTE…" />
                  <div><Submit variant="secondary">Add concession</Submit></div>
                </form>
                {!!consQ.data?.length && (
                  <form action={applyConcessions} className="mt-2"><input type="hidden" name="student_id" value={id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Apply to unpaid instalments</button></form>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {canEdit && (
        <Card title="Details">
          <details>
            <summary className="cursor-pointer text-[14px] font-semibold text-blue">Edit student details</summary>
            <div className="mt-4"><StudentForm s={s as unknown as Student} classes={classes} /></div>
          </details>
          <form action={setStudentStatus} className="mt-4 grid gap-3 border-t border-line pt-4 text-[14px] sm:grid-cols-4">
            <input type="hidden" name="id" value={id} />
            <Select label="Status" name="status" defaultValue={s.status} options={[["active", "Active"], ["left", "Left school"], ["transferred", "Transferred (TC issued)"], ["withdrawn", "Withdrawn"], ["passed_out", "Passed out"]]} />
            <Input label="Date" name="left_on" type="date" defaultValue={s.left_on ?? todayIST()} />
            <Input label="Reason" name="left_reason" defaultValue={s.left_reason} className="sm:col-span-2" hint="Needed for left / transferred / withdrawn" />
            <Input label="TC number" name="tc_no" defaultValue={s.tc_no} />
            <Input label="TC issued on" name="tc_issued_on" type="date" defaultValue={s.tc_issued_on} />
            <div className="flex items-end"><Submit variant="secondary">Update status</Submit></div>
          </form>
        </Card>
      )}

      {canBlock && !isBlocked && (
        <Card title="Block this student" description="For discipline, a long fee default or any other reason. The parent link stops showing the student&apos;s page; fee dues, attendance and records are untouched. Can be lifted any time.">
          <form action={blockStudent} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="id" value={id} />
            <Input label="Reason" name="reason" required className="sm:col-span-2" />
            <Input label="Blocked until (optional)" name="till" type="date" />
            <div className="flex items-end"><Submit variant="secondary">Block</Submit></div>
          </form>
        </Card>
      )}

      {canDelete && (
        <Card title="Delete this record" description="Only for a record entered by mistake. A student with fee receipts, attendance, marks, certificates or other history cannot be deleted — mark them Left / Withdrawn instead.">
          <form action={deleteStudent} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={id} />
            <Input label={`Type the admission number (${s.admission_no}) to confirm`} name="confirm" required />
            <Submit variant="danger">Delete student</Submit>
          </form>
        </Card>
      )}
    </div>
  );
}
