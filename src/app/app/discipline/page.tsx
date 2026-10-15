import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { IncidentStudents } from "@/components/wellbeing/IncidentStudents";
import { addDays, fmtDate, label, todayIST } from "@/lib/format";
import { addCounselling, reportIncident, updateIncident } from "../_actions/wellbeing";

type Inc = { id: string; incident_on: string; category: string; severity: string; status: string; location: string | null; description: string; action_taken: string | null;
  parent_informed: boolean; follow_up_on: string | null; confidential: boolean; reported_by_name: string | null; students: string | null; student_count: number; total: number };
const CATS = ["bullying", "fighting", "misbehaviour", "late_coming", "uniform", "mobile_phone", "property_damage", "cheating", "absconding", "abuse", "other"];
const STATUS: [string, string][] = [["open", "Open"], ["under_review", "Under review"], ["action_taken", "Action taken"], ["closed", "Closed"], ["escalated", "Escalated"]];
const SEV_BADGE: Record<string, string> = { minor: "low", moderate: "high", serious: "urgent" };
const STATUS_BADGE: Record<string, string> = { open: "new", under_review: "review", action_taken: "in_progress", closed: "done", escalated: "urgent" };
type Note = { id: string; on_date: string; note: string; by_name: string | null; student: { first_name: string; last_name: string | null; admission_no: string } | { first_name: string; last_name: string | null; admission_no: string }[] | null };

