import { Input, Select, Submit, Textarea } from "@/components/ui/ui";
import { HolderFields } from "./HolderFields";
import { assignItem, returnItem, transferItem } from "@/app/app/_actions/inventory";
import { todayIST } from "@/lib/format";

export type AssignableItem = { id: string; name: string; variant: string | null; on_hand: number; unit: string; kind: string };

/** Give school property to a room, a staff member, a student or a department. */
export function AssignForm({ items, locations, back, presetItem, presetLocation, initial }: {
  items: AssignableItem[]; locations: [string, string][]; back: string; presetItem?: string | null; presetLocation?: string | null; initial?: "location" | "staff" | "student" | "department";
}) {
  const usable = items.filter((i) => i.kind !== "shop" && (i.on_hand > 0 || i.id === presetItem));
  return (
    <form action={assignItem} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      <Select label="Item (in the store)" name="item_id" defaultValue={presetItem ?? ""} blank="Choose…" className="sm:col-span-2"
        options={usable.map((i) => [i.id, `${i.name}${i.variant ? ` (${i.variant})` : ""} — ${i.on_hand} ${i.unit} in store`] as [string, string])} />
      <HolderFields locations={locations} presetLocation={presetLocation} initial={initial ?? (presetLocation ? "location" : "staff")} />
      <Input label="How many" name="qty" type="number" min={1} defaultValue={1} required />
      <Input label="Return by" name="due_back" type="date" min={todayIST()} hint="Blank for things installed in a room" />
      <Input label="Serial / asset tag" name="tag" placeholder="LT-0042" />
      <Input label="Note" name="note" />
      <p className="m-0 text-[12.5px] text-muted sm:col-span-2">A staff member — or the parent of a student — gets an email at once, and again when it comes back.</p>
      <div className="sm:col-span-2"><Submit>Give</Submit></div>
    </form>
  );
}

export function ReturnForm({ id, qty, holderKind, back }: { id: string; qty: number; holderKind: string; back: string }) {
  return (
    <form action={returnItem} className="flex flex-col gap-3">
      <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={`How many (of ${qty})`} name="qty" type="number" min={1} max={qty} defaultValue={qty} />
        <Select label="Condition" name="condition" defaultValue="good" options={[["good", "Good — back to the store"], ["needs_repair", "Needs repair"], ["damaged", "Damaged — write off"], ["lost", "Lost"]]} />
      </div>
      {holderKind === "student" && <Input label="Recovery charge (₹) — damaged or lost only" name="charge" type="number" min={0} step="1" hint="Added to the student's fee account and collected at the fee counter" />}
      <Textarea label="Note" name="note" rows={2} />
      <Submit>Record return</Submit>
    </form>
  );
}

export function TransferForm({ id, locations, back }: { id: string; locations: [string, string][]; back: string }) {
  return (
    <form action={transferItem} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} /><input type="hidden" name="id" value={id} />
      <HolderFields locations={locations} />
      <Input label="Note" name="note" className="sm:col-span-2" placeholder="Shifted after the lab renovation" />
      <div className="sm:col-span-2"><Submit>Move</Submit></div>
    </form>
  );
}
