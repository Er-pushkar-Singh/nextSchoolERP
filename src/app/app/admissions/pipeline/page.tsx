import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Stat, Submit, Table, td } from "@/components/ui/ui";
import { fmtDate, money, todayIST } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { APP_STATUS, STAGES as FLOW_STAGES } from "@/lib/applications";
import { DOC_TYPES } from "@/lib/student-docs";
import { saveAdmissionFlow } from "../../_actions/admission-flow";
import { lapseOffers, promoteWaitlist, saveAdmissionSettings } from "../../_actions/admissions2";

type Pipe = { by_status: Record<string, number>; by_source: { source: string; applications: number; admitted: number }[]; avg_days_to_decision: number | null;
  oldest_open_days: number | null; docs_pending: number; offers_expiring: number; followups_due: number; fee_received: number };
type Seat = { class_id: string; seats: number | null; active_students: number; approved: number; waitlisted: number; applications: number };

const STAGES = ["submitted", "under_review", "test_scheduled", "approved", "waitlisted", "admitted", "rejected", "cancelled"];

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, session, can } = await requirePerm("frontdesk.admissions.view");
  const sp = await searchParams;
  if (!session) return <Empty>No current session. Set one in Settings.</Empty>;
  const today = todayIST();
  const [pipeQ, seatsQ, classes, { data: settings }, { data: expiring }, { data: followups }, { count: enq }, stageQ, cfgQ] = await Promise.all([
    supabase.rpc("admission_pipeline", { sid: school.id, sess: session.id }),
    supabase.rpc("admission_seats", { sid: school.id, sess: session.id }),
    getClasses(supabase, school.id),
    supabase.from("admission_settings").select("offer_days,auto_sibling_discount").eq("school_id", school.id).maybeSingle(),
    supabase.from("admission_applications").select("id,application_no,applicant_name,class_id,offer_valid_till").eq("school_id", school.id).eq("session_id", session.id).eq("status", "approved").not("offer_valid_till", "is", null).order("offer_valid_till").limit(12),
    supabase.from("application_followups").select("id,due_on,channel,note,application_id,enquiry_id,admission_applications(id,applicant_name,application_no),enquiries(id,student_name)").eq("school_id", school.id).eq("done", false).lte("due_on", today).order("due_on").limit(10),
    supabase.from("enquiries").select("id", { count: "exact", head: true }).eq("school_id", school.id),
    supabase.rpc("application_stage_counts", { sid: school.id, sess: session.id }),
    supabase.from("admission_settings").select("required_docs,require_test,fee_before_allotment,strict_workflow,fee_window_days").eq("school_id", school.id).maybeSingle(),
  ]);
  const stageCounts = new Map(((stageQ.data ?? []) as { stage: string; n: number }[]).map((c) => [c.stage, Number(c.n)]));
  const cfg = cfgQ.data ?? { required_docs: ["birth_certificate", "photo"], require_test: false, fee_before_allotment: true, strict_workflow: true, fee_window_days: 31 };
  const p = (pipeQ.data ?? { by_status: {}, by_source: [] }) as Pipe;
  const n = (s: string) => p.by_status[s] ?? 0;
  const total = Object.values(p.by_status).reduce((t, v) => t + v, 0);
  const seats = ((seatsQ.data ?? []) as Seat[]).filter((s) => s.applications > 0 || s.seats !== null);
  const cname = new Map(classes.map((c) => [c.id, c.name]));
  const canApprove = can("frontdesk.admissions.approve");
  const fu = (followups ?? []) as unknown as { id: string; due_on: string; channel: string; note: string | null; admission_applications: { id: string; applicant_name: string; application_no: string } | null; enquiries: { id: string; student_name: string } | null }[];
  const max = Math.max(1, ...STAGES.map(n));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Admission pipeline" subtitle={`Session ${session.name} · every stage from enquiry to admitted`} back={{ href: "/app/admissions/applications", label: "Applications" }}
        actions={<Link href="/app/admissions/followups" className="btn btn-sm btn-secondary">Follow-ups{p.followups_due ? ` (${p.followups_due})` : ""}</Link>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Enquiries" value={enq ?? "—"} icon="admissions" />
        <Stat label="Applications" value={total} hint={`${n("admitted")} admitted · ${total ? Math.round((n("admitted") / total) * 100) : 0}% conversion`} icon="layers" tone="cyan" />
        <Stat label="Avg. days to decision" value={p.avg_days_to_decision ?? "—"} hint={p.oldest_open_days !== null ? `oldest open: ${p.oldest_open_days} days` : undefined} icon="notifications" tone="amber" />
        <Stat label="Application fee received" value={money(p.fee_received)} hint={`${p.docs_pending} with documents pending`} icon="fees" tone="green" />
      </div>

      <Card title="Where every application stands" icon="layers" description="The fixed order: details → documents → test → decision → admission fee → class & section.">
        <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3 lg:grid-cols-6">
          {FLOW_STAGES.filter(([k]) => !["closed", "waitlist"].includes(k)).map(([k, l], i) => (
            <li key={k}>
              <Link href={`/app/admissions/applications?stage=${k}`} className="block rounded-[12px] border border-line bg-white p-3 no-underline hover:border-blue">
                <span className="text-[12px] text-muted">{i + 1}. {l}</span>
                <b className="block text-[24px] text-ink">{stageCounts.get(k) ?? 0}</b>
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-3 mb-0 text-[13px] text-muted">Waitlisted: {stageCounts.get("waitlist") ?? 0} · Closed (rejected / cancelled): {stageCounts.get("closed") ?? 0}</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Funnel" icon="layers">
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {STAGES.map((s) => (
              <li key={s} className="grid grid-cols-[130px_1fr_36px] items-center gap-2 text-[14px]">
                <Link href={`/app/admissions/applications?status=${s}`}>{APP_STATUS[s]}</Link>
                <span className="h-3 rounded-full bg-[#eef1f6]"><span className="block h-3 rounded-full bg-blue" style={{ width: `${(n(s) / max) * 100}%` }} /></span>
                <b className="text-right text-ink">{n(s)}</b>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Where applications come from" icon="admissions">
          {p.by_source.length ? (
            <Table head={["Source", "Applications", "Admitted", "Rate"]} minWidth={360}>
              {p.by_source.map((s) => (
                <tr key={s.source}><td className={`${td} font-semibold text-ink`}>{s.source}</td><td className={td}>{s.applications}</td><td className={td}>{s.admitted}</td><td className={td}>{s.applications ? Math.round((s.admitted / s.applications) * 100) : 0}%</td></tr>
              ))}
            </Table>
          ) : <Empty>No applications yet.</Empty>}
        </Card>
      </div>

      <Card title="Seats and waitlist" icon="school" description="Free = seats − students − approved (not yet admitted). Promote moves the first waitlisted applications to approved while seats are free.">
        {seats.length ? (
          <Table head={["Class", "Seats", "Students", "Approved", "Free", "Waitlisted", "Applications", ""]} minWidth={760}>
            {seats.map((s) => {
              const free = s.seats !== null ? s.seats - s.active_students - s.approved : null;
              return (
                <tr key={s.class_id}>
                  <td className={`${td} font-semibold text-ink`}><Link href={`/app/admissions/applications?class_id=${s.class_id}`}>Class {cname.get(s.class_id)}</Link></td>
                  <td className={td}>{s.seats ?? "—"}</td><td className={td}>{s.active_students}</td><td className={td}>{s.approved}</td>
                  <td className={td}>{free === null ? "—" : <b className={free <= 0 ? "text-error" : "text-ink"}>{free}</b>}</td>
                  <td className={td}>{s.waitlisted}</td><td className={td}>{s.applications}</td>
                  <td className={td}>
                    {canApprove && s.waitlisted > 0 && free !== null && free > 0 && (
                      <form action={promoteWaitlist}><input type="hidden" name="class_id" value={s.class_id} /><button className="btn btn-sm btn-primary cursor-pointer border-0">Promote waitlist</button></form>
                    )}
                    <Link href={`/app/admissions/applications/test-sheet?class_id=${s.class_id}`} className="text-[13px]">Marks & merit list</Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>No seats set. Set the seats for each class in Settings → Classes & sessions.</Empty>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Approved — offer valid till" icon="notifications" description={`An approval keeps the seat for ${settings?.offer_days ?? 7} days.`}
          actions={canApprove ? <form action={lapseOffers}><button className="cursor-pointer border-0 bg-transparent p-0 text-[14px] font-semibold text-blue">Cancel expired offers</button></form> : undefined}>
          {(expiring ?? []).length ? (
            <ul className="m-0 list-none p-0 text-[14px]">
              {(expiring ?? []).map((a) => (
                <li key={a.id} className="flex justify-between gap-2 border-t border-line py-1.5 first:border-0">
                  <Link href={`/app/admissions/applications/${a.id}`}>{a.applicant_name} <span className="text-[12px] text-muted">· Class {cname.get(a.class_id ?? "") ?? "—"}</span></Link>
                  <b className={a.offer_valid_till! < today ? "text-error" : a.offer_valid_till! <= todayIST() ? "text-error" : "text-ink"}>{fmtDate(a.offer_valid_till)}</b>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[14px] text-muted">No approved applications are waiting.</p>}
        </Card>
        <Card title="Follow-ups due" icon="notifications" actions={<Link href="/app/admissions/followups" className="text-[14px] font-semibold">All →</Link>}>
          {fu.length ? (
            <ul className="m-0 list-none p-0 text-[14px]">
              {fu.map((x) => (
                <li key={x.id} className="border-t border-line py-1.5 first:border-0">
                  <b className={x.due_on < today ? "text-error" : "text-ink"}>{fmtDate(x.due_on)}</b> · {x.channel} ·{" "}
                  {x.admission_applications ? <Link href={`/app/admissions/applications/${x.admission_applications.id}`}>{x.admission_applications.applicant_name}</Link> : x.enquiries?.student_name}
                  {x.note && <span className="text-muted"> — {x.note}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[14px] text-muted">Nothing due. 🎉</p>}
        </Card>
      </div>

      {canApprove && (
        <Card title="Admission flow rules" icon="school" description="What must be complete before each step. Applies to every new approval.">
          <form action={saveAdmissionFlow} className="grid gap-4">
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-1 text-[13px] font-semibold text-ink">Documents required before approval</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
                {DOC_TYPES.filter(([k]) => k !== "other").map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1"><input type="checkbox" name="required_docs" value={k} defaultChecked={(cfg.required_docs ?? []).includes(k)} /> {l}</label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" name="strict_workflow" defaultChecked={cfg.strict_workflow} className="mt-1" />
              <span><b className="text-ink">Check the file before approval</b><span className="block text-[13px] text-muted">An application cannot be approved while details, required documents (or test marks) are missing.</span></span></label>
            <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" name="require_test" defaultChecked={cfg.require_test} className="mt-1" />
              <span><b className="text-ink">Entrance test / interview is required</b><span className="block text-[13px] text-muted">Approval waits for the test marks.</span></span></label>
            <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" name="fee_before_allotment" defaultChecked={cfg.fee_before_allotment} className="mt-1" />
              <span><b className="text-ink">Admission fee before class &amp; section</b><span className="block text-[13px] text-muted">The student record is created without a class; the class and section are given only after the fee is paid (or waived by the principal).</span></span></label>
            <div className="max-w-xs"><Input label="Admission fee = dues falling due within (days)" name="fee_window_days" type="number" min={0} max={365} defaultValue={cfg.fee_window_days} hint="Admission, annual and the first instalments are usually due within a month." /></div>
            <div><Submit>Save flow rules</Submit></div>
          </form>
        </Card>
      )}

      {canApprove && (
        <Card title="Admission settings" icon="school">
          <form action={saveAdmissionSettings} className="flex flex-wrap items-end gap-4">
            <Input label="Offer valid for (days)" name="offer_days" type="number" min={1} max={90} defaultValue={settings?.offer_days ?? 7} />
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="auto_sibling_discount" defaultChecked={settings?.auto_sibling_discount ?? true} /> Apply the sibling discount automatically when a sibling is admitted</label>
            <Submit>Save</Submit>
          </form>
          <p className="mt-2 mb-0 text-[13px] text-muted">The discount percentage is set in Fees → Fee settings.</p>
        </Card>
      )}
    </div>
  );
}
