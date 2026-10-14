import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { fmtDate, todayIST } from "@/lib/format";
import { cancelGatePass, decideGatePass, releaseGatePass, requestGatePass } from "../../_actions/frontdesk";

type Row = { id: string; pass_no: string; reason: string; leave_on: string; pickup_name: string; pickup_relation: string | null; pickup_phone: string | null; status: string;
  requested_by_name: string | null; decided_by_name: string | null; decision_note: string | null; out_at: string | null;
  student: { first_name: string; last_name: string | null; admission_no: string; class: { name: string } | { name: string }[] | null } | { first_name: string; last_name: string | null; admission_no: string; class: { name: string } | { name: string }[] | null }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
const BADGE: Record<string, string> = { requested: "pending", approved: "active", completed: "done", rejected: "rejected", cancelled: "cancelled" };

export default async function GatePass({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.visitors.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const today = todayIST();
  const status = ["requested", "approved", "completed", "rejected", "cancelled"].includes(sp.status ?? "") ? sp.status! : null;
  const scope = sp.when === "all" ? "all" : "today";
  let q = supabase.from("gate_passes").select("*,student:students(first_name,last_name,admission_no,class:classes!class_id(name))", { count: "exact" })
    .eq("school_id", school.id).order("created_at", { ascending: false }).range(offset, offset + size - 1);
  if (status) q = q.eq("status", status);
  if (scope === "today") q = q.eq("leave_on", today);
  const { data, count } = await q;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Student gate pass" subtitle="Early leave only with a named pick-up person" back={{ href: "/app/frontdesk", label: "Front office" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {can("frontdesk.visitors.create") && (
        <Card title="New gate pass" description={can("frontdesk.visitors.edit") ? "Passes you raise are approved at once." : "A principal / office approver must approve it before the child is released."}>
          <form action={requestGatePass} className="grid gap-3 sm:grid-cols-4">
            <Input label="Admission no." name="admission_no" required />
            <Input label="Reason" name="reason" required className="sm:col-span-3" placeholder="Doctor appointment, family function…" />
            <Input label="Taken by" name="pickup_name" required />
            <Input label="Relation" name="pickup_relation" placeholder="Father, uncle…" />
            <Input label="Phone" name="pickup_phone" type="tel" />
            <div className="flex items-end"><Submit>Create pass</Submit></div>
          </form>
        </Card>
      )}
      <form className="flex flex-wrap items-end gap-2">
        <Select label="Show" name="when" defaultValue={scope} options={[["today", "Today"], ["all", "All dates"]]} />
        <Select label="Status" name="status" blank="All" defaultValue={status} options={[["requested", "Waiting approval"], ["approved", "Approved — to release"], ["completed", "Released"], ["rejected", "Refused"], ["cancelled", "Cancelled"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {rows.length ? (
        <Table head={["Pass", "Student", "Reason / pick-up", "Status", ""]} minWidth={820}>
          {rows.map((g) => {
            const s = one(g.student);
            return (
              <tr key={g.id}>
                <td className={`${td} font-mono text-[12px]`}>{g.pass_no}<div className="font-sans text-muted">{fmtDate(g.leave_on)}</div></td>
                <td className={td}><b className="text-ink">{s ? `${s.first_name} ${s.last_name ?? ""}`.trim() : "—"}</b><div className="text-[12px] text-muted">{s?.admission_no}{one(s?.class ?? null) ? ` · Class ${one(s!.class!)!.name}` : ""}</div></td>
                <td className={td}>{g.reason}<div className="text-[12px] text-muted">{g.pickup_name}{g.pickup_relation ? ` (${g.pickup_relation})` : ""}{g.pickup_phone ? ` · ${g.pickup_phone}` : ""}</div></td>
                <td className={td}><Badge value={BADGE[g.status] ?? g.status} text={g.status === "requested" ? "Waiting approval" : g.status[0].toUpperCase() + g.status.slice(1)} />
                  {(g.decision_note || g.decided_by_name) && <div className="mt-1 text-[12px] text-muted">{g.decided_by_name}{g.decision_note ? `: ${g.decision_note}` : ""}</div>}</td>
                <td className={`${td} text-[13px]`}>
                  <div className="flex flex-col gap-1">
                    {g.status === "requested" && can("frontdesk.visitors.edit") && (
                      <form action={decideGatePass} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={g.id} /><input name="note" placeholder="Note (to refuse)" className="input !min-h-8 !w-32 !py-1 text-[12px]" />
                        <button name="approve" value="1" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#15803d] underline">Approve</button>
                        <button name="approve" value="0" className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Refuse</button>
                      </form>
                    )}
                    {g.status === "approved" && g.leave_on === today && can("frontdesk.visitors.create") && (
                      <form action={releaseGatePass}><input type="hidden" name="id" value={g.id} /><button className="btn btn-sm btn-primary cursor-pointer border-0">Release child</button></form>
                    )}
                    {["requested", "approved"].includes(g.status) && can("frontdesk.visitors.create") && (
                      <form action={cancelGatePass}><input type="hidden" name="id" value={g.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-muted underline">Cancel</button></form>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No gate passes {scope === "today" ? "today" : "yet"}.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/frontdesk/gatepass" params={{ status: status ?? undefined, when: scope === "all" ? "all" : undefined }} />
    </div>
  );
}
