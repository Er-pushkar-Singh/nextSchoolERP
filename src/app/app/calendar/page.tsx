import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { addDays, fmtDate, todayIST } from "@/lib/format";
import { EVENT_KINDS } from "@/lib/timetable";
import { deleteEvent, saveEvent } from "../_actions/timetable";

type Ev = { id: string; title: string; kind: string; start_date: string; end_date: string; description: string | null };
const colour = (k: string) => EVENT_KINDS.find((e) => e[0] === k)?.[2] ?? "#64748b";
const label = (k: string) => EVENT_KINDS.find((e) => e[0] === k)?.[1] ?? k;
const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

export default async function Calendar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("comms.calendar.view");
  const sp = await searchParams;
  const today = todayIST();
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const first = `${month}-01`;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10);
  const last = addDays(next, -1);
  const prevMonth = addDays(first, -1).slice(0, 7), nextMonth = next.slice(0, 7);
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;     // Monday first
  const cells = Array.from({ length: Math.ceil((lead + Number(last.slice(8))) / 7) * 7 }, (_, i) => (i < lead || i - lead >= Number(last.slice(8)) ? null : addDays(first, i - lead)));

  const kind = EVENT_KINDS.some((e) => e[0] === sp.kind) ? sp.kind! : null;
  let q = supabase.from("school_events").select("id,title,kind,start_date,end_date,description").eq("school_id", school.id).lte("start_date", last).gte("end_date", first).order("start_date");
  if (kind) q = q.eq("kind", kind);
  const editId = uid(sp.edit);
  const [{ data }, editQ, { data: upcoming }] = await Promise.all([
    q,
    editId && can("comms.calendar.edit") ? supabase.from("school_events").select("*").eq("id", editId).eq("school_id", school.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("school_events").select("id,title,kind,start_date,end_date").eq("school_id", school.id).gte("end_date", today).order("start_date").limit(6),
  ]);
  const events = (data ?? []) as Ev[];
  const edit = editQ.data as Ev | null;
  const on = (d: string) => events.filter((e) => e.start_date <= d && e.end_date >= d);
  const monthName = new Date(`${first}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notices" title="School calendar" subtitle={monthName}
        actions={<><Link href={`/app/calendar?month=${prevMonth}`} className="btn btn-sm btn-secondary">← {prevMonth}</Link><Link href="/app/calendar" className="btn btn-sm btn-secondary">Today</Link><Link href={`/app/calendar?month=${nextMonth}`} className="btn btn-sm btn-secondary">{nextMonth} →</Link></>} />
      <Flash ok={sp.ok} error={sp.error} />

      <form className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="month" value={month} />
        <Select label="Show" name="kind" blank="Everything" defaultValue={kind} options={EVENT_KINDS.map(([k, l]) => [k, l] as [string, string])} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
      </form>

      <div className="overflow-hidden rounded-[14px] border border-line bg-white">
        <div className="grid grid-cols-7 bg-[#f5f7fb] text-center text-[12px] font-semibold text-muted">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const evs = d ? on(d) : [];
            const hol = evs.find((e) => e.kind === "holiday" || e.kind === "vacation");
            return (
              <div key={i} className={`min-h-[84px] border-t border-l border-line p-1 text-[12px] first:border-l-0 [&:nth-child(7n+1)]:border-l-0 ${hol ? "bg-[#fef2f2]" : !d ? "bg-[#fafbfd]" : ""}`}>
                {d && (
                  <>
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-semibold ${d === today ? "bg-blue text-white" : "text-ink"}`}>{Number(d.slice(8))}</span>
                    <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                      {evs.slice(0, 3).map((e) => (
                        <li key={e.id} className="truncate rounded px-1 py-0.5 text-[11px] font-medium text-white" style={{ background: colour(e.kind) }} title={`${e.title} — ${label(e.kind)}`}>{e.title}</li>
                      ))}
                      {evs.length > 3 && <li className="text-[11px] text-muted">+{evs.length - 3} more</li>}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-3 p-0 text-[12px] text-muted">
        {EVENT_KINDS.map(([k, l, c]) => <li key={k} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: c }} />{l}</li>)}
      </ul>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`This month (${events.length})`}>
          {events.length ? (
            <ul className="m-0 list-none divide-y divide-line p-0 text-[14px]">
              {events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                  <span>
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: colour(e.kind) }} /><b className="text-ink">{e.title}</b>
                    <span className="block text-[12px] text-muted">{fmtDate(e.start_date)}{e.end_date !== e.start_date ? ` – ${fmtDate(e.end_date)}` : ""} · {label(e.kind)}</span>
                    {e.description && <span className="block text-[12px] text-muted">{e.description}</span>}
                  </span>
                  <span className="flex shrink-0 gap-3 text-[13px]">
                    {can("comms.calendar.edit") && <Link href={`/app/calendar?month=${month}&edit=${e.id}`}>Edit</Link>}
                    {can("comms.calendar.delete") && <form action={deleteEvent}><input type="hidden" name="id" value={e.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Delete</button></form>}
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty>Nothing on the calendar this month.</Empty>}
        </Card>

        {(can("comms.calendar.create") || edit) && (
          <Card title={edit ? "Edit entry" : "Add to the calendar"}>
            <form key={edit?.id ?? "new"} action={saveEvent} className="grid gap-3 sm:grid-cols-2">
              {edit && <input type="hidden" name="id" value={edit.id} />}
              <Input label="Title" name="title" required defaultValue={edit?.title} className="sm:col-span-2" placeholder="Diwali break" />
              <Select label="Type" name="kind" defaultValue={edit?.kind ?? "holiday"} options={EVENT_KINDS.map(([k, l]) => [k, l] as [string, string])} />
              <span />
              <Input label="From" name="start_date" type="date" required defaultValue={edit?.start_date ?? first} />
              <Input label="To (same day if empty)" name="end_date" type="date" defaultValue={edit && edit.end_date !== edit.start_date ? edit.end_date : ""} />
              <Textarea label="Note" name="description" rows={2} defaultValue={edit?.description ?? ""} className="sm:col-span-2" />
              <div className="flex items-center gap-3 sm:col-span-2"><Submit>{edit ? "Save" : "Add"}</Submit>{edit && <Link href={`/app/calendar?month=${month}`} className="text-[14px]">Cancel</Link>}</div>
            </form>
            <p className="mt-3 mb-0 text-[12px] text-muted">Holidays and vacations are skipped when working days are counted for staff attendance and payroll.</p>
          </Card>
        )}
      </div>

      {(upcoming ?? []).length > 0 && (
        <Card title="Coming up">
          <ul className="m-0 list-none p-0 text-[14px]">
            {(upcoming as Ev[]).map((e) => <li key={e.id} className="py-1"><b className="text-ink">{e.title}</b> <span className="text-muted">· {fmtDate(e.start_date)}{e.end_date !== e.start_date ? ` – ${fmtDate(e.end_date)}` : ""}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
