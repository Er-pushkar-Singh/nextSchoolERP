import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { addDays, cleanSearch, fmtDate, todayIST, waLink } from "@/lib/format";
import { addFollowup, completeFollowup, deleteFollowup, updateFollowup } from "../../_actions/admissions2";

type F = { id: string; due_on: string; channel: string; note: string | null; done: boolean; outcome: string | null; done_at: string | null; application_id: string | null; enquiry_id: string | null;
  admission_applications: { id: string; applicant_name: string; application_no: string; phone: string | null } | null; enquiries: { id: string; student_name: string; phone: string | null } | null };
const CHANNELS: [string, string][] = [["call", "Call"], ["whatsapp", "WhatsApp"], ["visit", "Visit"], ["sms", "SMS"], ["email", "Email"]];

export default async function Followups({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.admissions.view", "frontdesk.enquiries.view");
  const sp = await searchParams;
  const today = todayIST();
  const { page, size, offset } = pageParams(sp);
  const show = sp.show === "done" ? "done" : sp.show === "all" ? "all" : "open";
  const channel = CHANNELS.some(([k]) => k === sp.channel) ? sp.channel! : null;
  const when = ["overdue", "today", "week"].includes(sp.when ?? "") ? sp.when! : null;
  const q = cleanSearch(sp.q ?? "").trim();
  const canEdit = can("frontdesk.admissions.edit") || can("frontdesk.enquiries.edit");

  let query = supabase.from("application_followups")
    .select("id,due_on,channel,note,done,outcome,done_at,application_id,enquiry_id,admission_applications(id,applicant_name,application_no,phone),enquiries(id,student_name,phone)", { count: "exact" })
    .eq("school_id", school.id);
  if (show === "open") query = query.eq("done", false);
  if (show === "done") query = query.eq("done", true);
  if (channel) query = query.eq("channel", channel);
  if (when === "overdue") query = query.lt("due_on", today).eq("done", false);
  if (when === "today") query = query.eq("due_on", today).eq("done", false);
  if (when === "week") query = query.gte("due_on", today).lte("due_on", addDays(today, 7)).eq("done", false);
  if (q) {
    const p = `%${q.replace(/[%_\\,()]/g, " ")}%`;
    const [{ data: a }, { data: e }] = await Promise.all([
      supabase.from("admission_applications").select("id").eq("school_id", school.id).or(`applicant_name.ilike.${p},application_no.ilike.${p},phone.ilike.${p}`).limit(200),
      supabase.from("enquiries").select("id").eq("school_id", school.id).or(`student_name.ilike.${p},phone.ilike.${p}`).limit(200),
    ]);
    const aIds = (a ?? []).map((x) => x.id), eIds = (e ?? []).map((x) => x.id);
    const parts = [aIds.length ? `application_id.in.(${aIds.join(",")})` : null, eIds.length ? `enquiry_id.in.(${eIds.join(",")})` : null, `note.ilike.${p}`].filter(Boolean).join(",");
    query = query.or(parts);
  }
  query = show === "done" ? query.order("done_at", { ascending: false }) : query.order("due_on");
  const editId = sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) ? sp.edit : null;
  const [{ data, count }, { count: overdueN }, { count: todayN }] = await Promise.all([
    query.range(offset, offset + size - 1),
    supabase.from("application_followups").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("done", false).lt("due_on", today),
    supabase.from("application_followups").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("done", false).eq("due_on", today),
  ]);
  const rows = (data ?? []) as unknown as F[];
  const editing = editId ? rows.find((r) => r.id === editId) ?? null : null;
  const params = { show: show === "open" ? undefined : show, channel: channel ?? undefined, when: when ?? undefined, q: q || undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: sp.page, size: sp.size }).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/app/admissions/followups${qs ? "?" + qs : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Admission follow-ups" subtitle={`${overdueN ?? 0} overdue · ${todayN ?? 0} due today`} back={{ href: "/app/admissions/pipeline", label: "Pipeline" }}
        actions={canEdit ? (
          <Modal label="+ Add follow-up" title="Add a follow-up">
            <form action={addFollowup} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="back" value={here} />
              <EntityPicker kind="applicant" name="who" label="Applicant / enquiry" required placeholder="Type a name or application no." className="sm:col-span-2" />
              <Select label="How" name="channel" options={CHANNELS} />
              <Input label="On" name="due_on" type="date" defaultValue={addDays(today, 1)} required />
              <Input label="Note" name="note" className="sm:col-span-2" />
              <div className="sm:col-span-2"><Submit>Add follow-up</Submit></div>
            </form>
            <p className="mt-3 mb-0 text-[13px] text-muted">You can also add one from an application&apos;s page.</p>
          </Modal>
        ) : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Overdue" value={overdueN ?? 0} tone={overdueN ? "rose" : "green"} />
        <Stat label="Due today" value={todayN ?? 0} tone="amber" />
        <Stat label="In this list" value={count ?? 0} tone="blue" />
      </div>

      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, phone, application no., note" className="lg:col-span-2" />
        <Select label="Show" name="show" defaultValue={show} options={[["open", "Open"], ["done", "Completed"], ["all", "All"]]} />
        <Select label="How" name="channel" blank="Any" defaultValue={channel} options={CHANNELS} />
        <Select label="Due" name="when" blank="Any" defaultValue={when} options={[["overdue", "Overdue"], ["today", "Today"], ["week", "Next 7 days"]]} />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>

      {rows.length ? (
        <Table head={["Due", "Who", "How", "Note", "Status / outcome", ""]} minWidth={960}>
          {rows.map((r) => {
            const a = r.admission_applications, e = r.enquiries;
            const phone = a?.phone ?? e?.phone ?? null;
            const wa = phone && !r.done ? waLink(phone, `Namaste, this is ${school.name} regarding the admission of ${a?.applicant_name ?? e?.student_name}.`) : null;
            const late = !r.done && r.due_on < today;
            return (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap ${late ? "font-semibold text-error" : ""}`}>{fmtDate(r.due_on)}{late && <div className="text-[12px]">overdue</div>}</td>
                <td className={td}>{a ? <Link href={`/app/admissions/applications/${a.id}`} className="font-semibold">{a.applicant_name}</Link> : <Link href={`/app/admissions?q=${encodeURIComponent(e?.student_name ?? "")}`} className="font-semibold">{e?.student_name}</Link>}
                  <div className="text-[12px] text-muted">{a ? a.application_no : "enquiry"}{phone ? ` · ${phone}` : ""}</div></td>
                <td className={`${td} capitalize`}>{r.channel}</td>
                <td className={`${td} text-[13px]`}>{r.note ?? "—"}</td>
                <td className={td}>
                  {r.done ? <><Badge value="done" text="Done" /><div className="mt-1 text-[12px] text-muted">{r.outcome ?? ""}{r.done_at ? ` · ${fmtDate(r.done_at.slice(0, 10))}` : ""}</div></> : <Badge value={late ? "overdue" : "pending"} text={late ? "Overdue" : "Open"} />}
                </td>
                <td className={`${td} text-[13px]`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {!r.done && canEdit && (
                      <Modal label="Complete" variant="link" title={`Complete — ${a?.applicant_name ?? e?.student_name}`} size="sm">
                        <form action={completeFollowup} className="grid gap-3">
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} />
                          <Input label="What happened?" name="outcome" />
                          <Input label="Next follow-up (optional)" name="next_due" type="date" defaultValue={addDays(today, 3)} />
                          <Submit>Done + next</Submit>
                        </form>
                      </Modal>
                    )}
                    {!r.done && canEdit && <Link href={`${here}${here.includes("?") ? "&" : "?"}edit=${r.id}`}>Reschedule</Link>}
                    {wa && <a href={wa} target="_blank" rel="noopener">WhatsApp</a>}
                    {canEdit && <form action={deleteFollowup}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={here} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Delete</button></form>}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No follow-ups match.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/admissions/followups" params={params} />

      {editing && (
        <Modal defaultOpen closeHref={here} title="Reschedule follow-up" size="sm">
          <form action={updateFollowup} className="grid gap-3">
            <input type="hidden" name="id" value={editing.id} /><input type="hidden" name="back" value={here} />
            <Input label="On" name="due_on" type="date" defaultValue={editing.due_on} required />
            <Select label="How" name="channel" defaultValue={editing.channel} options={CHANNELS} />
            <Input label="Note" name="note" defaultValue={editing.note} />
            <Submit>Save</Submit>
          </form>
        </Modal>
      )}
    </div>
  );
}
