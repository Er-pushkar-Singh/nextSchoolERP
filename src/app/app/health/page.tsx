import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { addDays, label, todayIST } from "@/lib/format";
import { addHealthVisit, informParent } from "../_actions/wellbeing";

type Visit = { id: string; student_id: string; student_name: string; admission_no: string; class_name: string | null; visited_at: string; complaint: string; temperature_c: number | null;
  treatment: string | null; medicine: string | null; outcome: string; parent_informed: boolean; follow_up_on: string | null; attended_by_name: string | null; allergies: string | null; conditions: string | null;
  visits_30: number; total: number };
const OUTCOMES: [string, string][] = [["rested", "Rested in the medical room"], ["returned_class", "Went back to class"], ["sent_home", "Sent home"], ["referred", "Referred to a doctor"], ["hospital", "Taken to hospital"]];
const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

export default async function Health({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("wellbeing.medical.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const today = todayIST();
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const d1 = ok(sp.from) ?? addDays(today, -6);
  const d2 = ok(sp.to) ?? today;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const outcome = OUTCOMES.some(([k]) => k === sp.outcome) ? sp.outcome! : null;
  const followup = sp.follow === "1";

  const [{ data }, { data: todays }, { data: due }] = await Promise.all([
    supabase.rpc("health_visit_list", { sid: school.id, d1, d2, p_q: q || null, p_outcome: outcome, p_followup: followup, p_limit: size, p_offset: offset }),
    supabase.rpc("health_visit_list", { sid: school.id, d1: today, d2: today, p_limit: 200, p_offset: 0 }),
    supabase.rpc("health_visit_list", { sid: school.id, d1: addDays(today, -90), d2: today, p_followup: true, p_limit: 200, p_offset: 0 }),
  ]);
  const V = (data ?? []) as Visit[];
  const T = (todays ?? []) as Visit[];
  const total = V[0] ? Number(V[0].total) : 0;
  const params = { from: d1 === addDays(today, -6) ? undefined : d1, to: d2 === today ? undefined : d2, q: q || undefined, outcome: outcome ?? undefined, follow: followup ? "1" : undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `/app/health${qs ? `?${qs}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="health" title="Medical room" subtitle="Visits, treatment and whether the parent was told"
        actions={<>
          {can("wellbeing.medical.view") && <Link href="/app/health/records" className="btn btn-sm btn-secondary">Health records</Link>}
          {can("wellbeing.medical.create") && (
            <Modal label="+ Record a visit" title="Medical room visit">
              <form action={addHealthVisit} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <EntityPicker kind="student" name="student_id" label="Student" required placeholder="Type name or admission no." className="sm:col-span-2" />
                <Input label="Complaint" name="complaint" required className="sm:col-span-2" placeholder="Headache, fever, injury on the playground…" />
                <Input label="Temperature (°C)" name="temperature" type="number" step="0.1" min={30} max={45} />
                <Select label="What happened" name="outcome" defaultValue="rested" options={OUTCOMES} />
                <Input label="Treatment given" name="treatment" />
                <Input label="Medicine" name="medicine" placeholder="Name and dose" />
                <Input label="Follow-up on" name="follow_up_on" type="date" min={today} />
                <label className="flex items-center gap-2 self-end pb-2 text-[14px]"><input type="checkbox" name="informed" /> Parent informed</label>
                <p className="m-0 text-[12.5px] text-muted sm:col-span-2">A child can be sent home or to hospital only after the parent is informed.</p>
                <div className="sm:col-span-2"><Submit>Save visit</Submit></div>
              </form>
            </Modal>
          )}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Visits today" value={T.length} icon="health" tone="rose" />
        <Stat label="Sent home / hospital today" value={T.filter((v) => v.outcome === "sent_home" || v.outcome === "hospital").length} icon="students" tone="amber" />
        <Stat label="Follow-ups due" value={(due ?? []).length} icon="attendance" tone={(due ?? []).length ? "violet" : "green"} href="/app/health?follow=1&from=2000-01-01" />
        <Stat label="Parent not yet told today" value={T.filter((v) => !v.parent_informed).length} icon="notifications" tone={T.some((v) => !v.parent_informed) ? "rose" : "green"} />
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <Input label="From" name="from" type="date" defaultValue={d1} />
        <Input label="To" name="to" type="date" defaultValue={d2} />
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Student, admission no., complaint, medicine" className="input !min-h-10 w-64 !py-2 text-[15px] font-normal" /></label>
        <Select label="Outcome" name="outcome" blank="Any" defaultValue={outcome} options={OUTCOMES} />
        <label className="flex items-center gap-2 pb-2.5 text-[14px]"><input type="checkbox" name="follow" value="1" defaultChecked={followup} /> Follow-up due</label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>

      {V.length ? (
        <Table head={["When", "Student", "Complaint & treatment", "Outcome", "Parent", ""]} minWidth={940}>
          {V.map((v) => (
            <tr key={v.id}>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{time(v.visited_at)}{v.attended_by_name && <div className="text-muted">{v.attended_by_name}</div>}</td>
              <td className={td}>
                <Link href={`/app/students/${v.student_id}`} className="font-semibold">{v.student_name}</Link>
                <div className="text-[12px] text-muted">{v.admission_no} · {v.class_name}{v.visits_30 >= 3 ? ` · ${v.visits_30} visits in 30 days` : ""}</div>
                {(v.allergies || v.conditions) && <div className="mt-1 text-[12px] font-semibold text-[#9a3412]">⚠ {[v.allergies && `Allergy: ${v.allergies}`, v.conditions].filter(Boolean).join(" · ")}</div>}
              </td>
              <td className={td}>{v.complaint}{v.temperature_c ? <span className="text-muted"> · {v.temperature_c}°C</span> : null}
                <div className="text-[12px] text-muted">{[v.treatment, v.medicine].filter(Boolean).join(" · ")}</div>
                {v.follow_up_on && <div className="text-[12px] text-muted">Follow-up {v.follow_up_on}</div>}</td>
              <td className={td}><Badge value={v.outcome === "sent_home" || v.outcome === "hospital" ? "high" : "normal"} text={label(v.outcome)} /></td>
              <td className={td}>{v.parent_informed ? <Badge value="done" text="Informed" /> : <Badge value="overdue" text="Not informed" />}</td>
              <td className={`${td} text-[13px]`}>
                {!v.parent_informed && can("wellbeing.medical.edit") && (
                  <form action={informParent}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={v.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">Mark informed</button></form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No visits in this period.</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/health" params={params} />
    </div>
  );
}
