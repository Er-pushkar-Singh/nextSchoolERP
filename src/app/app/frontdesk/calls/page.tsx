import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { cleanSearch, fmtDate, todayIST } from "@/lib/format";
import { deleteCall, logCall, setCallFollowup, updateCall } from "../../_actions/frontdesk";

type Row = { id: string; direction: string; name: string | null; phone: string | null; purpose: string; summary: string | null; call_at: string; follow_up_on: string | null;
  followed_up_at: string | null; follow_status: string; follow_note: string | null; handled_by_name: string | null };
const PURPOSE: [string, string][] = [["enquiry", "Enquiry"], ["complaint", "Complaint"], ["fees", "Fees"], ["leave", "Leave / absence"], ["transport", "Transport"], ["staff", "Staff"], ["other", "Other"]];
const FOLLOW: [string, string][] = [["pending", "Pending"], ["done", "Done"], ["no_answer", "No answer — call again"], ["rescheduled", "Rescheduled"], ["dropped", "Dropped / not needed"]];
const TONE: Record<string, string> = { pending: "pending", done: "paid", no_answer: "due", rescheduled: "info", dropped: "cancelled" };

export default async function Calls({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.visitors.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const today = todayIST();
  const q = cleanSearch(sp.q ?? "").trim();
  const purpose = PURPOSE.some(([k]) => k === sp.purpose) ? sp.purpose! : null;
  const dir = sp.direction === "incoming" || sp.direction === "outgoing" ? sp.direction : null;
  const fstatus = FOLLOW.some(([k]) => k === sp.fs) ? sp.fs! : null;
  const due = sp.due === "1";
  let query = supabase.from("phone_calls").select("*", { count: "exact" }).eq("school_id", school.id).order("call_at", { ascending: false }).range(offset, offset + size - 1);
  if (purpose) query = query.eq("purpose", purpose);
  if (dir) query = query.eq("direction", dir);
  if (fstatus) query = query.eq("follow_status", fstatus);
  if (due) query = query.lte("follow_up_on", today).eq("follow_status", "pending");
  if (q) { const p = `%${q.replace(/[%_\\,()]/g, " ")}%`; query = query.or(`name.ilike.${p},phone.ilike.${p},summary.ilike.${p}`); }
  const { data, count } = await query;
  const rows = (data ?? []) as Row[];
  const params = { q: q || undefined, purpose: purpose ?? undefined, direction: dir ?? undefined, fs: fstatus ?? undefined, due: sp.due };
  const qs = new URLSearchParams(Object.entries({ ...params, page: sp.page, size: sp.size }).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/app/frontdesk/calls${qs ? "?" + qs : ""}`;
  const editId = sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) ? sp.edit : null;
  const edit = editId && can("frontdesk.visitors.edit") ? ((await supabase.from("phone_calls").select("*").eq("id", editId).eq("school_id", school.id).maybeSingle()).data as Row | null) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Call log" subtitle="Incoming and outgoing calls with follow-up status" back={{ href: "/app/frontdesk", label: "Front desk" }}
        actions={can("frontdesk.visitors.create") ? (
          <Modal label="+ Log a call" title="Log a call">
            <form action={logCall} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="back" value={here} />
              <Select label="Type" name="direction" defaultValue="incoming" options={[["incoming", "Incoming"], ["outgoing", "Outgoing"]]} />
              <Select label="About" name="purpose" defaultValue="enquiry" options={PURPOSE} />
              <Input label="Name" name="name" />
              <Input label="Phone" name="phone" type="tel" />
              <Textarea label="What was said" name="summary" rows={3} className="sm:col-span-2" />
              <Input label="Follow up on (optional)" name="follow_up_on" type="date" min={today} />
              <div className="flex items-end"><Submit>Save call</Submit></div>
            </form>
          </Modal>
        ) : undefined} />
      <Flash ok={sp.ok} error={sp.error} />

      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, phone, notes" />
        <Select label="About" name="purpose" blank="All" defaultValue={purpose} options={PURPOSE} />
        <Select label="Type" name="direction" blank="All" defaultValue={dir} options={[["incoming", "Incoming"], ["outgoing", "Outgoing"]]} />
        <Select label="Follow-up status" name="fs" blank="Any" defaultValue={fstatus} options={FOLLOW} />
        <Select label="Due" name="due" blank="Any" defaultValue={sp.due} options={[["1", "Due or overdue"]]} />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>

      {rows.length ? (
        <Table head={["When", "Caller", "About", "Notes", "Follow-up", ""]} minWidth={920}>
          {rows.map((c) => {
            const open = c.follow_status === "pending" && c.follow_up_on;
            const overdue = open && c.follow_up_on! < today;
            return (
              <tr key={c.id}>
                <td className={`${td} whitespace-nowrap text-[13px]`}>{fmtDate(c.call_at.slice(0, 10))}<div className="text-[12px] text-muted capitalize">{c.direction}</div></td>
                <td className={td}><b className="text-ink">{c.name ?? "—"}</b><div className="text-[12px] text-muted">{c.phone ?? ""}</div></td>
                <td className={`${td} capitalize`}>{c.purpose}</td>
                <td className={`${td} text-[13px]`}>{c.summary ?? ""}<div className="text-[12px] text-muted">{c.handled_by_name ?? ""}</div></td>
                <td className={td}>
                  <Badge value={TONE[c.follow_status] ?? "pending"} text={FOLLOW.find(([k]) => k === c.follow_status)?.[1] ?? c.follow_status} />
                  {c.follow_up_on && c.follow_status === "pending" && <div className={`mt-1 text-[12px] ${overdue ? "font-bold text-error" : "text-muted"}`}>{overdue ? "Overdue · " : "On "}{fmtDate(c.follow_up_on)}</div>}
                  {c.follow_note && <div className="mt-1 text-[12px] text-muted">{c.follow_note}</div>}
                </td>
                <td className={`${td} text-[13px]`}>
                  <div className="flex flex-wrap items-center gap-3">
                    {can("frontdesk.visitors.edit") && (
                      <Modal label="Update status" variant="link" title={`Follow-up — ${c.name ?? c.phone ?? "caller"}`} size="sm">
                        <form action={setCallFollowup} className="grid gap-3">
                          <input type="hidden" name="id" value={c.id} /><input type="hidden" name="back" value={here} />
                          <Select label="Status" name="status" defaultValue={c.follow_status === "pending" ? "done" : c.follow_status} options={FOLLOW} />
                          <Input label="Next follow-up date (for “no answer” / “rescheduled”)" name="next" type="date" min={today} defaultValue={c.follow_up_on ?? ""} />
                          <Input label="Note" name="note" defaultValue={c.follow_note} />
                          <Submit>Save</Submit>
                        </form>
                      </Modal>
                    )}
                    {can("frontdesk.visitors.edit") && <Link href={`${here}${here.includes("?") ? "&" : "?"}edit=${c.id}`}>Edit</Link>}
                    {can("frontdesk.visitors.delete") && <form action={deleteCall}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="back" value={here} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Delete</button></form>}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No calls match.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/frontdesk/calls" params={params} />

      {edit && (
        <Modal defaultOpen closeHref={here.replace(/[?&]edit=[^&]*/, "")} title="Edit call">
          <form action={updateCall} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={edit.id} /><input type="hidden" name="back" value={here.replace(/[?&]edit=[^&]*/, "")} />
            <Select label="Type" name="direction" defaultValue={edit.direction} options={[["incoming", "Incoming"], ["outgoing", "Outgoing"]]} />
            <Select label="About" name="purpose" defaultValue={edit.purpose} options={PURPOSE} />
            <Input label="Name" name="name" defaultValue={edit.name} />
            <Input label="Phone" name="phone" type="tel" defaultValue={edit.phone} />
            <Textarea label="What was said" name="summary" rows={3} defaultValue={edit.summary} className="sm:col-span-2" />
            <div className="sm:col-span-2"><Submit>Save changes</Submit></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
