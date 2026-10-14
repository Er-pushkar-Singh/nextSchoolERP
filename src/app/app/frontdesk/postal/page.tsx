import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { PrintButton } from "@/components/ui/PrintButton";
import { cleanSearch, fmtDate, todayIST } from "@/lib/format";
import { logPostal } from "../../_actions/frontdesk";

type Row = { id: string; direction: string; on_date: string; mode: string; party: string; reference_no: string | null; subject: string | null; to_whom: string | null; note: string | null; created_by_name: string | null };
const MODE: [string, string][] = [["post", "Ordinary post"], ["speed_post", "Speed post"], ["courier", "Courier"], ["hand", "By hand"], ["other", "Other"]];

export default async function Postal({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.visitors.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = cleanSearch(sp.q ?? "").trim();
  const dir = sp.direction === "received" || sp.direction === "dispatched" ? sp.direction : null;
  let query = supabase.from("postal_items").select("*", { count: "exact" }).eq("school_id", school.id).order("on_date", { ascending: false }).order("created_at", { ascending: false }).range(offset, offset + size - 1);
  if (dir) query = query.eq("direction", dir);
  if (q) { const p = `%${q.replace(/[%_\\,()]/g, " ")}%`; query = query.or(`party.ilike.${p},reference_no.ilike.${p},subject.ilike.${p},to_whom.ilike.${p}`); }
  const { data, count } = await query;
  const rows = (data ?? []) as Row[];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 print:hidden">
        <PageHeader icon="admissions" title="Postal register" subtitle="Letters and parcels received and dispatched" back={{ href: "/app/frontdesk", label: "Front office" }} actions={<PrintButton />} />
        <Flash ok={sp.ok} error={sp.error} />
        {can("frontdesk.visitors.create") && (
          <Card title="New entry">
            <form action={logPostal} className="grid gap-3 sm:grid-cols-4">
              <Select label="Type" name="direction" defaultValue="received" options={[["received", "Received"], ["dispatched", "Dispatched"]]} />
              <Input label="Date" name="on_date" type="date" defaultValue={todayIST()} max={todayIST()} />
              <Select label="Mode" name="mode" defaultValue="post" options={MODE} />
              <Input label="Reference / AWB no." name="reference_no" />
              <Input label="From / to (party)" name="party" required className="sm:col-span-2" />
              <Input label="For / by (staff)" name="to_whom" />
              <Input label="Subject" name="subject" />
              <div className="sm:col-span-4"><Submit>Add entry</Submit></div>
            </form>
          </Card>
        )}
        <form className="grid items-end gap-2 sm:grid-cols-4">
          <Input label="Search" name="q" defaultValue={sp.q} placeholder="Party, AWB, subject" />
          <Select label="Type" name="direction" blank="All" defaultValue={dir} options={[["received", "Received"], ["dispatched", "Dispatched"]]} />
          <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
        </form>
      </div>
      <h1 className="hidden text-[18px] font-bold print:block">{school.name} — Postal register</h1>
      {rows.length ? (
        <Table head={["Date", "Type", "Party", "Reference", "Subject", "For / by"]} minWidth={780}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={`${td} whitespace-nowrap`}>{fmtDate(r.on_date)}</td>
              <td className={`${td} capitalize`}>{r.direction}<div className="text-[12px] text-muted">{MODE.find(([k]) => k === r.mode)?.[1]}</div></td>
              <td className={td}><b className="text-ink">{r.party}</b></td>
              <td className={`${td} text-[13px]`}>{r.reference_no ?? "—"}</td>
              <td className={`${td} text-[13px]`}>{r.subject ?? ""}</td>
              <td className={`${td} text-[13px]`}>{r.to_whom ?? ""}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>Nothing in the register.</Empty>}
      <div className="print:hidden"><Pagination total={count ?? 0} page={page} size={size} basePath="/app/frontdesk/postal" params={{ q: q || undefined, direction: dir ?? undefined }} /></div>
    </div>
  );
}
