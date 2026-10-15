import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { CHANNELS, CHANNEL_NAME, EVENTS, render, type Lang, type MsgEvent } from "@/lib/messages";
import { saveTemplate } from "../../_actions/messages";

const SAMPLE: Record<string, string> = {
  student: "Aarav Sharma", amount: "2,500", receipt_no: "R-1042", balance: "5,000", school: "Sunrise Public School", due_date: "10 Oct 2026", link: "https://…/p/abc123",
  class: "5-A", date: "15 Oct 2026", exam: "Half-yearly", title: "Winter uniform", body: "Winter uniform from 1 November.", admission_no: "2026-0152",
};
type Row = { event: string; channel: string; language: string; subject: string | null; body: string; provider_template: string | null; active: boolean };

export default async function Templates({ searchParams }: { searchParams: Promise<{ event?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("comms.templates.view");
  const sp = await searchParams;
  const events = Object.entries(EVENTS).filter(([, d]) => !d.platform) as [MsgEvent, (typeof EVENTS)[MsgEvent]][];
  const cur = (events.find(([k]) => k === sp.event) ?? events[0])[0];
  const def = EVENTS[cur];
  const { data } = await supabase.from("message_templates").select("event,channel,language,subject,body,provider_template,active").eq("school_id", school.id).eq("event", cur);
  const rows = (data ?? []) as Row[];
  const get = (ch: string, lang: Lang) => rows.find((r) => r.channel === ch && r.language === lang);
  const canEdit = can("comms.templates.edit") || can("comms.templates.create");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notifications" title="Message templates" subtitle="The wording of each automatic message, per channel and language" back={{ href: "/app/messages", label: "Messages" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="flex flex-wrap gap-1.5" aria-label="Event">
        {events.map(([k, d]) => (
          <Link key={k} href={`/app/messages/templates?event=${k}`} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${k === cur ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{d.name}</Link>
        ))}
      </nav>
      <p className="m-0 rounded-[12px] border border-line bg-blue-soft px-4 py-3 text-[13.5px]">
        Placeholders for <b>{def.name}</b>: {def.vars.map((v) => <code key={v} className="mx-0.5 rounded bg-white px-1.5 py-0.5 text-[12.5px]">{`{{${v}}}`}</code>)}.
        {" "}For <b>SMS</b> the text is only a preview — a DLT SMS is sent through its approved flow template, whose variables are filled in the order shown above.
        For <b>WhatsApp</b> enter the approved template name (optionally <code>name:hi</code> for a language code).
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {CHANNELS.flatMap((ch) => (["en", "hi"] as Lang[]).map((lang) => {
          const mine = get(ch, lang);
          return (
            <Card key={`${ch}-${lang}`} title={`${CHANNEL_NAME[ch]} · ${lang === "en" ? "English" : "हिन्दी"}`} actions={<Badge value={mine ? "info" : "muted"} text={mine ? "Your wording" : "Standard"} />}>
              <form action={saveTemplate} className="flex flex-col gap-2.5">
                <input type="hidden" name="event" value={cur} /><input type="hidden" name="channel" value={ch} /><input type="hidden" name="language" value={lang} />
                {ch === "email" && <Input label="Subject" name="subject" defaultValue={mine?.subject ?? def.subject[lang]} />}
                <Textarea label="Message" name="body" rows={4} defaultValue={mine?.body ?? def.text[lang]} />
                {ch !== "email" && <Input label={ch === "sms" ? "DLT flow / template ID (optional — else the one in Integrations)" : "Approved WhatsApp template name"} name="provider_template" defaultValue={mine?.provider_template} />}
                <p className="m-0 rounded-lg bg-[#f6f8fc] px-3 py-2 text-[13px] text-body"><span className="text-muted">Preview: </span>{render(mine?.body ?? def.text[lang], SAMPLE)}</p>
                {canEdit && (
                  <div className="flex items-center gap-3">
                    <Submit>Save</Submit>
                    {mine && <button name="reset" value="1" className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Use the standard wording</button>}
                  </div>
                )}
              </form>
            </Card>
          );
        }))}
      </div>
    </div>
  );
}
