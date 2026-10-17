"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requireChild } from "@/lib/family";
import { date, errMsg, go, str, uuid } from "@/lib/action-util";

/** Parent / student applies for leave (the database checks the child belongs to this login). */
export async function familyApplyLeave(f: FormData) {
  const id = uuid(f, "student_id");
  if (!id) redirect("/family");
  const { supabase } = await requireChild(id);
  const back = `/family/${id}/leave`;
  const d1 = date(f, "from_date"), d2 = date(f, "to_date") ?? d1;
  if (!d1 || !d2) go(back, { error: "Choose the first and last day of the leave." });
  const { error } = await supabase.rpc("apply_student_leave", { stu: id, d1, d2, why: str(f, "reason", 300) });
  revalidatePath(back);
  go(back, error ? { error: errMsg(error) } : { ok: "Leave request sent to the class teacher. You will see the decision here." });
}

export async function familyCancelLeave(f: FormData) {
  const id = uuid(f, "student_id"), lid = uuid(f, "id");
  if (!id || !lid) redirect("/family");
  const { supabase } = await requireChild(id);
  const { error } = await supabase.rpc("cancel_student_leave", { lid });
  revalidatePath(`/family/${id}/leave`);
  go(`/family/${id}/leave`, error ? { error: errMsg(error) } : { ok: "Request cancelled." });
}

export async function familySendMessage(f: FormData) {
  const id = uuid(f, "student_id");
  if (!id) redirect("/family");
  const { supabase } = await requireChild(id);
  const back = `/family/${id}/messages`;
  const body = str(f, "body", 2000);
  if (!body) go(back, { error: "Write a message first." });
  const { error } = await supabase.rpc("send_family_message", { stu: id, msg: body });
  revalidatePath(back);
  go(`${back}#end`, error ? { error: errMsg(error) } : { ok: "Sent." });
}

export async function familyChangePassword(f: FormData) {
  const pw = String(f.get("password") ?? "");
  if (pw.length < 8) go("/family/account", { error: "Use at least 8 characters." });
  if (pw !== String(f.get("confirm") ?? "")) go("/family/account", { error: "The two passwords don't match." });
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: pw });
  go("/family/account", error ? { error: errMsg(error) } : { ok: "Password changed." });
}
