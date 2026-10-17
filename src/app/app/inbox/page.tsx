import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { cleanSearch } from "@/lib/format";

type Row = { student_id: string; student_name: string; admission_no: string; class_name: string | null; section_name: string | null; last_body: string; last_at: string; last_from_family: boolean; unread: number; total: number };

const stamp = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function Inbox({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school } = await requirePerm("comms.messages.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = cleanSearch(sp.q ?? "").trim();
  const unreadOnly = sp.unread === "1";
  const { data, error } = await supabase.rpc("family_inbox", { sid: school.id, p_q: q || null, p_unread: unreadOnly, p_limit: size, p_offset: offset });
  const rows = (data ?? []) as Row[];
  const total = rows[0]?.total ? Number(rows[0].total) : 0;
  const { data: unread } = await supabase.rpc("family_unread", { sid: school.id });
  const params = { q: q || undefined, unread: unreadOnly ? "1" : undefined };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notices" title="Parent messages" subtitle={`${Number(unread ?? 0)} unread · parents write from the app; you see the students of your own classes`} />
      <Flash ok={sp.ok} error={sp.error ?? error?.message} />
      <form className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-72"><Input label="Search student" name="q" defaultValue={sp.q} placeholder="Name or admission no." /></div>
        <label className="flex items-center gap-1.5 pb-2 text-[14px]"><input type="checkbox" name="unread" value="1" defaultChecked={unreadOnly} /> Unread only</label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        {(q || unreadOnly) && <Link href="/app/inbox" className="pb-2 text-[14px]">Clear</Link>}
      </form>
      {rows.length ? (
        <Table head={["Student", "Class", "Last message", "When", ""]} minWidth={720}>
          {rows.map((r) => (
            <tr key={r.student_id} className={Number(r.unread) > 0 ? "bg-blue-tint/40" : ""}>
              <td className={td}><Link href={`/app/inbox/${r.student_id}`} className="font-semibold">{r.student_name}</Link><div className="text-[12px] text-muted">Adm. {r.admission_no}</div></td>
              <td className={td}>{r.class_name ?? "—"}{r.section_name ? `-${r.section_name}` : ""}</td>
              <td className={`${td} max-w-[360px]`}><span className="line-clamp-2 text-[14px]">{r.last_from_family ? "" : "You: "}{r.last_body}</span></td>
              <td className={`${td} whitespace-nowrap text-[13px] text-muted`}>{stamp(r.last_at)}</td>
              <td className={td}>{Number(r.unread) > 0 ? <Badge value="due" text={`${r.unread} new`} /> : null}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || unreadOnly ? "No conversation matches." : "No parent has written yet."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/inbox" params={params} />
    </div>
  );
}
