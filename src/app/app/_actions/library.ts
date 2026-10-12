"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, str, uuid } from "@/lib/action-util";
import { addDays, todayIST } from "@/lib/format";

/* ───────── Catalogue ───────── */

export async function saveBook(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "library.catalogue.edit" : "library.catalogue.create");
  const back = `/app/library/books${id ? `?edit=${id}` : ""}`;
  const title = str(f, "title", 200);
  if (!title) go(back, { error: "Title is required." });
  const copies = num(f, "copies") ?? 1;
  if (copies < 0) go(back, { error: "Copies can't be negative." });
  const row = {
    title, accession_no: str(f, "accession_no", 30), author: str(f, "author", 120), publisher: str(f, "publisher", 120), isbn: str(f, "isbn", 20)?.replace(/[^0-9Xx]/g, "") || null,
    category: str(f, "category", 60), language: str(f, "language", 30), shelf: str(f, "shelf", 30), copies: Math.round(copies), price: num(f, "price"),
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
  go("/app/library/books", error ? { error: /foreign key|violates/i.test(error.message) ? "This book has an issue history, so it can't be deleted. Set its copies to 0 instead." : errMsg(error) } : { ok: "Book removed." });
}

/* ───────── Issue & return ───────── */

export async function issueBook(f: FormData) {
  const { supabase, school, myName } = await requirePerm("library.circulation.create");
  const back = "/app/library";
  let book_id = uuid(f, "book_id");
  const acc = str(f, "accession_no", 30);
  if (!book_id && acc) {
    let { data } = await supabase.from("library_books").select("id").eq("school_id", school.id).eq("accession_no", acc).limit(2);
    const isbn = acc.replace(/[^0-9Xx]/g, "");
    if (!data?.length && isbn.length >= 10) ({ data } = await supabase.from("library_books").select("id").eq("school_id", school.id).eq("isbn", isbn).limit(2));
    if ((data ?? []).length === 1) book_id = data![0].id;
    else go(back, { error: data?.length ? `More than one book matches “${acc}”. Pick it from the catalogue.` : `No book with accession no. / ISBN “${acc}”.` });
  }
  if (!book_id) go(back, { error: "Enter the book's accession number." });
  let student_id: string | null = null;
  const staff_id = uuid(f, "staff_id");
  const adm = str(f, "admission_no", 30);
  if (!staff_id) {
    if (!adm) go(back, { error: "Enter the student's admission number (or pick a staff member)." });
    const { data } = await supabase.from("students").select("id,status").eq("school_id", school.id).eq("admission_no", adm!).maybeSingle();
    if (!data) go(back, { error: `No student with admission no. “${adm}”.` });
    if (data!.status !== "active") go(back, { error: "That student is no longer active." });
    student_id = data!.id;
  }
  const days = Math.min(90, Math.max(1, Math.round(num(f, "days") ?? 14)));
  const issued_on = todayIST();
  const { error } = await supabase.from("library_issues").insert({
    school_id: school.id, book_id, student_id, staff_id: student_id ? null : staff_id, issued_on, due_on: addDays(issued_on, days), issued_by_name: myName || null, note: str(f, "note", 200),
  });
  revalidatePath("/app/library");
  go(back, error ? { error: errMsg(error) } : { ok: `Book issued — due back on ${addDays(issued_on, days)}.` });
}

export async function returnBook(f: FormData) {
  const { supabase, school } = await requirePerm("library.circulation.edit");
  const fine = Math.max(0, num(f, "fine") ?? 0);
  const returned_on = date(f, "returned_on") ?? todayIST();
  const { data, error } = await supabase.from("library_issues").update({ returned_on, fine }).eq("id", uuid(f, "id")!).eq("school_id", school.id).is("returned_on", null).select("id");
  revalidatePath("/app/library");
  go("/app/library", error ? { error: errMsg(error) } : data?.length ? { ok: fine ? `Returned. Fine ₹${fine} recorded.` : "Returned." } : { error: "Already returned." });
}

export async function renewBook(f: FormData) {
  const { supabase, school } = await requirePerm("library.circulation.edit");
  const days = Math.min(90, Math.max(1, Math.round(num(f, "days") ?? 7)));
  const due = date(f, "due_on") ?? todayIST();
  const next = addDays(due < todayIST() ? todayIST() : due, days);
  const { data, error } = await supabase.from("library_issues").update({ due_on: next }).eq("id", uuid(f, "id")!).eq("school_id", school.id).is("returned_on", null).select("id");
  revalidatePath("/app/library");
  go("/app/library", error ? { error: errMsg(error) } : data?.length ? { ok: `Renewed until ${next}.` } : { error: "Already returned." });
}
