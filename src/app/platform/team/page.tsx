import { requirePlatform, ROLE_LABEL, type PlatformRole } from "@/lib/platform";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { addTeamMember, updateTeamMember } from "../_actions/ops";

const ROLES = Object.entries(ROLE_LABEL) as [PlatformRole, string][];

export default async function Team({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, user, can } = await requirePlatform("team");
  const sp = await searchParams;
  const { data } = await supabase.from("platform_admins").select("user_id,role,name,email,active,created_at").order("created_at");
  const W = can("team", true);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="team" title="Team & roles" subtitle="CodersDuniya staff who use this panel. Each role is enforced in the database." />
      <Flash ok={sp.ok} error={sp.error} />
      <Table head={["Name", "Email", "Role", "Status", ""]} minWidth={760}>
        {(data ?? []).map((m) => (
          <tr key={m.user_id}>
            <td className={`${td} font-semibold text-ink`}>{m.name ?? "—"}{m.user_id === user.id && <span className="ml-1 text-[12px] font-normal text-muted">(you)</span>}</td>
            <td className={td}>{m.email ?? "—"}</td>
            <td className={td} colSpan={W && m.user_id !== user.id ? 3 : 1}>
              {W && m.user_id !== user.id ? (
                <form action={updateTeamMember} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="user_id" value={m.user_id} />
                  <select name="role" defaultValue={m.role} className="rounded-md border border-line px-2 py-1 text-[13px]" aria-label="Role">{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" name="active" defaultChecked={m.active} /> Active</label>
                  <button className="cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-[13px]">Save</button>
                </form>
              ) : ROLE_LABEL[m.role as PlatformRole]}
            </td>
            {!(W && m.user_id !== user.id) && <><td className={td}><Badge value={m.active ? "active" : "cancelled"} text={m.active ? "Active" : "Disabled"} /></td><td className={td} /></>}
          </tr>
        ))}
      </Table>
      {W && (
        <Card title="Add a team member">
          <form action={addTeamMember} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Name" name="name" />
            <Input label="Email (login)" name="email" type="email" required />
            <Select label="Role" name="role" defaultValue="support" options={ROLES} />
            <div className="flex items-end"><Submit>Add</Submit></div>
          </form>
        </Card>
      )}
      <Card title="What each role can do">
        <ul className="m-0 list-disc pl-5 text-[14px]">{ROLES.map(([k, l]) => <li key={k}><b>{l.split(" — ")[0]}</b> — {l.split(" — ")[1]}</li>)}</ul>
        <p className="mb-0 text-[13px] text-muted">Changing data inside a school always needs a support session (reason + time limit), whatever the role.</p>
      </Card>
    </div>
  );
}
