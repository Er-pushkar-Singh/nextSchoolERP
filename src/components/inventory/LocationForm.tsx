import { Input, Select, Submit } from "@/components/ui/ui";
import { EntityPicker } from "@/components/ui/EntityPicker";
import { saveLocation } from "@/app/app/_actions/inventory";

export const LOCATION_KINDS: [string, string][] = [["classroom", "Classroom"], ["lab", "Lab"], ["office", "Office"], ["library", "Library"], ["staffroom", "Staff room"], ["hostel", "Hostel"], ["ground", "Ground / sports"], ["store", "Store"], ["other", "Other"]];
const KINDS = LOCATION_KINDS;

export function LocationForm({ classes, sections, loc, back }: { classes: [string, string][]; sections: [string, string][]; loc?: { id: string; name: string; kind: string; class_id: string | null; section_id: string | null; building: string | null; active: boolean } | null; back: string }) {
  return (
    <form action={saveLocation} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      {loc && <input type="hidden" name="id" value={loc.id} />}
      <Input label="Name" name="name" required defaultValue={loc?.name} placeholder="Room 12, Chemistry lab, Principal's office" />
      <Select label="Type" name="kind" defaultValue={loc?.kind ?? "classroom"} options={KINDS} />
      <Select label="Class (for a classroom)" name="class_id" blank="—" defaultValue={loc?.class_id} options={classes} />
      <Select label="Section" name="section_id" blank="—" defaultValue={loc?.section_id} options={sections} />
      <Input label="Building / floor" name="building" defaultValue={loc?.building} />
      <EntityPicker kind="staff" name="in_charge_staff_id" label={loc ? "In-charge (leave to keep)" : "In-charge (gets the emails for this room)"} />
      {loc && <label className="flex items-center gap-2 text-[14px] sm:col-span-2"><input type="checkbox" name="active" defaultChecked={loc.active} /> In use</label>}
      <div className="sm:col-span-2"><Submit>{loc ? "Save" : "Add room"}</Submit></div>
    </form>
  );
}

