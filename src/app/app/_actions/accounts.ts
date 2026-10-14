"use server";

import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const back = (f: FormData, fallback: string) => {
  const b = str(f, "back", 300);
  return b && b.startsWith("/app/accounts") ? b : fallback;
};

export async function saveVoucher(f: FormData) {
  const { supabase, school } = await requirePerm("accounts.vouchers.create", "accounts.vouchers.edit");
  const id = uuid(f, "id");
  const kind = oneOf(f, "kind", ["receipt", "payment", "transfer"] as const, "receipt");
  const dest = back(f, "/app/accounts/vouchers");
  const { error } = await supabase.rpc("save_voucher", {
    sid: school.id, p_id: id, p_kind: kind, p_date: date(f, "date") ?? todayIST(), p_head: uuid(f, "head_id"), p_book: uuid(f, "book_id"), p_to_book: uuid(f, "to_book_id"),
    p_amount: num(f, "amount"), p_party: str(f, "party", 120), p_mode: str(f, "mode", 20), p_ref: str(f, "ref_no", 60), p_narration: str(f, "narration", 500),
  });
  go(dest, error ? { error: errMsg(error) } : { ok: id ? "Voucher updated." : "Voucher saved." });
}

export async function decideVoucher(f: FormData) {
  const { supabase } = await requirePerm("accounts.vouchers.approve");
  const { error } = await supabase.rpc("decide_voucher", { vid: uuid(f, "id"), p_approve: f.get("approve") === "1", p_note: str(f, "note", 300) });
  go(back(f, "/app/accounts/vouchers?status=pending"), error ? { error: errMsg(error) } : { ok: f.get("approve") === "1" ? "Voucher approved and posted." : "Voucher rejected." });
}

export async function cancelVoucher(f: FormData) {
  const { supabase } = await requirePerm("accounts.vouchers.edit");
  const { error } = await supabase.rpc("cancel_voucher", { vid: uuid(f, "id"), p_reason: str(f, "reason", 300) ?? "" });
  go(back(f, "/app/accounts/vouchers"), error ? { error: errMsg(error) } : { ok: "Voucher cancelled." });
}

export async function saveHead(f: FormData) {
  const { supabase, school } = await requirePerm("accounts.vouchers.edit");
  const name = str(f, "name", 60);
  if (!name) go("/app/accounts/setup", { error: "Enter a name for the head." });
  const { error } = await supabase.from("account_heads").insert({ school_id: school.id, name, kind: oneOf(f, "kind", ["income", "expense"] as const, "expense") });
  go("/app/accounts/setup", error ? { error: /unique/i.test(error.message) ? "That head already exists." : errMsg(error) } : { ok: "Head added." });
}

export async function toggleHead(f: FormData) {
  const { supabase, school } = await requirePerm("accounts.vouchers.edit");
  const { error } = await supabase.from("account_heads").update({ active: f.get("active") === "1" }).eq("id", uuid(f, "id")).eq("school_id", school.id);
  go("/app/accounts/setup", error ? { error: errMsg(error) } : { ok: "Head updated." });
}

export async function saveBook(f: FormData) {
  const { supabase, school } = await requirePerm("accounts.vouchers.edit");
  const id = uuid(f, "id");
  const name = str(f, "name", 60);
  if (!name) go("/app/accounts/setup", { error: "Enter a name for the book." });
  const row = { name, account_no: str(f, "account_no", 40), opening_balance: Math.round((num(f, "opening_balance") ?? 0) * 100) / 100, opening_date: date(f, "opening_date") ?? todayIST() };
  const { error } = id
    ? await supabase.from("account_books").update(row).eq("id", id).eq("school_id", school.id)
    : await supabase.from("account_books").insert({ ...row, school_id: school.id, kind: oneOf(f, "kind", ["cash", "bank"] as const, "bank") });
  go("/app/accounts/setup", error ? { error: /unique/i.test(error.message) ? "A book with this name already exists." : errMsg(error) } : { ok: id ? "Book updated." : "Book added." });
}

export async function toggleBook(f: FormData) {
  const { supabase, school } = await requirePerm("accounts.vouchers.edit");
  const { error } = await supabase.from("account_books").update({ active: f.get("active") === "1" }).eq("id", uuid(f, "id")).eq("school_id", school.id);
  go("/app/accounts/setup", error ? { error: errMsg(error) } : { ok: "Book updated." });
}

export async function saveAccountSettings(f: FormData) {
  const { supabase, school } = await requirePerm("accounts.vouchers.edit");
  const { error } = await supabase.from("account_settings").upsert({ school_id: school.id, approval_above: Math.max(0, num(f, "approval_above") ?? 0) });
  go("/app/accounts/setup", error ? { error: errMsg(error) } : { ok: "Approval limit saved." });
}
