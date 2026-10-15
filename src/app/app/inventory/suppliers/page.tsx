import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { saveSupplier } from "../../_actions/inventory";

type S = { id: string; name: string; phone: string | null; email: string | null; gstin: string | null; address: string | null; active: boolean };

function Form({ s }: { s?: S }) {
  return (
    <form action={saveSupplier} className="grid gap-3 sm:grid-cols-2">
      {s && <input type="hidden" name="id" value={s.id} />}
      <Input label="Name" name="name" required defaultValue={s?.name} className="sm:col-span-2" />
      <Input label="Phone" name="phone" type="tel" defaultValue={s?.phone} /><Input label="Email" name="email" type="email" defaultValue={s?.email} />
      <Input label="GSTIN" name="gstin" defaultValue={s?.gstin} /><Input label="Address" name="address" defaultValue={s?.address} />
      {s && <label className="flex items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" name="active" defaultChecked={s.active} /> Active</label>}
      <div className="sm:col-span-2"><Submit>{s ? "Save supplier" : "Add supplier"}</Submit></div>
    </form>
  );
}

export default async function Suppliers({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("inventory.purchase.view");
  const sp = await searchParams;
  const { data } = await supabase.from("inventory_suppliers").select("id,name,phone,email,gstin,address,active").eq("school_id", school.id).order("name").limit(500);
  const rows = (data ?? []) as S[];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="billing" title="Suppliers" subtitle={`${rows.length} supplier${rows.length === 1 ? "" : "s"}`} back={{ href: "/app/inventory/purchases", label: "Purchases" }}
        actions={can("inventory.purchase.create") ? <Modal label="+ Add supplier" title="Add a supplier"><Form /></Modal> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      {rows.length ? (
        <Table head={["Supplier", "Contact", "GSTIN", ""]} minWidth={640}>
          {rows.map((s) => (
            <tr key={s.id} className={s.active ? "" : "opacity-60"}>
              <td className={td}><b className="text-ink">{s.name}</b>{!s.active && <> <Badge value="muted" text="Inactive" /></>}<div className="text-[12px] text-muted">{s.address}</div></td>
              <td className={td}>{s.phone ?? "—"}<div className="text-[12px] text-muted">{s.email}</div></td>
              <td className={`${td} font-mono text-[13px]`}>{s.gstin ?? "—"}</td>
              <td className={td}>{can("inventory.purchase.edit") && <Modal label="Edit" variant="link" title={`Edit ${s.name}`}><Form s={s} /></Modal>}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No suppliers yet.</Empty>}
    </div>
  );
}
