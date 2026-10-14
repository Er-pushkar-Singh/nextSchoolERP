import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { fmtDate, money } from "@/lib/format";
import { saveAccountSettings, saveBook, saveHead, toggleBook, toggleHead } from "../../_actions/accounts";

export default async function AccountSetup({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("accounts.vouchers.view", "accounts.books.view");
  const sp = await searchParams;
  await supabase.rpc("ensure_account_defaults", { sid: school.id });
  const [{ data: heads }, { data: books }, { data: cfg }] = await Promise.all([
    supabase.from("account_heads").select("id,name,kind,active").eq("school_id", school.id).order("kind").order("name"),
    supabase.from("account_books").select("*").eq("school_id", school.id).order("created_at"),
    supabase.from("account_settings").select("approval_above").eq("school_id", school.id).maybeSingle(),
  ]);
  const edit = can("accounts.vouchers.edit");
  const small = "cursor-pointer border-0 bg-transparent p-0 text-[13px] underline";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="revenue" title="Accounts setup" subtitle="Books, income and expense heads, approval limit" back={{ href: "/app/accounts", label: "Accounts" }} />
      <Flash ok={sp.ok} error={sp.error} />

      <Card title="Cash & bank books" description="Opening balance counts from its date. Fee money lands in the first cash book (cash) and the first bank book (everything else).">
        <Table head={["Book", "Type", "Opening balance", "Opening date", ""]} minWidth={640}>
          {(books ?? []).map((b) => (
            <tr key={b.id}>
              <td className={td}><b className="text-ink">{b.name}</b>{b.account_no ? <div className="text-[12px] text-muted">{b.account_no}</div> : null}{!b.active && <Badge value="muted" text="Closed" />}</td>
              <td className={`${td} capitalize`}>{b.kind}</td>
              <td className={td}>{money(b.opening_balance)}</td>
              <td className={td}>{fmtDate(b.opening_date)}</td>
              <td className={td}>
                {edit && (
                  <div className="flex flex-col gap-2">
                    <form action={saveBook} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={b.id} /><input type="hidden" name="name" value={b.name} /><input type="hidden" name="account_no" value={b.account_no ?? ""} />
                      <Input label="Opening ₹" name="opening_balance" defaultValue={String(b.opening_balance)} className="w-28" />
                      <Input label="As on" name="opening_date" type="date" defaultValue={b.opening_date} />
                      <button className="btn btn-sm btn-secondary cursor-pointer">Save</button>
                    </form>
                    <form action={toggleBook}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="active" value={b.active ? "0" : "1"} /><button className={`${small} text-blue`}>{b.active ? "Close this book" : "Reopen"}</button></form>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {edit && (
          <form action={saveBook} className="mt-4 grid items-end gap-3 sm:grid-cols-5">
            <Input label="New book" name="name" required placeholder="SBI current account" />
            <Select label="Type" name="kind" defaultValue="bank" options={[["bank", "Bank"], ["cash", "Cash"]]} />
            <Input label="Account no. (optional)" name="account_no" />
            <Input label="Opening ₹" name="opening_balance" defaultValue="0" />
            <Input label="As on" name="opening_date" type="date" />
            <div className="sm:col-span-5"><Submit>Add book</Submit></div>
          </form>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {(["income", "expense"] as const).map((k) => (
          <Card key={k} title={k === "income" ? "Income heads" : "Expense heads"}>
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0 text-[14px]">
              {(heads ?? []).filter((h) => h.kind === k).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                  <span className={h.active ? "text-ink" : "text-muted line-through"}>{h.name}</span>
                  {edit && <form action={toggleHead}><input type="hidden" name="id" value={h.id} /><input type="hidden" name="active" value={h.active ? "0" : "1"} /><button className={`${small} text-blue`}>{h.active ? "Hide" : "Show"}</button></form>}
                </li>
              ))}
            </ul>
            {edit && (
              <form action={saveHead} className="mt-3 flex items-end gap-2">
                <input type="hidden" name="kind" value={k} />
                <Input label="New head" name="name" required className="flex-1" />
                <button className="btn btn-sm btn-secondary cursor-pointer">Add</button>
              </form>
            )}
          </Card>
        ))}
      </div>

      <Card title="Approval" description="Payments and receipts above this amount, entered by someone who cannot approve, wait for a principal / approver. 0 means no approval.">
        <form action={saveAccountSettings} className="flex flex-wrap items-end gap-3">
          <Input label="Approval needed above (₹)" name="approval_above" defaultValue={String(cfg?.approval_above ?? 0)} />
          {edit && <Submit>Save</Submit>}
        </form>
      </Card>
    </div>
  );
}
