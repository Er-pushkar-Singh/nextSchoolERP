import { Submit } from "@/components/ui/ui";
import { StudentFields } from "./StudentFields";
import { saveStudent } from "@/app/app/_actions/students";
import type { ClassRow } from "@/lib/erp";

export type Student = Record<string, string | number | boolean | null> & { id?: string };

export function StudentForm({ s, classes, enquiryId }: { s?: Student; classes: ClassRow[]; enquiryId?: string }) {
  const v = (k: string) => (s?.[k] ?? null) as string | number | boolean | null;
  return (
    <form action={saveStudent} className="flex flex-col gap-5">
      {s?.id && <input type="hidden" name="id" value={s.id} />}
      {enquiryId && <input type="hidden" name="enquiry_id" value={enquiryId} />}
      <StudentFields v={v} classes={classes} />
      <p className="m-0 text-[13px] text-muted">
        PEN, APAAR, Aadhaar, health alerts, documents, earlier examinations and internal notes are kept on the student's page in separate, restricted sections.
      </p>
      <div><Submit>{s?.id ? "Save changes" : "Admit student"}</Submit></div>
    </form>
  );
}
