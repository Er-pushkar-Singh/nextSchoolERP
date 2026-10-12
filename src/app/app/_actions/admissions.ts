"use server";

import { requirePerm } from "@/lib/school";
import { date, errMsg, go, oneOf, str, uuid } from "@/lib/action-util";

const STATUSES = ["new", "contacted", "visited", "test", "admitted", "lost"] as const;

export async function saveEnquiry(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.enquiries.create", "frontdesk.enquiries.edit");
  const id = uuid(f, "id");
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
  if (!row.student_name) go("/app/admissions", { error: "Student name is required." });
  const { error } = id
    ? await supabase.from("enquiries").update(row).eq("id", id).eq("school_id", school.id)
    : await supabase.from("enquiries").insert({ ...row, school_id: school.id });
  go("/app/admissions", error ? { error: errMsg(error) } : { ok: id ? "Enquiry updated." : "Enquiry added." });
}
