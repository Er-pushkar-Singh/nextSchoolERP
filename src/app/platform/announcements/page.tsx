import { requirePlatform } from "@/lib/platform";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { deleteAnnouncement, saveAnnouncement } from "../_actions/ops";

const toLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 16) : "");

export default async function Announcements({ searchParams }: { searchParams: Promise<{ edit?: string; ok?: string; error?: string }> }) {
  const { supabase, can } = await requirePlatform("announcements");
  const sp = await searchParams;
  const [{ data: rows }, { data: plans }, { data: schools }] = await Promise.all([
    supabase.from("announcements").select("*").order("starts_at", { ascending: false }),
    supabase.from("plans").select("code,name").order("sort"),
    supabase.from("schools").select("id,name").is("archived_at", null).order("name"),
  ]);
  const ed = (rows ?? []).find((r) => r.id === sp.edit);
  const now = new Date().toISOString();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notices" title="Announcements" subtitle="A banner at the top of the school app — maintenance windows, new features, offers, payment reminders." />
      <Flash ok={sp.ok} error={sp.error} />
      {can("announcements", true) && (
        <Card title={ed ? "Edit announcement" : "New announcement"}>
          <form action={saveAnnouncement} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" key={ed?.id ?? "new"}>
            {ed && <input type="hidden" name="id" value={ed.id} />}
            <Input label="Title" name="title" defaultValue={ed?.title} required className="sm:col-span-2" />
            <Select label="Level" name="level" defaultValue={ed?.level ?? "info"} options={[["info", "Info"], ["warning", "Warning"], ["critical", "Critical"]]} />
            <Select label="Who sees it" name="audience" defaultValue={ed?.audience ?? "all"} options={[["all", "All schools"], ["plan", "Schools on these plans"], ["schools", "Chosen schools"]]} />
            <Textarea label="Message" name="body" defaultValue={ed?.body} rows={3} className="sm:col-span-2 lg:col-span-4" />
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Starts (IST)<input type="datetime-local" name="starts_at" defaultValue={toLocal(ed?.starts_at ?? null)} className="input !min-h-10 !py-2 font-normal" /></label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Ends (IST, optional)<input type="datetime-local" name="ends_at" defaultValue={toLocal(ed?.ends_at ?? null)} className="input !min-h-10 !py-2 font-normal" /></label>
            <fieldset className="border-0 p-0 sm:col-span-2"><legend className="mb-1 text-[13px] font-semibold text-ink">Plans (for “Schools on these plans”)</legend>
              <div className="flex flex-wrap gap-x-4">{(plans ?? []).map((p) => <label key={p.code} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="plan_codes" value={p.code} defaultChecked={ed?.plan_codes?.includes(p.code)} /> {p.name}</label>)}</div>
            </fieldset>
            <fieldset className="border-0 p-0 sm:col-span-2 lg:col-span-4"><legend className="mb-1 text-[13px] font-semibold text-ink">Schools (for “Chosen schools”)</legend>
              <div className="flex max-h-32 flex-wrap gap-x-4 overflow-y-auto rounded-lg border border-line p-2">{(schools ?? []).map((s) => <label key={s.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="school_ids" value={s.id} defaultChecked={ed?.school_ids?.includes(s.id)} /> {s.name}</label>)}</div>
            </fieldset>
            <div><Submit>{ed ? "Save" : "Publish"}</Submit></div>
          </form>
        </Card>
      )}
      {(rows ?? []).length ? (rows ?? []).map((a) => {
        const live = a.starts_at <= now && (!a.ends_at || a.ends_at > now);
        return (
          <Card key={a.id} title={a.title} actions={<span className="flex items-center gap-2"><Badge value={a.level === "critical" ? "overdue" : a.level === "warning" ? "due" : "contacted"} text={a.level} /><Badge value={live ? "active" : "draft"} text={live ? "Live" : a.starts_at > now ? "Scheduled" : "Ended"} /></span>}>
            {a.body && <p className="mt-0 text-[14px] whitespace-pre-line">{a.body}</p>}
            <p className="m-0 text-[13px] text-muted">{a.audience === "all" ? "All schools" : a.audience === "plan" ? `Plans: ${a.plan_codes.join(", ")}` : `${a.school_ids.length} school(s)`} · from {new Date(a.starts_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}{a.ends_at ? ` to ${new Date(a.ends_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}</p>
            {can("announcements", true) && <div className="mt-2 flex gap-3 text-[14px]"><a href={`/platform/announcements?edit=${a.id}`}>Edit</a><form action={deleteAnnouncement}><input type="hidden" name="id" value={a.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[14px] text-error underline">Delete</button></form></div>}
          </Card>
        );
      }) : <Empty>No announcements yet.</Empty>}
    </div>
  );
}
