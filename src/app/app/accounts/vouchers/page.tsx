import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { VoucherForm } from "@/components/accounts/VoucherForm";
import { cleanSearch, fmtDate, money } from "@/lib/format";
import { MODES, period } from "@/lib/accounts";
import { cancelVoucher, decideVoucher } from "../../_actions/accounts";

type Row = { id: string; no: string; date: string; kind: string; head_name: string | null; book_name: string; to_book_name: string | null; amount: number; party: string | null; mode: string | null;
  ref_no: string | null; narration: string | null; status: string; created_by_name: string | null; decided_by_name: string | null; decision_note: string | null; total: number };
const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
const KIND: Record<string, string> = { receipt: "Receipt", payment: "Payment", transfer: "Transfer" };
const STATUS_BADGE: Record<string, string> = { posted: "active", pending: "pending", rejected: "rejected", cancelled: "cancelled" };

export default async function Vouchers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("accounts.vouchers.view");
  const sp = await searchParams;
  await supabase.rpc("ensure_account_defaults", { sid: school.id });
  const { from, to, today } = period({ from: sp.from ?? `${new Date().getFullYear() - 1}-01-01`, to: sp.to });
  const { page, size, offset } = pageParams(sp);
  const kind = ["receipt", "payment", "transfer"].includes(sp.kind ?? "") ? sp.kind! : null;
  const status = ["posted", "pending", "rejected", "cancelled"].includes(sp.status ?? "") ? sp.status! : null;
  const head = uid(sp.head), book = uid(sp.book);
  const q = cleanSearch(sp.q ?? "").trim();
  const editId = uid(sp.edit);
  const [{ data, error }, { data: heads }, { data: books }, editQ] = await Promise.all([
    supabase.rpc("voucher_list", { sid: school.id, d1: from, d2: to, p_kind: kind, p_status: status, p_head: head, p_book: book, p_q: q || null, p_limit: size, p_offset: offset }),
    supabase.from("account_heads").select("id,name,kind,active").eq("school_id", school.id).order("name"),
    supabase.from("account_books").select("id,name,kind,active").eq("school_id", school.id).order("created_at"),
    editId && can("accounts.vouchers.edit") ? supabase.from("vouchers").select("*").eq("id", editId).eq("school_id", school.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const rows = (data ?? []) as Row[];
  const total = rows[0] ? Number(rows[0].total) : 0;
  const edit = editQ.data as { id: string; date: string; kind: string; head_id: string | null; book_id: string; to_book_id: string | null; amount: number; party: string | null; mode: string | null; ref_no: string | null; narration: string | null; status: string } | null;
  const showForm = Boolean(edit) || (can("accounts.vouchers.create") && (sp.new === "1" || rows.length === 0));
  const params = { from: sp.from, to: sp.to, kind: kind ?? undefined, status: status ?? undefined, head: head ?? undefined, book: book ?? undefined, q: q || undefined };
  const here = `/app/accounts/vouchers${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString() ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString() : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="revenue" title="Vouchers" subtitle="Income and expense that did not come through fees or payroll" back={{ href: "/app/accounts", label: "Accounts" }}
        actions={can("accounts.vouchers.create") ? <Link href="/app/accounts/vouchers?new=1" className="btn btn-sm btn-primary">New voucher</Link> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />

      {showForm && (
        <Card title={edit ? "Edit voucher" : "New voucher"} icon="revenue">
          <VoucherForm key={edit?.id ?? "new"} today={today} back={here} modes={MODES}
            heads={(heads ?? []).filter((h) => h.active || h.id === edit?.head_id).map((h) => ({ id: h.id, name: h.name, kind: h.kind as "income" | "expense" }))}
            books={(books ?? []).filter((b) => b.active || b.id === edit?.book_id).map((b) => ({ id: b.id, name: b.name, kind: b.kind }))}
            initial={edit ? { id: edit.id, kind: edit.kind, date: edit.date, head_id: edit.head_id, book_id: edit.book_id, to_book_id: edit.to_book_id, amount: String(edit.amount), party: edit.party ?? "", mode: edit.mode ?? "cash", ref_no: edit.ref_no ?? "", narration: edit.narration ?? "" } : undefined}
            submit={<Submit>{edit ? "Save changes" : "Save voucher"}</Submit>} />
        </Card>
      )}

      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <Input label="From" name="from" type="date" defaultValue={from} />
        <Input label="To" name="to" type="date" defaultValue={to} />
        <Select label="Type" name="kind" blank="All" defaultValue={kind} options={[["receipt", "Receipt"], ["payment", "Payment"], ["transfer", "Transfer"]]} />
        <Select label="Status" name="status" blank="All" defaultValue={status} options={[["posted", "Posted"], ["pending", "Waiting approval"], ["rejected", "Rejected"], ["cancelled", "Cancelled"]]} />
        <Select label="Head" name="head" blank="All" defaultValue={head} options={(heads ?? []).map((h) => [h.id, h.name] as [string, string])} />
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Party, number, note" />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>

      {error && <Flash error={`Could not load vouchers: ${error.message}`} />}
      {rows.length ? (
        <Table head={["Voucher", "Date", "Head / books", "Party", "Amount", "Status", ""]} minWidth={900}>
          {rows.map((v) => (
            <tr key={v.id} className={edit?.id === v.id ? "bg-blue-tint" : ""}>
              <td className={td}><b className="font-mono text-[13px] text-ink">{v.no}</b><div className="text-[12px] text-muted">{KIND[v.kind]}{v.created_by_name ? ` · ${v.created_by_name}` : ""}</div></td>
              <td className={`${td} whitespace-nowrap`}>{fmtDate(v.date)}</td>
              <td className={td}>
                {v.head_name ?? "Transfer"}
                <div className="text-[12px] text-muted">{v.kind === "transfer" ? `${v.book_name} → ${v.to_book_name}` : v.book_name}{v.ref_no ? ` · ${v.ref_no}` : ""}</div>
                {v.narration && <div className="text-[12px] text-muted">{v.narration}</div>}
              </td>
              <td className={td}>{v.party ?? "—"}</td>
              <td className={`${td} whitespace-nowrap`}><b className={v.kind === "receipt" ? "text-[#15803d]" : v.kind === "payment" ? "text-error" : "text-ink"}>{money(v.amount)}</b></td>
              <td className={td}>
                <Badge value={STATUS_BADGE[v.status] ?? v.status} text={v.status === "pending" ? "Waiting approval" : v.status[0].toUpperCase() + v.status.slice(1)} />
                {v.decision_note && <div className="mt-1 text-[12px] text-muted">{v.decided_by_name}: {v.decision_note}</div>}
              </td>
              <td className={`${td} text-[13px]`}>
                <div className="flex flex-col gap-1">
                  {v.status === "pending" && can("accounts.vouchers.approve") && (
                    <form action={decideVoucher} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={v.id} /><input type="hidden" name="back" value={here} />
                      <input name="note" placeholder="Note (needed to reject)" className="input !min-h-8 !w-40 !py-1 text-[12px]" />
                      <button name="approve" value="1" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#15803d] underline">Approve</button>
                      <button name="approve" value="0" className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Reject</button>
                    </form>
                  )}
                  {["posted", "pending"].includes(v.status) && can("accounts.vouchers.edit") && (
                    <>
                      <Link href={`/app/accounts/vouchers?edit=${v.id}`}>Edit</Link>
                      <form action={cancelVoucher} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={v.id} /><input type="hidden" name="back" value={here} />
                        <input name="reason" required placeholder="Reason" aria-label="Reason for cancelling" className="input !min-h-8 !w-28 !py-1 text-[12px]" />
                        <button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Cancel</button>
                      </form>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || kind || status || head ? "No voucher matches these filters." : "No vouchers yet."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/accounts/vouchers" params={params} />
    </div>
  );
}
