import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Table, td } from "@/components/ui/ui";
import { cleanSearch, fmtDate } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { APP_STATUS, APP_TONE } from "@/lib/applications";

type Row = { source: string | null; id: string; application_no: string; applicant_name: string; father_name: string | null; phone: string | null; status: string; rte_applicant: boolean; applied_on: string; class_id: string | null; waitlist_no: number | null; test_on: string | null; test_marks: number | null; test_max: number | null };

export default async function Applications({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; class_id?: string; source?: string; ok?: string; error?: string }> }) {
  const { supabase, school, session, can } = await requirePerm("frontdesk.admissions.view");
  const sp = await searchParams;
  const q = cleanSearch(sp.q ?? "").trim();
  const status = Object.keys(APP_STATUS).includes(sp.status ?? "") ? sp.status! : null;
  const cls = sp.class_id && /^[0-9a-f-]{36}$/.test(sp.class_id) ? sp.class_id : null;
  let list = supabase.from("admission_applications").select("id,application_no,applicant_name,father_name,phone,status,rte_applicant,applied_on,class_id,waitlist_no,test_on,test_marks,test_max,source")
    .eq("school_id", school.id).order("created_at", { ascending: false }).limit(300);
  if (session) list = list.eq("session_id", session.id);
  if (status) list = list.eq("status", status);
  if (cls) list = list.eq("class_id", cls);
  const online = sp.source === "Online";
  if (online) list = list.eq("source", "Online");
  if (q) list = list.or(`applicant_name.ilike.%${q}%,application_no.ilike.%${q}%,father_name.ilike.%${q}%,phone.ilike.%${q}%`);
  const [{ data }, classes, seatsQ, enq] = await Promise.all([
    list,
    getClasses(supabase, school.id),
    session ? supabase.rpc("admission_seats", { sid: school.id, sess: session.id }) : Promise.resolve({ data: [] }),
    can("frontdesk.enquiries.view") ? supabase.from("enquiries").select("id", { count: "exact", head: true }).eq("school_id", school.id) : Promise.resolve({ count: null }),
  ]);
  const R = (data ?? []) as Row[];
  const cname = new Map(classes.map((c) => [c.id, c.name]));
  const seats = ((seatsQ.data ?? []) as { class_id: string; seats: number | null; active_students: number; approved: number; waitlisted: number; applications: number }[]).filter((s) => s.applications > 0 || s.seats !== null);
  const { data: all } = session ? await supabase.from("admission_applications").select("status").eq("school_id", school.id).eq("session_id", session.id).limit(10000) : { data: [] };
  const n = (st: string) => (all ?? []).filter((a) => a.status === st).length;
  const total = (all ?? []).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Admission applications" subtitle={`Session ${session?.name ?? "—"} · from enquiry to admitted student`}
        actions={<>
          <Link href="/app/admissions/pipeline" className="btn btn-sm btn-secondary">Pipeline</Link>
          <Link href="/app/admissions/followups" className="btn btn-sm btn-secondary">Follow-ups</Link>
          <Link href="/app/admissions/applications/test-sheet" className="btn btn-sm btn-secondary">Marks &amp; merit</Link>
          <a href={`/app/admissions/applications/export${status ? `?status=${status}` : ""}`} className="btn btn-sm btn-secondary">CSV</a>
          <Link href="/app/admissions" className="btn btn-sm btn-secondary">Enquiries</Link>
          {can("frontdesk.online_form.view") && <Link href="/app/admissions/online" className="btn btn-sm btn-secondary">Online form</Link>}
          {can("frontdesk.admissions.create") && <Link href="/app/admissions/applications/new" className="btn btn-sm btn-primary">New application</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Enquiries" value={enq.count ?? "—"} icon="admissions" />
        <Stat label="Applications" value={total} icon="layers" tone="cyan" />
        <Stat label="In process" value={n("submitted") + n("under_review") + n("test_scheduled")} icon="notifications" tone="amber" />
        <Stat label="Approved" value={n("approved")} hint={n("waitlisted") ? `${n("waitlisted")} waitlisted` : undefined} icon="school" tone="violet" />
        <Stat label="Admitted" value={n("admitted")} icon="students" tone="green" />
        <Stat label="Conversion" value={total ? `${Math.round((n("admitted") / total) * 100)}%` : "—"} hint={`${n("rejected")} rejected`} icon="revenue" tone="rose" />
      </div>

      {seats.length > 0 && (
        <Card title="Seats" icon="school" description="Set the seats for each class in Settings → Classes & sessions.">
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
        </Card>
      )}

      <form className="flex flex-wrap items-end gap-2">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, application no., father, phone" />
        <Select label="Class" name="class_id" blank="All" defaultValue={cls} options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
        <Select label="Status" name="status" blank="All" defaultValue={status} options={Object.entries(APP_STATUS)} />
        <Select label="Source" name="source" blank="All" defaultValue={online ? "Online" : null} options={[["Online", "Online form"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>

      {R.length ? (
        <Table head={["Application", "Applicant", "Class", "Father · phone", "Applied", "Test", "Status"]} minWidth={860}>
          {R.map((a) => (
            <tr key={a.id}>
              <td className={`${td} font-mono text-[13px]`}><Link href={`/app/admissions/applications/${a.id}`}>{a.application_no}</Link></td>
              <td className={`${td} font-semibold text-ink`}>{a.applicant_name}{a.rte_applicant && <span className="ml-1 rounded bg-blue-tint px-1.5 text-[11px] font-bold text-blue-strong">RTE</span>}{a.source === "Online" && <span className="ml-1 rounded bg-wa-tint px-1.5 text-[11px] font-bold text-[#0b4f2c]">Online</span>}</td>
              <td className={td}>{a.class_id ? cname.get(a.class_id) : "—"}</td>
              <td className={`${td} text-[13px]`}>{a.father_name ?? "—"}<div className="text-muted">{a.phone ?? ""}</div></td>
              <td className={td}>{fmtDate(a.applied_on)}</td>
              <td className={`${td} text-[13px]`}>{a.test_marks !== null ? `${a.test_marks}/${a.test_max ?? "?"}` : a.test_on ? fmtDate(a.test_on) : "—"}</td>
              <td className={td}><Badge value={APP_TONE[a.status]} text={APP_STATUS[a.status] + (a.waitlist_no ? ` #${a.waitlist_no}` : "")} /></td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No applications{status || q || cls ? " match." : " yet."}</Empty>}
    </div>
  );
}
