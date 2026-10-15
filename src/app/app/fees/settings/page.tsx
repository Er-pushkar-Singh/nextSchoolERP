import { requirePerm } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Select, Submit } from "@/components/ui/ui";
import { FINE_MODES } from "@/lib/fees";
import { appUrl } from "@/lib/brand";
import { resolveIntegration } from "@/lib/integrations";
import { saveFeeSettings } from "../../_actions/fees2";

const Check = ({ name, label, hint, on }: { name: string; label: string; hint?: string; on: boolean }) => (
  <label className="flex items-start gap-2 text-[14px]">
    <input type="checkbox" name={name} defaultChecked={on} className="mt-1" />
    <span><b className="text-ink">{label}</b>{hint && <span className="block text-[13px] text-muted">{hint}</span>}</span>
  </label>
);

export default async function FeeSettings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("fees.structure.view");
  const sp = await searchParams;
  const { data: s } = await supabase.from("fee_settings").select("*").eq("school_id", school.id).maybeSingle();
  const { data: heads } = await supabase.from("fee_heads").select("id,name").eq("school_id", school.id).order("sort");
  const rz = await resolveIntegration(school.id, "razorpay");
  const ownRazorpay = rz?.source === "school";
  const editable = can("fees.structure.edit");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="fees" title="Fee settings" subtitle="Late fine, approvals, advance, online payment" back={{ href: "/app/fees", label: "Fees" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form action={saveFeeSettings} className="flex flex-col gap-5">
        <Card title="Late fine" description="Added automatically to overdue instalments; the principal can waive it with a reason.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4"><Check name="fine_enabled" label="Charge a late fine" on={!!s?.fine_enabled} /></div>
            <Select label="How it is charged" name="fine_mode" options={FINE_MODES} defaultValue={s?.fine_mode ?? "per_day"} />
            <Input label="Amount (₹)" name="fine_amount" type="number" step="0.01" min={0} defaultValue={s?.fine_amount ?? 0} />
            <Input label="Grace days" name="fine_grace_days" type="number" step="1" min={0} defaultValue={s?.fine_grace_days ?? 0} hint="No fine until this many days after the due date" />
            <Input label="Maximum per instalment (₹)" name="fine_cap" type="number" step="0.01" min={0} defaultValue={s?.fine_cap ?? 0} hint="0 = no limit" />
          </div>
        </Card>

        <Card title="Rules">
          <div className="grid gap-4">
            <Check name="concession_approval" label="Concessions need the principal's approval" hint="A concession entered by an accountant waits as “pending” and is billed only after approval." on={!!s?.concession_approval} />
            <Check name="advance_allowed" label="Accept more than the amount due (kept as advance)" hint="Off: a payment larger than the dues is refused." on={s?.advance_allowed ?? true} />
            <div className="max-w-xs"><Input label="Bank charge for a bounced cheque (₹)" name="bounce_charge" type="number" step="0.01" min={0} defaultValue={s?.bounce_charge ?? 0} /></div>
            <div className="max-w-md"><Select label="Transfer Certificate needs" name="tc_clearance" defaultValue={(s as { tc_clearance?: string } | null)?.tc_clearance ?? "all"} options={[["all", "Every fee of the student paid (full fee)"], ["due_till_today", "Every instalment due till today paid"]]} /></div>
            <Input label="Receipt footer" name="receipt_footer" defaultValue={s?.receipt_footer} hint="Printed at the bottom of every receipt, e.g. “Fees once paid are not refundable.”" />
          </div>
        </Card>

        <Card title="Sibling discount" description="Applied automatically to the second and later children of a family (same parent phone, or same father and mother) when they are admitted, or with one click on the collect screen.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Discount (%)" name="sibling_percent" type="number" step="0.5" min={0} max={100} defaultValue={s?.sibling_percent ?? 0} hint="0 = no sibling discount" />
            <Select label="On which fee" name="sibling_head_id" blank="All fees" defaultValue={s?.sibling_head_id ?? ""} options={(heads ?? []).map((h) => [h.id, h.name] as [string, string])} />
          </div>
        </Card>

        <Card title="Online payment by parents" description="Parents pay from their page, and staff can generate a payment link or take a payment through the gateway at the counter. The receipt is created automatically when Razorpay confirms.">
          <div className="grid gap-4">
            <Check name="online_enabled" label="Allow online payment" on={!!s?.online_enabled} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input label="Minimum payment (₹)" name="online_min_amount" type="number" step="1" min={0} defaultValue={s?.online_min_amount ?? 1} />
              <div className="sm:col-span-2 flex items-end"><Check name="online_allow_partial" label="Allow part payment" on={s?.online_allow_partial ?? true} /></div>
            </div>
            <div className="rounded-[10px] bg-surface p-3 text-[13px]">
              <p className="m-0"><b className="text-ink">Razorpay account:</b> {ownRazorpay ? "connected (the school's own account)" : "not connected — add the school's Razorpay keys in Settings → Integrations. Money goes straight to the school; the platform's account is never used for fees."}</p>
              <p className="mt-2 mb-0">In Razorpay → Webhooks add <code className="break-all">{appUrl("/api/razorpay/fees")}</code>, event <b>payment_link.paid</b>, and paste the same secret into the integration&apos;s “Webhook secret”.</p>
            </div>
          </div>
        </Card>
        {editable ? <div><Submit>Save settings</Submit></div> : <p className="m-0 text-[13px] text-muted">You can view these settings but not change them.</p>}
      </form>
    </div>
  );
}
