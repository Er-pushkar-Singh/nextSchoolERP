"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { errMsg, go, num, str, uuid } from "@/lib/action-util";

/** Pages post back to where they were (filters and page kept); only paths inside the library are accepted. */
const backTo = (f: FormData, fallback = "/app/library") => {
  const b = str(f, "back", 300);
  return b && /^\/app\/library(\/[a-z-]+)?(\?[^#\s]*)?$/.test(b) ? b : fallback;
};
const clean = (e: { message?: string } | null) => errMsg(e);

/* ───────── Catalogue ───────── */

export async function saveBook(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "library.catalogue.edit" : "library.catalogue.create");
  const back = backTo(f, "/app/library/books");
  const title = str(f, "title", 200);
  if (!title) go(back, { error: "Title is required." });
  const copies = num(f, "copies") ?? 1;
  if (copies < 0 || copies > 500) go(back, { error: "Copies must be between 0 and 500." });
  const row = {
    title, accession_no: str(f, "accession_no", 30), author: str(f, "author", 120), publisher: str(f, "publisher", 120), isbn: str(f, "isbn", 20)?.replace(/[^0-9Xx]/g, "") || null,
    category: str(f, "category", 60), language: str(f, "language", 30), shelf: str(f, "shelf", 30), copies: Math.round(copies), price: num(f, "price"), tags: str(f, "tags", 200),
    active: f.get("active") !== "off",
  };
  const { error } = id
    ? await supabase.from("library_books").update(row).eq("id", id).eq("school_id", school.id)
    : await supabase.from("library_books").insert({ ...row, school_id: school.id });
  revalidatePath("/app/library");
  if (error) go(back, { error: /unique/i.test(error.message) ? "Another book already has this accession number." : errMsg(error) });
  go("/app/library/books", { ok: id ? "Book updated." : `“${title}” added to the catalogue.` });
}

export async function deleteBook(f: FormData) {
  const { supabase, school } = await requirePerm("library.catalogue.delete");
  const { error } = await supabase.from("library_books").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go("/app/library/books", error ? { error: /foreign key|violates/i.test(error.message) ? "This book has an issue history, so it can't be deleted. Withdraw it from circulation instead." : errMsg(error) } : { ok: "Book removed." });
}

/* ───────── Issue & return ───────── */

/** The member's code: typed / scanned, or the picked student or staff member's own card code. */
async function memberCode(f: FormData, supabase: Awaited<ReturnType<typeof requirePerm>>["supabase"], schoolId: string) {
  const typed = str(f, "member_code", 40);
  if (typed) return typed;
  const stu = uuid(f, "student_id");
  if (stu) {
    const { data } = await supabase.from("students").select("att_code,admission_no").eq("id", stu).eq("school_id", schoolId).maybeSingle();
    return data?.att_code ?? data?.admission_no ?? null;
  }
  const stf = uuid(f, "staff_id");
  if (stf) {
    const { data } = await supabase.from("staff").select("att_code,emp_code").eq("id", stf).eq("school_id", schoolId).maybeSingle();
    return data?.att_code ?? data?.emp_code ?? null;
  }
  return null;
}

export async function issueBook(f: FormData) {
  const { supabase, school } = await requirePerm("library.circulation.create");
  const back = backTo(f);
  let book = uuid(f, "book_id");
  const acc = str(f, "accession_no", 30);
  if (!book && acc) {
    let { data } = await supabase.from("library_books").select("id").eq("school_id", school.id).eq("accession_no", acc).limit(2);
    const isbn = acc.replace(/[^0-9Xx]/g, "");
    if (!data?.length && isbn.length >= 10) ({ data } = await supabase.from("library_books").select("id").eq("school_id", school.id).eq("isbn", isbn).limit(2));
    if ((data ?? []).length === 1) book = data![0].id;
    else go(back, { error: data?.length ? `More than one book matches “${acc}”. Pick it by title.` : `No book with accession no. / ISBN “${acc}”.` });
  }
  if (!book) go(back, { error: "Pick the book, or scan / type its accession number." });
  const code = await memberCode(f, supabase, school.id);
  if (!code) go(back, { error: "Pick the student or staff member, or scan / type the card code." });
  const days = num(f, "days");
  const { data, error } = await supabase.rpc("library_issue", { sid: school.id, p_book: book!, p_code: code!, p_days: days ? Math.round(days) : null });
  revalidatePath("/app/library");
  if (error) go(back, { error: clean(error) });
  const r = data as { member: string; book: string; due_on: string };
  go(back, { ok: `“${r.book}” issued to ${r.member} — due back on ${r.due_on}.` });
}

export async function returnBook(f: FormData) {
  const { supabase, school } = await requirePerm("library.circulation.edit");
  const back = backTo(f);
  const lost = f.get("lost") === "on";
  const waive = f.get("waive") === "on";
  const fine = num(f, "fine");
  const { data, error } = await supabase.rpc("library_return", { sid: school.id, p_issue: uuid(f, "id")!, p_lost: lost, p_fine: fine, p_waive: waive });
  revalidatePath("/app/library");
  if (error) go(back, { error: clean(error) });
  const r = data as { fine: number; lost: boolean; reservation_waiting: boolean };
  const bits = [lost ? "Marked lost" : "Returned", r.fine > 0 ? `fine ₹${r.fine}` : null, r.reservation_waiting ? "a reservation is waiting for this title" : null].filter(Boolean);
  go(back, { ok: `${bits.join(" · ")}.` });
}

export async function renewBook(f: FormData) {
  const { supabase, school } = await requirePerm("library.circulation.edit");
  const back = backTo(f);
  const { data, error } = await supabase.rpc("library_renew", { sid: school.id, p_issue: uuid(f, "id")! });
  revalidatePath("/app/library");
  go(back, error ? { error: clean(error) } : { ok: `Renewed until ${data}.` });
}

export async function collectLibraryFine(f: FormData) {
  const { supabase, school } = await requirePerm("library.circulation.edit");
  const back = backTo(f);
  const mode = str(f, "mode", 20) ?? "cash";
  const { error } = await supabase.rpc("library_collect_fine", { sid: school.id, p_issue: uuid(f, "id")!, p_mode: mode });
  revalidatePath("/app/library");
  go(back, error ? { error: clean(error) } : { ok: "Fine collected and posted to the day book." });
}

/* ───────── Reservations ───────── */

export async function reserveBook(f: FormData) {
  const { supabase, school } = await requirePerm("library.circulation.create");
  const back = backTo(f, "/app/library/reservations");
  const book = uuid(f, "book_id");
  if (!book) go(back, { error: "Pick the book." });
  const code = await memberCode(f, supabase, school.id);
  if (!code) go(back, { error: "Pick the student or staff member." });
  const { error } = await supabase.rpc("library_reserve", { sid: school.id, p_book: book!, p_code: code! });
  revalidatePath("/app/library");
  go(back, error ? { error: clean(error) } : { ok: "Reserved. The member is next in line when a copy comes back." });
}

export async function cancelReservation(f: FormData) {
  const { supabase, school } = await requirePerm("library.circulation.edit");
  const back = backTo(f, "/app/library/reservations");
  const { error } = await supabase.rpc("library_cancel_reservation", { sid: school.id, p_res: uuid(f, "id")! });
  revalidatePath("/app/library");
  go(back, error ? { error: clean(error) } : { ok: "Reservation cancelled." });
}

/* ───────── Loan rules ───────── */

export async function saveLibrarySettings(f: FormData) {
  const { supabase, school } = await requirePerm("library.catalogue.edit");
  const n = (k: string, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.round(num(f, k) ?? d)));
  const { error } = await supabase.from("library_settings").upsert({
    school_id: school.id,
    loan_days_student: n("loan_days_student", 1, 90, 14), loan_days_staff: n("loan_days_staff", 1, 180, 30),
    max_books_student: n("max_books_student", 1, 20, 3), max_books_staff: n("max_books_staff", 1, 40, 5),
    fine_per_day: Math.min(1000, Math.max(0, num(f, "fine_per_day") ?? 1)), grace_days: n("grace_days", 0, 14, 0),
    max_renewals: n("max_renewals", 0, 10, 2), renew_days: n("renew_days", 1, 60, 7), block_when_overdue: f.get("block_when_overdue") === "on",
  });
  revalidatePath("/app/library");
  go("/app/library/settings", error ? { error: errMsg(error) } : { ok: "Loan rules saved." });
}
