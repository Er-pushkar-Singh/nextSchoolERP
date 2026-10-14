import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Textarea } from "@/components/ui/ui";
import { VISIT_PURPOSES } from "@/lib/frontdesk";
import { addDays, todayIST } from "@/lib/format";
import { checkInVisitor, checkOutVisitor } from "../_actions/frontdesk";

type Today = { visitors_today: number; visitors_inside: number; calls_today: number; followups_due: number; passes_waiting: number; passes_to_release: number;
  postal_today: number; enquiries_new: number; applications_open: number };
type V = { id: string; pass_no: string; name: string; purpose: string; to_meet: string | null; in_at: string; people: number };
const hhmm = (t: string) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

export default async function FrontDesk({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.visitors.view", "frontdesk.enquiries.view", "frontdesk.admissions.view");
  const sp = await searchParams;
  const today = todayIST();
  const [{ data: t }, { data: inside }] = await Promise.all([
    supabase.rpc("frontdesk_today", { sid: school.id }),
    can("frontdesk.visitors.view") ? supabase.rpc("visitor_list", { sid: school.id, d1: addDays(today, -1), d2: today, p_inside: true, p_limit: 50, p_offset: 0 }) : Promise.resolve({ data: [] }),
  ]);
  const T = (t ?? {}) as Partial<Today>;
  const V = (inside ?? []) as V[];
  const desk = can("frontdesk.visitors.create");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Front office" subtitle="Visitors, calls, post, gate passes and admissions at one desk"
        actions={can("frontdesk.admissions.view") ? <Link href="/app/admissions/pipeline" className="btn btn-sm btn-secondary">Admission pipeline</Link> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Visitors today" value={T.visitors_today ?? 0} hint={`${T.visitors_inside ?? 0} inside now`} href="/app/frontdesk/visitors" tone="blue" />
        <Stat label="Calls today" value={T.calls_today ?? 0} hint={`${T.followups_due ?? 0} follow-ups due`} href="/app/frontdesk/calls" tone={T.followups_due ? "amber" : "cyan"} />
        <Stat label="Gate passes" value={(T.passes_waiting ?? 0) + (T.passes_to_release ?? 0)} hint={`${T.passes_waiting ?? 0} to approve · ${T.passes_to_release ?? 0} to release`} href="/app/frontdesk/gatepass" tone="violet" />
        <Stat label="New enquiries" value={T.enquiries_new ?? 0} hint={`${T.applications_open ?? 0} applications open`} href="/app/admissions" tone="green" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {desk && (
          <Card title="Check in a visitor" icon="admissions">
            <form action={checkInVisitor} className="grid gap-3 sm:grid-cols-2">
              <Input label="Name" name="name" required />
              <Input label="Phone" name="phone" type="tel" />
              <Select label="Purpose" name="purpose" defaultValue="meeting" options={VISIT_PURPOSES} />
              <Input label="To meet" name="to_meet" placeholder="Teacher / office / principal" />
              <Input label="Student admission no. (parent visits)" name="admission_no" />
              <Input label="Organisation" name="organisation" />
              <Input label="ID shown" name="id_proof" placeholder="Aadhaar / DL, last 4 digits" />
              <Input label="Vehicle no." name="vehicle_no" />
              <Input label="People" name="people" type="number" min={1} defaultValue="1" />
              <Textarea label="Note" name="note" rows={1} />
              <div className="sm:col-span-2"><Submit>Check in</Submit></div>
            </form>
          </Card>
        )}
        <Card title={`Inside now (${V.length})`} actions={<Link href="/app/frontdesk/visitors" className="text-[13px]">All visitors</Link>}>
          {V.length ? (
            <ul className="m-0 list-none divide-y divide-line p-0 text-[14px]">
              {V.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                  <span><b className="text-ink">{v.name}</b>{v.people > 1 ? ` +${v.people - 1}` : ""}<span className="block text-[12px] text-muted">{v.pass_no} · in {hhmm(v.in_at)} · {v.to_meet ?? v.purpose}</span></span>
                  {desk && (
                    <form action={checkOutVisitor}><input type="hidden" name="id" value={v.id} /><button className="btn btn-sm btn-secondary cursor-pointer">Check out</button></form>
                  )}
                </li>
              ))}
            </ul>
          ) : <Empty>No visitor is inside.</Empty>}
        </Card>
      </div>

      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
        {[["/app/frontdesk/calls", "Call log", "Incoming and outgoing, follow-ups"], ["/app/frontdesk/postal", "Postal register", "Letters, speed post, couriers"],
          ["/app/frontdesk/gatepass", "Student gate pass", "Early leave with pick-up person"], ["/app/admissions", "Enquiries & admissions", "From enquiry to admit"]].map(([h, l, d]) => (
          <li key={h}><Link href={h} className="block h-full rounded-[12px] border border-line bg-white px-3 py-2.5 no-underline hover:border-blue"><b className="block text-[14px] text-ink">{l}</b><span className="text-[12px] text-muted">{d}</span></Link></li>
        ))}
      </ul>
    </div>
  );
}
