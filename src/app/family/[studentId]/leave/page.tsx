import { Badge, Card, Flash, Input, Submit, Textarea } from "@/components/ui/ui";
import { Pagination, pager } from "@/components/ui/Pagination";
import { fmtDate, todayIST } from "@/lib/format";
import { requireChild } from "@/lib/family";
import { familyApplyLeave, familyCancelLeave } from "../../actions";

export const metadata = { title: "Leave" };

export default async function FamilyLeave({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { studentId } = await params;
  const sp = await searchParams;
  const { supabase, child } = await requireChild(studentId);
  const pg = pager(sp, "page", "size", 10);
  const { data, count } = await supabase.from("student_leaves").select("id,from_date,to_date,reason,status,decided_by_name,decision_note,applied_via,applied_by_name", { count: "exact" })
    .eq("student_id", studentId).order("from_date", { ascending: false }).range(...pg.range);
  const today = todayIST();
  return (
    <div className="flex flex-col gap-4">
      <Flash ok={sp.ok} error={sp.error} />
      <Card title="Apply for leave" description={`For ${child.first_name}. The class teacher approves it; approved days show as leave in the attendance register.`}>
        <form action={familyApplyLeave} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="student_id" value={studentId} />
          <Input label="From" name="from_date" type="date" required defaultValue={today} />
          <Input label="To" name="to_date" type="date" required defaultValue={today} />
          <Textarea label="Reason" name="reason" rows={2} className="sm:col-span-2" />
          <div className="sm:col-span-2"><Submit>Send request</Submit></div>
        </form>
      </Card>
      <Card title="My requests">
        {(data ?? []).length ? (
          <ul className="m-0 list-none p-0">
            {(data ?? []).map((l) => (
              <li key={l.id} className="flex flex-col gap-1 border-t border-line py-3 first:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="text-ink">{fmtDate(l.from_date)}{l.to_date !== l.from_date ? ` – ${fmtDate(l.to_date)}` : ""}</b>
                  <Badge value={l.status === "approved" ? "paid" : l.status === "pending" ? "due" : l.status === "rejected" ? "overdue" : "cancelled"} text={l.status} />
                </div>
                {l.reason && <span className="text-[14px] text-muted">“{l.reason}”</span>}
                {l.decided_by_name && l.status !== "pending" && <span className="text-[13px] text-muted">{l.decided_by_name}{l.decision_note ? `: ${l.decision_note}` : ""}</span>}
                {l.applied_via === "staff" && <span className="text-[12px] text-muted">Entered by the school office</span>}
                {l.status === "pending" && (
                  <form action={familyCancelLeave}><input type="hidden" name="student_id" value={studentId} /><input type="hidden" name="id" value={l.id} />
                    <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Cancel request</button></form>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="m-0 text-[14px] text-muted">No leave requests yet.</p>}
        <div className="mt-3"><Pagination {...pg.props(count ?? 0, `/family/${studentId}/leave`)} /></div>
      </Card>
    </div>
  );
}
