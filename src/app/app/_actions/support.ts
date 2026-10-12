"use server";

import { requirePerm } from "@/lib/school";
import { errMsg, go, oneOf, str, uuid } from "@/lib/action-util";

export async function createTicket(f: FormData) {
  const { supabase, school, user, myName } = await requirePerm("support.tickets.create");
  const subject = str(f, "subject", 150);
  const body = str(f, "body", 8000);
  if (!subject || !body) go("/app/support", { error: "Write a subject and describe the problem." });
  const { data, error } = await supabase.from("tickets").insert({
    school_id: school.id, created_by: user.id, created_by_name: myName || user.email, subject,
    category: oneOf(f, "category", ["question", "bug", "billing", "feature", "data", "other"] as const, "question"),
    priority: oneOf(f, "priority", ["low", "normal", "high", "urgent"] as const, "normal"),
  }).select("id").single();
  if (error) go("/app/support", { error: errMsg(error) });
  await supabase.from("ticket_messages").insert({ ticket_id: data!.id, author: user.id, author_name: myName || user.email, body });
  go(`/app/support/${data!.id}`, { ok: "Sent to CodersDuniya support. You'll see replies here." });
}

export async function replyTicketSchool(f: FormData) {
  const { supabase, user, myName } = await requirePerm("support.tickets.create");
  const id = uuid(f, "ticket_id");
  const body = str(f, "body", 8000);
  if (!body) go(`/app/support/${id}`, { error: "Write a message." });
  const { error } = await supabase.from("ticket_messages").insert({ ticket_id: id, author: user.id, author_name: myName || user.email, body });
  go(`/app/support/${id}`, error ? { error: errMsg(error) } : { ok: "Reply sent." });
}
