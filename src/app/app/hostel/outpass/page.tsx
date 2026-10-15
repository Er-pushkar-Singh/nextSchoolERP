import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { label } from "@/lib/format";
import { addHostelVisitor, outpassStep, requestOutpass, visitorOut } from "../../_actions/hostel";

type Op = { id: string; student_id: string; student_name: string; admission_no: string; hostel_name: string | null; room_no: string | null; kind: string; reason: string; out_at: string; expected_back: string;
  status: string; late: boolean; guardian_name: string | null; guardian_phone: string | null; decided_by_name: string | null; decision_note: string | null; left_at: string | null; returned_at: string | null; total: number };
type Vis = { id: string; visitor_name: string; relation: string | null; phone: string | null; in_at: string; out_at: string | null; by_name: string | null;
  student: { first_name: string; last_name: string | null; admission_no: string } | { first_name: string; last_name: string | null; admission_no: string }[] | null };
const STATUS: [string, string][] = [["requested", "Waiting approval"], ["approved", "Approved"], ["out", "Out now"], ["late", "Late back"], ["returned", "Returned"], ["rejected", "Refused"], ["cancelled", "Cancelled"]];
const BADGE: Record<string, string> = { requested: "pending", approved: "active", out: "info", returned: "done", rejected: "rejected", cancelled: "cancelled" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—");
const nowLocal = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16);

