import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { PrintButton } from "@/components/ui/PrintButton";
import { VISIT_PURPOSES } from "@/lib/frontdesk";
import { addDays, cleanSearch, fmtDate, todayIST } from "@/lib/format";
import { checkOutVisitor } from "../../_actions/frontdesk";

type Row = { id: string; pass_no: string; name: string; phone: string | null; purpose: string; to_meet: string | null; student_name: string | null; organisation: string | null;
  id_proof: string | null; people: number; vehicle_no: string | null; note: string | null; in_at: string; out_at: string | null; created_by_name: string | null; total: number };
const hhmm = (t: string) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export default async function Visitors({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.visitors.view");
  const sp = await searchParams;
  const today = todayIST();
  const to = ok(sp.to) ?? today;
  const from = ok(sp.from) ?? addDays(to, -6);
  const { page, size, offset } = pageParams(sp);
  const q = cleanSearch(sp.q ?? "").trim();
  const purpose = VISIT_PURPOSES.some(([k]) => k === sp.purpose) ? sp.purpose! : null;
  const inside = sp.state === "inside" ? true : sp.state === "left" ? false : null;
  const { data, error } = await supabase.rpc("visitor_list", { sid: school.id, d1: from, d2: to, p_q: q || null, p_purpose: purpose, p_inside: inside, p_limit: size, p_offset: offset });
  const rows = (data ?? []) as Row[];
  const total = rows[0] ? Number(rows[0].total) : 0;
  const params = { from, to, q: q || undefined, purpose: purpose ?? undefined, state: sp.state };
  const label = (p: string) => VISIT_PURPOSES.find(([k]) => k === p)?.[1] ?? p;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 print:hidden">
        <PageHeader icon="admissions" title="Visitor register" subtitle={`${fmtDate(from)} to ${fmtDate(to)} · ${total} visits`} back={{ href: "/app/frontdesk", label: "Front office" }} actions={<PrintButton />} />
        <Flash ok={sp.ok} error={sp.error} />
        <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Input label="From" name="from" type="date" defaultValue={from} />
          <Input label="To" name="to" type="date" defaultValue={to} />
          <Select label="Purpose" name="purpose" blank="All" defaultValue={purpose} options={VISIT_PURPOSES} />
          <Select label="Status" name="state" blank="All" defaultValue={sp.state} options={[["inside", "Inside"], ["left", "Left"]]} />
          <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, phone, pass, vehicle" />
          <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
        </form>
      </div>
      <h1 className="hidden text-[18px] font-bold print:block">{school.name} — Visitor register {fmtDate(from)} to {fmtDate(to)}</h1>
      {error && <Flash error={`Could not load visitors: ${error.message}`} />}
      {rows.length ? (
        <Table head={["Pass", "Visitor", "Purpose / to meet", "In", "Out", ""]} minWidth={820}>
          {rows.map((v) => (
            <tr key={v.id}>
              <td className={`${td} font-mono text-[12px]`}>{v.pass_no}</td>
              <td className={td}><b className="text-ink">{v.name}</b>{v.people > 1 ? ` +${v.people - 1}` : ""}<div className="text-[12px] text-muted">{[v.phone, v.organisation, v.vehicle_no, v.id_proof].filter(Boolean).join(" · ")}</div></td>
              <td className={td}>{label(v.purpose)}<div className="text-[12px] text-muted">{[v.to_meet, v.student_name ? `for ${v.student_name}` : null, v.note].filter(Boolean).join(" · ")}</div></td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{fmtDate(v.in_at.slice(0, 10))}<div>{hhmm(v.in_at)}</div></td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>{v.out_at ? hhmm(v.out_at) : <Badge value="active" text="Inside" />}</td>
              <td className={`${td} print:hidden`}>
                {!v.out_at && can("frontdesk.visitors.create") && (
                  <form action={checkOutVisitor}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="back" value="/app/frontdesk/visitors" /><button className="btn btn-sm btn-secondary cursor-pointer">Check out</button></form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || purpose || inside !== null ? "No visit matches these filters." : "No visitors in this period."}</Empty>}
      <div className="print:hidden"><Pagination total={total} page={page} size={size} basePath="/app/frontdesk/visitors" params={params} /></div>
      <p className="m-0 text-[12px] text-muted print:hidden"><Link href="/app/frontdesk">Check in a visitor</Link></p>
    </div>
  );
}
