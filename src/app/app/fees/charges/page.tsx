import { requirePerm } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Select, Submit } from "@/components/ui/ui";
import { classOptions, getClasses, sectionOptions } from "@/lib/erp";
import { addDays, todayIST } from "@/lib/format";
import { addCharge, carryForward, runLateFines } from "../../_actions/fees2";

export default async function Charges({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, session } = await requirePerm("fees.dues.create");
  const sp = await searchParams;
  const [classes, { data: heads }, { data: sessions }, { data: st }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("fee_heads").select("id,name").eq("school_id", school.id).order("sort"),
    supabase.from("sessions").select("id,name,is_current").eq("school_id", school.id).order("start_date", { ascending: false }),
    supabase.from("fee_settings").select("fine_enabled").eq("school_id", school.id).maybeSingle(),
  ]);
  const today = todayIST();
  const sessOpts = (sessions ?? []).map((s) => [s.id, s.name + (s.is_current ? " (current)" : "")] as [string, string]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Charges, fines & carry-forward" subtitle={`Session ${session?.name ?? "—"}`} back={{ href: "/app/fees", label: "Fees" }} />
      <Flash ok={sp.ok} error={sp.error} />

      <Card title="Add a one-time charge" description="Exam fee, picnic, uniform, lost book… to a whole class or section.">
        <form action={addCharge} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Label" name="label" required placeholder="Annual day fee" />
          <Select label="Fee head" name="fee_head_id" blank="No head" options={(heads ?? []).map((h) => [h.id, h.name] as [string, string])} />
          <Input label="Amount (₹)" name="amount" type="number" step="0.01" min={0} required />
          <Input label="Due date" name="due_date" type="date" defaultValue={addDays(today, 15)} required />
          <Select label="Class" name="class_id" blank="Choose class" options={classOptions(classes)} />
          <Select label="Section" name="section_id" blank="All sections" options={sectionOptions(classes)} />
          <div className="flex items-end sm:col-span-2"><Submit>Add charge</Submit></div>
        </form>
        <p className="mt-3 mb-0 text-[13px] text-muted">Charged to every active student of the class (or section). Waive it for exceptions with <b>Adjust an instalment</b> on the collect screen.</p>
      </Card>

      <Card title="Late fine" description={st?.fine_enabled ? "The rule in Fee settings is applied to every overdue instalment." : "Switch the late fine on in Fee settings first."}>
        <form action={runLateFines}><Submit>Update late fines up to today</Submit></form>
        <p className="mt-3 mb-0 text-[13px] text-muted">Fines also update automatically whenever a payment is received. Running this is safe any number of times.</p>
      </Card>

      <Card title="Carry arrears to the next session" description="Unpaid balances of the old session become one “Arrears” instalment in the new one; the old balance is closed.">
        <form action={carryForward} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="From session" name="from_session" options={sessOpts} />
          <Select label="To session" name="to_session" options={sessOpts} />
          <Input label="Arrears due on" name="due_date" type="date" defaultValue={addDays(today, 30)} required />
          <div className="flex items-end"><Submit>Carry forward</Submit></div>
        </form>
      </Card>
    </div>
  );
}