export default async function Outpass({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("hostel.rollcall.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const status = STATUS.some(([k]) => k === sp.status) ? sp.status! : null;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const [{ data }, { data: vis }] = await Promise.all([
    supabase.rpc("hostel_outpass_list", { sid: school.id, p_status: status, p_q: q || null, p_limit: size, p_offset: offset }),
    can("hostel.mess.view") ? supabase.from("hostel_visitors").select("id,visitor_name,relation,phone,in_at,out_at,by_name,student:students(first_name,last_name,admission_no)")
      .eq("school_id", school.id).order("in_at", { ascending: false }).limit(15) : Promise.resolve({ data: [] }),
  ]);
  const O = (data ?? []) as Op[];
  const total = O[0] ? Number(O[0].total) : 0;
  const params = { status: status ?? undefined, q: q || undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `/app/hostel/outpass${qs ? `?${qs}` : ""}`;
  const create = can("hostel.rollcall.create"), approve = can("hostel.rollcall.approve");
  const nowStr = nowLocal();

  const act = (id: string, action: string, text: string, tone = "text-blue") => (
    <form action={outpassStep} key={action}>
      <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={action} />
      <button className={`cursor-pointer border-0 bg-transparent p-0 font-semibold underline ${tone}`}>{text}</button>
    </form>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="route" title="Outpass & visitors" subtitle="Boarders leaving the hostel need an approved pass; visitors sign in and out" back={{ href: "/app/hostel", label: "Hostel" }}
        actions={<>
          {can("hostel.mess.create") && (
            <Modal label="+ Visitor" variant="secondary" title="Hostel visitor" size="sm">
              <form action={addHostelVisitor} className="flex flex-col gap-3">
                <input type="hidden" name="back" value={back} />
                <EntityPicker kind="student" name="student_id" label="Visiting student" required />
                <Input label="Visitor's name" name="visitor_name" required />
                <div className="grid grid-cols-2 gap-3"><Input label="Relation" name="relation" placeholder="Father" /><Input label="Phone" name="phone" type="tel" /></div>
                <Input label="Note" name="note" />
                <Submit>Sign in</Submit>
              </form>
            </Modal>
          )}
          {create && (
            <Modal label="+ New outpass" title="New outpass">
              <p className="mt-0 text-[13px] text-muted">{approve ? "Passes you create are approved at once." : "The warden / principal must approve it before the student leaves."}</p>
              <form action={requestOutpass} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <EntityPicker kind="student" name="student_id" label="Student (must have a bed)" required className="sm:col-span-2" />
                <Select label="Purpose" name="kind" defaultValue="home" options={[["home", "Going home"], ["local", "Local outing"], ["medical", "Medical"], ["event", "Event / competition"]]} />
                <Input label="Taken by" name="guardian_name" placeholder="Name of guardian" />
                <Input label="Going out" name="out_at" type="datetime-local" required defaultValue={nowStr} />
                <Input label="Back by" name="expected_back" type="datetime-local" required />
                <Input label="Guardian phone" name="guardian_phone" type="tel" />
                <Textarea label="Reason" name="reason" rows={2} className="sm:col-span-2" />
                <div className="sm:col-span-2"><Submit>Create outpass</Submit></div>
              </form>
            </Modal>
          )}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <nav className="flex flex-wrap gap-1.5" aria-label="Status">
        <Link href="/app/hostel/outpass" className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${!status ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>All</Link>
        {STATUS.map(([k, t]) => <Link key={k} href={`/app/hostel/outpass?status=${k}`} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${status === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{t}</Link>)}
      </nav>
      <form className="flex flex-wrap items-end gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Student, admission no., reason" className="input !min-h-10 w-64 !py-2 text-[15px] font-normal" /></label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Search</button>
      </form>

      {O.length ? (
        <Table head={["Student", "Going out", "Reason", "Status", ""]} minWidth={900}>
          {O.map((o) => (
            <tr key={o.id}>
              <td className={td}><Link href={`/app/students/${o.student_id}`} className="font-semibold">{o.student_name}</Link>
                <div className="text-[12px] text-muted">{o.admission_no}{o.hostel_name ? ` · ${o.hostel_name} ${o.room_no ?? ""}` : ""}</div></td>
              <td className={`${td} text-[13px]`}>{when(o.out_at)}<div className="text-muted">back by {when(o.expected_back)}</div>
                {o.returned_at && <div className="text-muted">returned {when(o.returned_at)}</div>}</td>
              <td className={td}>{o.reason}<div className="text-[12px] text-muted">{label(o.kind)}{o.guardian_name ? ` · with ${o.guardian_name}` : ""}{o.guardian_phone ? ` · ${o.guardian_phone}` : ""}</div></td>
              <td className={td}><Badge value={BADGE[o.status] ?? "normal"} text={o.status === "requested" ? "Waiting approval" : label(o.status)} />{o.late && <div className="mt-1"><Badge value="overdue" text="Late back" /></div>}
                {(o.decided_by_name || o.decision_note) && <div className="mt-1 text-[12px] text-muted">{o.decided_by_name}{o.decision_note ? `: ${o.decision_note}` : ""}</div>}</td>
              <td className={`${td} text-[13px]`}>
                <div className="flex flex-col items-start gap-1">
                  {o.status === "requested" && approve && (
                    <>
                      {act(o.id, "approve", "Approve", "text-[#15803d]")}
                      <form action={outpassStep} className="flex items-center gap-1.5">
                        <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={o.id} /><input type="hidden" name="action" value="reject" />
                        <input name="note" placeholder="Reason" required className="input !min-h-8 !w-28 !py-1 text-[12px]" /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Refuse</button>
                      </form>
                    </>
                  )}
                  {o.status === "approved" && create && act(o.id, "out", "Student has left")}
                  {o.status === "out" && create && act(o.id, "return", "Student is back", "text-[#15803d]")}
                  {(o.status === "requested" || o.status === "approved") && create && act(o.id, "cancel", "Cancel", "text-muted")}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No outpass {status ? `with this status` : "yet"}.</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/hostel/outpass" params={params} />

      {can("hostel.mess.view") && (
        <Card title="Recent visitors" description="Parents and guardians who came to meet a boarder">
          {((vis ?? []) as unknown as Vis[]).length ? (
            <ul className="m-0 list-none p-0 text-[14px]">
              {((vis ?? []) as unknown as Vis[]).map((v) => {
                const s = Array.isArray(v.student) ? v.student[0] : v.student;
                return (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 first:border-0">
                    <span><b className="text-ink">{v.visitor_name}</b>{v.relation ? ` (${v.relation})` : ""} <span className="text-muted">→ {s ? `${s.first_name} ${s.last_name ?? ""}`.trim() : "—"}</span></span>
                    <span className="flex items-center gap-3 text-[13px] text-muted">in {when(v.in_at)}{v.out_at ? ` · out ${when(v.out_at)}` : ""}
                      {!v.out_at && can("hostel.mess.edit") && (
                        <form action={visitorOut}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={v.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Sign out</button></form>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="m-0 text-[13px] text-muted">No visitors yet.</p>}
        </Card>
      )}
    </div>
  );
}
