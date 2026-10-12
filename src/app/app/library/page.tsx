import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { fmtDate, fullName, money, todayIST, waLink } from "@/lib/format";
import { issueBook, renewBook, returnBook } from "../_actions/library";

type Issue = {
  id: string; book_id: string; issued_on: string; due_on: string; returned_on: string | null; fine: number; issued_by_name: string | null;
  library_books: { title: string; accession_no: string | null; author: string | null } | null;
  students: { id: string; first_name: string; last_name: string | null; admission_no: string; guardian_phone: string | null; classes: { name: string } | null; sections: { name: string } | null } | null;
  staff: { id: string; name: string; phone: string | null } | null;
};
const sel = "id,book_id,issued_on,due_on,returned_on,fine,issued_by_name,library_books(title,accession_no,author),students(id,first_name,last_name,admission_no,guardian_phone,classes(name),sections(name)),staff(id,name,phone)";
/** Suggested late fine per day (₹); the librarian can change it on each return. */
const FINE_PER_DAY = 1;

export default async function Library({ searchParams }: { searchParams: Promise<{ book?: string; show?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("library.circulation.view");
  const sp = await searchParams;
  const today = todayIST();
  const overdueOnly = sp.show === "overdue";
  let open = supabase.from("library_issues").select(sel).eq("school_id", school.id).is("returned_on", null).order("due_on").limit(500);
  if (overdueOnly) open = open.lt("due_on", today);
  const [{ data: issues }, { data: returned }, { count: titles }, { data: copies }, { data: staff }, { data: book }] = await Promise.all([
    open,
    supabase.from("library_issues").select(sel).eq("school_id", school.id).not("returned_on", "is", null).order("returned_on", { ascending: false }).limit(15),
    supabase.from("library_books").select("id", { count: "exact", head: true }).eq("school_id", school.id),
    supabase.from("library_books").select("copies").eq("school_id", school.id).limit(20000),
    can("library.circulation.create") ? supabase.from("staff").select("id,name").eq("school_id", school.id).eq("status", "active").order("name") : Promise.resolve({ data: [] }),
    sp.book && /^[0-9a-f-]{36}$/.test(sp.book) ? supabase.from("library_books").select("id,title,accession_no").eq("id", sp.book).eq("school_id", school.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const I = (issues ?? []) as unknown as Issue[];
  const late = (i: Issue) => Math.max(0, Math.round((Date.parse(today) - Date.parse(i.due_on)) / 86400000));
  const overdue = I.filter((i) => i.due_on < today);
  const totalCopies = (copies ?? []).reduce((t, b) => t + Number(b.copies), 0);
  const who = (i: Issue) => i.students
    ? <><Link href={`/app/students/${i.students.id}`} className="font-semibold">{fullName(i.students)}</Link><div className="text-[12px] text-muted">{i.students.admission_no} · {i.students.classes ? `${i.students.classes.name}-${i.students.sections?.name ?? ""}` : ""}</div></>
    : <><b className="text-ink">{i.staff?.name}</b><div className="text-[12px] text-muted">Staff</div></>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="library" title="Library" subtitle="Issue and return books, overdue reminders"
        actions={can("library.catalogue.view") ? <Link href="/app/library/books" className="btn btn-sm btn-secondary">Book catalogue</Link> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Titles" value={titles ?? 0} hint={`${totalCopies} copies`} icon="library" href={can("library.catalogue.view") ? "/app/library/books" : undefined} />
        <Stat label="Issued now" value={overdueOnly ? "—" : I.length} icon="book" tone="cyan" href="/app/library" />
        <Stat label="Overdue" value={overdueOnly ? I.length : overdue.length} icon="notifications" tone={overdue.length || overdueOnly ? "rose" : "green"} href="/app/library?show=overdue" />
        <Stat label="Fines this list" value={money((returned ?? []).reduce((t, r) => t + Number(r.fine), 0))} hint="last 15 returns" icon="fees" tone="amber" />
      </div>

      {can("library.circulation.create") && (
        <Card title="Issue a book" icon="book">
          <form action={issueBook} className="grid gap-3 sm:grid-cols-6">
            {book ? (
              <div className="flex flex-col gap-1 text-[13px] font-semibold text-ink sm:col-span-2">
                Book<input type="hidden" name="book_id" value={book.id} />
                <span className="rounded-lg border border-line bg-blue-soft px-3 py-2 text-[15px] font-normal">{book.title}{book.accession_no ? ` · ${book.accession_no}` : ""} <Link href="/app/library" className="text-[13px]">change</Link></span>
              </div>
            ) : <Input label="Accession no. or ISBN" name="accession_no" required className="sm:col-span-2" hint="Or pick from the catalogue" />}
            <Input label="Student admission no." name="admission_no" />
            <Select label="…or staff member" name="staff_id" blank="—" options={(staff ?? []).map((s) => [s.id, s.name] as [string, string])} />
            <Input label="Days" name="days" type="number" min={1} max={90} defaultValue={14} />
            <div className="flex items-end"><Submit>Issue</Submit></div>
          </form>
        </Card>
      )}

      <Card title={overdueOnly ? `Overdue (${I.length})` : `Books out (${I.length})`} actions={overdueOnly ? <Link href="/app/library" className="text-[14px]">Show all</Link> : undefined}>
        {I.length ? (
          <Table head={["Book", "Borrower", "Issued", "Due", ...(can("library.circulation.edit") ? ["Return"] : []), ""]} minWidth={900}>
            {I.map((i) => {
              const d = late(i);
              const fine = d * FINE_PER_DAY;
              const remind = i.students ? waLink(i.students.guardian_phone, `Dear Parent, the library book “${i.library_books?.title}” issued to ${fullName(i.students)} was due on ${fmtDate(i.due_on)}. Please return it to the school library.\n— ${school.name}`) : null;
              return (
                <tr key={i.id}>
                  <td className={td}><b className="text-ink">{i.library_books?.title}</b><div className="text-[12px] text-muted">{[i.library_books?.accession_no, i.library_books?.author].filter(Boolean).join(" · ")}</div></td>
                  <td className={td}>{who(i)}</td>
                  <td className={td}>{fmtDate(i.issued_on)}</td>
                  <td className={td}>{fmtDate(i.due_on)}{d > 0 && <div><Badge value="overdue" text={`${d} day${d === 1 ? "" : "s"} late`} /></div>}</td>
                  {can("library.circulation.edit") && (
                    <td className={td}>
                      <form action={returnBook} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={i.id} />
                        <label className="text-[12px] text-muted">Fine ₹<input name="fine" type="number" min={0} step="1" defaultValue={fine} className="input ml-1 !min-h-8 w-16 !py-1 text-[14px]" /></label>
                        <Submit>Return</Submit>
                      </form>
                    </td>
                  )}
                  <td className={`${td} whitespace-nowrap text-[13px]`}>
                    {can("library.circulation.edit") && <form action={renewBook}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="due_on" value={i.due_on} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Renew 7 days</button></form>}
                    {d > 0 && remind && <a href={remind} target="_blank" rel="noopener noreferrer" className="mt-1 block">WhatsApp parent</a>}
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>{overdueOnly ? "No overdue books." : "No books are out."}</Empty>}
      </Card>

      {(returned ?? []).length > 0 && (
        <Card title="Recently returned">
          <ul className="m-0 list-none p-0 text-[14px]">
            {((returned ?? []) as unknown as Issue[]).map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-0">
                <span><b className="text-ink">{i.library_books?.title}</b> · {i.students ? fullName(i.students) : i.staff?.name}</span>
                <span className="text-muted">{fmtDate(i.returned_on)}{Number(i.fine) > 0 ? ` · fine ${money(i.fine)}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
