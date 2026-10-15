import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { CopyButton } from "@/components/CopyButton";
import { PrintButton } from "@/components/ui/PrintButton";
import { appUrl } from "@/lib/brand";
import { qrDataUrl } from "@/lib/qr";
import { VISIT_PURPOSES } from "@/lib/frontdesk";
import { cleanSearch, fmtDate, todayIST } from "@/lib/format";
import { checkInVisitor, checkOutVisitor, deleteVisitor, rotateVisitLink, updateVisitor } from "../_actions/frontdesk";

type Today = { visitors_today: number; visitors_inside: number; calls_today: number; followups_due: number; passes_waiting: number; passes_to_release: number;
  postal_today: number; enquiries_new: number; applications_open: number };
type Row = { id: string; pass_no: string; name: string; phone: string | null; purpose: string; to_meet: string | null; student_name: string | null; organisation: string | null;
  id_proof: string | null; people: number; vehicle_no: string | null; note: string | null; in_at: string; out_at: string | null; created_by_name: string | null; source: string; total: number };
const hhmm = (t: string) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const label = (p: string) => VISIT_PURPOSES.find(([k]) => k === p)?.[1] ?? p;

export default async function FrontDesk({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.visitors.view", "frontdesk.enquiries.view", "frontdesk.admissions.view");
  const sp = await searchParams;
  const today = todayIST();
  const canSee = can("frontdesk.visitors.view");
  const from = ok(sp.from) ?? today, to = ok(sp.to) ?? today;
  const { page, size, offset } = pageParams(sp);
  const q = cleanSearch(sp.q ?? "").trim();
  const purpose = VISIT_PURPOSES.some(([k]) => k === sp.purpose) ? sp.purpose! : null;
  const inside = sp.state === "inside" ? true : sp.state === "left" ? false : null;
  const source = sp.source === "qr" || sp.source === "manual" ? sp.source : null;
  const editId = sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) ? sp.edit : null;

  const [{ data: t }, { data, error }, token, editQ] = await Promise.all([
    supabase.rpc("frontdesk_today", { sid: school.id }),
    canSee ? supabase.rpc("visitor_list", { sid: school.id, d1: from, d2: to, p_q: q || null, p_purpose: purpose, p_inside: inside, p_limit: size, p_offset: offset, p_source: source }) : Promise.resolve({ data: [], error: null }),
    canSee ? supabase.rpc("visit_token", { sid: school.id }) : Promise.resolve({ data: null }),
    editId && can("frontdesk.visitors.edit") ? supabase.from("visitors").select("*").eq("id", editId).eq("school_id", school.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const T = (t ?? {}) as Partial<Today>;
  const rows = (data ?? []) as Row[];
  const total = rows[0] ? Number(rows[0].total) : 0;
  const edit = editQ.data as { id: string; name: string; phone: string | null; purpose: string; to_meet: string | null; organisation: string | null; people: number; vehicle_no: string | null; id_proof: string | null; note: string | null } | null;
  const desk = can("frontdesk.visitors.create");
  const params = { from: sp.from, to: sp.to, q: q || undefined, purpose: purpose ?? undefined, state: sp.state, source: source ?? undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: sp.page, size: sp.size }).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/app/frontdesk${qs ? "?" + qs : ""}`;
  const visitUrl = token.data ? appUrl(`/visit/${token.data}`) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 print:hidden">
        <PageHeader icon="admissions" title="Front desk" subtitle="Visitors, calls, post, gate passes and admissions at one desk"
          actions={<>
            {desk && (
              <Modal label="+ Add visitor" title="Check in a visitor">
                <form action={checkInVisitor} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="back" value={here} />
                  <Input label="Name" name="name" required />
                  <Input label="Phone" name="phone" type="tel" />
                  <Select label="Purpose" name="purpose" defaultValue="meeting" options={VISIT_PURPOSES} />
                  <Input label="To meet" name="to_meet" placeholder="Teacher / office / principal" />
                  <EntityPicker kind="student" name="student_id" label="Visiting for student (optional)" className="sm:col-span-2" />
                  <Input label="Organisation" name="organisation" />
                  <Input label="ID shown" name="id_proof" placeholder="Aadhaar / DL, last 4 digits" />
                  <Input label="Vehicle no." name="vehicle_no" />
                  <Input label="People" name="people" type="number" min={1} defaultValue="1" />
                  <Textarea label="Note" name="note" rows={2} className="sm:col-span-2" />
                  <div className="sm:col-span-2"><Submit>Check in</Submit></div>
                </form>
              </Modal>
            )}
            {visitUrl && (
              <Modal label="Visitor QR" variant="secondary" title="Visitors scan this to check themselves in" size="sm">
                <div className="flex flex-col items-center gap-3 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl(visitUrl)} alt="Visitor check-in QR code" width={220} height={220} className="rounded-lg border border-line" />
                  <p className="m-0 text-[13px] text-muted">Print and put it at the gate or reception. A visitor scans, fills name, mobile and purpose, and appears here as <b>Inside</b>.</p>
                  <div className="flex flex-wrap justify-center gap-2"><CopyButton text={visitUrl} label="Copy link" /><PrintButton /></div>
                  {can("frontdesk.visitors.edit") && (
                    <form action={rotateVisitLink}><input type="hidden" name="back" value={here} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-error underline">Create a new QR (old one stops working)</button></form>
                  )}
                </div>
              </Modal>
            )}
            {can("frontdesk.admissions.view") && <Link href="/app/admissions/pipeline" className="btn btn-sm btn-secondary">Admission pipeline</Link>}
          </>} />
        <Flash ok={sp.ok} error={sp.error} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Visitors today" value={T.visitors_today ?? 0} hint={`${T.visitors_inside ?? 0} inside now`} tone="blue" />
          <Stat label="Calls today" value={T.calls_today ?? 0} hint={`${T.followups_due ?? 0} follow-ups due`} href="/app/frontdesk/calls" tone={T.followups_due ? "amber" : "cyan"} />
          <Stat label="Gate passes" value={(T.passes_waiting ?? 0) + (T.passes_to_release ?? 0)} hint={`${T.passes_waiting ?? 0} to approve · ${T.passes_to_release ?? 0} to release`} href="/app/frontdesk/gatepass" tone="violet" />
          <Stat label="New enquiries" value={T.enquiries_new ?? 0} hint={`${T.applications_open ?? 0} applications open`} href="/app/admissions" tone="green" />
        </div>

        {canSee && (
          <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-7">
            <Input label="From" name="from" type="date" defaultValue={from} />
            <Input label="To" name="to" type="date" defaultValue={to} />
            <Select label="Purpose" name="purpose" blank="All" defaultValue={purpose} options={VISIT_PURPOSES} />
            <Select label="Status" name="state" blank="All" defaultValue={sp.state} options={[["inside", "Inside"], ["left", "Left"]]} />
            <Select label="Source" name="source" blank="All" defaultValue={source} options={[["qr", "QR self check-in"], ["manual", "Entered by staff"]]} />
            <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, phone, pass…" />
            <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
          </form>
        )}
      </div>

      {canSee ? (
        <>
          <h1 className="hidden text-[18px] font-bold print:block">{school.name} — Visitors {fmtDate(from)} to {fmtDate(to)}</h1>
          {error && <Flash error={`Could not load visitors: ${error.message}`} />}
          {rows.length ? (
            <Table head={["Pass", "Visitor", "Purpose / to meet", "In", "Out", "How", ""]} minWidth={900}>
              {rows.map((v) => (
                <tr key={v.id} className={edit?.id === v.id ? "bg-blue-tint" : ""}>
                  <td className={`${td} font-mono text-[12px]`}>{v.pass_no}</td>
                  <td className={td}><b className="text-ink">{v.name}</b>{v.people > 1 ? ` +${v.people - 1}` : ""}<div className="text-[12px] text-muted">{[v.phone, v.organisation, v.vehicle_no, v.id_proof].filter(Boolean).join(" · ")}</div></td>
                  <td className={td}>{label(v.purpose)}<div className="text-[12px] text-muted">{[v.to_meet, v.student_name ? `for ${v.student_name}` : null, v.note].filter(Boolean).join(" · ")}</div></td>
                  <td className={`${td} whitespace-nowrap text-[13px]`}>{fmtDate(v.in_at.slice(0, 10))}<div>{hhmm(v.in_at)}</div></td>
                  <td className={`${td} whitespace-nowrap text-[13px]`}>{v.out_at ? hhmm(v.out_at) : <Badge value="active" text="Inside" />}</td>
                  <td className={`${td} text-[12px]`}>{v.source === "qr" ? <Badge value="info" text="QR" /> : <span className="text-muted">Staff{v.created_by_name ? ` · ${v.created_by_name}` : ""}</span>}</td>
                  <td className={`${td} print:hidden`}>
                    <div className="flex flex-wrap items-center gap-3 text-[13px]">
                      {!v.out_at && desk && <form action={checkOutVisitor}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="back" value={here} /><button className="btn btn-sm btn-secondary cursor-pointer">Check out</button></form>}
                      {can("frontdesk.visitors.edit") && <Link href={`${here}${here.includes("?") ? "&" : "?"}edit=${v.id}`}>Edit</Link>}
                      {can("frontdesk.visitors.delete") && <form action={deleteVisitor}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="back" value={here} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Delete</button></form>}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          ) : <Empty>{q || purpose || inside !== null || source ? "No visit matches these filters." : "No visitors in this period."}</Empty>}
          <div className="print:hidden"><Pagination total={total} page={page} size={size} basePath="/app/frontdesk" params={params} /></div>
        </>
      ) : null}

      {edit && (
        <Modal defaultOpen closeHref={here.replace(/[?&]edit=[^&]*/, "")} title={`Edit visit — ${edit.name}`}>
          <form action={updateVisitor} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={edit.id} /><input type="hidden" name="back" value={here} />
            <Input label="Name" name="name" required defaultValue={edit.name} />
            <Input label="Phone" name="phone" type="tel" defaultValue={edit.phone} />
            <Select label="Purpose" name="purpose" defaultValue={edit.purpose} options={VISIT_PURPOSES} />
            <Input label="To meet" name="to_meet" defaultValue={edit.to_meet} />
            <Input label="Organisation" name="organisation" defaultValue={edit.organisation} />
            <Input label="ID shown" name="id_proof" defaultValue={edit.id_proof} />
            <Input label="Vehicle no." name="vehicle_no" defaultValue={edit.vehicle_no} />
            <Input label="People" name="people" type="number" min={1} defaultValue={edit.people} />
            <Textarea label="Note" name="note" rows={2} defaultValue={edit.note} className="sm:col-span-2" />
            <div className="sm:col-span-2"><Submit>Save changes</Submit></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
