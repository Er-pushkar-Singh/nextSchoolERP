"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, str, uuid } from "@/lib/action-util";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DOC_BUCKET } from "@/lib/student-docs";

const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
const back = (f: FormData, fallback: string) => {
  const b = String(f.get("back") ?? "");
  return b.startsWith("/app/") ? b : fallback;
};

/* ───────────── Students ───────────── */
export async function blockStudent(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.block");
  const id = uuid(f, "id");
  const to = `/app/students/${id}`;
  const { error } = await supabase.rpc("block_student", { sid: school.id, stu: id, p_reason: str(f, "reason", 200) ?? "", p_till: date(f, "till") });
  revalidatePath(to);
  go(to, error ? { error: errMsg(error) } : { ok: "Student blocked. The parent link shows a notice until you unblock." });
}

export async function unblockStudent(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.block");
  const id = uuid(f, "id");
  const to = `/app/students/${id}`;
  const { error } = await supabase.rpc("unblock_student", { sid: school.id, stu: id });
  revalidatePath(to);
  go(to, error ? { error: errMsg(error) } : { ok: "Student unblocked." });
}

export async function deleteStudent(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.delete");
  const id = uuid(f, "id");
  const to = `/app/students/${id}`;
  // remember the uploaded files; they are removed from storage only after the record is gone
  const { data: files } = await supabase.from("student_documents").select("file_path").eq("student_id", id!).not("file_path", "is", null);
  const { error } = await supabase.rpc("delete_student", { sid: school.id, stu: id, p_confirm: str(f, "confirm", 40) ?? "" });
  if (error) go(to, { error: errMsg(error) });
  const paths = ((files ?? []) as { file_path: string }[]).map((x) => x.file_path);
  if (paths.length) await supabaseAdmin()?.storage.from(DOC_BUCKET).remove(paths);
  revalidatePath("/app/students");
  go("/app/students", { ok: "Student record deleted." });
}

/** Tick rows on the student list → block / unblock / move to a section. */
export async function bulkStudents(f: FormData) {
  const { supabase, school } = await requirePerm("students.profile.view");
  const to = back(f, "/app/students");
  const picked = ids(f, "id");
  if (!picked.length) go(to, { error: "Tick at least one student." });
  const action = String(f.get("action") ?? "");
  if (action === "block" || action === "unblock") {
    const { data, error } = await supabase.rpc("bulk_block_students", { sid: school.id, p_ids: picked, p_block: action === "block", p_reason: str(f, "reason", 200), p_till: date(f, "till") });
    revalidatePath("/app/students");
    go(to, error ? { error: errMsg(error) } : { ok: `${data} student(s) ${action === "block" ? "blocked" : "unblocked"}.` });
  }
  if (action === "section") {
    const sec = uuid(f, "section_id");
    if (!sec) go(to, { error: "Choose the section." });
    const { data, error } = await supabase.rpc("bulk_set_section", { sid: school.id, p_ids: picked, p_section: sec });
    revalidatePath("/app/students");
    go(to, error ? { error: errMsg(error) } : { ok: `${data} student(s) moved. Students of other classes were left as they are.` });
  }
  go(to, { error: "Choose an action." });
}

/* ───────────── Staff ───────────── */
export async function blockStaff(f: FormData) {
  const { supabase, school } = await requirePerm("hr.staff.block");
  const id = uuid(f, "id");
  const to = `/app/hr/staff/${id}`;
  const { error } = await supabase.rpc("block_staff", { sid: school.id, p_staff: id, p_reason: str(f, "reason", 200) ?? "", p_till: date(f, "till") });
  revalidatePath(to);
  go(to, error ? { error: errMsg(error) } : { ok: "Blocked. If this person has an ERP login, they can no longer use it." });
}

export async function unblockStaff(f: FormData) {
  const { supabase, school } = await requirePerm("hr.staff.block");
  const id = uuid(f, "id");
  const to = `/app/hr/staff/${id}`;
  const { error } = await supabase.rpc("unblock_staff", { sid: school.id, p_staff: id });
  revalidatePath(to);
  go(to, error ? { error: errMsg(error) } : { ok: "Unblocked." });
}

export async function deleteStaffSafe(f: FormData) {
  const { supabase, school } = await requirePerm("hr.staff.delete");
  const id = uuid(f, "id");
  const { error } = await supabase.rpc("delete_staff", { sid: school.id, p_staff: id, p_confirm: str(f, "confirm", 100) ?? "" });
  if (error) go(`/app/hr/staff/${id}`, { error: errMsg(error) });
  revalidatePath("/app/hr");
  go("/app/hr", { ok: "Staff record deleted." });
}

/** A login without a staff record (Settings → Staff & access). */
export async function setLoginBlocked(f: FormData) {
  const { supabase, school } = await requirePerm("hr.staff.block");
  const user = uuid(f, "user_id");
  const block = f.get("block") === "1";
  const to = back(f, `/app/settings/staff?user=${user}`);
  const { error } = await supabase.rpc("set_member_blocked", { sid: school.id, p_user: user, p_block: block, p_till: date(f, "till") });
  go(to, error ? { error: errMsg(error) } : { ok: block ? "Login blocked." : "Login unblocked." });
}
