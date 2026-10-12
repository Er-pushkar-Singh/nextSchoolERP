import Link from "next/link";
import { requireSchool } from "@/lib/school";
import { redirect } from "next/navigation";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { fmtDate, money, todayIST } from "@/lib/format";
import { LEAVE_KINDS, monthName, QUOTA_KINDS } from "@/lib/hr";
import { applyLeave, cancelLeave, decideLeave } from "../../_actions/hr";

type Leave = {
  id: string; staff_id: string; kind: string; from_date: string; to_date: string; half_day: boolean; days: number; reason: string | null; status: string;
  decided_by_name: string | null; decision_note: string | null; created_at: string; staff: { name: string; designation: string | null } | null;
};
const sel = "id,staff_id,kind,from_date,to_date,half_day,days,reason,status,decided_by_name,decision_note,created_at,staff(name,designation)";

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string; error?: string }> }) {
  const ctx = await requireSchool();
  const { supabase, school, session, can, canSchool } = ctx;
  if (!ctx.canAny("hr.leave.view", "hr.leave.create", "hr.leave.approve")) redirect("/app?denied=1");
  const sp = await searchParams;
  const approver = canSchool("hr.leave.approve");
  const seeAll = canSchool("hr.leave.view") || approver;
  const forOthers = canSchool("hr.leave.create");
  const { data: myId } = await supabase.rpc("my_staff_id", { sid: school.id });
  const me = myId as string | null;
  const d1 = session?.start_date ?? `${todayIST().slice(0, 4)}-01-01`, d2 = session?.end_date ?? `${todayIST().slice(0, 4)}-12-31`;
  const status = ["pending", "approved", "rejected", "cancelled"].includes(sp.status ?? "") ? sp.status! : null;

  const [{ data: mine }, { data: myStaff }, { data: used }, { data: pending }, { data: recent }, { data: staffList }, { data: slips }] = await Promise.all([
    me ? supabase.from("staff_leaves").select(sel).eq("staff_id", me).order("from_date", { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    me ? supabase.from("staff").select("name,leave_quota").eq("id", me).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("leave_summary", { sid: school.id, d1, d2 }),
    approver ? supabase.from("staff_leaves").select(sel).eq("school_id", school.id).eq("status", "pending").order("from_date").limit(200) : Promise.resolve({ data: [] }),
    seeAll ? (() => {
      let q = supabase.from("staff_leaves").select(sel).eq("school_id", school.id).order("from_date", { ascending: false }).limit(100);
      if (status) q = q.eq("status", status);
      return q;
    })() : Promise.resolve({ data: [] }),
    forOthers ? supabase.from("staff").select("id,name").eq("school_id", school.id).eq("status", "active").order("name") : Promise.resolve({ data: [] }),
    me ? supabase.from("payslips").select("id,net,paid_on,payroll_runs(month)").eq("staff_id", me).limit(12) : Promise.resolve({ data: [] }),
  ]);
  const M = (mine ?? []) as unknown as Leave[];
  const U = (used ?? []) as { staff_id: string; kind: string; days: number }[];
  const usedOf = (sid: string, k: string) => U.filter((u) => u.staff_id === sid && u.kind === k).reduce((t, u) => t + Number(u.days), 0);
  const quota = (myStaff?.leave_quota ?? {}) as Record<string, number>;
  const kind = new Map(LEAVE_KINDS);
  const canApply = can("hr.leave.create") && (me || forOthers);
  const P = (pending ?? []) as unknown as Leave[];
  const S = ((slips ?? []) as unknown as { id: string; net: number; paid_on: string | null; payroll_runs: { month: string } | null }[])
    .sort((a, b) => (b.payroll_runs?.month ?? "").localeCompare(a.payroll_runs?.month ?? ""));
  const dates = (l: Leave) => `${fmtDate(l.from_date)}${l.to_date !== l.from_date ? ` – ${fmtDate(l.to_date)}` : ""}${l.half_day ? " (half day)" : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="leave" title="Leave" subtitle={approver ? `${P.length} request${P.length === 1 ? "" : "s"} waiting for you` : "Apply for leave and see your balance"} back={canSchool("hr.staff.view") ? { href: "/app/hr", label: "Staff" } : undefined} />
      <Flash ok={sp.ok} error={sp.error} />

      {me && (
        <div className="grid grid-cols-3 gap-3">
          {QUOTA_KINDS.filter((k) => (quota[k] ?? 0) > 0).map((k) => (
            <div key={k} className="rounded-[14px] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
              <p className="m-0 text-[13px] text-muted">{kind.get(k)}</p>
              <p className="m-0 mt-1 text-[22px] font-extrabold text-ink">{quota[k] - usedOf(me, k)} <span className="text-[14px] font-normal text-muted">of {quota[k]} left</span></p>
            </div>
          ))}
        </div>
      )}
      {!me && !forOthers && can("hr.leave.create") && <Empty>Your login is not linked to a staff record yet. Ask the office to link it under Staff & payroll.</Empty>}

      {canApply && (
        <Card title="Apply for leave" icon="leave">
          <form action={applyLeave} className="grid gap-3 sm:grid-cols-4">
            {forOthers && <Select label="For" name="staff_id" defaultValue={me ?? undefined} options={(staffList ?? []).map((s) => [s.id, s.id === me ? `${s.name} (me)` : s.name] as [string, string])} />}
            <Select label="Type" name="kind" defaultValue="CL" options={LEAVE_KINDS} />
            <Input label="From" name="from_date" type="date" required defaultValue={todayIST()} />
            <Input label="To" name="to_date" type="date" defaultValue={todayIST()} />
            <Select label="Duration" name="half_day" defaultValue="0" options={[["0", "Full day(s)"], ["1", "Half day"]]} />
            <Textarea label="Reason" name="reason" rows={2} className={forOthers ? "sm:col-span-3" : "sm:col-span-3"} />
            <div className="flex items-end"><Submit>Send request</Submit></div>
          </form>
        </Card>
      )}

      {approver && (
        <Card title="Waiting for approval" icon="leave">
          {P.length ? (
            <ul className="m-0 list-none p-0">
              {P.map((l) => (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3 first:border-0">
                  <div className="min-w-0 text-[14px]">
                    <b className="text-ink">{l.staff?.name}</b> <span className="text-muted">{l.staff?.designation ?? ""}</span>
                    <div>{kind.get(l.kind)} · {dates(l)} · <b>{Number(l.days)}</b> day{Number(l.days) === 1 ? "" : "s"}</div>
                    {l.reason && <div className="text-muted">“{l.reason}”</div>}
                    {QUOTA_KINDS.includes(l.kind as "CL") && <div className="text-[12px] text-muted">Already taken this session: {usedOf(l.staff_id, l.kind)} {l.kind}</div>}
                  </div>
                  {l.staff_id === me ? <span className="text-[13px] text-muted">Your own request — another approver must decide</span> : (
                    <form action={decideLeave} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={l.id} />
                      <input name="note" placeholder="Note (optional)" aria-label="Note" className="input !min-h-9 w-40 !py-1.5 text-[14px]" />
                      <button name="status" value="approved" className="btn btn-sm btn-primary cursor-pointer">Approve</button>
                      <button name="status" value="rejected" className="btn btn-sm btn-secondary cursor-pointer">Reject</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-[14px] text-muted">Nothing waiting.</p>}
        </Card>
      )}

      {me && (
        <Card title={myStaff?.name ? `My leave · ${myStaff.name}` : "My leave"}>
          {M.length ? (
            <Table head={["Type", "Dates", "Days", "Reason", "Status", ""]} minWidth={640}>
              {M.map((l) => (
                <tr key={l.id}>
                  <td className={td}>{l.kind}</td>
                  <td className={td}>{dates(l)}</td>
                  <td className={td}>{Number(l.days)}</td>
                  <td className={`${td} text-[13px]`}>{l.reason ?? "—"}{l.decision_note && <div className="text-muted">↳ {l.decision_note}{l.decided_by_name ? ` — ${l.decided_by_name}` : ""}</div>}</td>
                  <td className={td}><Badge value={l.status === "approved" ? "paid" : l.status} text={l.status} /></td>
                  <td className={td}>{l.status === "pending" && <form action={cancelLeave}><input type="hidden" name="id" value={l.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Cancel</button></form>}</td>
                </tr>
              ))}
            </Table>
          ) : <p className="m-0 text-[14px] text-muted">No leave requests yet.</p>}
        </Card>
      )}

      {S.length > 0 && (
        <Card title="My payslips" icon="payroll">
          <ul className="m-0 list-none p-0 text-[14px]">
            {S.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 border-t border-line py-2 first:border-0">
                <Link href={`/app/hr/payroll/slip/${p.id}`}>{p.payroll_runs ? monthName(p.payroll_runs.month) : "—"}</Link>
                <span><b>{money(p.net)}</b> {p.paid_on ? <span className="text-muted">· paid {fmtDate(p.paid_on)}</span> : null}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {seeAll && (
        <>
          <form className="flex flex-wrap items-end gap-2">
            <Select label="All leave — status" name="status" blank="All" defaultValue={status} options={["pending", "approved", "rejected", "cancelled"]} />
            <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
          </form>
          {(recent ?? []).length ? (
            <Table head={["Staff", "Type", "Dates", "Days", "Status", "Decided by", ""]} minWidth={760}>
              {((recent ?? []) as unknown as Leave[]).map((l) => (
                <tr key={l.id}>
                  <td className={td}>{canSchool("hr.staff.view") ? <Link href={`/app/hr/staff/${l.staff_id}`} className="font-semibold">{l.staff?.name}</Link> : l.staff?.name}</td>
                  <td className={td}>{l.kind}</td>
                  <td className={td}>{dates(l)}</td>
                  <td className={td}>{Number(l.days)}</td>
                  <td className={td}><Badge value={l.status === "approved" ? "paid" : l.status} text={l.status} /></td>
                  <td className={`${td} text-[13px]`}>{l.decided_by_name ?? "—"}</td>
                  <td className={td}>{(forOthers || approver) && ["pending", "approved"].includes(l.status) && l.to_date >= todayIST() && (
                    <form action={cancelLeave}><input type="hidden" name="id" value={l.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Cancel</button></form>
                  )}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No leave recorded.</Empty>}
        </>
      )}
    </div>
  );
}
