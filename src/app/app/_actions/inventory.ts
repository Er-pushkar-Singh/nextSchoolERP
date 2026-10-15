"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";

const back = (f: FormData, fallback: string) => {
  const b = str(f, "back", 300);
  return b && /^\/app\/inventory(\/[a-z0-9-]+)*(\?[^#\s]*)?$/.test(b) ? b : fallback;
};
const done = () => revalidatePath("/app/inventory", "layout");

/* ───────── Items ───────── */
export async function saveItem(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "inventory.items.edit" : "inventory.items.create");
  const to = back(f, "/app/inventory/items");
  const name = str(f, "name", 120);
  if (!name) go(to, { error: "Give the item a name." });
  const cost = Math.max(0, num(f, "cost") ?? 0), price = Math.max(0, num(f, "price") ?? 0);
  const row = {
    name: name!, sku: str(f, "sku", 40), category: str(f, "category", 40) ?? "General", variant: str(f, "variant", 30), unit: str(f, "unit", 12) ?? "pcs", cost, price,
    gst_rate: Math.min(40, Math.max(0, num(f, "gst_rate") ?? 0)), reorder_level: Math.max(0, Math.round(num(f, "reorder_level") ?? 0)), track_stock: f.get("track_stock") !== "off",
    for_class_id: uuid(f, "for_class_id"), location: str(f, "location", 40), barcode: str(f, "barcode", 40), note: str(f, "note", 200), active: id ? f.get("active") === "on" : true,
  };
  const { data, error } = id
    ? await supabase.from("inventory_items").update(row).eq("id", id).eq("school_id", school.id).select("id").single()
    : await supabase.from("inventory_items").insert({ ...row, school_id: school.id }).select("id").single();
  if (error) go(to, { error: /unique|duplicate/i.test(error.message) ? "Another item already has this SKU." : errMsg(error) });
  // an opening stock typed on a new item is recorded as its first stock move
  const opening = Math.round(num(f, "opening") ?? 0);
  if (!id && opening > 0 && data) {
    const r = await supabase.rpc("inventory_adjust", { sid: school.id, p_item: data.id, p_qty: opening, p_kind: "opening", p_note: "Opening stock" });
    if (r.error) go(to, { error: `Item saved, but opening stock failed: ${errMsg(r.error)}` });
  }
  done();
  go(to, { ok: id ? "Item updated." : `“${name}” added${opening > 0 ? ` with ${opening} in stock` : ""}.` });
}

export async function adjustStock(f: FormData) {
  const { supabase, school } = await requirePerm("inventory.items.edit");
  const to = back(f, "/app/inventory/items");
  const kind = oneOf(f, "kind", ["adjust", "opening", "damage"] as const, "adjust");
  const qty = Math.round(num(f, "qty") ?? 0);
  const sign = f.get("direction") === "out" && kind === "adjust" ? -1 : 1;
  const { data, error } = await supabase.rpc("inventory_adjust", { sid: school.id, p_item: uuid(f, "item_id")!, p_qty: sign * qty, p_kind: kind, p_note: str(f, "note", 200) });
  done();
  go(to, error ? { error: errMsg(error) } : { ok: `Stock is now ${data}.` });
}

export async function issueItem(f: FormData) {
  const { supabase, school } = await requirePerm("inventory.items.edit");
  const to = back(f, "/app/inventory/items");
  const ret = f.get("return") === "1";
  const { data, error } = await supabase.rpc("inventory_issue", { sid: school.id, p_item: uuid(f, "item_id")!, p_qty: Math.round(num(f, "qty") ?? 0), p_to: str(f, "to", 80) ?? "", p_note: str(f, "note", 200), p_return: ret });
  done();
  go(to, error ? { error: errMsg(error) } : { ok: `${ret ? "Returned" : "Issued"}. Stock is now ${data}.` });
}

export async function stockTake(f: FormData) {
  const { supabase, school } = await requirePerm("inventory.items.edit");
  const to = back(f, "/app/inventory/stocktake");
  const counts: { item: string; counted: number }[] = [];
  for (const [k, v] of f.entries()) {
    const m = /^c_([0-9a-f-]{36})$/.exec(k);
    if (!m || typeof v !== "string" || v.trim() === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) go(to, { error: "Counts must be whole numbers, zero or more." });
    counts.push({ item: m[1], counted: n });
  }
  if (!counts.length) go(to, { error: "Enter at least one counted quantity." });
  const { data, error } = await supabase.rpc("inventory_stock_take", { sid: school.id, p_counts: counts });
  done();
  go(to, error ? { error: errMsg(error) } : { ok: data ? `Stock take saved — ${data} item${data === 1 ? "" : "s"} corrected.` : "Everything you counted already matched." });
}

/* ───────── Sales ───────── */
function lines(f: FormData) {
  try {
    const raw = JSON.parse(str(f, "lines", 20000) ?? "[]") as { item?: string; qty?: number; price?: number | null; unit_cost?: number }[];
    return raw.filter((l) => l.item && /^[0-9a-f-]{36}$/.test(l.item) && Number(l.qty) > 0).slice(0, 100);
  } catch { return []; }
}

export async function sellItems(f: FormData) {
  const { supabase, school } = await requirePerm("inventory.sales.create");
  const to = "/app/inventory/sell";
  const kind = oneOf(f, "kind", ["student", "staff", "walkin"] as const, "student");
  const items = lines(f).map((l) => ({ item: l.item, qty: Math.round(Number(l.qty)), ...(l.price !== null && l.price !== undefined ? { price: Number(l.price) } : {}) }));
  if (!items.length) go(to, { error: "Add at least one item to the bill." });
  const { data, error } = await supabase.rpc("inventory_sell", {
    sid: school.id, p_kind: kind, p_student: kind === "student" ? uuid(f, "student_id") : null, p_staff: kind === "staff" ? uuid(f, "staff_id") : null,
    p_name: str(f, "customer_name", 80), p_phone: str(f, "phone", 20), p_lines: items, p_discount: Math.max(0, num(f, "discount") ?? 0),
    p_mode: oneOf(f, "mode", ["cash", "upi", "card", "cheque", "bank_transfer", "fee_account"] as const, "cash"), p_note: str(f, "note", 200),
  });
  if (error) go(to, { error: errMsg(error) });
  done();
  revalidatePath("/app/fees");
  const r = data as { id: string; no: string; total: number; on_fee_account: boolean };
  go(`/app/inventory/sales/${r.id}`, { ok: r.on_fee_account ? `Bill ${r.no} added to the student's fee account.` : `Bill ${r.no} saved.` });
}

export async function cancelSale(f: FormData) {
  const { supabase, school } = await requirePerm("inventory.sales.edit");
  const to = back(f, "/app/inventory/sales");
  const { error } = await supabase.rpc("inventory_cancel_sale", { sid: school.id, p_sale: uuid(f, "id")!, p_reason: str(f, "reason", 300) ?? "" });
  done();
  revalidatePath("/app/fees");
  go(to, error ? { error: errMsg(error) } : { ok: "Sale cancelled — stock returned." });
}

/* ───────── Purchases & suppliers ───────── */
export async function savePurchase(f: FormData) {
  const { supabase, school } = await requirePerm("inventory.purchase.create");
  const to = "/app/inventory/purchases";
  const items = lines(f).map((l) => ({ item: l.item, qty: Math.round(Number(l.qty)), unit_cost: Math.max(0, Number(l.unit_cost ?? 0)) }));
  if (!items.length) go(to, { error: "Add at least one item." });
  const { data, error } = await supabase.rpc("inventory_purchase", {
    sid: school.id, p_supplier: uuid(f, "supplier_id"), p_date: date(f, "on_date"), p_bill: str(f, "bill_no", 40), p_lines: items,
    p_paid: Math.max(0, num(f, "paid") ?? 0), p_mode: oneOf(f, "mode", ["cash", "upi", "cheque", "bank_transfer", "card"] as const, "cash"), p_note: str(f, "note", 200),
  });
  done();
  const r = data as { no: string; total: number } | null;
  go(to, error ? { error: errMsg(error) } : { ok: `Purchase ${r?.no} saved — stock updated.` });
}

export async function saveSupplier(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "inventory.purchase.edit" : "inventory.purchase.create");
  const to = back(f, "/app/inventory/suppliers");
  const name = str(f, "name", 100);
  if (!name) go(to, { error: "Give the supplier a name." });
  const row = { name: name!, phone: str(f, "phone", 20), email: str(f, "email", 100), gstin: str(f, "gstin", 20), address: str(f, "address", 200), active: id ? f.get("active") === "on" : true };
  const { error } = id ? await supabase.from("inventory_suppliers").update(row).eq("id", id).eq("school_id", school.id) : await supabase.from("inventory_suppliers").insert({ ...row, school_id: school.id });
  go(to, error ? { error: /unique|duplicate/i.test(error.message) ? "A supplier with this name already exists." : errMsg(error) } : { ok: id ? "Supplier updated." : "Supplier added." });
}
