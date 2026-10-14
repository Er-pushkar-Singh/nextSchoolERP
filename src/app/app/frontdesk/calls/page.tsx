import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { cleanSearch, fmtDate, todayIST } from "@/lib/format";
import { callDone, logCall } from "../../_actions/frontdesk";

type Row = { id: string; direction: string; name: string | null; phone: string | null; purpose: string; summary: string | null; call_at: string; follow_up_on: string | null; followed_up_at: string | null; handled_by_name: string | null };
const PURPOSE: [string, string][] = [["enquiry", "Enquiry"], ["complaint", "Complaint"], ["fees", "Fees"], ["leave", "Leave / absence"], ["transport", "Transport"], ["staff", "Staff"], ["other", "Other"]];

export default async function Calls({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.visitors.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const today = todayIST();
  const q = cleanSearch(sp.q ?? "").trim();
  const purpose = PURPOSE.some(([k]) => k === sp.purpose) ? sp.purpose! : null;
  const due = sp.due === "1";
  let query = supabase.from("phone_calls").select("*", { count: "exact" }).eq("school_id", school.id).order("call_at", { ascending: false }).range(offset, offset + size - 1);
  if (purpose) query = query.eq("purpose", purpose);
  if (due) query = query.lte("follow_up_on", today).is("followed_up_at", null);
  if (q) { const p = `%${q.replace(/[%_\\,()]/g, " ")}%`; query = query.or(`name.ilike.${p},phone.ilike.${p},summary.ilike.${p}`); }
  const { data, count } = await query;
  const rows = (data ?? []) as Row[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Call log" subtitle="Incoming and outgoing calls with follow-up dates" back={{ href: "/app/frontdesk", label: "Front office" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {can("frontdesk.visitors.create") && (
        <Card title="Log a call">
          <form action={logCall} className="grid gap-3 sm:grid-cols-4">
            <Select label="Type" name="direction" defaultValue="incoming" options={[["incoming", "Incoming"], ["outgoing", "Outgoing"]]} />
            <Input label="Name" name="name" />
            <Input label="Phone" name="phone" type="tel" />
            <Select label="About" name="purpose" defaultValue="enquiry" options={PURPOSE} />
            <Textarea label="What was said" name="summary" rows={2} className="sm:col-span-3" />
            <Input label="Follow up on" name="follow_up_on" type="date" min={today} />
            <div className="sm:col-span-4"><Submit>Save call</Submit></div>
          </form>
        </Card>
      )}
      <form className="grid items-end gap-2 sm:grid-cols-4">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, phone, notes" />
        <Select label="About" name="purpose" blank="All" defaultValue={purpose} options={PURPOSE} />
        <Select label="Follow-up" name="due" blank="Any" defaultValue={sp.due} options={[["1", "Due or overdue"]]} />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>
      {rows.length ? (
        <Table head={["When", "Caller", "About", "Notes", "Follow-up", ""]} minWidth={840}>
          {rows.map((c) => {
            const overdue = c.follow_up_on && !c.followed_up_at && c.follow_up_on < today;
            return (
              <tr key={c.id}>
                <td className={`${td} whitespace-nowrap text-[13px]`}>{fmtDate(c.call_at.slice(0, 10))}<div className="text-[12px] text-muted capitalize">{c.direction}</div></td>
                <td className={td}><b className="text-ink">{c.name ?? "—"}</b><div className="text-[12px] text-muted">{c.phone ?? ""}</div></td>
                <td className={`${td} capitalize`}>{c.purpose}</td>
                <td className={`${td} text-[13px]`}>{c.summary ?? ""}<div className="text-[12px] text-muted">{c.handled_by_name ?? ""}</div></td>
                <td className={td}>{c.follow_up_on ? (c.followed_up_at ? <Badge value="done" text="Done" /> : <Badge value={overdue ? "overdue" : "due"} text={`${overdue ? "Overdue · " : ""}${fmtDate(c.follow_up_on)}`} />) : "—"}</td>
                <td className={td}>{c.follow_up_on && !c.followed_up_at && can("frontdesk.visitors.edit") && (
                  <form action={callDone}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="back" value="/app/frontdesk/calls" /><button className="btn btn-sm btn-secondary cursor-pointer">Done</button></form>
                )}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No calls logged.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/frontdesk/calls" params={{ q: q || undefined, purpose: purpose ?? undefined, due: sp.due }} />
    </div>
  );
}
