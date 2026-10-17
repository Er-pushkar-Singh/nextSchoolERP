import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, ButtonLink, Empty, Flash, PageHeader, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { cleanSearch, fullName, money } from "@/lib/format";
import { getClasses, sectionOptions } from "@/lib/erp";
import { Modal } from "@/components/ui/Modal";
import { ClassSection } from "@/components/ClassSection";
import { bulkStudents, moveStudent } from "../_actions/people";

const STUDENT_STATUS: [string, string][] = [["active", "Active"], ["left", "Left"], ["transferred", "Transferred"], ["withdrawn", "Withdrawn"], ["passed_out", "Passed out"], ["admission_pending", "Admission in progress"], ["all", "All"]];
const SORTS: [string, string][] = [["name", "Name"], ["class", "Class & roll"], ["adm", "Admission no."], ["newest", "Newest first"], ["dues", "Highest dues"]];
const CATEGORIES = ["General", "OBC", "SC", "ST", "EWS", "Other"];

type Row = { id: string; admission_no: string; first_name: string; middle_name: string | null; last_name: string | null; roll_no: number | null; father_name: string | null; guardian_phone: string | null;
  status: string; class_name: string | null; section_name: string | null; gender: string | null; category: string | null; blocked: boolean; block_reason: string | null; balance: number; total: number };

