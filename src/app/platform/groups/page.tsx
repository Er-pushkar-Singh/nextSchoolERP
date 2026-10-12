import Link from "next/link";
import { requirePlatform } from "@/lib/platform";
import { Card, Empty, Flash, Input, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { loadTenants } from "@/lib/tenants";
import { money } from "@/lib/format";
import { addGroupMember, deleteGroup, removeGroupMember, saveGroup } from "../_actions/ops";

export default async function Groups({ searchParams }: { searchParams: Promise<{ group?: string; ok?: string; error?: string }> }) {
  const { supabase, can } = await requirePlatform("tenants");
  const sp = await searchParams;
  const W = can("tenants", true);
  const [{ data: groups }, { data: members }, tenants] = await Promise.all([
    supabase.from("school_groups").select("*").order("name"),
    supabase.from("group_members").select("group_id,user_id,name,email,role"),
    loadTenants(supabase),
  ]);
  const sel = (groups ?? []).find((g) => g.id === sp.group);
  const live = tenants.filter((t) => !t.archived_at);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="groups" title="Groups & branches" subtitle="A trust or chain with several schools. Group owners sign in and see all their branches at /group (read-only)." />
      <Flash ok={sp.ok} error={sp.error} />
      {(groups ?? []).length ? (
        <Table head={["Group", "Branches", "Students", "Collected this month", "Owners", ""]} minWidth={760}>
          {(groups ?? []).map((g) => {
            const br = live.filter((t) => t.group_id === g.id);
            return (
              <tr key={g.id} className={sel?.id === g.id ? "bg-blue-tint" : ""}>
                <td className={td}><b className="text-ink">{g.name}</b><div className="text-[12px] text-muted">{[g.city, g.contact_name, g.contact_phone].filter(Boolean).join(" · ")}</div></td>
                <td className={td}>{br.map((t) => <Link key={t.id} href={`/platform/tenants/${t.id}`} className="mr-2 text-[13px]">{t.name}</Link>)}{!br.length && "—"}</td>
                <td className={td}>{br.reduce((s, t) => s + (t.stats?.students ?? 0), 0)}</td>
                <td className={td}>{money(br.reduce((s, t) => s + Number(t.stats?.collected_month ?? 0), 0))}</td>
                <td className={td}>{(members ?? []).filter((m) => m.group_id === g.id).map((m) => m.email).join(", ") || "—"}</td>
                <td className={td}><Link href={`/platform/groups?group=${g.id}`}>Manage</Link></td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>No groups yet.</Empty>}

      {W && (
        <Card title={sel ? `Manage: ${sel.name}` : "New group"} actions={sel && <Link href="/platform/groups" className="text-[14px]">New group instead</Link>}>
          <form action={saveGroup} className="flex flex-col gap-3" key={sel?.id ?? "new"}>
            {sel && <input type="hidden" name="id" value={sel.id} />}
            <input type="hidden" name="set_schools" value="1" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Input label="Group name" name="name" defaultValue={sel?.name} required />
              <Input label="City" name="city" defaultValue={sel?.city} />
              <Input label="Contact" name="contact_name" defaultValue={sel?.contact_name} />
              <Input label="Phone" name="contact_phone" defaultValue={sel?.contact_phone} />
              <Input label="Email" name="contact_email" defaultValue={sel?.contact_email} />
            </div>
            <fieldset className="border-0 p-0"><legend className="mb-1 text-[13px] font-semibold text-ink">Branches</legend>
              <div className="flex max-h-48 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {live.map((t) => <label key={t.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="school_ids" value={t.id} defaultChecked={!!sel && t.group_id === sel.id} /> {t.name}{t.group && t.group_id !== sel?.id ? <span className="text-[12px] text-muted"> ({t.group})</span> : null}</label>)}
              </div>
            </fieldset>
            <div className="flex gap-3"><Submit>{sel ? "Save group" : "Create group"}</Submit></div>
          </form>
          {sel && (
            <div className="mt-5 grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
              <div>
                <h3 className="m-0 mb-2 text-[15px] font-bold text-ink">Group logins</h3>
                <ul className="m-0 mb-3 list-none p-0 text-[14px]">
                  {(members ?? []).filter((m) => m.group_id === sel.id).map((m) => (
                    <li key={m.user_id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 first:border-0">
                      <span>{m.name ?? m.email} <span className="text-muted">· {m.email} · {m.role}</span></span>
                      <form action={removeGroupMember}><input type="hidden" name="group_id" value={sel.id} /><input type="hidden" name="user_id" value={m.user_id} /><button className="cursor-pointer border-0 bg-transparent text-[13px] text-error underline">Remove</button></form>
                    </li>
                  ))}
                </ul>
                <form action={addGroupMember} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="group_id" value={sel.id} />
                  <Input label="Name" name="name" />
                  <Input label="Email" name="email" type="email" required />
                  <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Access<select name="role" className="input !min-h-10 !py-2 font-normal"><option value="owner">Owner</option><option value="viewer">Viewer</option></select></label>
                  <Submit variant="secondary">Add login</Submit>
                </form>
              </div>
              <div>
                <h3 className="m-0 mb-2 text-[15px] font-bold text-ink">Remove group</h3>
                <p className="mt-0 text-[14px]">The schools stay; they just stop being linked.</p>
                <form action={deleteGroup}><input type="hidden" name="id" value={sel.id} /><Submit variant="danger">Delete group</Submit></form>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
