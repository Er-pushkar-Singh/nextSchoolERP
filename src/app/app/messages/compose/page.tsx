import { requirePerm } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { getClasses } from "@/lib/erp";
import { CHANNELS, CHANNEL_NAME } from "@/lib/messages";
import { composeMessage } from "../../_actions/messages";

export default async function Compose({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("comms.broadcast.create");
  const sp = await searchParams;
  const [classes, { data: eff }] = await Promise.all([getClasses(supabase, school.id), supabase.rpc("effective_integrations", { sid: school.id })]);
  const on = new Set(((eff ?? []) as { provider: string; enabled: boolean }[]).filter((e) => e.enabled).map((e) => e.provider));
  const sections = classes.flatMap((c) => c.sections.map((s) => [s.id, `${c.name}-${s.name}`] as [string, string]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notifications" title="Send a message" subtitle="To parents of a class, the whole school, defaulters, staff or a list of numbers" back={{ href: "/app/messages", label: "Messages" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form action={composeMessage} className="grid gap-4 lg:grid-cols-3">
        <Card title="Message" className="lg:col-span-2">
          <div className="flex flex-col gap-3">
            <Textarea label="Text" name="body" rows={5} placeholder="Tomorrow is a holiday for Diwali. School reopens on Monday." />
            <p className="m-0 text-[12.5px] text-muted">WhatsApp and DLT SMS use provider-approved templates: the text goes into the template variable, so keep it short (under about 160 characters for SMS).</p>
            <Select label="Language of the standard wording" name="language" defaultValue="en" options={[["en", "English"], ["hi", "हिन्दी"]]} />
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Send through">
            <div className="flex flex-col gap-2 text-[14px]">
              {CHANNELS.map((c) => (
                <label key={c} className="flex items-center gap-2"><input type="checkbox" name="channel" value={c} defaultChecked={on.has(c)} disabled={!on.has(c)} /> {CHANNEL_NAME[c]}{!on.has(c) && <span className="text-[12px] text-muted"> — not connected</span>}</label>
              ))}
            </div>
          </Card>
          <Card title="To whom">
            <div className="flex flex-col gap-3">
              <Select label="Audience" name="audience" defaultValue="school" options={[["school", "Whole school — all parents"], ["class", "One class"], ["section", "One section"], ["defaulters", "Parents with overdue fees"], ["staff", "All staff"], ["numbers", "Numbers / emails I type"]]} />
              <Select label="Class" name="class_id" blank="—" options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
              <Select label="Section" name="section_id" blank="—" options={sections} />
              <Textarea label="Numbers or emails (comma or space separated)" name="numbers" rows={3} />
            </div>
          </Card>
          <Card title="When">
            <div className="flex flex-col gap-3">
              <Input label="Schedule for (optional)" name="send_at" type="datetime-local" hint="Blank = now" />
              <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="ignore_quiet" value="1" /> Send even in quiet hours (urgent)</label>
            </div>
          </Card>
          <Submit>Queue the message</Submit>
        </div>
      </form>
    </div>
  );
}
