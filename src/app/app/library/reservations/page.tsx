import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { fmtDate } from "@/lib/format";
import { cancelReservation, reserveBook } from "../../_actions/library";

type Res = {
  id: string; created_at: string; notified_at: string | null;
  book: { title: string; accession_no: string | null } | { title: string; accession_no: string | null }[] | null;
  student: { first_name: string; last_name: string | null; admission_no: string } | { first_name: string; last_name: string | null; admission_no: string }[] | null;
  staff: { name: string } | { name: string }[] | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function Reservations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("library.circulation.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const { data, count } = await supabase.from("library_reservations")
    .select("id,created_at,notified_at,book:library_books(title,accession_no),student:students(first_name,last_name,admission_no),staff(name)", { count: "exact" })
    .eq("school_id", school.id).eq("status", "active").order("created_at").range(offset, offset + size - 1);
  const R = (data ?? []) as unknown as Res[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="library" title="Reservations" subtitle="Members waiting for a title — the next free copy is kept for them" back={{ href: "/app/library", label: "Library" }}
        actions={can("library.circulation.create") ? (
          <Modal label="+ Reserve a book" title="Reserve a book" size="sm">
            <form action={reserveBook} className="flex flex-col gap-3">
              <EntityPicker kind="book" name="book_id" label="Book" required />
              <EntityPicker kind="student" name="student_id" label="Student" />
              <EntityPicker kind="staff" name="staff_id" label="…or staff member" />
              <Submit>Reserve</Submit>
            </form>
          </Modal>
        ) : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      {R.length ? (
        <Table head={["Book", "Member", "Waiting since", "Status", ""]} minWidth={720}>
          {R.map((r) => {
            const b = one(r.book), s = one(r.student), t = one(r.staff);
            return (
              <tr key={r.id}>
                <td className={td}><b className="text-ink">{b?.title}</b><div className="text-[12px] text-muted">{b?.accession_no}</div></td>
                <td className={td}>{s ? `${s.first_name} ${s.last_name ?? ""}`.trim() : t?.name}<div className="text-[12px] text-muted">{s ? s.admission_no : "Staff"}</div></td>
                <td className={td}>{fmtDate(r.created_at.slice(0, 10))}</td>
                <td className={td}>{r.notified_at ? <Badge value="active" text="Copy is back — tell the member" /> : <Badge value="pending" text="Waiting" />}</td>
                <td className={`${td} text-[13px]`}>
                  {can("library.circulation.edit") && (
                    <form action={cancelReservation}><input type="hidden" name="id" value={r.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Cancel</button></form>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No active reservations.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/library/reservations" params={{}} />
    </div>
  );
}
