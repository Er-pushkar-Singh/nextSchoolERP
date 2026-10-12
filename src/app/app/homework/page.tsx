import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { ClassSection } from "@/components/ClassSection";
import { CopyButton } from "@/components/CopyButton";
import { fmtDate, todayIST } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { deleteHomework, saveHomework } from "../_actions/homework";

type Row = {
  id: string; kind: "homework" | "material"; class_id: string; section_id: string | null; subject_id: string | null; title: string; details: string | null;
  link_url: string | null; assigned_on: string; due_on: string | null; created_by_name: string | null;
  classes: { name: string } | null; sections: { name: string } | null; subjects: { name: string } | null;
};

export default async function Homework({ searchParams }: { searchParams: Promise<{ kind?: string; class_id?: string; section_id?: string; edit?: string; ok?: string; error?: string }> }) {
  const { supabase, school, user, can, scope } = await requirePerm("homework.homework.view", "homework.material.view");
  const sp = await searchParams;
  const kinds = (["homework", "material"] as const).filter((k) => can(`homework.${k}.view`));
  const kind = kinds.includes(sp.kind as "homework") ? (sp.kind as "homework" | "material") : kinds[0];
  const isUuid = (v?: string) => !!v && /^[0-9a-f-]{36}$/.test(v);
  const today = todayIST();

  let q = supabase.from("homework")
    .select("id,kind,class_id,section_id,subject_id,title,details,link_url,assigned_on,due_on,created_by_name,classes(name),sections(name),subjects(name)")
    .eq("school_id", school.id).eq("kind", kind).order("assigned_on", { ascending: false }).order("created_at", { ascending: false }).limit(100);
  if (isUuid(sp.class_id)) q = q.eq("class_id", sp.class_id!);
  if (isUuid(sp.section_id)) q = q.or(`section_id.is.null,section_id.eq.${sp.section_id}`);
  const [classes, { data: subjects }, { data: rows }, { data: mine }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("sort"),
    q,
    supabase.from("staff_assignments").select("section_id,subject_id").eq("school_id", school.id).eq("user_id", user.id),
  ]);
  const R = (rows ?? []) as unknown as Row[];
  const canCreate = can(`homework.${kind}.create`);
  const canEdit = can(`homework.${kind}.edit`);
  const canDelete = can(`homework.${kind}.delete`);
  // Teachers with "assigned" scope only get the sections / subjects they teach in the form
  const assigned = scope(`homework.${kind}.create`) === "assigned";
  const mySections = new Set((mine ?? []).map((m) => m.section_id));
  const mySubjects = (mine ?? []).some((m) => m.subject_id === null) ? null : new Set((mine ?? []).map((m) => m.subject_id));
  const formClasses = assigned ? classes.map((c) => ({ ...c, sections: c.sections.filter((s) => mySections.has(s.id)) })).filter((c) => c.sections.length) : classes;
  const formSubjects = (subjects ?? []).filter((s) => !assigned || !mySubjects || mySubjects.has(s.id)).map((s) => [s.id, s.name] as [string, string]);
  const editing = sp.edit && canEdit ? R.find((r) => r.id === sp.edit) : undefined;
  const where = (r: Row) => `Class ${r.classes?.name ?? "?"}${r.sections ? `-${r.sections.name}` : " (all sections)"}`;
  const tab = (k: string, text: string) => (
    <Link key={k} href={`/app/homework?kind=${k}`} className={`rounded-full px-4 py-1.5 text-[14px] font-semibold no-underline ${k === kind ? "bg-blue text-white" : "bg-white text-body border border-line"}`}>{text}</Link>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="homework" title="Homework & study material" subtitle="Parents see these on their page; copy them to the class WhatsApp group in one tap" />
      <Flash ok={sp.ok} error={sp.error} />
      {kinds.length > 1 && <div className="flex gap-2">{tab("homework", "Homework")}{tab("material", "Study material")}</div>}

      {(canCreate || editing) && (
        <Card title={editing ? `Edit: ${editing.title}` : kind === "homework" ? "Give homework" : "Share study material"} icon="homework">
          <form action={saveHomework} className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="kind" value={kind} />
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <ClassSection classes={formClasses} classId={editing?.class_id ?? (isUuid(sp.class_id) ? sp.class_id : null)} sectionId={editing?.section_id ?? sp.section_id} required allowAll={!assigned} />
            <Select label="Subject" name="subject_id" blank={assigned && mySubjects ? undefined : "—"} defaultValue={editing?.subject_id} options={formSubjects} />
            <Input label="Date given" name="assigned_on" type="date" defaultValue={editing?.assigned_on ?? today} />
            <Input label="Title" name="title" required defaultValue={editing?.title} className="sm:col-span-3" placeholder={kind === "homework" ? "Maths: Exercise 3.1, Q1–10" : "Chapter 4 notes"} />
            {kind === "homework" ? <Input label="Submit by" name="due_on" type="date" defaultValue={editing?.due_on} /> : <div />}
            <Textarea label="Details" name="details" rows={3} defaultValue={editing?.details} className="sm:col-span-4" />
            <Input label="Link (Google Drive, YouTube, PDF …)" name="link_url" type="url" defaultValue={editing?.link_url} className="sm:col-span-3" placeholder="https://" />
            <div className="flex items-end gap-2">
              <Submit>{editing ? "Save" : kind === "homework" ? "Post homework" : "Share"}</Submit>
              {editing && <Link href={`/app/homework?kind=${kind}`} className="text-[14px]">Cancel</Link>}
            </div>
          </form>
          {assigned && !formClasses.length && <p className="mt-3 mb-0 text-[13px] text-error">No sections are assigned to you yet — ask the office to assign your classes in Settings → Staff & access.</p>}
        </Card>
      )}

      <form className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="kind" value={kind} />
        <div className="grid grid-cols-2 gap-2"><ClassSection classes={classes} classId={sp.class_id} sectionId={sp.section_id} allowAll /></div>
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
      </form>

      {R.length ? R.map((r) => {
        const overdue = r.due_on && r.due_on < today;
        const wa = `*${r.kind === "homework" ? "Homework" : "Study material"} · ${where(r)}${r.subjects ? ` · ${r.subjects.name}` : ""}*\n${r.title}${r.details ? `\n${r.details}` : ""}${r.link_url ? `\n${r.link_url}` : ""}${r.due_on ? `\nSubmit by: ${fmtDate(r.due_on)}` : ""}\n— ${school.name}`;
        return (
          <Card key={r.id} title={r.title}
            description={<>{where(r)}{r.subjects ? ` · ${r.subjects.name}` : ""} · {fmtDate(r.assigned_on)}{r.created_by_name ? ` · ${r.created_by_name}` : ""}</>}
            actions={r.due_on ? <Badge value={overdue ? "expired" : r.due_on === today ? "due" : "contacted"} text={`Due ${fmtDate(r.due_on)}`} /> : undefined}>
            {r.details && <p className="mt-0 text-[15px] whitespace-pre-line">{r.details}</p>}
            {r.link_url && <p className="mt-0"><a href={r.link_url} target="_blank" rel="noopener noreferrer" className="break-all text-[14px]">{r.link_url}</a></p>}
            <div className="flex flex-wrap items-center gap-3">
              <CopyButton text={wa} label="Copy for WhatsApp group" />
              {canEdit && <Link href={`/app/homework?kind=${kind}&edit=${r.id}`} className="text-[13px]">Edit</Link>}
              {canDelete && (
                <form action={deleteHomework}>
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value={kind} />
                  <button className="cursor-pointer border-0 bg-transparent text-[13px] text-error underline">Delete</button>
                </form>
              )}
            </div>
          </Card>
        );
      }) : <Empty>{kind === "homework" ? "No homework posted yet." : "No study material shared yet."}</Empty>}
    </div>
  );
}
