import { Input, Select, Submit, Textarea } from "@/components/ui/ui";
import { ClassSection } from "./ClassSection";
import { saveStudent } from "@/app/app/_actions/students";
import type { ClassRow } from "@/lib/erp";
import { todayIST } from "@/lib/format";

export type Student = Record<string, string | number | null> & { id?: string };

export function StudentForm({ s, classes, enquiryId }: { s?: Student; classes: ClassRow[]; enquiryId?: string }) {
  const v = (k: string) => (s?.[k] ?? null) as string | number | null;
  return (
    <form action={saveStudent} className="flex flex-col gap-5">
      {s?.id && <input type="hidden" name="id" value={s.id} />}
      {enquiryId && <input type="hidden" name="enquiry_id" value={enquiryId} />}
      <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-[15px] font-bold text-ink">Student</legend>
        <Input label="First name" name="first_name" defaultValue={v("first_name")} required />
        <Input label="Last name" name="last_name" defaultValue={v("last_name")} />
        <Select label="Gender" name="gender" defaultValue={v("gender")} blank="—" options={[["M", "Male"], ["F", "Female"], ["O", "Other"]]} />
        <Input label="Date of birth" name="dob" type="date" defaultValue={v("dob")} />
        <ClassSection classes={classes} classId={v("class_id") as string} sectionId={v("section_id") as string} />
        <Input label="Roll no." name="roll_no" type="number" min={1} defaultValue={v("roll_no")} />
        <Input label="Admission no." name="admission_no" defaultValue={v("admission_no")} hint={s?.id ? undefined : "Leave blank to auto-number"} />
        <Input label="Admission date" name="admission_date" type="date" defaultValue={v("admission_date") ?? todayIST()} />
        <Select label="Category" name="category" defaultValue={v("category")} blank="—" options={["General", "OBC", "SC", "ST", "EWS", "Other"].map((c) => [c, c] as [string, string])} />
        <Input label="Blood group" name="blood_group" defaultValue={v("blood_group")} />
        <Input label="Transport route" name="transport_route" defaultValue={v("transport_route")} />
      </fieldset>
      <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-[15px] font-bold text-ink">Parents</legend>
        <Input label="Father's name" name="father_name" defaultValue={v("father_name")} />
        <Input label="Mother's name" name="mother_name" defaultValue={v("mother_name")} />
        <Input label="WhatsApp / mobile" name="guardian_phone" type="tel" defaultValue={v("guardian_phone")} hint="Fee reminders and absence alerts go here" />
        <Input label="Other phone" name="alt_phone" type="tel" defaultValue={v("alt_phone")} />
        <Input label="Email" name="email" type="email" defaultValue={v("email")} />
        <Input label="City" name="city" defaultValue={v("city")} />
        <Textarea label="Address" name="address" defaultValue={v("address") as string} className="sm:col-span-2" rows={2} />
      </fieldset>
      <Textarea label="Notes (internal)" name="notes" defaultValue={v("notes") as string} rows={2} />
      <div><Submit>{s?.id ? "Save changes" : "Admit student"}</Submit></div>
    </form>
  );
}
