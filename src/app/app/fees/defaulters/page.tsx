import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Empty, PageHeader, Table, td } from "@/components/ui/ui";
import { fmtDate, money, todayIST, waLink } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { appUrl } from "@/lib/brand";
import { feeReminderText, type Defaulter } from "@/lib/reminders";
import { WaQueue } from "@/components/WaQueue";
import { Pagination, pageParams } from "@/components/ui/Pagination";

export default async function Defaulters({ searchParams }: { searchParams: Promise<{ class_id?: string; min?: string; on?: string; page?: string; size?: string }> }) {
  const { supabase, school, session } = await requirePerm("fees.defaulters.view");
  const sp = await searchParams;
  if (!session) return <Empty>No current session.</Empty>;
  const on = sp.on && /^\d{4}-\d{2}-\d{2}$/.test(sp.on) ? sp.on : todayIST();
  const cls = sp.class_id && /^[0-9a-f-]{36}$/.test(sp.class_id) ? sp.class_id : null;
  const min = Math.max(1, Number(sp.min) || 1);
  const [classes, { data }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.rpc("defaulters", { sid: school.id, sess: session.id, on_day: on, cls, min_amount: min }).limit(5000),
  ]);
  const all = (data ?? []) as Defaulter[];
  const total = all.reduce((s, r) => s + Number(r.overdue), 0);
  const { page, size, offset } = pageParams(sp);
  const rows = all.slice(offset, offset + size); // totals are for everyone; the table and the WhatsApp queue show this page
  const msgs = rows.map((r) => ({ id: r.student_id, name: r.student_name, href: waLink(r.guardian_phone, feeReminderText(r, school, appUrl(`/p/${r.portal_token}`))) }));
  const qs = new URLSearchParams({ on, min: String(min), ...(cls ? { class_id: cls } : {}) });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Fee defaulters" subtitle={`${all.length} students · ${money(total)} overdue as of ${fmtDate(on)}`} back={{ href: "/app/fees", label: "Fees" }}
        actions={<a href={`/app/fees/defaulters/export?${qs}`} className="btn btn-sm btn-secondary">Download CSV</a>} />
      <form className="flex flex-wrap items-end gap-2">
        <label className="text-[13px] font-semibold">Class
          <select name="class_id" defaultValue={cls ?? ""} className="input !min-h-10 !py-2"><option value="">All</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="text-[13px] font-semibold">Min. ₹<input name="min" type="number" defaultValue={min} className="input !min-h-10 !w-28 !py-2" /></label>
        <label className="text-[13px] font-semibold">As of<input name="on" type="date" defaultValue={on} className="input !min-h-10 !py-2" /></label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {rows.length ? (
        <>
          <p className="m-0 text-[14px] print:hidden"><Link href={`/app/fees/print/demand?${new URLSearchParams({ ...(cls ? { class_id: cls } : {}), min: String(min) })}`}>Print demand notices for all {all.length > 60 ? "(first 60) " : ""}{all.length} →</Link></p>
          <WaQueue items={msgs} />
          <Table head={["Student", "Class", "Father / phone", "Overdue", "Since", ""]}>
            {rows.map((r, i) => (
              <tr key={r.student_id}>
                <td className={td}><Link href={`/app/students/${r.student_id}`} className="font-semibold">{r.student_name}</Link><div className="font-mono text-[12px] text-muted">{r.admission_no}</div></td>
                <td className={td}>{r.class_name ?? "—"}{r.section_name ? `-${r.section_name}` : ""}</td>
                <td className={td}>{r.father_name ?? "—"}<div className="text-[12px] text-muted">{r.guardian_phone ?? "no phone"}</div></td>
                <td className={`${td} font-semibold text-error`}>{money(r.overdue)}<div className="text-[12px] font-normal text-muted">{r.instalments} instalment(s)</div></td>
                <td className={td}>{fmtDate(r.oldest_due)}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {msgs[i].href ? <a href={msgs[i].href!} target="_blank" rel="noopener" className="mr-3">WhatsApp</a> : <span className="mr-3 text-muted">—</span>}
                  <Link href={`/app/fees/collect?student=${r.student_id}`} className="mr-3">Collect</Link>
                  <Link href={`/app/fees/print/demand?student=${r.student_id}`}>Demand notice</Link>
                </td>
              </tr>
            ))}
          </Table>
          <Pagination total={all.length} page={page} size={size} basePath="/app/fees/defaulters" params={{ class_id: cls ?? undefined, min: min > 1 ? String(min) : undefined, on: sp.on ? on : undefined }} />
        </>
      ) : <Empty>No one has overdue fees. 🎉</Empty>}
    </div>
  );
}