export default async function Students({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can, canSchool, user } = await requirePerm("students.profile.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const uuidOk = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const q = cleanSearch(sp.q ?? "").trim();
  const status = STUDENT_STATUS.some(([k]) => k === sp.status) ? sp.status! : "active";
  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : "name";
  const cls = uuidOk(sp.class_id), sec = uuidOk(sp.section_id);
  const gender = ["M", "F", "O"].includes(sp.gender ?? "") ? sp.gender! : null;
  const category = CATEGORIES.includes(sp.category ?? "") ? sp.category! : null;
  const blocked = ["yes", "no"].includes(sp.blocked ?? "") ? sp.blocked! : null;
  const dues = ["yes", "no"].includes(sp.dues ?? "") ? sp.dues! : null;

  // a teacher (scope "assigned") sees only the sections assigned to them — say so when there are none
  const assignedOnly = !canSchool("students.profile.view");
  const [classes, listQ, countsQ, { count: myClasses }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.rpc("student_list", { sid: school.id, p_q: q || null, p_class: cls, p_section: sec, p_status: status, p_gender: gender, p_category: category,
      p_blocked: blocked, p_dues: dues, p_sort: sort, p_limit: size, p_offset: offset }),
    supabase.rpc("student_counts", { sid: school.id }),
    assignedOnly ? supabase.from("staff_assignments").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("user_id", user.id) : Promise.resolve({ count: null }),
  ]);
  const rows = (listQ.data ?? []) as Row[];
  const total = rows[0]?.total ? Number(rows[0].total) : 0;
  const counts = new Map(((countsQ.data ?? []) as { status: string; n: number; blocked: number }[]).map((c) => [c.status, c]));
  const all = [...counts.values()].reduce((t, c) => t + Number(c.n), 0);
  const blockedCount = [...counts.values()].reduce((t, c) => t + Number(c.blocked), 0);
  const params = { q: q || undefined, status: status === "active" ? undefined : status, class_id: cls ?? undefined, section_id: sec ?? undefined, gender: gender ?? undefined,
    category: category ?? undefined, blocked: blocked ?? undefined, dues: dues ?? undefined, sort: sort === "name" ? undefined : sort };
  const here = `/app/students?${new URLSearchParams(Object.entries({ ...params, size: size === 25 ? undefined : String(size), page: page > 1 ? String(page) : undefined }).filter(([, v]) => v) as [string, string][])}`;
  const filtered = Boolean(q || cls || sec || gender || category || blocked || dues);
  const canWrite = can("students.profile.create");
  const canBlock = can("students.profile.block");
  const canMove = can("students.profile.edit");
  const canPromote = can("students.promotion.create");
  const classId = (s: Row) => classes.find((c) => c.name === s.class_name)?.id ?? null;
  const nextClass = (s: Row) => { const i = classes.findIndex((c) => c.name === s.class_name); return classes[i + 1]?.id ?? null; };
  const sections = sectionOptions(classes);
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="students" title="Students" subtitle={`${all} on record · ${counts.get("active")?.n ?? 0} active${blockedCount ? ` · ${blockedCount} blocked` : ""}`}
        actions={<>
          {can("students.profile.export") && <a href={`/app/students/export${exportQs ? `?${exportQs}` : ""}`} className="btn btn-sm btn-secondary">Export CSV</a>}
          {canWrite && can("students.import.create") && <ButtonLink href="/app/students/import" variant="secondary">Import CSV</ButtonLink>}
          {canWrite && <ButtonLink href="/app/students/new">New admission</ButtonLink>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      {assignedOnly && myClasses === 0 && (
        <div role="note" className="rounded-[12px] border border-[#f1d39a] bg-[#fff4e0] px-4 py-3 text-[14px] text-[#7a4b00]">
          <b>No class is assigned to you yet</b>, so there are no students to show. Ask the principal or office to assign your class and subjects (Staff → your profile → Classes &amp; subjects, or Settings → Staff &amp; access).
        </div>
      )}

      <nav className="flex flex-wrap gap-2 text-[14px]" aria-label="Status">
        {STUDENT_STATUS.map(([k, l]) => {
          const n = k === "all" ? all : Number(counts.get(k)?.n ?? 0);
          const qs = new URLSearchParams(Object.entries({ ...params, status: k === "active" ? undefined : k }).filter(([, v]) => v) as [string, string][]).toString();
          return <Link key={k} href={`/app/students${qs ? `?${qs}` : ""}`} className={`chip ${status === k ? "!border-ink" : ""}`}>{l} ({n})</Link>;
        })}
      </nav>

      <form className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={sp.q} placeholder="Name, admission no., father, phone…" className="input col-span-2 !min-h-10 sm:max-w-xs !py-2" aria-label="Search" />
        <select name="class_id" defaultValue={cls ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Class">
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
        </select>
        <select name="section_id" defaultValue={sec ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Section">
          <option value="">All sections</option>
          {sections.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
        <select name="gender" defaultValue={gender ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Gender">
          <option value="">Any gender</option><option value="M">Boys</option><option value="F">Girls</option><option value="O">Other</option>
        </select>
        <select name="category" defaultValue={category ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Category">
          <option value="">Any category</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {can("fees.collection.view") && (
          <select name="dues" defaultValue={dues ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Fee dues">
            <option value="">Any fee status</option><option value="yes">Has dues</option><option value="no">No dues</option>
          </select>
        )}
        <select name="blocked" defaultValue={blocked ?? ""} className="input !min-h-10 !w-auto !py-2" aria-label="Blocked">
          <option value="">Blocked or not</option><option value="yes">Blocked only</option><option value="no">Not blocked</option>
        </select>
        <select name="sort" defaultValue={sort} className="input !min-h-10 !w-auto !py-2" aria-label="Sort by">
          {SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
        </select>
        <button className="btn btn-sm btn-secondary cursor-pointer">Apply</button>
        {(filtered || sort !== "name") && <Link href={`/app/students${status === "active" ? "" : `?status=${status}`}`} className="text-[14px]">Clear</Link>}
      </form>

      {listQ.error && <Flash error={`Could not load students: ${listQ.error.message}`} />}
      {rows.length ? (
        <div className="flex flex-col gap-3">
          <form id="bulk" />
          <input type="hidden" name="back" value={here} form="bulk" />
          <Table head={["", "Adm. no.", "Name", "Class", "Roll", "Father", "Phone", ...(can("fees.collection.view") ? ["Dues"] : []), "Status", "Actions"]} minWidth={1000}>
            {rows.map((s) => (
              <tr key={s.id} className={s.blocked ? "bg-[#fff7f6]" : ""}>
                <td className={td}><input type="checkbox" name="id" value={s.id} form="bulk" aria-label={`Select ${s.first_name}`} /></td>
                <td className={`${td} font-mono text-[13px]`}>{s.admission_no}</td>
                <td className={td}><Link href={`/app/students/${s.id}`} className="font-semibold">{fullName(s)}</Link>
                  <div className="text-[12px] text-muted">{[s.gender === "M" ? "Boy" : s.gender === "F" ? "Girl" : null, s.category].filter(Boolean).join(" · ")}</div></td>
                <td className={td}>{s.class_name ? `${s.class_name}${s.section_name ? `-${s.section_name}` : ""}` : "—"}</td>
                <td className={td}>{s.roll_no ?? "—"}</td>
                <td className={td}>{s.father_name ?? "—"}</td>
                <td className={td}>{s.guardian_phone ?? "—"}</td>
                {can("fees.collection.view") && <td className={`${td} ${Number(s.balance) > 0 ? "font-semibold text-error" : "text-muted"}`}>{Number(s.balance) > 0 ? money(s.balance) : "—"}</td>}
                <td className={td}>
                  <span className="flex flex-wrap gap-1">
                    {s.status !== "active" ? <Badge value={s.status} /> : <Badge value="active" text="Active" />}
                    {s.blocked && <span title={s.block_reason ?? ""}><Badge value="overdue" text="Blocked" /></span>}
                  </span>
                </td>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <Link href={`/app/students/${s.id}`}>{canMove ? "Edit" : "View"}</Link>
                    {s.status === "active" && canMove && (
                      <Modal label="Move" variant="link" title={`Move ${fullName(s)} to another section`} size="sm">
                        <form action={moveStudent} className="grid gap-3">
                          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={here} /><input type="hidden" name="kind" value="move" />
                          <p className="m-0 text-[13px] text-muted">Now in {s.class_name ? `Class ${s.class_name}${s.section_name ? `-${s.section_name}` : ""}` : "no class"}. Moving to another class keeps the old class in the history; use Promote for a new session.</p>
                          <ClassSection classes={classes} classId={classId(s)} required />
                          <button className="btn btn-sm btn-primary cursor-pointer border-0">Move</button>
                        </form>
                      </Modal>
                    )}
                    {s.status === "active" && canPromote && (
                      <Modal label="Promote" variant="link" title={`Promote ${fullName(s)}`} size="sm">
                        <form action={moveStudent} className="grid gap-3">
                          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={here} /><input type="hidden" name="kind" value="promote" />
                          <p className="m-0 text-[13px] text-muted">Currently {s.class_name ? `Class ${s.class_name}` : "—"}. The old class stays in the student&apos;s history as <b>promoted</b>; the roll number is cleared.</p>
                          <ClassSection classes={classes} classId={nextClass(s)} required />
                          <button className="btn btn-sm btn-primary cursor-pointer border-0">Promote</button>
                        </form>
                      </Modal>
                    )}
                    {canBlock && (s.blocked ? (
                      <form action={bulkStudents}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={here} /><input type="hidden" name="action" value="unblock" />
                        <button className="cursor-pointer border-0 bg-transparent p-0 text-[#15803d] underline">Unblock</button></form>
                    ) : (
                      <Modal label="Block" variant="link" title={`Block ${fullName(s)}`} size="sm">
                        <form action={bulkStudents} className="grid gap-3">
                          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={here} /><input type="hidden" name="action" value="block" />
                          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Reason<input name="reason" required className="input !min-h-10 !py-2 font-normal" placeholder="e.g. fees pending, discipline" /></label>
                          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Until (optional)<input name="till" type="date" className="input !min-h-10 !py-2 font-normal" /></label>
                          <button className="btn btn-sm btn-primary cursor-pointer border-0">Block student</button>
                        </form>
                      </Modal>
                    ))}
                    {can("fees.collection.create") && s.status === "active" && <Link href={`/app/fees/collect?student=${s.id}`}>Collect fee</Link>}
                    {can("documents.issue.view") && <Link href={`/app/documents?student=${s.id}`}>Documents</Link>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>

          {(canBlock || canMove) && (
            <fieldset className="m-0 flex flex-wrap items-end gap-2 rounded-[12px] border border-line bg-white p-3 text-[14px]">
              <legend className="px-1 text-[13px] font-bold text-ink">For the ticked students</legend>
              {canMove && (
                <>
                  <select name="section_id" form="bulk" className="input !min-h-10 !w-auto !py-2" aria-label="Move to section" defaultValue="">
                    <option value="">Move to section…</option>
                    {sections.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                  </select>
                  <button name="action" value="section" form="bulk" formAction={bulkStudents} className="btn btn-sm btn-secondary cursor-pointer">Move</button>
                </>
              )}
              {canBlock && (
                <>
                  <input name="reason" form="bulk" placeholder="Reason to block" aria-label="Reason to block" className="input !min-h-10 max-w-[220px] !py-2" />
                  <input name="till" form="bulk" type="date" aria-label="Blocked until" className="input !min-h-10 !w-auto !py-2" />
                  <button name="action" value="block" form="bulk" formAction={bulkStudents} className="btn btn-sm btn-secondary cursor-pointer">Block</button>
                  <button name="action" value="unblock" form="bulk" formAction={bulkStudents} className="btn btn-sm btn-secondary cursor-pointer">Unblock</button>
                </>
              )}
            </fieldset>
          )}
        </div>
      ) : (
        <Empty>{filtered ? "No student matches these filters." : <>No students here yet. {canWrite && <><Link href="/app/students/new">Admit one</Link> or <Link href="/app/students/import">import your list from Excel</Link>.</>}</>}</Empty>
      )}
      <Pagination total={total} page={page} size={size} basePath="/app/students" params={params} />
    </div>
  );
}
