import { requirePerm } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Submit } from "@/components/ui/ui";
import { saveLibrarySettings } from "../../_actions/library";

type Cfg = { loan_days_student: number; loan_days_staff: number; max_books_student: number; max_books_staff: number; fine_per_day: number; grace_days: number; max_renewals: number; renew_days: number; block_when_overdue: boolean };
const DEFAULTS: Cfg = { loan_days_student: 14, loan_days_staff: 30, max_books_student: 3, max_books_staff: 5, fine_per_day: 1, grace_days: 0, max_renewals: 2, renew_days: 7, block_when_overdue: true };

export default async function LibrarySettings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("library.catalogue.edit");
  const sp = await searchParams;
  const { data } = await supabase.from("library_settings").select("*").eq("school_id", school.id).maybeSingle();
  const c: Cfg = { ...DEFAULTS, ...((data as Cfg | null) ?? {}) };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="library" title="Loan rules" subtitle="How long a book stays out, how many a member may hold, and the late fine" back={{ href: "/app/library", label: "Library" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form action={saveLibrarySettings} className="grid gap-4 lg:grid-cols-2">
        <Card title="Students">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Loan period (days)" name="loan_days_student" type="number" min={1} max={90} defaultValue={c.loan_days_student} />
            <Input label="Books at a time" name="max_books_student" type="number" min={1} max={20} defaultValue={c.max_books_student} />
          </div>
        </Card>
        <Card title="Staff">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Loan period (days)" name="loan_days_staff" type="number" min={1} max={180} defaultValue={c.loan_days_staff} />
            <Input label="Books at a time" name="max_books_staff" type="number" min={1} max={40} defaultValue={c.max_books_staff} />
          </div>
        </Card>
        <Card title="Late fine" description="Calculated when a book comes back; the librarian can still change or waive it.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Fine per day (₹)" name="fine_per_day" type="number" min={0} step="0.5" defaultValue={c.fine_per_day} />
            <Input label="Grace days (no fine)" name="grace_days" type="number" min={0} max={14} defaultValue={c.grace_days} />
          </div>
        </Card>
        <Card title="Renewals & blocking">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Renewals allowed" name="max_renewals" type="number" min={0} max={10} defaultValue={c.max_renewals} />
            <Input label="Each renewal adds (days)" name="renew_days" type="number" min={1} max={60} defaultValue={c.renew_days} />
          </div>
          <label className="mt-3 flex items-center gap-2 text-[14px]"><input type="checkbox" name="block_when_overdue" defaultChecked={c.block_when_overdue} /> Do not issue a new book while the member has an overdue one</label>
        </Card>
        <div className="lg:col-span-2"><Submit>Save loan rules</Submit></div>
      </form>
    </div>
  );
}
