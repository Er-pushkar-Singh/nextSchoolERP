import Link from "next/link";
import { cookies } from "next/headers";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { resetStaffPassword } from "../../_actions/staff-login";
import { cleanSearch } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";
import { getClasses } from "@/lib/erp";
import { appUrl } from "@/lib/brand";
import { todayIST } from "@/lib/format";
import catalog from "@/lib/catalog.json";
import { addAssignment, addStaff, removeAssignment, removeStaff, setOverride, setStaffRoles } from "../../_actions/access";
import { setLoginBlocked } from "../../_actions/people";

type Role = { id: string; name: string; kind: string; code: string };
type Member = { user_id: string; name: string | null; email: string | null; phone: string | null; blocked_at: string | null; blocked_till: string | null };

export default async function Staff({ searchParams }: { searchParams: Promise<{ user?: string; q?: string; page?: string; size?: string; ok?: string; error?: string }> }) {
  const { supabase, school, user, can } = await requirePerm("settings.users.view");
  const sp = await searchParams;
  const raw = (await cookies()).get("erp_newpw")?.value;
  let newpw: { email: string; pw: string } | null = null;
  try { newpw = raw ? JSON.parse(raw) : null; } catch { newpw = null; }

  const { page, size, offset } = pageParams(sp);
  const q = cleanSearch(sp.q ?? "").trim();
  let mq = supabase.from("school_members").select("user_id,name,email,phone,blocked_at,blocked_till", { count: "exact" }).eq("school_id", school.id);
  if (q) mq = mq.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  const [{ data: members, count: memberN }, { data: roles }, classes, { data: subjects }, { count: everyone }] = await Promise.all([
    mq.order("name").order("user_id").range(offset, offset + size - 1),
    supabase.from("roles").select("id,name,kind,code").eq("school_id", school.id).order("created_at"),
    getClasses(supabase, school.id),
    supabase.from("subjects").select("id,name").eq("school_id", school.id).order("sort"),
    supabase.from("school_members").select("user_id", { count: "exact", head: true }).eq("school_id", school.id),
  ]);
  const selId = sp.user && /^[0-9a-f-]{36}$/.test(sp.user) ? sp.user : null;
  const wanted = [...new Set([...(members ?? []).map((m) => m.user_id), ...(selId ? [selId] : [])])];
  const [{ data: mr }, { data: assigns }, { data: selRow }] = await Promise.all([
    wanted.length ? supabase.from("member_roles").select("user_id,role_id").eq("school_id", school.id).in("user_id", wanted) : Promise.resolve({ data: [] }),
    wanted.length ? supabase.from("staff_assignments").select("id,user_id,section_id,subject_id,is_class_teacher").eq("school_id", school.id).in("user_id", wanted) : Promise.resolve({ data: [] }),
    selId && !(members ?? []).some((m) => m.user_id === selId) ? supabase.from("school_members").select("user_id,name,email,phone,blocked_at,blocked_till").eq("school_id", school.id).eq("user_id", selId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const R = (roles ?? []) as Role[];
  const staffRoles = R.filter((r) => r.kind === "staff");
  const rolesOf = (uid: string) => (mr ?? []).filter((x) => x.user_id === uid).map((x) => R.find((r) => r.id === x.role_id)).filter(Boolean) as Role[];
  const secName = new Map(classes.flatMap((c) => c.sections.map((s) => [s.id, `${c.name}-${s.name}`] as [string, string])));
  const subName = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const M = (members ?? []) as Member[];
  const sel = selId ? (M.find((m) => m.user_id === selId) ?? ((selRow as Member | null) ?? undefined)) : undefined;
  const pageQs = new URLSearchParams(Object.entries({ q: q || undefined, page: sp.page, size: sp.size }).filter(([, v]) => v) as [string, string][]).toString();
  const here = `/app/settings/staff${pageQs ? `?${pageQs}` : ""}`;
  const selRoles = sel ? new Set(rolesOf(sel.user_id).map((r) => r.id)) : new Set<string>();
  const { data: overrides } = sel ? await supabase.from("member_overrides").select("perm_key,effect,scope").eq("school_id", school.id).eq("user_id", sel.user_id) : { data: [] };
  const allPerms = catalog.modules.flatMap((m) => m.submodules.flatMap((s) => s.actions.map((a) => ({ key: `${m.code}.${s.code}.${a}`, label: `${m.name} › ${s.name} › ${a}` }))));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="students" title="Staff & access" subtitle={`${everyone ?? M.length} people · roles decide what each person can do`} back={{ href: "/app/settings", label: "Settings centre" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {newpw && (
        <div role="status" className="rounded-[12px] border-2 border-wa bg-wa-tint p-4 text-[14px] text-[#0b4f2c]">
          <b>Share these sign-in details privately (shown only once):</b>
          <p className="my-2 font-mono">{appUrl("/login")}<br />Email: {newpw.email}<br />Temporary password: {newpw.pw}</p>
          <CopyButton text={`Sign in to ${school.name}: ${appUrl("/login")}\nEmail: ${newpw.email}\nPassword: ${newpw.pw}\n(Please change it under your name → My account.)`} label="Copy message" />
        </div>
      )}

      <form className="flex flex-wrap items-end gap-2">
        <div className="w-full sm:w-80"><Input label="Search people" name="q" defaultValue={sp.q} placeholder="Name, email or phone" /></div>
        <button className="btn btn-sm btn-secondary cursor-pointer">Search</button>
        {q && <Link href="/app/settings/staff" className="pb-2 text-[14px]">Clear</Link>}
      </form>

      {M.length ? <Table head={["Name", "Email / phone", "Roles", "Assigned to", "Actions"]} minWidth={820}>
        {M.map((m) => {
          const a = (assigns ?? []).filter((x) => x.user_id === m.user_id);
          return (
            <tr key={m.user_id} className={sel?.user_id === m.user_id ? "bg-blue-tint" : ""}>
              <td className={`${td} font-semibold text-ink`}>{m.name ?? "—"}{m.user_id === user.id && <span className="ml-1 text-[12px] font-normal text-muted">(you)</span>}{m.blocked_at && (!m.blocked_till || m.blocked_till >= todayIST()) && <span className="ml-1"><Badge value="overdue" text="Blocked" /></span>}</td>
              <td className={td}>{m.email}<div className="text-[12px] text-muted">{m.phone ?? ""}</div></td>
              <td className={td}><span className="flex flex-wrap gap-1">{rolesOf(m.user_id).map((r) => <Badge key={r.id} value="contacted" text={r.name} />)}</span></td>
              <td className={`${td} text-[13px]`}>{a.length ? a.map((x) => `${secName.get(x.section_id) ?? "?"}${x.is_class_teacher ? " (class teacher)" : x.subject_id ? ` ${subName.get(x.subject_id) ?? ""}` : ""}`).join(", ") : <span className="text-muted">—</span>}</td>
              <td className={td}>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <Link href={`/app/settings/staff?user=${m.user_id}${pageQs ? `&${pageQs}` : ""}`}>Manage</Link>
                  {can("settings.users.edit") && m.user_id !== user.id && (
                    <Modal label="Reset password" variant="link" size="sm" title={`Reset password — ${m.name ?? m.email}`}>
                      <form action={resetStaffPassword} className="flex flex-col gap-3">
                        <input type="hidden" name="user_id" value={m.user_id} /><input type="hidden" name="back" value={here} />
                        <p className="m-0 text-[14px]">A new temporary password is generated for <b>{m.email ?? m.name}</b>. The old one stops working at once; the new one is shown <b>only once</b> on the next screen.</p>
                        <div><Submit>Reset password</Submit></div>
                      </form>
                    </Modal>
                  )}
                </span>
              </td>
            </tr>
          );
        })}
      </Table> : <Empty>{q ? "Nobody matches this search." : "No staff yet."}</Empty>}
      <Pagination total={memberN ?? 0} page={page} size={size} basePath="/app/settings/staff" params={{ q: q || undefined }} />

      {sel && (
        <Card title={`Manage: ${sel.name ?? sel.email}`} actions={<Link href="/app/settings/staff" className="text-[14px]">Close</Link>}>
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h3 className="m-0 mb-2 text-[15px] font-bold text-ink">Roles</h3>
              {sel.user_id === user.id ? <p className="m-0 text-[14px] text-muted">You can't change your own roles. Ask another Principal / School Admin.</p> : (
                <form action={setStaffRoles} className="flex flex-col gap-2">
                  <input type="hidden" name="user_id" value={sel.user_id} />
                  <div className="grid gap-1 sm:grid-cols-2">
                    {staffRoles.map((r) => <label key={r.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="role_ids" value={r.id} defaultChecked={selRoles.has(r.id)} disabled={!can("settings.users.edit")} /> {r.name}</label>)}
                  </div>
                  {can("settings.users.edit") && <div><Submit variant="secondary">Save roles</Submit></div>}
                </form>
              )}
            </section>
            {can("hr.staff.block") && sel.user_id !== user.id && (
              <section className="lg:col-span-2">
                <h3 className="m-0 mb-2 text-[15px] font-bold text-ink">Login access</h3>
                {sel.blocked_at ? (
                  <form action={setLoginBlocked} className="flex flex-wrap items-center gap-3 text-[14px]">
                    <input type="hidden" name="user_id" value={sel.user_id} /><input type="hidden" name="block" value="0" />
                    <span className="text-error">This login is blocked{sel.blocked_till ? ` until ${sel.blocked_till}` : ""}.</span>
                    <Submit variant="secondary">Unblock</Submit>
                  </form>
                ) : (
                  <form action={setLoginBlocked} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="user_id" value={sel.user_id} /><input type="hidden" name="block" value="1" />
                    <Input label="Block until (optional)" name="till" type="date" />
                    <Submit variant="secondary">Block this login</Submit>
                    <span className="pb-2 text-[13px] text-muted">They are shut out immediately; roles and records are kept.</span>
                  </form>
                )}
              </section>
            )}
            <section>
              <h3 className="m-0 mb-2 text-[15px] font-bold text-ink">Classes & subjects (for “assigned” permissions)</h3>
              <ul className="m-0 mb-3 list-none p-0 text-[14px]">
                {(assigns ?? []).filter((x) => x.user_id === sel.user_id).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 first:border-0">
                    <span>{secName.get(x.section_id)} · {x.is_class_teacher ? "Class teacher (all subjects)" : x.subject_id ? subName.get(x.subject_id) : "All subjects"}</span>
                    {can("academics.allocation.edit") && <form action={removeAssignment}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="user_id" value={sel.user_id} /><button className="cursor-pointer border-0 bg-transparent text-[13px] text-error underline">Remove</button></form>}
                  </li>
                ))}
                {!(assigns ?? []).some((x) => x.user_id === sel.user_id) && <li className="text-muted">Not assigned to any section. Teachers see nothing in “assigned” areas until you assign them.</li>}
              </ul>
              {can("academics.allocation.edit") && (
                <form action={addAssignment} className="flex flex-col gap-2">
                  <input type="hidden" name="user_id" value={sel.user_id} />
                  <div className="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-y-auto rounded-lg border border-line p-2">
                    {classes.flatMap((c) => c.sections.map((s) => <label key={s.id} className="flex items-center gap-1 text-[13px]"><input type="checkbox" name="section_ids" value={s.id} /> {c.name}-{s.name}</label>))}
                  </div>
                  <div className="flex flex-wrap items-end gap-3 text-[14px]">
                    <label className="flex items-center gap-1.5"><input type="checkbox" name="is_class_teacher" /> Class teacher</label>
                    <label className="flex flex-col gap-1 text-[13px] font-semibold">or subject
                      <select name="subject_id" className="rounded-md border border-line px-2 py-1.5 font-normal"><option value="">All subjects</option>{(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                    </label>
                    <Submit variant="secondary">Assign</Submit>
                  </div>
                </form>
              )}
            </section>
            {can("settings.roles.edit") && sel.user_id !== user.id && (
              <section className="lg:col-span-2">
                <h3 className="m-0 mb-2 text-[15px] font-bold text-ink">Exceptions for this person only</h3>
                <ul className="m-0 mb-2 list-none p-0 text-[14px]">
                  {(overrides ?? []).map((o) => (
                    <li key={o.perm_key} className="flex items-center gap-2"><Badge value={o.effect === "deny" ? "overdue" : "paid"} text={o.effect === "deny" ? "Denied" : `Granted (${o.scope})`} /> <code className="text-[13px]">{o.perm_key}</code>
                      <form action={setOverride}><input type="hidden" name="user_id" value={sel.user_id} /><input type="hidden" name="perm_key" value={o.perm_key} /><input type="hidden" name="effect" value="remove" /><button className="cursor-pointer border-0 bg-transparent text-[13px] text-blue underline">remove</button></form>
                    </li>
                  ))}
                  {!overrides?.length && <li className="text-muted">None — this person gets exactly what their roles give.</li>}
                </ul>
                <form action={setOverride} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="user_id" value={sel.user_id} />
                  <select name="perm_key" className="input !min-h-10 !w-auto max-w-md !py-2 text-[14px]" aria-label="Permission">{allPerms.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
                  <select name="effect" className="input !min-h-10 !w-auto !py-2 text-[14px]" aria-label="Effect"><option value="deny">Deny</option><option value="grant">Grant</option></select>
                  <select name="scope" className="input !min-h-10 !w-auto !py-2 text-[14px]" aria-label="Scope">{Object.entries(catalog.scopes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <Submit variant="secondary">Add exception</Submit>
                </form>
              </section>
            )}
            {can("settings.users.delete") && sel.user_id !== user.id && (
              <form action={removeStaff} className="lg:col-span-2"><input type="hidden" name="user_id" value={sel.user_id} /><Submit variant="danger">Remove {sel.name ?? "this person"} from the school</Submit></form>
            )}
          </div>
        </Card>
      )}

      {can("settings.users.create") ? (
        <Card title="Add staff">
          <form action={addStaff} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Name" name="name" required />
              <Input label="Email (login)" name="email" type="email" required />
              <Input label="Phone" name="phone" type="tel" />
            </div>
            <fieldset className="border-0 p-0"><legend className="mb-1 text-[13px] font-semibold text-ink">Roles</legend>
              <div className="grid gap-1 sm:grid-cols-3">{staffRoles.map((r) => <label key={r.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="role_ids" value={r.id} /> {r.name}</label>)}</div>
            </fieldset>
            <div><Submit>Add staff</Submit></div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
