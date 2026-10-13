import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { addDays, fmtDate, todayIST, waLink } from "@/lib/format";
import { addFollowup, completeFollowup } from "../../_actions/admissions2";

type F = { id: string; due_on: string; channel: string; note: string | null; done: boolean; outcome: string | null; done_at: string | null;
  admission_applications: { id: string; applicant_name: string; application_no: string; phone: string | null } | null; enquiries: { id: string; student_name: string; phone: string | null } | null };

export default async function Followups({ searchParams }: { searchParams: Promise<{ show?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.admissions.view", "frontdesk.enquiries.view");
  const sp = await searchParams;
  const today = todayIST();
  const showDone = sp.show === "done";
  let q = supabase.from("application_followups").select("id,due_on,channel,note,done,outcome,done_at,admission_applications(id,applicant_name,application_no,phone),enquiries(id,student_name,phone)").eq("school_id", school.id);
  q = showDone ? q.eq("done", true).order("done_at", { ascending: false }).limit(100) : q.eq("done", false).order("due_on").limit(200);
  const [{ data }, { data: apps }, { data: enqs }] = await Promise.all([
    q,
    can("frontdesk.admissions.edit") ? supabase.from("admission_applications").select("id,applicant_name,application_no").eq("school_id", school.id).not("status", "in", "(admitted,cancelled,rejected)").order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    can("frontdesk.enquiries.edit") ? supabase.from("enquiries").select("id,student_name").eq("school_id", school.id).not("status", "in", "(admitted,lost)").order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  const rows = (data ?? []) as unknown as F[];
  const canEdit = can("frontdesk.admissions.edit") || can("frontdesk.enquiries.edit");
  const who = [...(apps ?? []).map((a) => [`a:${a.id}`, `${a.applicant_name} · ${a.application_no}`] as [string, string]), ...(enqs ?? []).map((e) => [`e:${e.id}`, `${e.student_name} · enquiry`] as [string, string])];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Admission follow-ups" subtitle={showDone ? "Completed" : `${rows.filter((r) => r.due_on <= today).length} due or overdue`} back={{ href: "/app/admissions/pipeline", label: "Pipeline" }}
        actions={<Link href={showDone ? "/app/admissions/followups" : "/app/admissions/followups?show=done"} className="btn btn-sm btn-secondary">{showDone ? "Open ones" : "Completed"}</Link>} />
      <Flash ok={sp.ok} error={sp.error} />
      {rows.length ? (
        <Table head={["Due", "Who", "How", "Note", showDone ? "Outcome" : ""]} minWidth={820}>
          {rows.map((r) => {
            const a = r.admission_applications, e = r.enquiries;
            const phone = a?.phone ?? e?.phone ?? null;
            const wa = phone && !showDone ? waLink(phone, `Namaste, this is ${school.name} regarding the admission of ${a?.applicant_name ?? e?.student_name}.`) : null;
            return (
              <tr key={r.id}>
                <td className={`${td} ${!r.done && r.due_on < today ? "font-semibold text-error" : ""}`}>{fmtDate(r.due_on)}</td>
                <td className={td}>{a ? <Link href={`/app/admissions/applications/${a.id}`} className="font-semibold">{a.applicant_name}</Link> : <Link href={`/app/admissions?edit=${e?.id}`} className="font-semibold">{e?.student_name}</Link>}
                  <div className="text-[12px] text-muted">{a ? a.application_no : "enquiry"}{phone ? ` · ${phone}` : ""}</div></td>
                <td className={td}>{r.channel}</td>
                <td className={td}>{r.note ?? "—"}</td>
                <td className={td}>
                  {showDone ? (r.outcome ?? "—") : canEdit && (
                    <form action={completeFollowup} className="flex flex-col gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <input name="outcome" placeholder="What happened?" aria-label="Outcome" className="input !min-h-9 !py-1 text-[13px]" />
                      <span className="flex flex-wrap items-center gap-2">
                        <input name="next_due" type="date" defaultValue={addDays(today, 3)} aria-label="Next follow-up" className="input !min-h-9 !py-1 text-[13px]" />
                        <button className="btn btn-sm btn-primary cursor-pointer border-0">Done + next</button>
                        {wa && <a href={wa} target="_blank" rel="noopener" className="text-[13px]">WhatsApp</a>}
                      </span>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{showDone ? "Nothing completed yet." : "No open follow-ups."}</Empty>}

      {canEdit && who.length > 0 && !showDone && (
        <Card title="Add a follow-up">
          <form action={addFollowup} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select label="Applicant / enquiry" name="who" options={who} />
            <Select label="How" name="channel" options={[["call", "Call"], ["whatsapp", "WhatsApp"], ["visit", "Visit"], ["sms", "SMS"], ["email", "Email"]]} />
            <Input label="On" name="due_on" type="date" defaultValue={addDays(today, 1)} required />
            <Input label="Note" name="note" />
            <div className="flex items-end"><Submit>Add</Submit></div>
          </form>
          <p className="mt-2 mb-0 text-[13px] text-muted">You can also add one from an application&apos;s page.</p>
        </Card>
      )}
    </div>
  );
}
