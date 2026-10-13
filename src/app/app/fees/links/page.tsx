import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { CopyButton } from "@/components/CopyButton";
import { fmtDate, fullName, money, waLink } from "@/lib/format";
import { LINK_STATUS } from "@/lib/fees";
import { cancelPaymentLink } from "../../_actions/fees2";

type O = { id: string; amount: number; status: string; channel: string; link_url: string | null; created_by_name: string | null; created_at: string; paid_at: string | null; phone: string | null; note: string | null; receipt_id: string | null; error: string | null;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string; guardian_phone: string | null; classes: { name: string } | null } | null };

export default async function PaymentLinks({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("fees.online.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const status = Object.keys(LINK_STATUS).includes(sp.status ?? "") ? sp.status! : null;
  const channel = ["parent", "link", "gateway"].includes(sp.channel ?? "") ? sp.channel! : null;
  let q = supabase.from("fee_online_orders")
    .select("id,amount,status,channel,link_url,created_by_name,created_at,paid_at,phone,note,receipt_id,error,students(id,first_name,last_name,admission_no,guardian_phone,classes!class_id(name))", { count: "exact" })
    .eq("school_id", school.id);
  if (status) q = q.eq("status", status);
  if (channel) q = q.eq("channel", channel);
  const { data, count } = await q.order("created_at", { ascending: false }).range(offset, offset + size - 1);
  const rows = (data ?? []) as unknown as O[];
  const [{ data: sums }] = await Promise.all([
    supabase.from("fee_online_orders").select("status,amount").eq("school_id", school.id).limit(5000),
  ]);
  const sum = (st: string) => ((sums ?? []) as { status: string; amount: number }[]).filter((x) => x.status === st).reduce((t, x) => t + Number(x.amount), 0);
  const cnt = (st: string) => ((sums ?? []) as { status: string }[]).filter((x) => x.status === st).length;
  const params = { status: status ?? undefined, channel: channel ?? undefined };
  const canCancel = can("fees.online.create");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Online payments & links" subtitle="Payment links and gateway payments — parents and the fee counter" back={{ href: "/app/fees", label: "Fees" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Paid online" value={money(sum("paid"))} hint={`${cnt("paid")} payments`} icon="revenue" tone="green" />
        <Stat label="Waiting for payment" value={money(sum("created"))} hint={`${cnt("created")} links open`} icon="notifications" tone="amber" />
        <Stat label="Cancelled / expired" value={cnt("cancelled") + cnt("expired")} icon="layers" tone="rose" />
        <Stat label="Failed" value={cnt("failed")} icon="layers" tone="violet" />
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <label className="text-[13px] font-semibold">Status
          <select name="status" defaultValue={status ?? ""} className="input !min-h-10 !py-2"><option value="">All</option>{Object.entries(LINK_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className="text-[13px] font-semibold">Source
          <select name="channel" defaultValue={channel ?? ""} className="input !min-h-10 !py-2"><option value="">All</option><option value="parent">Parent page</option><option value="link">Payment link</option><option value="gateway">Counter gateway</option></select>
        </label>
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>

      {rows.length ? (
        <Table head={["Student", "Amount", "Source", "Created", "Status", ""]} minWidth={860}>
          {rows.map((o) => {
            const s = o.students;
            const phone = o.phone ?? s?.guardian_phone ?? null;
            const wa = o.status === "created" && o.link_url && s ? waLink(phone, `Dear Parent, please pay ${money(o.amount)} school fee for ${fullName(s)} using this secure link: ${o.link_url}\n— ${school.name}`) : null;
            return (
              <tr key={o.id}>
                <td className={td}>{s ? <Link href={`/app/fees/collect?student=${s.id}`} className="font-semibold">{fullName(s)}</Link> : "—"}<div className="text-[12px] text-muted">{s?.admission_no} · {s?.classes?.name ?? ""}</div></td>
                <td className={`${td} font-semibold text-ink`}>{money(o.amount)}</td>
                <td className={td}>{o.channel === "parent" ? "Parent page" : o.channel === "link" ? "Payment link" : "Counter gateway"}<div className="text-[12px] text-muted">{o.created_by_name ?? ""}{o.note ? ` · ${o.note}` : ""}</div></td>
                <td className={td}>{fmtDate(o.created_at.slice(0, 10))}{o.paid_at && <div className="text-[12px] text-muted">paid {fmtDate(o.paid_at.slice(0, 10))}</div>}</td>
                <td className={td}><Badge value={o.status === "paid" ? "paid" : o.status === "created" ? "pending" : o.status === "failed" ? "overdue" : "cancelled"} text={LINK_STATUS[o.status] ?? o.status} />
                  {o.error && <div className="text-[12px] text-error">{o.error.slice(0, 80)}</div>}</td>
                <td className={`${td} whitespace-nowrap text-[13px]`}>
                  {o.receipt_id && <Link href={`/app/fees/receipts/${o.receipt_id}`} className="mr-3">Receipt</Link>}
                  {o.status === "created" && o.link_url && <><a href={o.link_url} target="_blank" rel="noopener noreferrer" className="mr-3">Open</a><CopyButton text={o.link_url} label="Copy" /></>}
                  {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="ml-3">WhatsApp</a>}
                  {o.status === "created" && canCancel && (
                    <form action={cancelPaymentLink} className="mt-1"><input type="hidden" name="id" value={o.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Cancel link</button></form>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No online payments or links yet. Generate one from a student&apos;s collect screen.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/fees/links" params={params} />
    </div>
  );
}
