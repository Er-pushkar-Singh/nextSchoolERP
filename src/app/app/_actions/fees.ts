"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function addFeeHead(f: FormData) {
  const { supabase, school } = await requirePerm("fees.structure.create");
  const name = str(f, "name", 60);
  if (!name) go("/app/fees/structure", { error: "Name is required." });
  const { error } = await supabase.from("fee_heads").insert({ school_id: school.id, name, sort: 50 });
  go("/app/fees/structure", error ? { error: /unique/i.test(error.message) ? "That fee head already exists." : errMsg(error) } : { ok: "Fee head added." });
}

export async function deleteFeeHead(f: FormData) {
  const { supabase, school } = await requirePerm("fees.structure.delete");
  const { count } = await supabase.from("fee_plans").select("id", { count: "exact", head: true }).eq("fee_head_id", uuid(f, "id")!);
  if (count) go("/app/fees/structure", { error: "Remove this head's instalments first." });
  const { error } = await supabase.from("fee_heads").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go("/app/fees/structure", error ? { error: errMsg(error) } : { ok: "Fee head removed." });
}

/** Adds instalments for a fee head to one or more classes, e.g. monthly tuition for classes 1–5. */
export async function addSchedule(f: FormData) {
  const { supabase, school, session } = await requirePerm("fees.structure.create");
  const back = "/app/fees/structure";
  if (!session) go(back, { error: "Set a current session in Settings first." });
  const head = uuid(f, "fee_head_id");
  const amount = num(f, "amount");
  const classIds = f.getAll("class_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const freq = oneOf(f, "frequency", ["monthly", "quarterly", "half_yearly", "annual", "once"] as const, "monthly");
  const day = Math.min(28, Math.max(1, num(f, "due_day") ?? 10));
  if (!head || amount === null || amount < 0 || !classIds.length) go(back, { error: "Choose a fee head, at least one class and an amount." });

  const start = new Date(`${session!.start_date}T00:00:00Z`);
  const step = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12, once: 12 }[freq];
  const n = 12 / step;
  const items: { label: string; due_date: string }[] = [];
  if (freq === "once") {
    items.push({ label: str(f, "label", 40) ?? "One time", due_date: date(f, "once_date") ?? session!.start_date });
  } else {
    for (let i = 0; i < n; i++) {
      const d = new Date(start); d.setUTCMonth(start.getUTCMonth() + i * step); d.setUTCDate(day);
      const endM = new Date(d); endM.setUTCMonth(d.getUTCMonth() + step - 1);
      const y = String(d.getUTCFullYear()).slice(2);
      const label = freq === "monthly" ? `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`
        : freq === "annual" ? `Annual ${session!.name}`
        : `${MON[d.getUTCMonth()]}–${MON[endM.getUTCMonth()]} ${y}`;
      items.push({ label, due_date: d.toISOString().slice(0, 10) });
    }
  }
  const rows = classIds.flatMap((class_id) => items.map((it) => ({ school_id: school.id, session_id: session!.id, class_id, fee_head_id: head, amount, ...it })));
  const { error } = await supabase.from("fee_plans").insert(rows);
  revalidatePath(back);
  go(back, error ? { error: errMsg(error) } : { ok: `Added ${rows.length} instalment(s). Click “Generate dues” to bill students.` });
}

export async function deletePlan(f: FormData) {
  const { supabase, school } = await requirePerm("fees.structure.delete");
  const ids = (f.getAll("id").map(String)).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (!ids.length) go("/app/fees/structure");
  const { count } = await supabase.from("fee_dues").select("id", { count: "exact", head: true }).in("fee_plan_id", ids).gt("paid", 0);
  if (count) go("/app/fees/structure", { error: `${count} student(s) have already paid against this. Cancel those receipts first, or keep it.` });
  await supabase.from("fee_dues").delete().in("fee_plan_id", ids).eq("school_id", school.id);
  const { error } = await supabase.from("fee_plans").delete().in("id", ids).eq("school_id", school.id);
  go("/app/fees/structure", error ? { error: errMsg(error) } : { ok: "Removed (and the unpaid dues created from it)." });
}

export async function generateDues(f: FormData) {
  const { supabase, school, session } = await requirePerm("fees.dues.create");
  if (!session) go("/app/fees/structure", { error: "No current session." });
  const cls = uuid(f, "class_id");
  const { data, error } = await supabase.rpc("generate_dues", { sid: school.id, sess: session!.id, ...(cls ? { cls } : {}) });
  go("/app/fees/structure", error ? { error: errMsg(error) } : { ok: `Created ${data} new instalment due(s). Already-billed students were skipped.` });
}

export async function collectFee(f: FormData) {
  const { supabase, school, myName } = await requirePerm("fees.collection.create");
  const student = uuid(f, "student_id");
  const amount = num(f, "amount");
  const back = `/app/fees/collect?student=${student}`;
  if (!student || !amount || amount <= 0) go(back, { error: "Enter the amount received." });
  const by = myName || null;
  const { data, error } = await supabase.rpc("collect_fee", {
    sid: school.id, stu: student, amt: amount,
    p_mode: oneOf(f, "mode", ["cash", "upi", "cheque", "bank_transfer", "card", "online"] as const, "cash"),
    p_ref: str(f, "reference", 80), p_note: str(f, "note", 300), p_paid_on: date(f, "paid_on"),
    p_fine: Math.max(0, num(f, "fine") ?? 0), p_by: by,
  });
  if (error) go(back, { error: errMsg(error) });
  go(`/app/fees/receipts/${data}`, { ok: "Fee received." });
}

export async function cancelReceipt(f: FormData) {
  const { supabase, school } = await requirePerm("fees.receipts.approve");
  const id = uuid(f, "id");
  const reason = str(f, "reason", 200);
  if (!reason) go(`/app/fees/receipts/${id}`, { error: "Write the reason for cancelling." });
  const { error } = await supabase.from("fee_receipts").update({ cancelled: true, cancelled_reason: reason }).eq("id", id!).eq("school_id", school.id).eq("cancelled", false);
  go(`/app/fees/receipts/${id}`, error ? { error: errMsg(error) } : { ok: "Receipt cancelled. The student's dues are back as unpaid." });
}
