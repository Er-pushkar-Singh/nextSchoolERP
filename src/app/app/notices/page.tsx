import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { CopyButton } from "@/components/CopyButton";
import { fmtDate, todayIST } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { deleteNotice, saveNotice } from "../_actions/academics";

export default async function Notices({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("comms.notices.view");
  const sp = await searchParams;
  const [classes, { data }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("notices").select("id,title,body,class_id,published_on,created_by,classes(name)").eq("school_id", school.id).order("published_on", { ascending: false }).limit(100),
  ]);
  const canWrite = can("comms.notices.create");
  const rows = (data ?? []) as unknown as { id: string; title: string; body: string | null; published_on: string; created_by: string | null; classes: { name: string } | null }[];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="notices" title="Notices" subtitle="Shown on every parent's page (or only the chosen class)" />
      <Flash ok={sp.ok} error={sp.error} />
      {canWrite && (
        <Card title="New notice">
          <form action={saveNotice} className="grid gap-3 sm:grid-cols-3">
            <Input label="Title" name="title" required className="sm:col-span-2" placeholder="School closed on Monday" />
            <Select label="For" name="class_id" blank="Whole school" options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
            <Textarea label="Details" name="body" rows={4} className="sm:col-span-3" />
            <Input label="Date" name="published_on" type="date" defaultValue={todayIST()} />
            <div className="flex items-end"><Submit>Publish</Submit></div>
          </form>
        </Card>
      )}
      {rows.length ? rows.map((n) => (
        <Card key={n.id} title={n.title} actions={<span className="text-[13px] text-muted">{fmtDate(n.published_on)} · {n.classes ? `Class ${n.classes.name}` : "Whole school"}</span>}>
          {n.body && <p className="mt-0 whitespace-pre-line text-[15px]">{n.body}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <CopyButton text={`*${n.title}*\n${n.body ?? ""}\n— ${school.name}`} label="Copy for WhatsApp group" />
            {can("comms.notices.delete") && <form action={deleteNotice}><input type="hidden" name="id" value={n.id} /><button className="cursor-pointer border-0 bg-transparent text-[13px] text-error underline">Delete</button></form>}
          </div>
        </Card>
      )) : <Empty>No notices yet.</Empty>}
    </div>
  );
}
