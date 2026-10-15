"use server";

import { requirePerm } from "@/lib/school";
import { date, errMsg, go, oneOf, str, uuid } from "@/lib/action-util";

const STATUSES = ["new", "contacted", "visited", "test", "admitted", "lost"] as const;

const back = (f: FormData) => {
  const b = str(f, "back", 300);
  return b && b.startsWith("/app/admissions") ? b : "/app/admissions";
};

export async function saveEnquiry(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.enquiries.create", "frontdesk.enquiries.edit");
  const id = uuid(f, "id");
  const dest = back(f);
  const row = {
    student_name: str(f, "student_name", 120),
    class_sought: str(f, "class_sought", 20),
    parent_name: str(f, "parent_name", 120),
    phone: str(f, "phone", 20)?.replace(/[^\d+]/g, "") ?? null,
    email: str(f, "email", 120),
    source: str(f, "source", 40),
    status: oneOf(f, "status", STATUSES, "new"),
    follow_up_date: date(f, "follow_up_date"),
    notes: str(f, "notes", 2000),
  };
  if (!row.student_name) go(dest, { error: "Student name is required." });
  const { error } = id
    ? await supabase.from("enquiries").update(row).eq("id", id).eq("school_id", school.id)
    : await supabase.from("enquiries").insert({ ...row, school_id: school.id });
  go(dest, error ? { error: errMsg(error) } : { ok: id ? "Enquiry updated." : "Enquiry added." });
}

/** Quick status change from the table (and the follow-up date, if one is sent). */
export async function setEnquiryStatus(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.enquiries.edit");
  const patch: Record<string, unknown> = { status: oneOf(f, "status", STATUSES, "contacted") };
  if (f.has("follow_up_date")) patch.follow_up_date = date(f, "follow_up_date");
  const { error } = await supabase.from("enquiries").update(patch).eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back(f), error ? { error: errMsg(error) } : { ok: "Enquiry updated." });
}

export async function deleteEnquiry(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.enquiries.delete");
  const id = uuid(f, "id");
  const { count } = await supabase.from("admission_applications").select("id", { count: "exact", head: true }).eq("enquiry_id", id!);
  if ((count ?? 0) > 0) go(back(f), { error: "This enquiry already has an application. Mark it Lost instead of deleting." });
  const { error } = await supabase.from("enquiries").delete().eq("id", id!).eq("school_id", school.id);
  go(back(f), error ? { error: errMsg(error) } : { ok: "Enquiry deleted." });
}
