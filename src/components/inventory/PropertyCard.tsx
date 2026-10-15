import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Card } from "@/components/ui/ui";
import { fmtDate, money } from "@/lib/format";

type A = { id: string; item_name: string; qty: number; tag: string | null; assigned_on: string; due_back: string | null; days_overdue: number };

/** School property a staff member or student holds right now (profile pages). */
export async function PropertyCard({ supabase, sid, kind, id }: { supabase: SupabaseClient; sid: string; kind: "staff" | "student"; id: string }) {
  const { data } = await supabase.rpc("inventory_assignment_list", { sid, p_state: "active", ...(kind === "staff" ? { p_staff: id } : { p_student: id }), p_limit: 50, p_offset: 0 });
  const R = (data ?? []) as A[];
  return (
    <Card title="School property with them" icon="layers" actions={<Link href={`/app/inventory/assignments?${kind}=${id}&state=all`} className="text-[14px] font-semibold">History →</Link>}>
      {R.length ? (
        <ul className="m-0 list-none p-0 text-[14px]">
          {R.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-0">
              <span><b className="text-ink">{r.qty} × {r.item_name}</b>{r.tag ? <span className="text-muted"> · {r.tag}</span> : null}</span>
              <span className="text-muted">since {fmtDate(r.assigned_on)}{r.due_back ? ` · return by ${fmtDate(r.due_back)}` : ""} {r.days_overdue > 0 && <Badge value="overdue" text={`${r.days_overdue} days late`} />}</span>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 text-[14px] text-muted">Nothing is assigned.</p>}
    </Card>
  );
}

type Charge = { id: string; head: string | null; label: string; amount: number; paid: number; balance: number; due_date: string; source: string };
const SOURCE: Record<string, string> = { board: "UP Board", libfine: "Library", disc: "Discipline", asset: "Property", sale: "Shop", hostel: "Hostel", transport: "Transport" };

/** What stands between the student and a Transfer Certificate, and the charges other modules put on the fee account. */
export async function ClearanceCard({ supabase, sid, studentId }: { supabase: SupabaseClient; sid: string; studentId: string }) {
  const [{ data: c }, { data: ch }] = await Promise.all([
    supabase.rpc("student_clearance", { sid, stu: studentId }),
    supabase.rpc("student_charges", { sid, p_student: studentId }),
  ]);
  const cl = (c ?? null) as { owed: number; books_out: number; assets_out: number; hostel_bed: boolean; fees_clear: boolean; mode: string } | null;
  const charges = ((ch ?? []) as Charge[]).slice(0, 12);
  if (!cl) return null;
  return (
    <Card title="Clearance & other charges" icon="fees" description={cl.mode === "all" ? "A Transfer Certificate needs every fee paid (Fee settings)." : "A Transfer Certificate needs every instalment due till today paid (Fee settings)."}>
      <div className="flex flex-wrap gap-2 text-[13.5px]">
        <Badge value={cl.fees_clear ? "done" : "overdue"} text={cl.fees_clear ? "Fees clear" : `Fees pending ${money(cl.owed)}`} />
        <Badge value={cl.books_out ? "high" : "done"} text={cl.books_out ? `${cl.books_out} library book(s) out` : "No library books"} />
        <Badge value={cl.assets_out ? "high" : "done"} text={cl.assets_out ? `${cl.assets_out} school item(s) with the student` : "No school property"} />
        {cl.hostel_bed && <Badge value="high" text="Has a hostel bed" />}
      </div>
      {charges.length > 0 && (
        <ul className="m-0 mt-3 list-none p-0 text-[13.5px]">
          {charges.map((x) => (
            <li key={x.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-1.5">
              <span><Badge value="normal" text={SOURCE[x.source] ?? x.head ?? "Charge"} /> {x.label}</span>
              <span>{Number(x.balance) > 0 ? <b className="text-error">{money(x.balance)} due</b> : <span className="text-muted">paid {money(x.paid)}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
