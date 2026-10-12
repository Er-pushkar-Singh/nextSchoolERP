import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { createRole } from "../../_actions/access";

export default async function Roles({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("settings.roles.view");
  const sp = await searchParams;
  const [{ data: roles }, { data: rp }, { data: mr }, { count: total }] = await Promise.all([
    supabase.from("roles").select("id,name,description,kind,template_code,locked").eq("school_id", school.id).order("created_at"),
    supabase.from("role_permissions").select("role_id, roles!inner(school_id)").eq("roles.school_id", school.id).limit(10000),
    supabase.from("member_roles").select("role_id").eq("school_id", school.id),
    supabase.from("erp_permissions").select("key", { count: "exact", head: true }),
  ]);
  const n = (id: string, rows: { role_id: string }[] | null) => (rows ?? []).filter((r) => r.role_id === id).length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="team" title="Roles & permissions" subtitle={`${total ?? 0} permissions across all modules · each role is a set of them with a scope`} back={{ href: "/app/settings", label: "Settings centre" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <Table head={["Role", "Type", "Permissions", "People", ""]} minWidth={640}>
        {(roles ?? []).map((r) => (
          <tr key={r.id}>
            <td className={td}><Link href={`/app/settings/roles/${r.id}`} className="font-semibold">{r.name}</Link><div className="text-[12px] text-muted">{r.description}</div></td>
            <td className={td}>{r.kind === "family" ? "Parent / student" : "Staff"}</td>
            <td className={td}>{n(r.id, rp as { role_id: string }[] | null)} / {total}</td>
            <td className={td}>{n(r.id, mr)}</td>
            <td className={td}>{r.locked ? <Badge value="active" text="Locked: full access" /> : r.template_code ? <Badge value="draft" text="Default" /> : <Badge value="contacted" text="Custom" />}</td>
          </tr>
        ))}
      </Table>
      {can("settings.roles.create") && (
        <Card title="New role">
          <form action={createRole} className="flex flex-wrap items-end gap-3">
            <Input label="Name" name="name" required placeholder="Exam coordinator" />
            <Input label="Description" name="description" className="min-w-64" />
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Start from
              <select name="copy_from" className="input !min-h-10 !py-2 font-normal"><option value="">Empty</option>{(roles ?? []).filter((r) => !r.locked).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </label>
            <Submit>Create role</Submit>
          </form>
        </Card>
      )}
    </div>
  );
}
