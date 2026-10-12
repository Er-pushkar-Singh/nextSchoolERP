import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { savePrefs, setModule, updateSchool, uploadLogo } from "../../_actions/settings";
import { DAYS, DEFAULT_PREFS } from "@/lib/prefs";

export default async function SchoolProfile({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("settings.school.view");
  const sp = await searchParams;
  const canEdit = can("settings.school.edit");
  const [{ data: modules }, { data: sm }] = await Promise.all([
    supabase.from("erp_modules").select("code,name,grp,tier,core").order("sort"),
    supabase.from("school_modules").select("module_code,licensed,enabled").eq("school_id", school.id),
  ]);
  const state = new Map((sm ?? []).map((m) => [m.module_code, m]));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="school" title="School profile" subtitle={`Plan: ${school.plan} · up to ${school.student_limit} students`} back={{ href: "/app/settings", label: "Settings centre" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <Card title="Logo & branding" icon="prefs" description="Shown on the sidebar, login page, receipts and report cards.">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex h-24 w-24 flex-none items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-alt">
            {school.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={school.logo_url} alt={`${school.name} logo`} className="h-full w-full object-contain" />
              : <span className="text-[12px] text-muted">No logo</span>}
          </div>
          {canEdit && (
            <div className="flex flex-col gap-2">
              <form action={uploadLogo} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Upload a new logo (PNG, JPG, WebP or SVG, up to 2 MB)
                  <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" required className="text-[14px] font-normal file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-blue-tint file:px-3 file:py-2 file:font-semibold file:text-blue-strong" />
                </label>
                <Submit>Upload</Submit>
              </form>
              {school.logo_url && <form action={uploadLogo}><input type="hidden" name="remove" value="1" /><Submit variant="danger">Remove logo</Submit></form>}
              <p className="m-0 text-[12px] text-muted">Stored in your Cloudinary account (Settings → Integrations), or the shared CodersDuniya one.</p>
            </div>
          )}
        </div>
      </Card>
      {can("settings.school.view") && (
        <Card title="Modules" icon="modules" actions={<span className="text-[13px] text-muted">Licensed by your plan; switch off what your school doesn't use.</span>}>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {(modules ?? []).map((m) => {
              const st = state.get(m.code);
              const on = m.core || (st?.licensed && st?.enabled);
              return (
                <li key={m.code} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[14px]">
                  <span><b className="text-ink">{m.name}</b><span className="block text-[12px] text-muted">{m.grp} · {m.tier}</span></span>
                  {m.core ? <Badge value="active" text="Always on" /> : !st?.licensed ? <Badge value="draft" text="Not in plan" /> : canEdit ? (
                    <form action={setModule}><input type="hidden" name="module" value={m.code} /><input type="hidden" name="on" value={on ? "0" : "1"} />
                      <button className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] font-semibold ${on ? "border-wa bg-wa-tint text-[#0b4f2c]" : "border-line bg-white text-muted"}`}>{on ? "On" : "Off"}</button>
                    </form>
                  ) : <Badge value={on ? "active" : "draft"} text={on ? "On" : "Off"} />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {canEdit && (
        <Card title="School profile, receipts & payments" icon="school">
          <form action={updateSchool} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="School name" name="name" defaultValue={school.name} required className="sm:col-span-2" />
            <Select label="Board" name="board" defaultValue={school.board} options={["CBSE", "ICSE", "UP Board", "State Board", "Other"].map((b) => [b, b] as [string, string])} />
            <Input label="Principal" name="principal_name" defaultValue={school.principal_name} />
            <Input label="Address" name="address" defaultValue={school.address} className="sm:col-span-2" />
            <Input label="City" name="city" defaultValue={school.city} />
            <Input label="PIN code" name="pincode" defaultValue={school.pincode} />
            <Input label="State" name="state" defaultValue={school.state} />
            <Input label="Phone" name="phone" defaultValue={school.phone} />
            <Input label="Email" name="email" type="email" defaultValue={school.email} />
            <Input label="UDISE code" name="udise_code" defaultValue={school.udise_code} />
            <Input label="Affiliation no." name="affiliation_no" defaultValue={school.affiliation_no} />
            <Input label="UPI ID (for parent payments)" name="upi_id" defaultValue={school.upi_id} placeholder="school@okhdfcbank" className="sm:col-span-2" hint="Parents get a UPI pay button. Payments go straight to your bank; you still record them here." />
            <Input label="Late fine per day (₹)" name="late_fine_per_day" type="number" step="1" min={0} defaultValue={school.late_fine_per_day} />
            <Input label="Receipt prefix" name="receipt_prefix" defaultValue={school.receipt_prefix} />
            <Input label="Next receipt no." name="next_receipt_no" type="number" min={1} defaultValue={(school as unknown as { next_receipt_no: number }).next_receipt_no} />
            <Input label="Admission no. prefix" name="admission_prefix" defaultValue={school.admission_prefix} />
            <Input label="Next admission no." name="next_admission_no" type="number" min={1} defaultValue={(school as unknown as { next_admission_no: number }).next_admission_no} />
            <Textarea label="Bank details (shown to parents)" name="bank_details" defaultValue={school.bank_details} className="sm:col-span-2" rows={2} />
            <Textarea label="WhatsApp message signature" name="whatsapp_footer" defaultValue={school.whatsapp_footer} className="sm:col-span-2" rows={2} placeholder={`— Accounts Office, ${school.name}`} />
            <div><Submit>Save</Submit></div>
          </form>
        </Card>
        )}
      <Card title="Regional preferences" icon="prefs" description="Dates, working days and quiet hours for automatic messages." className="scroll-mt-24">
        <form id="preferences" action={savePrefs} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Date format" name="date_format" defaultValue={school.prefs?.date_format ?? DEFAULT_PREFS.date_format} options={[["DD/MM/YYYY", "31/12/2026"], ["DD-MMM-YYYY", "31-Dec-2026"], ["YYYY-MM-DD", "2026-12-31"]]} />
          <Select label="Week starts on" name="week_start" defaultValue={school.prefs?.week_start ?? DEFAULT_PREFS.week_start} options={[["mon", "Monday"], ["sun", "Sunday"]]} />
          <Select label="Messages language" name="language" defaultValue={school.prefs?.language ?? DEFAULT_PREFS.language} options={[["en", "English"], ["hi", "हिन्दी (Hindi)"]]} />
          <div className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Time zone<span className="input !min-h-10 !py-2 bg-surface-alt text-[15px] font-normal">India (IST, UTC+5:30)</span></div>
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0 sm:col-span-2">
            <legend className="mb-1 text-[13px] font-semibold text-ink">Working days</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(([n, l]) => (
                <label key={n} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[14px] has-[:checked]:border-blue has-[:checked]:bg-blue-soft has-[:checked]:text-blue-strong">
                  <input type="checkbox" name="working_days" value={n} defaultChecked={(school.prefs?.working_days ?? [...DEFAULT_PREFS.working_days] as number[]).includes(n)} disabled={!canEdit} className="accent-[#2563eb]" />{l}
                </label>
              ))}
            </div>
          </fieldset>
          <Input label="Quiet hours from" name="quiet_from" type="time" defaultValue={school.prefs?.quiet_from ?? DEFAULT_PREFS.quiet_from} hint="No automatic SMS / WhatsApp" />
          <Input label="Quiet hours until" name="quiet_to" type="time" defaultValue={school.prefs?.quiet_to ?? DEFAULT_PREFS.quiet_to} />
          {canEdit && <div className="sm:col-span-2 lg:col-span-4"><Submit>Save preferences</Submit></div>}
        </form>
      </Card>
    </div>
  );
}
