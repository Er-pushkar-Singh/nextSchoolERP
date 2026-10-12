import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Stat, Submit, Textarea } from "@/components/ui/ui";
import { CopyButton } from "@/components/CopyButton";
import { appUrl } from "@/lib/brand";
import { getClasses } from "@/lib/erp";
import { waLink } from "@/lib/format";
import { saveOnlineSettings } from "../../_actions/online-admission";

export default async function OnlineAdmission({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, session, can } = await requirePerm("frontdesk.online_form.view");
  const sp = await searchParams;
  const [{ data: st }, classes, { count: total }, { count: fresh }] = await Promise.all([
    supabase.from("online_admission_settings").select("*").eq("school_id", school.id).maybeSingle(),
    getClasses(supabase, school.id),
    supabase.from("admission_applications").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("source", "Online"),
    supabase.from("admission_applications").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("source", "Online").eq("status", "submitted"),
  ]);
  const edit = can("frontdesk.online_form.edit");
  const link = appUrl(`/apply/${school.code}`);
  const chosen = new Set<string>(st?.class_ids ?? []);
  const msg = `${school.name} — online admission${session ? ` ${session.name}` : ""}. Apply here: ${link}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Online admission form" subtitle="Parents fill the application themselves — no login. It lands in Admission applications." back={{ href: "/app/admissions/applications", label: "Applications" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Status" value={st?.enabled ? "Open" : "Closed"} icon="admissions" tone={st?.enabled ? "green" : "rose"} />
        <Stat label="Online applications" value={total ?? 0} icon="layers" tone="cyan" href="/app/admissions/applications?source=Online" />
        <Stat label="Not yet reviewed" value={fresh ?? 0} icon="notifications" tone={fresh ? "amber" : "green"} href="/app/admissions/applications?source=Online&status=submitted" />
      </div>

      <Card title="Share with parents" icon="school">
        <p className="mt-0 mb-2 font-mono text-[14px] break-all">{link}</p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton text={link} label="Copy link" />
          <a href={waLink("", msg) ?? `https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-wa">Share on WhatsApp</a>
          <Link href={`/apply/${school.code}`} target="_blank" className="btn btn-sm btn-secondary">Preview the form</Link>
        </div>
        <p className="mt-3 mb-0 text-[13px] text-muted">Put this link (or a QR code of it) on the school website, banner and WhatsApp groups. Parents can track their application at <span className="font-mono">/apply/{school.code}/track</span>.</p>
      </Card>

      <Card title="Settings" icon="settings">
        <form action={saveOnlineSettings} className="flex flex-col gap-4">
          <fieldset disabled={!edit} className="m-0 flex flex-col gap-4 border-0 p-0">
            <label className="flex items-center gap-2 text-[15px] font-semibold text-ink"><input type="checkbox" name="enabled" value="1" defaultChecked={st?.enabled} className="h-4 w-4" /> Online admission is open</label>
            <div>
              <p className="m-0 mb-1 text-[13px] font-semibold text-ink">Classes open for online applications <span className="font-normal text-muted">(none ticked = all classes)</span></p>
              <div className="flex flex-wrap gap-3">
                {classes.map((c) => <label key={c.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="class_ids" value={c.id} defaultChecked={chosen.has(c.id)} className="h-4 w-4" /> Class {c.name}</label>)}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Last date to apply" name="closes_on" type="date" defaultValue={st?.closes_on} />
              <label className="flex items-center gap-2 pt-6 text-[14px] text-ink"><input type="checkbox" name="ask_documents" value="1" defaultChecked={st?.ask_documents ?? true} className="h-4 w-4" /> Ask parents to upload documents</label>
            </div>
            <Textarea label="Welcome message (shown above the form)" name="intro" defaultValue={st?.intro} rows={2} />
            <Textarea label="Instructions / eligibility (age, documents to bring…)" name="instructions" defaultValue={st?.instructions} rows={3} />
            <Textarea label="Fee / registration note" name="fee_note" defaultValue={st?.fee_note} rows={2} />
          </fieldset>
          {edit && <div><Submit>Save</Submit></div>}
        </form>
      </Card>
      <p className="m-0 text-[13px] text-muted">Safeguards: a hidden trap field, a minimum fill time, 5 forms per hour per network and 4 per day per mobile number, and a duplicate check on name + date of birth + father. Aadhaar is never asked online; staff record it in person with consent.</p>
    </div>
  );
}