export default async function Discipline({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("wellbeing.discipline.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const today = todayIST();
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const d1 = ok(sp.from) ?? addDays(today, -89);
  const d2 = ok(sp.to) ?? today;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const status = STATUS.some(([k]) => k === sp.status) ? sp.status! : null;
  const category = CATS.includes(sp.category ?? "") ? sp.category! : null;
  const severity = ["minor", "moderate", "serious"].includes(sp.severity ?? "") ? sp.severity! : null;
  const approver = can("wellbeing.discipline.approve");

  const [{ data }, { data: open }, { data: notes }] = await Promise.all([
    supabase.rpc("discipline_list", { sid: school.id, d1, d2, p_q: q || null, p_status: status, p_category: category, p_severity: severity, p_limit: size, p_offset: offset }),
    supabase.rpc("discipline_list", { sid: school.id, d1: addDays(today, -365), d2: today, p_limit: 200, p_offset: 0 }),
    approver ? supabase.from("counselling_notes").select("id,on_date,note,by_name,student:students(first_name,last_name,admission_no)").eq("school_id", school.id).order("created_at", { ascending: false }).limit(6) : Promise.resolve({ data: [] }),
  ]);
  const I = (data ?? []) as Inc[];
  const A = (open ?? []) as Inc[];
  const total = I[0] ? Number(I[0].total) : 0;
  const params = { from: d1 === addDays(today, -89) ? undefined : d1, to: d2 === today ? undefined : d2, q: q || undefined, status: status ?? undefined, category: category ?? undefined, severity: severity ?? undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `/app/discipline${qs ? `?${qs}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="discipline" title="Discipline" subtitle="Incidents, action taken and follow-up — bullying and abuse are kept confidential"
        actions={<>
          {approver && (
            <Modal label="+ Counselling note" variant="secondary" title="Counselling note" size="sm">
              <form action={addCounselling} className="flex flex-col gap-3">
                <input type="hidden" name="back" value={back} />
                <EntityPicker kind="student" name="student_id" label="Student" required />
                <Textarea label="Note (visible only to the principal)" name="note" rows={4} />
                <Submit>Save note</Submit>
              </form>
            </Modal>
          )}
          {can("wellbeing.discipline.create") && (
            <Modal label="+ Report an incident" title="Report an incident">
              <form action={reportIncident} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <IncidentStudents />
                <Select label="Type" name="category" defaultValue="misbehaviour" options={CATS.map((c) => [c, label(c)] as [string, string])} />
                <Select label="Severity" name="severity" defaultValue="minor" options={[["minor", "Minor"], ["moderate", "Moderate"], ["serious", "Serious — goes to the principal"]]} />
                <Input label="Date" name="incident_on" type="date" defaultValue={today} max={today} />
                <Input label="Place" name="location" placeholder="Playground, bus, classroom…" />
                <Textarea label="What happened" name="description" rows={3} className="sm:col-span-2" />
                <Textarea label="Action taken so far" name="action_taken" rows={2} className="sm:col-span-2" />
                <Input label="Follow-up on" name="follow_up_on" type="date" min={today} />
                <div className="flex flex-col justify-end gap-1.5 pb-1 text-[14px]">
                  <label className="flex items-center gap-2"><input type="checkbox" name="informed" /> Parents informed</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="confidential" /> Confidential</label>
                </div>
                <div className="sm:col-span-2"><Submit>Save incident</Submit></div>
              </form>
            </Modal>
          )}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open incidents" value={A.filter((a) => a.status === "open" || a.status === "under_review").length} icon="discipline" tone="amber" href="/app/discipline?status=open" />
        <Stat label="Serious (this year)" value={A.filter((a) => a.severity === "serious").length} icon="notifications" tone="rose" href="/app/discipline?severity=serious" />
        <Stat label="Follow-ups due" value={A.filter((a) => a.follow_up_on && a.follow_up_on <= today && a.status !== "closed").length} icon="attendance" tone="violet" />
        <Stat label="Parents not informed" value={A.filter((a) => !a.parent_informed && a.status !== "closed").length} icon="students" tone="cyan" />
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <Input label="From" name="from" type="date" defaultValue={d1} />
        <Input label="To" name="to" type="date" defaultValue={d2} />
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Student or words in the description" className="input !min-h-10 w-60 !py-2 text-[15px] font-normal" /></label>
        <Select label="Status" name="status" blank="Any" defaultValue={status} options={STATUS} />
        <Select label="Type" name="category" blank="Any" defaultValue={category} options={CATS.map((c) => [c, label(c)] as [string, string])} />
        <Select label="Severity" name="severity" blank="Any" defaultValue={severity} options={[["minor", "Minor"], ["moderate", "Moderate"], ["serious", "Serious"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>

      {I.length ? (
        <Table head={["Date", "Students", "Incident", "Severity", "Status", ""]} minWidth={960}>
          {I.map((i) => (
            <tr key={i.id}>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{fmtDate(i.incident_on)}{i.confidential && <div><Badge value="spam" text="Confidential" /></div>}</td>
              <td className={`${td} max-w-[220px] text-[13.5px]`}>{i.students}</td>
              <td className={td}><b className="text-ink">{label(i.category)}</b>{i.location ? <span className="text-muted"> · {i.location}</span> : null}
                <div className="text-[13.5px]">{i.description}</div>
                {i.action_taken && <div className="mt-1 text-[12.5px] text-muted"><b>Action:</b> {i.action_taken}</div>}
                <div className="mt-1 text-[12px] text-muted">Reported by {i.reported_by_name ?? "—"}{i.follow_up_on ? ` · follow-up ${fmtDate(i.follow_up_on)}` : ""}{!i.parent_informed ? " · parents not informed" : ""}</div></td>
              <td className={td}><Badge value={SEV_BADGE[i.severity] ?? "normal"} text={label(i.severity)} /></td>
              <td className={td}><Badge value={STATUS_BADGE[i.status] ?? "normal"} text={label(i.status)} /></td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>
                {/* the database decides who may update: editors, or the person who reported it */}
                {i.status !== "closed" && (
                  <Modal label="Update" variant="link" title="Update incident" size="sm">
                    <form action={updateIncident} className="flex flex-col gap-3">
                      <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={i.id} />
                      <Select label="Status" name="status" defaultValue={i.status} options={approver ? STATUS : STATUS.filter(([k]) => k !== "closed" && k !== "escalated")} />
                      <Textarea label="Action taken" name="action_taken" rows={3} defaultValue={i.action_taken} />
                      <Input label="Follow-up on" name="follow_up_on" type="date" defaultValue={i.follow_up_on} />
                      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="informed" defaultChecked={i.parent_informed} /> Parents informed</label>
                      <Submit>Save</Submit>
                    </form>
                  </Modal>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No incidents in this period.</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/discipline" params={params} />

      {approver && (notes ?? []).length > 0 && (
        <Card title="Recent counselling notes" description="Visible only to those who can approve discipline actions.">
          <ul className="m-0 list-none p-0 text-[14px]">
            {((notes ?? []) as unknown as Note[]).map((n) => {
              const s = Array.isArray(n.student) ? n.student[0] : n.student;
              return (
                <li key={n.id} className="border-t border-line py-2.5 first:border-0">
                  <div className="flex flex-wrap justify-between gap-2"><b className="text-ink">{s ? `${s.first_name} ${s.last_name ?? ""}`.trim() : "—"} <span className="font-normal text-muted">{s?.admission_no}</span></b>
                    <span className="text-[12.5px] text-muted">{fmtDate(n.on_date)} · {n.by_name}</span></div>
                  <p className="m-0 mt-0.5 text-body">{n.note}</p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <p className="m-0 text-[12.5px] text-muted print:hidden">Class teachers see and report incidents of their own sections only. <Link href="/app/health">Medical room →</Link></p>
    </div>
  );
}
