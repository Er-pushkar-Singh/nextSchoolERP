import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { BarChart, Donut, HBars } from "@/components/ui/charts";
import { fmtDate, money, todayIST, waLink } from "@/lib/format";
import { collectLibraryFine, issueBook, renewBook, returnBook } from "../_actions/library";

type Row = {
  id: string; book_id: string; title: string; accession_no: string | null; author: string | null; member_kind: "student" | "staff"; member_id: string; member_name: string; member_sub: string | null;
  phone: string | null; issued_on: string; due_on: string; returned_on: string | null; fine: number; lost: boolean; fine_paid_on: string | null; renewals: number; days_late: number; fine_now: number; total: number;
};
type Dash = { titles: number; copies: number; out: number; overdue: number; due_today: number; fines_pending: number; fines_collected_30: number; reservations: number;
  per_month: { m: string; n: number }[]; top_books: { title: string; n: number }[]; top_classes: { name: string; n: number }[]; by_category: { name: string; n: number }[] };

const STATES = [["out", "Out now"], ["overdue", "Overdue"], ["returned", "Returned"], ["fines", "Fines to collect"], ["all", "Everything"]] as const;

export default async function Library({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("library.circulation.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const state = STATES.some(([k]) => k === sp.state) ? sp.state! : "out";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const member = sp.member === "student" || sp.member === "staff" ? sp.member : null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : null;
  const today = todayIST();

  const [{ data: dash }, { data: rows }] = await Promise.all([
    supabase.rpc("library_dashboard", { sid: school.id }),
    supabase.rpc("library_issue_list", { sid: school.id, p_state: state, p_q: q || null, p_member: member, p_from: from, p_to: to, p_limit: size, p_offset: offset }),
  ]);
  const D = (dash ?? {}) as Dash;
  const R = (rows ?? []) as Row[];
  const total = R[0] ? Number(R[0].total) : 0;
  const params = { state: state === "out" ? undefined : state, q: q || undefined, member: member ?? undefined, from: from ?? undefined, to: to ?? undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `/app/library${qs ? `?${qs}` : ""}`;
  const tabHref = (k: string) => `/app/library${k === "out" ? "" : `?state=${k}`}`;
  const edit = can("library.circulation.edit");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="library" title="Library" subtitle="Issue by scanning the card, return with fine, reservations"
        actions={<>
          {can("library.circulation.create") && (
            <Modal label="+ Issue a book" title="Issue a book">
              <form action={issueBook} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="back" value={back} />
                <EntityPicker kind="book" name="book_id" label="Book (title, author or accession no.)" placeholder="Type at least 2 letters…" className="sm:col-span-2" />
                <Input label="…or scan the accession no. / ISBN" name="accession_no" className="sm:col-span-2" />
                <Input label="Member card code" name="member_code" className="sm:col-span-2" hint="Scan the ID card QR, or type the admission no. / employee code" />
                <EntityPicker kind="student" name="student_id" label="…or find the student" placeholder="Name or admission no." />
                <EntityPicker kind="staff" name="staff_id" label="…or find the staff member" placeholder="Name or employee code" />
                <Input label="Loan days" name="days" type="number" min={1} max={180} hint="Blank = the school's rule" />
                <div className="flex items-end"><Submit>Issue book</Submit></div>
              </form>
            </Modal>
          )}
          {can("library.circulation.create") && <Link href="/app/library/reservations" className="btn btn-sm btn-secondary">Reservations{D.reservations ? ` (${D.reservations})` : ""}</Link>}
          {can("library.catalogue.view") && <Link href="/app/library/books" className="btn btn-sm btn-secondary">Catalogue</Link>}
          {can("library.catalogue.edit") && <Link href="/app/library/settings" className="btn btn-sm btn-secondary">Loan rules</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Titles" value={D.titles ?? 0} hint={`${D.copies ?? 0} copies`} icon="library" href={can("library.catalogue.view") ? "/app/library/books" : undefined} />
        <Stat label="Out now" value={D.out ?? 0} icon="book" tone="cyan" href="/app/library" />
        <Stat label="Due today" value={D.due_today ?? 0} icon="attendance" tone="amber" />
        <Stat label="Overdue" value={D.overdue ?? 0} icon="notifications" tone={D.overdue ? "rose" : "green"} href="/app/library?state=overdue" />
        <Stat label="Fines to collect" value={money(D.fines_pending ?? 0)} icon="fees" tone="violet" href="/app/library?state=fines" />
        <Stat label="Fines, 30 days" value={money(D.fines_collected_30 ?? 0)} icon="revenue" tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Books issued — last 6 months" className="lg:col-span-2">
          <BarChart data={(D.per_month ?? []).map((m) => ({ label: m.m, value: m.n }))} />
        </Card>
        <Card title="What is read (6 months)">
          {(D.by_category ?? []).length ? <Donut size={120} data={(D.by_category ?? []).map((c) => ({ label: c.name, value: c.n }))} /> : <p className="m-0 text-[13px] text-muted">No issues yet.</p>}
        </Card>
        <Card title="Most issued titles">
          <HBars data={(D.top_books ?? []).map((b) => ({ label: b.title, value: b.n }))} />
        </Card>
        <Card title="Classes that read most">
          <HBars color="#16a34a" data={(D.top_classes ?? []).map((b) => ({ label: `Class ${b.name}`, value: b.n }))} />
        </Card>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label="Show">
        {STATES.map(([k, t]) => (
          <Link key={k} href={tabHref(k)} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${state === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{t}</Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-2">
        {state !== "out" && <input type="hidden" name="state" value={state} />}
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Book, author, borrower, admission no." className="input !min-h-10 w-64 !py-2 text-[15px] font-normal" /></label>
        <Select label="Borrower" name="member" blank="Students & staff" defaultValue={member} options={[["student", "Students"], ["staff", "Staff"]]} />
        <Input label="Issued from" name="from" type="date" defaultValue={from} />
        <Input label="to" name="to" type="date" defaultValue={to} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
        {(q || member || from || to) && <Link href={tabHref(state)} className="pb-2 text-[14px]">Clear</Link>}
      </form>

      {R.length ? (
        <Table head={["Book", "Borrower", "Issued", state === "returned" || state === "fines" ? "Returned" : "Due", "Fine", ""]} minWidth={960}>
          {R.map((i) => {
            const open = i.returned_on === null;
            const remind = open && i.days_late > 0 && i.member_kind === "student"
              ? waLink(i.phone, `Dear Parent, the library book “${i.title}” issued to ${i.member_name} was due on ${fmtDate(i.due_on)}. Please return it to the school library.\n— ${school.name}`) : null;
            return (
              <tr key={i.id}>
                <td className={td}><b className="text-ink">{i.title}</b><div className="text-[12px] text-muted">{[i.accession_no, i.author].filter(Boolean).join(" · ")}</div></td>
                <td className={td}>
                  {i.member_kind === "student" ? <Link href={`/app/students/${i.member_id}`} className="font-semibold">{i.member_name}</Link> : <b className="text-ink">{i.member_name}</b>}
                  <div className="text-[12px] text-muted">{i.member_sub}</div>
                </td>
                <td className={td}>{fmtDate(i.issued_on)}{i.renewals > 0 && <div className="text-[12px] text-muted">renewed {i.renewals}×</div>}</td>
                <td className={td}>
                  {open ? <>{fmtDate(i.due_on)}{i.days_late > 0 ? <div><Badge value="overdue" text={`${i.days_late} day${i.days_late === 1 ? "" : "s"} late`} /></div> : i.due_on === today ? <div><Badge value="due" text="Due today" /></div> : null}</>
                    : <>{fmtDate(i.returned_on)}{i.lost && <div><Badge value="lost" text="Lost" /></div>}</>}
                </td>
                <td className={td}>
                  {open ? (i.fine_now > 0 ? <b className="text-error">{money(i.fine_now)}</b> : <span className="text-muted">—</span>)
                    : i.fine > 0 ? <><b className="text-ink">{money(i.fine)}</b><div className="text-[12px] text-muted">{i.fine_paid_on ? `paid ${fmtDate(i.fine_paid_on)}` : "unpaid"}</div></> : <span className="text-muted">—</span>}
                </td>
                <td className={`${td} whitespace-nowrap text-[13px]`}>
                  <div className="flex flex-col items-start gap-1">
                    {open && edit && (
                      <Modal label="Return" variant="link" title={`Return: ${i.title}`} size="sm">
                        <p className="mt-0 text-[13.5px] text-muted">{i.member_name} · due {fmtDate(i.due_on)}{i.days_late > 0 ? ` · ${i.days_late} day(s) late` : ""}</p>
                        <form action={returnBook} className="flex flex-col gap-3">
                          <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={i.id} />
                          <Input label="Fine (₹)" name="fine" type="number" min={0} step="1" defaultValue={i.fine_now} hint="Calculated from the loan rules — change it if needed" />
                          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="lost" /> The book is lost (adds the book&apos;s price, removes one copy)</label>
                          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="waive" /> Waive the fine</label>
                          <Submit>Confirm return</Submit>
                        </form>
                      </Modal>
                    )}
                    {open && edit && <form action={renewBook}><input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={i.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Renew</button></form>}
                    {remind && <a href={remind} target="_blank" rel="noopener noreferrer">WhatsApp parent</a>}
                    {!open && i.fine > 0 && !i.fine_paid_on && edit && (
                      <form action={collectLibraryFine} className="flex items-center gap-1.5">
                        <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={i.id} />
                        <select name="mode" className="input !min-h-8 !py-1 text-[13px]" aria-label="Payment mode"><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select>
                        <button className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#15803d] underline">Collect</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{q || member || from || to ? "No loan matches these filters." : state === "overdue" ? "No overdue books." : state === "out" ? "No books are out." : "Nothing here yet."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/library" params={params} />
    </div>
  );
}
