import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { addDays, cleanSearch, fmtDate, todayIST, waLink } from "@/lib/format";
import { deleteEnquiry, saveEnquiry, setEnquiryStatus } from "../_actions/admissions";

const STATUSES = ["new", "contacted", "visited", "test", "admitted", "lost"] as const;
const SOURCES = ["Walk-in", "Phone call", "WhatsApp", "Website", "Google", "Facebook/Instagram", "Banner/Hoarding", "Referral", "Other"];
type Enq = { id: string; created_at: string; student_name: string; class_sought: string | null; parent_name: string | null; phone: string | null; email: string | null; source: string | null; status: string; follow_up_date: string | null; notes: string | null; student_id: string | null };

export default async function Admissions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("frontdesk.enquiries.view");
  const sp = await searchParams;
  const today = todayIST();
  const { page, size, offset } = pageParams(sp);
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : sp.status === "all" ? "all" : "open";
  const source = SOURCES.includes(sp.source ?? "") ? sp.source! : null;
  const cls = sp.class?.trim().slice(0, 20) || null;
  const follow = ["due", "none", "week"].includes(sp.follow ?? "") ? sp.follow! : null;
  const q = cleanSearch(sp.q ?? "").trim();
  const sort = ["follow", "new", "name"].includes(sp.sort ?? "") ? sp.sort! : "follow";

  let query = supabase.from("enquiries").select("*", { count: "exact" }).eq("school_id", school.id);
  if (status === "open") query = query.in("status", ["new", "contacted", "visited", "test"]);
  else if (status !== "all") query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (cls) query = query.ilike("class_sought", cls);
  if (follow === "due") query = query.lte("follow_up_date", today).not("status", "in", "(admitted,lost)");
  if (follow === "none") query = query.is("follow_up_date", null);
  if (follow === "week") query = query.gte("follow_up_date", today).lte("follow_up_date", addDays(today, 7));
  if (q) { const p = `%${q.replace(/[%_\\,()]/g, " ")}%`; query = query.or(`student_name.ilike.${p},parent_name.ilike.${p},phone.ilike.${p},notes.ilike.${p}`); }
  query = sort === "name" ? query.order("student_name") : sort === "new" ? query.order("created_at", { ascending: false }) : query.order("follow_up_date", { nullsFirst: false }).order("created_at", { ascending: false });

  const editId = sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) ? sp.edit : null;
  const [{ data, count }, { data: all }, editQ] = await Promise.all([
    query.range(offset, offset + size - 1),
    supabase.from("enquiries").select("status").eq("school_id", school.id).gte("created_at", addDays(today, -365)),
    editId && can("frontdesk.enquiries.edit") ? supabase.from("enquiries").select("*").eq("id", editId).eq("school_id", school.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const rows = (data ?? []) as Enq[];
  const { data: linked } = rows.length ? await supabase.from("admission_applications").select("id,enquiry_id,status").in("enquiry_id", rows.map((r) => r.id)) : { data: [] };
  const appOf = new Map((linked ?? []).map((x) => [x.enquiry_id as string, x as { id: string; status: string }]));
  const editing = editQ.data as Enq | null;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, (all ?? []).filter((r) => r.status === s).length]));
  const total12 = (all ?? []).length;
  const params = { status: status === "open" ? undefined : status, source: source ?? undefined, class: cls ?? undefined, follow: follow ?? undefined, q: q || undefined, sort: sort === "follow" ? undefined : sort };
  const qs = new URLSearchParams(Object.entries({ ...params, page: sp.page, size: sp.size }).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/app/admissions${qs ? "?" + qs : ""}`;
  const chip = (s: string) => (s === status ? "!border-ink" : "");

  const enquiryForm = (e?: Enq | null) => (
    <form action={saveEnquiry} className="grid gap-3 sm:grid-cols-2">
      {e && <input type="hidden" name="id" value={e.id} />}
      <input type="hidden" name="back" value={here} />
      <Input label="Student name" name="student_name" defaultValue={e?.student_name} required />
      <Input label="Class sought" name="class_sought" defaultValue={e?.class_sought} placeholder="e.g. 5 or LKG" />
      <Input label="Parent name" name="parent_name" defaultValue={e?.parent_name} />
      <Input label="Phone / WhatsApp" name="phone" type="tel" defaultValue={e?.phone} />
      <Select label="Source" name="source" defaultValue={e?.source} blank="—" options={SOURCES.map((s) => [s, s] as [string, string])} />
      <Select label="Status" name="status" defaultValue={e?.status ?? "new"} options={STATUSES} />
      <Input label="Follow up on" name="follow_up_date" type="date" defaultValue={e ? e.follow_up_date : addDays(today, 2)} />
      <Input label="Email" name="email" type="email" defaultValue={e?.email} />
      <Textarea label="Notes" name="notes" defaultValue={e?.notes} className="sm:col-span-2" rows={2} />
      <div className="sm:col-span-2"><Submit>{e ? "Save changes" : "Add enquiry"}</Submit></div>
    </form>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="admissions" title="Admission enquiries" subtitle={`Last 12 months: ${total12} enquiries · ${counts.admitted} admitted${total12 ? ` (${Math.round((counts.admitted / total12) * 100)}%)` : ""}`}
        actions={<>
          {can("frontdesk.enquiries.create") && <Modal label="+ New enquiry" title="New enquiry">{enquiryForm()}</Modal>}
          {can("frontdesk.admissions.view") && <Link href="/app/admissions/applications" className="btn btn-sm btn-secondary">Applications</Link>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="flex flex-wrap gap-2 text-[14px]">
        <Link href="/app/admissions" className={`chip ${chip("open")}`}>Open</Link>
        {STATUSES.map((s) => <Link key={s} href={`/app/admissions?status=${s}`} className={`chip ${chip(s)}`}>{s[0].toUpperCase() + s.slice(1)} ({counts[s]})</Link>)}
        <Link href="/app/admissions?status=all" className={`chip ${chip("all")}`}>All</Link>
      </nav>

      <form className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input type="hidden" name="status" value={status === "open" ? "" : status} />
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Student, parent, phone, notes" className="lg:col-span-2" />
        <Select label="Source" name="source" blank="Any" defaultValue={source} options={SOURCES.map((s) => [s, s] as [string, string])} />
        <Input label="Class sought" name="class" defaultValue={cls ?? ""} placeholder="5, LKG…" />
        <Select label="Follow-up" name="follow" blank="Any" defaultValue={follow} options={[["due", "Due or overdue"], ["week", "Next 7 days"], ["none", "No date set"]]} />
        <Select label="Sort" name="sort" defaultValue={sort} options={[["follow", "Follow-up date"], ["new", "Newest"], ["name", "Name"]]} />
        <div><button className="btn btn-sm btn-secondary cursor-pointer">Show</button></div>
      </form>

      {rows.length ? (
        <Table head={["Student", "Class", "Parent / phone", "Source", "Follow up", "Status", ""]} minWidth={940}>
          {rows.map((e) => {
            const wa = waLink(e.phone, `Namaste${e.parent_name ? ` ${e.parent_name}` : ""}, thank you for your admission enquiry for ${e.student_name} at ${school.name}.`);
            const app = appOf.get(e.id);
            return (
              <tr key={e.id}>
                <td className={td}><b className="text-ink">{e.student_name}</b><div className="text-[12px] text-muted">{fmtDate(e.created_at)}{e.notes ? ` · ${e.notes.slice(0, 40)}` : ""}</div></td>
                <td className={td}>{e.class_sought ?? "—"}</td>
                <td className={td}>{e.parent_name ?? "—"}<div className="text-[12px] text-muted">{e.phone ?? ""}</div></td>
                <td className={td}>{e.source ?? "—"}</td>
                <td className={`${td} ${e.follow_up_date && e.follow_up_date <= today && !["admitted", "lost"].includes(e.status) ? "font-semibold text-error" : ""}`}>{fmtDate(e.follow_up_date)}</td>
                <td className={td}><Badge value={e.status} /></td>
                <td className={`${td} text-[13px]`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {can("frontdesk.enquiries.edit") && (
                      <Modal label="Status" variant="link" title={`Update — ${e.student_name}`} size="sm">
                        <form action={setEnquiryStatus} className="grid gap-3">
                          <input type="hidden" name="id" value={e.id} /><input type="hidden" name="back" value={here} />
                          <Select label="Status" name="status" defaultValue={e.status} options={STATUSES} />
                          <Input label="Next follow-up" name="follow_up_date" type="date" defaultValue={e.follow_up_date ?? ""} />
                          <Submit>Save</Submit>
                        </form>
                      </Modal>
                    )}
                    {can("frontdesk.enquiries.edit") && <Link href={`${here}${here.includes("?") ? "&" : "?"}edit=${e.id}`}>Edit</Link>}
                    {wa && <a href={wa} target="_blank" rel="noopener">WhatsApp</a>}
                    {app ? <Link href={`/app/admissions/applications/${app.id}`}>Application →</Link>
                      : e.status !== "lost" && can("frontdesk.admissions.create") && <Link href={`/app/admissions/applications/new?enquiry=${e.id}`}>Start application →</Link>}
                    {can("frontdesk.enquiries.delete") && !app && (
                      <form action={deleteEnquiry}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="back" value={here} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Delete</button></form>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No enquiries match these filters.</Empty>}
      <Pagination total={count ?? 0} page={page} size={size} basePath="/app/admissions" params={params} />

      {editing && (
        <Modal defaultOpen closeHref={here.replace(/[?&]edit=[^&]*/, "")} title={`Edit — ${editing.student_name}`}>
          {enquiryForm(editing)}
        </Modal>
      )}
    </div>
  );
}
