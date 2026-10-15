import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { fmtDate, fullName, money, todayIST, waLink } from "@/lib/format";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { closePromise } from "../../_actions/fees2";

type P = { id: string; promised_on: string; amount: number | null; note: string | null; status: string; created_by_name: string | null;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string; guardian_phone: string | null; classes: { name: string } | null } | null };

export default async function Promises({ searchParams }: { searchParams: Promise<{ show?: string; ok?: string; error?: string; page?: string; size?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.defaulters.view");
  const sp = await searchParams;
  const today = todayIST();
  const all = sp.show === "all";
  const { page, size, offset } = pageParams(sp);
  let q = supabase.from("fee_followups").select("id,promised_on,amount,note,status,created_by_name,students(id,first_name,last_name,admission_no,guardian_phone,classes!class_id(name))", { count: "exact" }).eq("school_id", school.id);
  q = all ? q.order("promised_on", { ascending: false }).range(offset, offset + size - 1) : q.eq("status", "open").order("promised_on").range(offset, offset + size - 1);
  const [{ data, count }, { count: overdue }] = await Promise.all([
    q,
    supabase.from("fee_followups").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("status", "open").lt("promised_on", today),
  ]);
  const rows = (data ?? []) as unknown as P[];
  const canEdit = can("fees.defaulters.create") || can("fees.collection.create");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Promises to pay" subtitle={all ? `All promises · ${count ?? 0}` : `${overdue ?? 0} overdue · ${count ?? 0} open`} back={{ href: "/app/fees", label: "Fees" }}
        actions={<Link href={all ? "/app/fees/followups" : "/app/fees/followups?show=all"} className="btn btn-sm btn-secondary">{all ? "Open ones" : "All"}</Link>} />
      <Flash ok={sp.ok} error={sp.error} />
      {rows.length ? (
        <Table head={["Promised for", "Student", "Amount", "Note", "Status", ""]} minWidth={820}>
          {rows.map((r) => {
            const s = r.students;
            const wa = s && r.status === "open" ? waLink(s.guardian_phone, `Namaste, a gentle reminder from ${school.name}: the fee of ${s.first_name} was to be paid on ${fmtDate(r.promised_on)}${r.amount ? ` (${money(r.amount)})` : ""}. Thank you.`) : null;
            return (
              <tr key={r.id}>
                <td className={`${td} ${r.status === "open" && r.promised_on < today ? "font-semibold text-error" : ""}`}>{fmtDate(r.promised_on)}</td>
                <td className={td}>{s ? <Link href={`/app/fees/collect?student=${s.id}`} className="font-semibold">{fullName(s)}</Link> : "—"}<div className="text-[12px] text-muted">{s?.admission_no} · {s?.classes?.name ?? ""}{s?.guardian_phone ? ` · ${s.guardian_phone}` : ""}</div></td>
                <td className={td}>{r.amount ? money(r.amount) : "—"}</td>
                <td className={td}>{r.note ?? "—"}<div className="text-[12px] text-muted">{r.created_by_name}</div></td>
                <td className={td}><Badge value={r.status === "kept" ? "paid" : r.status === "broken" ? "overdue" : "pending"} text={r.status} /></td>
                <td className={`${td} whitespace-nowrap`}>
                  {wa && <a href={wa} target="_blank" rel="noopener" className="mr-3 text-[13px]">WhatsApp</a>}
                  {r.status === "open" && canEdit && (
                    <form action={closePromise} className="inline-flex gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <button name="status" value="kept" className="btn btn-sm btn-primary cursor-pointer border-0">Kept</button>
                      <button name="status" value="broken" className="btn btn-sm btn-secondary cursor-pointer">Broken</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No promises recorded. Add one from a student&apos;s collect screen.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/fees/followups" params={{ show: all ? "all" : undefined }} />
    </div>
  );
}
