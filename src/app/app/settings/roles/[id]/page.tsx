import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Flash, Input, PageHeader, Submit } from "@/components/ui/ui";
import catalog from "@/lib/catalog.json";
import { deleteRole, resetRole, saveRolePermissions } from "../../../_actions/access";

const ACTIONS = Object.keys(catalog.actions) as (keyof typeof catalog.actions)[];

export default async function RoleEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can, user } = await requirePerm("settings.roles.view");
  const { data: role } = await supabase.from("roles").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!role) notFound();
  const [{ data: rp }, { data: mine }, { data: sm }] = await Promise.all([
    supabase.from("role_permissions").select("perm_key,scope").eq("role_id", id),
    supabase.from("member_roles").select("role_id").eq("school_id", school.id).eq("user_id", user.id).eq("role_id", id),
    supabase.from("school_modules").select("module_code,licensed,enabled").eq("school_id", school.id),
  ]);
  const has = new Map((rp ?? []).map((p) => [p.perm_key, p.scope]));
  const holdsIt = (mine ?? []).length > 0;
  const editable = can("settings.roles.edit") && !role.locked && !holdsIt;
  const off = new Set((sm ?? []).filter((m) => !m.licensed || !m.enabled).map((m) => m.module_code));
  const scopes = Object.entries(catalog.scopes).filter(([k]) => (role.kind === "family" ? ["school", "child", "self"] : ["school", "assigned", "own"]).includes(k));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={role.name} subtitle={`${has.size} permissions · ${role.kind === "family" ? "parent / student role" : "staff role"}`} back={{ href: "/app/settings/roles", label: "Roles" }} />
      <Flash ok={sp.ok} error={sp.error} />
      {role.locked && <Flash ok="This role always holds every permission in the school, including new modules. It can't be narrowed." />}
      {holdsIt && !role.locked && <Flash error="You hold this role yourself, so you can't change its permissions." />}

      <form action={saveRolePermissions} className="flex flex-col gap-4">
        <input type="hidden" name="role_id" value={id} />
        {editable && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Role name" name="name" defaultValue={role.name} />
            <Input label="Description" name="description" defaultValue={role.description} />
          </div>
        )}
        <div className="overflow-x-auto rounded-[12px] border border-line bg-white">
          <table className="w-full border-collapse text-[14px]" style={{ minWidth: 980 }}>
            <thead>
              <tr className="bg-surface-alt text-left text-ink">
                <th className="px-3 py-2">Module · sub-module</th>
                {ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center font-semibold">{catalog.actions[a]}</th>)}
                <th className="px-3 py-2">Scope</th>
              </tr>
            </thead>
            {catalog.modules.map((m) => (
              <tbody key={m.code}>
                <tr className="border-t-2 border-line-strong bg-surface-alt/60">
                  <td colSpan={ACTIONS.length + 2} className="px-3 py-2 font-bold text-ink">
                    {m.name} <span className="font-normal text-[12px] text-muted">· {m.tier}</span> {off.has(m.code) && <Badge value="draft" text="Switched off for this school" />}
                  </td>
                </tr>
                {m.submodules.map((s) => {
                  const sub = `${m.code}.${s.code}`;
                  const cur = s.actions.map((a) => has.get(`${sub}.${a}`)).find(Boolean) ?? (role.kind === "family" ? "child" : "school");
                  return (
                    <tr key={sub} className="border-t border-line">
                      <td className="px-3 py-1.5 pl-6">{s.name} {!("built" in s && s.built) && <span className="text-[11px] text-muted">(coming)</span>}</td>
                      {ACTIONS.map((a) => (
                        <td key={a} className="px-2 py-1.5 text-center">
                          {s.actions.includes(a) ? (
                            <input type="checkbox" name={`p:${sub}.${a}`} defaultChecked={has.has(`${sub}.${a}`)} disabled={!editable} aria-label={`${s.name} ${a}`} className="h-4 w-4" />
                          ) : <span className="text-line-strong">·</span>}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        <select name={`s:${sub}`} defaultValue={cur} disabled={!editable} className="rounded-md border border-line px-1.5 py-1 text-[13px]" aria-label={`${s.name} scope`}>
                          {scopes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        {editable && <div className="sticky bottom-3"><Submit>Save permissions</Submit></div>}
      </form>

      {editable && (
        <div className="flex flex-wrap gap-3">
          {role.template_code && <form action={resetRole}><input type="hidden" name="role_id" value={id} /><Submit variant="secondary">Reset to default</Submit></form>}
          {!role.template_code && can("settings.roles.delete") && <form action={deleteRole}><input type="hidden" name="role_id" value={id} /><Submit variant="danger">Delete role</Submit></form>}
        </div>
      )}
      <p className="m-0 text-[13px] text-muted">Scope: <b>Whole school</b> = every record · <b>Assigned</b> = only sections / subjects given under Staff & access · <b>Own</b> = only their own records (e.g. own leave) · <b>Own children</b> / <b>Self</b> = parent and student logins.</p>
    </div>
  );
}
