import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { addDays, fmtDate, todayIST, waLink } from "@/lib/format";
import { saveEnquiry } from "../_actions/admissions";

const STATUSES = ["new", "contacted", "visited", "test", "admitted", "lost"] as const;
const SOURCES = ["Walk-in", "Phone call", "WhatsApp", "Website", "Google", "Facebook/Instagram", "Banner/Hoarding", "Referral", "Other"];
type Enq = { id: string; created_at: string; student_name: string; class_sought: string | null; parent_name: string | null; phone: string | null; email: string | null; source: string | null; status: string; follow_up_date: string | null; notes: string | null; student_id: string | null };

export default async function Admissions({ searchParams }: { searchParams: Promise<{ status?: string; edit?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.enquiries.view");
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  let q = supabase.from("enquiries").select("*").eq("school_id", school.id);
  q = status ? q.eq("status", status) : q.in("status", ["new", "contacted", "visited", "test"]);
  const [{ data }, { data: all }] = await Promise.all([
    q.order("follow_up_date", { nullsFirst: false }).order("created_at", { ascending: false }).limit(300),
    supabase.from("enquiries").select("status").eq("school_id", school.id).gte("created_at", addDays(todayIST(), -365)),
  ]);
  const rows = (data ?? []) as Enq[];
  const editing = sp.edit ? rows.find((r) => r.id === sp.edit) ?? (await supabase.from("enquiries").select("*").eq("id", sp.edit).eq("school_id", school.id).maybeSingle()).data as Enq | null : null;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, (all ?? []).filter((r) => r.status === s).length]));
  const total = (all ?? []).length;
  const today = todayIST();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Admissions" subtitle={`Last 12 months: ${total} enquiries · ${counts.admitted} admitted${total ? ` (${Math.round((counts.admitted / total) * 100)}%)` : ""}`} />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="flex flex-wrap gap-2 text-[14px]">
        <Link href="/app/admissions" className={`chip ${!status ? "!border-ink" : ""}`}>Open</Link>
        {STATUSES.map((s) => <Link key={s} href={`/app/admissions?status=${s}`} className={`chip ${status === s ? "!border-ink" : ""}`}>{s[0].toUpperCase() + s.slice(1)} ({counts[s]})</Link>)}
      </nav>

      {can(editing ? "frontdesk.enquiries.edit" : "frontdesk.enquiries.create") && <Card title={editing ? `Edit: ${editing.student_name}` : "New enquiry"} actions={editing && <Link href="/app/admissions" className="text-[14px]">Cancel</Link>}>
        <form action={saveEnquiry} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" key={editing?.id ?? "new"}>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <Input label="Student name" name="student_name" defaultValue={editing?.student_name} required />
          <Input label="Class sought" name="class_sought" defaultValue={editing?.class_sought} placeholder="e.g. 5 or LKG" />
          <Input label="Parent name" name="parent_name" defaultValue={editing?.parent_name} />
          <Input label="Phone / WhatsApp" name="phone" type="tel" defaultValue={editing?.phone} />
          <Select label="Source" name="source" defaultValue={editing?.source} blank="—" options={SOURCES.map((s) => [s, s] as [string, string])} />
          <Select label="Status" name="status" defaultValue={editing?.status ?? "new"} options={STATUSES} />
          <Input label="Follow up on" name="follow_up_date" type="date" defaultValue={editing?.follow_up_date ?? addDays(today, 2)} />
          <Input label="Email" name="email" type="email" defaultValue={editing?.email} />
          <Textarea label="Notes" name="notes" defaultValue={editing?.notes} className="sm:col-span-2 lg:col-span-4" rows={2} />
          <div><Submit>{editing ? "Save" : "Add enquiry"}</Submit></div>
        </form>
      </Card>}

      {rows.length ? (
        <Table head={["Student", "Class", "Parent / phone", "Source", "Follow up", "Status", ""]}>
          {rows.map((e) => {
            const wa = waLink(e.phone, `Namaste${e.parent_name ? ` ${e.parent_name}` : ""}, thank you for your admission enquiry for ${e.student_name} at ${school.name}.`);
            return (
              <tr key={e.id}>
                <td className={td}><Link href={`/app/admissions?edit=${e.id}${status ? `&status=${status}` : ""}`} className="font-semibold">{e.student_name}</Link><div className="text-[12px] text-muted">{fmtDate(e.created_at)}</div></td>
                <td className={td}>{e.class_sought ?? "—"}</td>
                <td className={td}>{e.parent_name ?? "—"}<div className="text-[12px] text-muted">{e.phone ?? ""}</div></td>
                <td className={td}>{e.source ?? "—"}</td>
                <td className={`${td} ${e.follow_up_date && e.follow_up_date <= today && !["admitted", "lost"].includes(e.status) ? "font-semibold text-error" : ""}`}>{fmtDate(e.follow_up_date)}</td>
                <td className={td}><Badge value={e.status} /></td>
                <td className={`${td} whitespace-nowrap`}>
                  {wa && <a href={wa} target="_blank" rel="noopener" className="mr-3">WhatsApp</a>}
                  {e.student_id ? <Link href={`/app/students/${e.student_id}`}>Student</Link> : e.status !== "lost" && can("students.profile.create") && <Link href={`/app/students/new?enquiry=${e.id}`}>Admit →</Link>}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No enquiries here.</Empty>}
    </div>
  );
}
