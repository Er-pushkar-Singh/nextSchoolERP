import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { cleanSearch, fmtDate } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { APP_STATUS, APP_TONE, STAGES } from "@/lib/applications";

type Row = { id: string; application_no: string; applicant_name: string; father_name: string | null; phone: string | null; class_id: string | null; status: string; stage: string;
  applied_on: string; rte_applicant: boolean; source: string | null; waitlist_no: number | null; offer_valid_till: string | null; student_id: string | null; total: number };

const STAGE_TONE: Record<string, string> = { details: "new", documents: "due", assessment: "test", decision: "contacted", fee: "due", allotment: "paid", admitted: "admitted", waitlist: "due", closed: "cancelled" };
const stageName = new Map(STAGES);

export default async function Applications({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, session, can } = await requirePerm("frontdesk.admissions.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = cleanSearch(sp.q ?? "").trim();
  const stage = STAGES.some(([k]) => k === sp.stage) ? sp.stage! : "";
  const cls = sp.class_id && /^[0-9a-f-]{36}$/.test(sp.class_id) ? sp.class_id : null;
  const classes = await getClasses(supabase, school.id);
  const [boardQ, countsQ, seatsQ, enq] = session
    ? await Promise.all([
        supabase.rpc("application_board", { sid: school.id, sess: session.id, p_stage: stage || null, p_q: q || null, p_class: cls, p_limit: size, p_offset: offset }),
        supabase.rpc("application_stage_counts", { sid: school.id, sess: session.id }),
        supabase.rpc("admission_seats", { sid: school.id, sess: session.id }),
        can("frontdesk.enquiries.view") ? supabase.from("enquiries").select("id", { count: "exact", head: true }).eq("school_id", school.id) : Promise.resolve({ count: null }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { count: null }] as const;
  const R = (boardQ.data ?? []) as Row[];
  const total = R[0]?.total ? Number(R[0].total) : 0;
  const counts = new Map(((countsQ.data ?? []) as { stage: string; n: number }[]).map((c) => [c.stage, Number(c.n)]));
  const all = counts.get("total") ?? 0;
  const cname = new Map(classes.map((c) => [c.id, c.name]));
  const seats = ((seatsQ.data ?? []) as { class_id: string; seats: number | null; active_students: number; approved: number; waitlisted: number; applications: number }[]).filter((s) => s.applications > 0 || s.seats !== null);
  const params = { q: q || undefined, stage: stage || undefined, class_id: cls ?? undefined };
  const inProcess = ["details", "documents", "assessment", "decision"].reduce((t, k) => t + (counts.get(k) ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Admission applications" subtitle={`Session ${session?.name ?? "—"} · enquiry → details → documents → test → decision → fee → class & section`}
        actions={<>
          <Link href="/app/admissions/pipeline" className="btn btn-sm btn-secondary">Pipeline</Link>
          <Link href="/app/admissions/followups" className="btn btn-sm btn-secondary">Follow-ups</Link>
          <Link href="/app/admissions/applications/test-sheet" className="btn btn-sm btn-secondary">Marks &amp; merit</Link>
          <a href={`/app/admissions/applications/export${stage ? `?stage=${stage}` : ""}`} className="btn btn-sm btn-secondary">CSV</a>
          <Link href="/app/admissions" className="btn btn-sm btn-secondary">Enquiries</Link>
          {can("frontdesk.online_form.view") && <Link href="/app/admissions/online" className="btn btn-sm btn-secondary">Online form</Link>}
          {can("frontdesk.admissions.create") && <Link href="/app/admissions/applications/new" className="btn btn-sm btn-primary">New application</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Enquiries" value={enq.count ?? "—"} icon="admissions" />
        <Stat label="Applications" value={all} icon="layers" tone="cyan" />
        <Stat label="Completing file" value={inProcess} hint="details · documents · test · decision" icon="notifications" tone="amber" />
        <Stat label="Fee pending" value={counts.get("fee") ?? 0} icon="fees" tone="rose" />
        <Stat label="Ready for class" value={counts.get("allotment") ?? 0} icon="school" tone="violet" />
        <Stat label="Admitted" value={counts.get("admitted") ?? 0} hint={all ? `${Math.round(((counts.get("admitted") ?? 0) / all) * 100)}% of applications` : undefined} icon="students" tone="green" />
      </div>

      <nav className="flex flex-wrap gap-2 text-[14px]" aria-label="Stage">
        <Link href="/app/admissions/applications" className={`chip ${!stage ? "!border-ink" : ""}`}>All ({all})</Link>
        {STAGES.map(([k, l]) => (counts.get(k) ?? 0) > 0 || stage === k
          ? <Link key={k} href={`/app/admissions/applications?stage=${k}`} className={`chip ${stage === k ? "!border-ink" : ""}`}>{l} ({counts.get(k) ?? 0})</Link> : null)}
      </nav>

      {seats.length > 0 && (
        <details className="rounded-[14px] border border-line bg-white p-4">
          <summary className="cursor-pointer text-[14px] font-bold text-ink">Seats by class</summary>
          <div className="mt-3">
            <Table head={["Class", "Seats", "Students now", "Approved (not yet admitted)", "Free", "Waitlisted", "Applications"]} minWidth={720}>
              {seats.map((s) => {
                const free = s.seats !== null ? s.seats - s.active_students - s.approved : null;
                return (
                  <tr key={s.class_id}>
                    <td className={`${td} font-semibold text-ink`}><Link href={`/app/admissions/applications?class_id=${s.class_id}`}>Class {cname.get(s.class_id)}</Link></td>
                    <td className={td}>{s.seats ?? "—"}</td><td className={td}>{s.active_students}</td><td className={td}>{s.approved}</td>
                    <td className={td}>{free === null ? "—" : <b className={free <= 0 ? "text-error" : "text-ink"}>{free}</b>}</td>
                    <td className={td}>{s.waitlisted}</td><td className={td}>{s.applications}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </details>
      )}

      <form className="flex flex-wrap items-end gap-2">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, application no., father, phone" />
        <Select label="Class" name="class_id" blank="All" defaultValue={cls} options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
        <Select label="Stage" name="stage" blank="All" defaultValue={stage} options={STAGES} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>

      {boardQ.error && <Flash error={`Could not load applications: ${boardQ.error.message}`} />}
      {R.length ? (
        <Table head={["Application", "Applicant", "Class", "Father · phone", "Applied", "Stage", "Status"]} minWidth={900}>
          {R.map((a) => (
            <tr key={a.id}>
              <td className={`${td} font-mono text-[13px]`}><Link href={`/app/admissions/applications/${a.id}`}>{a.application_no}</Link></td>
              <td className={`${td} font-semibold text-ink`}>{a.applicant_name}{a.rte_applicant && <span className="ml-1 rounded bg-blue-tint px-1.5 text-[11px] font-bold text-blue-strong">RTE</span>}{a.source === "Online" && <span className="ml-1 rounded bg-wa-tint px-1.5 text-[11px] font-bold text-[#0b4f2c]">Online</span>}</td>
              <td className={td}>{a.class_id ? cname.get(a.class_id) : "—"}</td>
              <td className={`${td} text-[13px]`}>{a.father_name ?? "—"}<div className="text-muted">{a.phone ?? ""}</div></td>
              <td className={td}>{fmtDate(a.applied_on)}{a.status === "approved" && a.offer_valid_till && <div className="text-[12px] text-muted">offer till {fmtDate(a.offer_valid_till)}</div>}</td>
              <td className={td}><Badge value={STAGE_TONE[a.stage] ?? "neutral"} text={stageName.get(a.stage) ?? a.stage} /></td>
              <td className={td}><Badge value={APP_TONE[a.status]} text={APP_STATUS[a.status] + (a.waitlist_no ? ` #${a.waitlist_no}` : "")} /></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No applications{stage || q || cls ? " match." : " yet."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/admissions/applications" params={params} />
    </div>
  );
}
