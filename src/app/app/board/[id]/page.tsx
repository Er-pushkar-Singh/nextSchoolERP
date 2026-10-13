import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { fmtDate, fullName, money } from "@/lib/format";
import { boardLevel, defaultExamYear, KIND_LABEL, readiness, STATUS_LABEL } from "@/lib/board";
import { saveBoardSubjects, saveFee, saveGroup, setRegistrationStatus, startRegistration } from "../../_actions/board";
import { checkRegistration } from "@/lib/board-check";
import { GROUPS, HS_SLOT_LABELS, interAllowed, interRequiredCount, levelOf, optionsForHs, type Group } from "@/lib/board-rules";

type Snap = { name?: string; father_name?: string | null; mother_name?: string | null; dob?: string | null; gender?: string | null; apaar_id?: string | null; subjects?: { name: string; code: string | null; elective: boolean }[] };
const tone: Record<string, string> = { draft: "draft", checked: "contacted", submitted: "sent", correction: "overdue", accepted: "paid" };

export default async function BoardStudent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session, can } = await requirePerm("students.board_reg.view");
  const sp = await searchParams;
  const { data: s } = await supabase.from("students")
    .select("id,admission_no,first_name,middle_name,last_name,father_name,mother_name,dob,gender,category,roll_no,class_id,classes!class_id(name),sections(name)").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!s) notFound();
  const cn = (s as unknown as { classes: { name: string } | null }).classes?.name;
  const lv = boardLevel(cn);
  const [{ data: reg }, { data: codeRows }, { data: mine }, { data: photo }, { data: sens }] = await Promise.all([
    session ? supabase.from("board_registrations").select("*").eq("student_id", id).eq("session_id", session.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("board_subject_codes").select("level,code,name_en,name_hi").order("code"),
    session ? supabase.from("student_board_subjects").select("slot,code").eq("student_id", id).eq("session_id", session.id) : Promise.resolve({ data: [] }),
    can("students.documents.view") ? supabase.from("student_documents").select("status").eq("student_id", id).eq("doc_type", "photo").not("file_path", "is", null).maybeSingle() : Promise.resolve({ data: null }),
    can("students.sensitive.view") ? supabase.from("student_sensitive").select("pen,apaar_id").eq("student_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: events } = reg ? await supabase.from("board_registration_events").select("id,at,actor_name,event,details").eq("registration_id", reg.id).order("id", { ascending: false }).limit(40) : { data: [] };
  const level = lv ? levelOf(lv.level) : "hs";
  const names = new Map((codeRows ?? []).filter((c) => c.level === level).map((c) => [c.code, c]));
  const chosen = new Map((mine ?? []).filter((m) => m.slot !== "7").map((m) => [m.slot, m.code]));
  const group = (reg?.subject_group ?? null) as Group | null;
  const rules = reg && session && lv ? await checkRegistration(supabase, id, session.id, lv.level, group) : null;
  const r = readiness({
    first_name: s.first_name, father_name: s.father_name, mother_name: s.mother_name, dob: s.dob, gender: s.gender,
    photo: photo ? photo.status !== "rejected" : false, subjects: chosen.size, subjectsWithoutCode: 0, apaar: !!sens?.apaar_id,
  });
  const locked = reg ? !["draft", "correction"].includes(reg.status) : false;
  const snap = (reg?.snapshot ?? {}) as Snap;
  const changed = reg && Object.keys(snap).length > 0 && (snap.name !== fullName(s) || (snap.dob ?? null) !== s.dob || (snap.father_name ?? null) !== s.father_name || (snap.mother_name ?? null) !== s.mother_name);
  const approve = can("students.board_reg.approve");
  const edit = can("students.board_reg.edit");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title={fullName(s)} back={{ href: `/app/board?class_id=${s.class_id ?? ""}`, label: "Board registration" }}
        subtitle={<>Adm. {s.admission_no} · Class {cn}{(s as unknown as { sections: { name: string } | null }).sections ? `-${(s as unknown as { sections: { name: string } }).sections.name}` : ""} {reg && <Badge value={tone[reg.status]} text={STATUS_LABEL[reg.status]} />}</>}
        actions={<><Link href={`/app/students/${id}`} className="btn btn-sm btn-secondary">Student page</Link>{reg && <Link href={`/app/board/${id}/sheet`} className="btn btn-sm btn-primary">Board form data sheet</Link>}</>} />
      <Flash ok={sp.ok} error={sp.error} />
      {!lv && <Empty>This student is not in Class 9, 10, 11 or 12.</Empty>}

      <Card title="Details the board will receive" icon="students" description="Taken from the student page — correct them there before the principal checks.">
        <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-3">
          {[["Name", fullName(s)], ["Father's name", s.father_name], ["Mother's name", s.mother_name], ["Date of birth", fmtDate(s.dob)], ["Gender", s.gender === "M" ? "Male" : s.gender === "F" ? "Female" : s.gender === "O" ? "Other" : null],
            ["Category", s.category], ["APAAR ID", sens?.apaar_id ?? (can("students.sensitive.view") ? null : "restricted")], ["PEN", sens?.pen ?? (can("students.sensitive.view") ? null : "restricted")]].map(([k, v]) => (
            <div key={k as string}><dt className="text-[12px] text-muted">{k}</dt><dd className="m-0 text-[15px] font-semibold text-ink">{v || <span className="font-normal text-muted">—</span>}</dd></div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {r.ok ? <Badge value="paid" text="Ready for principal's check" /> : r.missing.map((m) => <Badge key={m} value="overdue" text={`Missing: ${m}`} />)}
          {r.warnings.map((w) => <Badge key={w} value="due" text={w} />)}
        </div>
        <p className="mt-3 mb-0 text-[13px]"><Link href={`/app/students/${id}`}>Edit student details, photograph and APAAR →</Link></p>
      </Card>

      {!reg && lv && can("students.board_reg.create") && (
        <Card title="Start registration" icon="academics" description={KIND_LABEL[lv.kind]}>
          <form action={startRegistration} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="student_id" value={id} />
            <Input label="Exam year" name="exam_year" type="number" defaultValue={defaultExamYear(session?.name, lv.kind)} className="w-32" />
            <Submit>Start</Submit>
          </form>
        </Card>
      )}

      {reg && lv && (
        <Card title={`Subjects — ${level === "hs" ? "High School" : "Intermediate"} (official UPMSP codes)`} icon="academics"
          description={locked ? "Locked — send the registration back to draft to change." : "Pick from the Board's own subject list; the combination is checked against the 2027 rules."}>
          {level === "inter" && (
            <form action={saveGroup} className="mb-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={reg.id} /><input type="hidden" name="student_id" value={id} />
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Subject group
                <select name="subject_group" defaultValue={reg.subject_group ?? ""} disabled={locked || !edit} className="input !min-h-10 !py-2 text-[15px] font-normal">
                  <option value="">Choose…</option>
                  {Object.entries(GROUPS).map(([k, t]) => <option key={k} value={k}>{k} — {t}</option>)}
                </select></label>
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Exam
                <select name="exam_type" defaultValue={reg.exam_type ?? "full"} disabled={locked || !edit} className="input !min-h-10 !py-2 text-[15px] font-normal">
                  <option value="full">Full exam</option><option value="part">Additional subjects (Reg. 17)</option>
                </select></label>
              {edit && !locked && <Submit variant="secondary">Set group</Submit>}
            </form>
          )}
          {level === "inter" && !group ? <p className="m-0 text-[14px] text-muted">Choose the subject group first.</p> : (
            <form action={saveBoardSubjects} className="flex flex-col gap-3">
              <input type="hidden" name="student_id" value={id} />
              <fieldset disabled={locked || !edit} className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
                {level === "hs"
                  ? ["1", "2", "3", "4", "5", "6", "trade"].map((slot) => (
                    <label key={slot} className="flex flex-col gap-1 text-[13px] font-semibold text-ink">{HS_SLOT_LABELS[slot]}
                      <select name={`slot_${slot}`} defaultValue={chosen.get(slot) ?? ""} className="input !min-h-10 !py-2 text-[15px] font-normal">
                        <option value="">—</option>
                        {optionsForHs(slot).map((c) => <option key={c} value={c}>{c} — {names.get(c)?.name_en ?? c}{names.get(c)?.name_hi ? ` (${names.get(c)!.name_hi})` : ""}</option>)}
                      </select>
                    </label>
                  ))
                  : Array.from({ length: interRequiredCount(group as Group) }, (_, i) => String(i + 1)).map((slot) => (
                    <label key={slot} className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Subject {slot}
                      <select name={`slot_${slot}`} defaultValue={chosen.get(slot) ?? ""} className="input !min-h-10 !py-2 text-[15px] font-normal">
                        <option value="">—</option>
                        {interAllowed(group as Group).map((c) => <option key={c} value={c}>{c} — {names.get(c)?.name_en ?? c}{names.get(c)?.name_hi ? ` (${names.get(c)!.name_hi})` : ""}</option>)}
                      </select>
                    </label>
                  ))}
              </fieldset>
              <p className="m-0 text-[13px] text-muted">Seventh subject <b>{level === "hs" ? "944" : "173"}</b> — {names.get(level === "hs" ? "944" : "173")?.name_en} is added automatically.</p>
              {edit && !locked && <div><Submit>Save subjects</Submit></div>}
            </form>
          )}
          {rules && (
            <div className="mt-3 flex flex-col gap-1">
              {rules.ok ? <Badge value="paid" text="Combination follows the Board's rules" /> : rules.errors.map((e) => <Badge key={e} value="overdue" text={e} />)}
            </div>
          )}
        </Card>
      )}
      {!reg && lv && <Empty>Start the registration to choose subjects.</Empty>}

      {reg && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Form" value={reg.kind === "advance_registration" ? "Advance reg." : "Exam application"} hint={`Class ${reg.class_level} · exam year ${reg.exam_year ?? "—"}`} icon="academics" />
            <Stat label="Fee" value={money(reg.fee_total)} hint={`${money(reg.fee_to_treasury)} to treasury · ${money(Number(reg.fee_total) - Number(reg.fee_to_treasury))} school`} icon="fees" tone="green" />
            <Stat label="Challan" value={reg.challan_no ?? "—"} hint={reg.challan_date ? fmtDate(reg.challan_date) : undefined} icon="billing" tone="amber" />
            <Stat label="Board ref." value={reg.board_ref ?? "—"} hint={reg.submitted_on ? `submitted ${fmtDate(reg.submitted_on)}` : undefined} icon="school" tone="violet" />
          </div>

          {reg.status === "correction" && reg.correction_note && (
            <p role="alert" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]"><b>Board asked for a correction:</b> {reg.correction_note}</p>
          )}
          {changed && (
            <p role="alert" className="m-0 rounded-[12px] border border-[#f1d39a] bg-[#fff4e0] px-4 py-3 text-[14px] text-[#7a4b00]">
              The student&apos;s name, date of birth or parent names were changed after the principal checked this record. Send it back to draft and check it again so the record matches.
            </p>
          )}

          {Object.keys(snap).length > 0 && (
            <Card title="Snapshot checked by the principal" description={reg.checked_at ? `${reg.checked_by_name ?? "Principal"} · ${fmtDate(reg.checked_at)}` : undefined}>
              <p className="m-0 text-[14px]"><b className="text-ink">{snap.name}</b> · {snap.father_name ?? "—"} / {snap.mother_name ?? "—"} · DOB {fmtDate(snap.dob)} · {snap.gender}{snap.apaar_id ? ` · APAAR ${snap.apaar_id}` : ""}</p>
              <p className="mt-1 mb-0 text-[13px] text-muted">{(snap.subjects ?? []).map((x) => `${x.name}${x.code ? ` (${x.code})` : ""}${x.elective ? " · elective" : ""}`).join("; ")}</p>
            </Card>
          )}

          {edit && (
            <Card title="Fee & challan" icon="fees">
              <form action={saveFee} className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="id" value={reg.id} /><input type="hidden" name="student_id" value={id} />
                <fieldset disabled={locked} className="m-0 contents border-0 p-0">
                  <Input label="Registration fee (₹)" name="fee_total" type="number" step="0.01" min={0} defaultValue={Number(reg.fee_total)} />
                  <Input label="To treasury (₹)" name="fee_to_treasury" type="number" step="0.01" min={0} defaultValue={Number(reg.fee_to_treasury)} />
                  <Input label="Fee received on" name="fee_paid_on" type="date" defaultValue={reg.fee_paid_on} />
                  <Input label="Exam year" name="exam_year" type="number" defaultValue={reg.exam_year} />
                  <Input label="Challan no." name="challan_no" defaultValue={reg.challan_no} />
                  <Input label="Challan date" name="challan_date" type="date" defaultValue={reg.challan_date} />
                </fieldset>
                {!locked && <div className="flex items-end"><Submit variant="secondary">Save</Submit></div>}
              </form>
            </Card>
          )}

          {(edit || approve) && (
            <Card title="Workflow" icon="school" description="Checking, submitting and accepting are done by the principal.">
              <div className="flex flex-wrap items-end gap-4">
                {reg.status === "draft" && approve && (
                  <form action={setRegistrationStatus}><input type="hidden" name="id" value={reg.id} /><input type="hidden" name="student_id" value={id} /><input type="hidden" name="status" value="checked" /><Submit>Check & freeze</Submit></form>
                )}
                {reg.status === "correction" && approve && (
                  <form action={setRegistrationStatus}><input type="hidden" name="id" value={reg.id} /><input type="hidden" name="student_id" value={id} /><input type="hidden" name="status" value="checked" /><Submit>Corrected — check again</Submit></form>
                )}
                {reg.status === "checked" && approve && (
                  <>
                    <form action={setRegistrationStatus} className="flex items-end gap-2">
                      <input type="hidden" name="id" value={reg.id} /><input type="hidden" name="student_id" value={id} /><input type="hidden" name="status" value="submitted" />
                      <Input label="Board reference" name="board_ref" defaultValue={reg.board_ref} /><Input label="Submitted on" name="submitted_on" type="date" />
                      <Submit>Mark submitted</Submit>
                    </form>
                    <form action={setRegistrationStatus}><input type="hidden" name="id" value={reg.id} /><input type="hidden" name="student_id" value={id} /><input type="hidden" name="status" value="draft" /><Submit variant="secondary">Back to draft</Submit></form>
                  </>
                )}
                {reg.status === "submitted" && approve && (
                  <>
                    <form action={setRegistrationStatus} className="flex items-end gap-2">
                      <input type="hidden" name="id" value={reg.id} /><input type="hidden" name="student_id" value={id} /><input type="hidden" name="status" value="accepted" />
                      <Input label="Board reference" name="board_ref" defaultValue={reg.board_ref} /><Submit>Board accepted</Submit>
                    </form>
                    <form action={setRegistrationStatus} className="flex items-end gap-2">
                      <input type="hidden" name="id" value={reg.id} /><input type="hidden" name="student_id" value={id} /><input type="hidden" name="status" value="correction" />
                      <Textarea label="What must be corrected" name="correction_note" rows={1} /><Submit variant="secondary">Correction requested</Submit>
                    </form>
                  </>
                )}
                {reg.status === "accepted" && <p className="m-0 text-[14px] text-[#0b4f2c]">Accepted by the board{reg.board_ref ? ` — ${reg.board_ref}` : ""}.</p>}
                {!approve && reg.status === "draft" && <p className="m-0 text-[14px] text-muted">Ready? Ask the principal to check this record.</p>}
              </div>
            </Card>
          )}

          <Card title="History">
            {(events ?? []).length ? (
              <Table head={["When", "Who", "What"]} minWidth={520}>
                {(events ?? []).map((e) => (
                  <tr key={e.id}><td className={td}>{fmtDate(e.at)}</td><td className={`${td} text-[13px]`}>{e.actor_name || "—"}</td>
                    <td className={td}>{e.event}{(e.details as { note?: string })?.note ? <div className="text-[12px] text-muted">{(e.details as { note?: string }).note}</div> : null}</td></tr>
                ))}
              </Table>
            ) : <p className="m-0 text-[14px] text-muted">No history yet.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
