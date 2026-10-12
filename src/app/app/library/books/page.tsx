import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { cleanSearch, money } from "@/lib/format";
import { deleteBook, saveBook } from "../../_actions/library";

type Book = { id: string; accession_no: string | null; title: string; author: string | null; publisher: string | null; isbn: string | null; category: string | null; language: string | null; shelf: string | null; copies: number; price: number | null };

export default async function Books({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("library.catalogue.view");
  const sp = await searchParams;
  const q = cleanSearch(sp.q ?? "").trim();
  let query = supabase.from("library_books").select("*").eq("school_id", school.id).order("title").limit(200);
  if (q) query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%,accession_no.ilike.${q}%,isbn.ilike.${q}%,category.ilike.%${q}%`);
  const [{ data }, { count }, edit] = await Promise.all([
    query,
    supabase.from("library_books").select("id", { count: "exact", head: true }).eq("school_id", school.id),
    sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) && can("library.catalogue.edit")
      ? supabase.from("library_books").select("*").eq("id", sp.edit).eq("school_id", school.id).maybeSingle().then((r) => r.data as Book | null)
      : Promise.resolve(null),
  ]);
  const B = (data ?? []) as Book[];
  const { data: out } = B.length ? await supabase.from("library_issues").select("book_id").in("book_id", B.map((b) => b.id)).is("returned_on", null) : { data: [] };
  const outOf = new Map<string, number>();
  for (const o of out ?? []) outOf.set(o.book_id, (outOf.get(o.book_id) ?? 0) + 1);
  const issue = can("library.circulation.create");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="library" title="Book catalogue" subtitle={`${count ?? 0} titles`} back={{ href: "/app/library", label: "Library" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Title, author, accession no., ISBN, category" className="input !min-h-11 max-w-md !py-2" aria-label="Search books" />
        <button className="btn btn-sm btn-secondary cursor-pointer">Search</button>
      </form>
      {B.length ? (
        <Table head={["Acc. no.", "Title", "Author", "Category", "Shelf", "Available", ""]} minWidth={820}>
          {B.map((b) => {
            const avail = Number(b.copies) - (outOf.get(b.id) ?? 0);
            return (
              <tr key={b.id} className={edit?.id === b.id ? "bg-blue-tint" : ""}>
                <td className={`${td} font-mono text-[13px]`}>{b.accession_no ?? "—"}</td>
                <td className={td}><b className="text-ink">{b.title}</b><div className="text-[12px] text-muted">{[b.publisher, b.isbn ? `ISBN ${b.isbn}` : null, b.language].filter(Boolean).join(" · ")}</div></td>
                <td className={td}>{b.author ?? "—"}</td>
                <td className={td}>{b.category ?? "—"}</td>
                <td className={td}>{b.shelf ?? "—"}</td>
                <td className={td}><b className={avail > 0 ? "text-ink" : "text-error"}>{avail}</b><span className="text-muted"> / {b.copies}</span></td>
                <td className={`${td} whitespace-nowrap text-[13px]`}>
                  {issue && avail > 0 && <Link href={`/app/library?book=${b.id}`} className="mr-3 font-semibold">Issue</Link>}
                  {can("library.catalogue.edit") && <Link href={`/app/library/books?edit=${b.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Edit</Link>}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{q ? `No book matches “${q}”.` : "The catalogue is empty."}</Empty>}

      {(edit || can("library.catalogue.create")) && (
        <Card title={edit ? `Edit: ${edit.title}` : "Add a book"} icon="book">
          <form action={saveBook} className="grid gap-3 sm:grid-cols-4">
            {edit && <input type="hidden" name="id" value={edit.id} />}
            <Input label="Title" name="title" required defaultValue={edit?.title} className="sm:col-span-2" />
            <Input label="Author" name="author" defaultValue={edit?.author} />
            <Input label="Accession no." name="accession_no" defaultValue={edit?.accession_no} hint="Unique number on the book" />
            <Input label="Publisher" name="publisher" defaultValue={edit?.publisher} />
            <Input label="ISBN" name="isbn" defaultValue={edit?.isbn} />
            <Input label="Category" name="category" defaultValue={edit?.category} placeholder="Fiction, Reference, NCERT …" />
            <Input label="Language" name="language" defaultValue={edit?.language} placeholder="English" />
            <Input label="Shelf / rack" name="shelf" defaultValue={edit?.shelf} />
            <Input label="Copies" name="copies" type="number" min={0} defaultValue={edit?.copies ?? 1} />
            <Input label="Price (₹)" name="price" type="number" min={0} step="0.01" defaultValue={edit?.price} hint={edit?.price ? money(edit.price) : undefined} />
            <div className="flex items-end gap-3"><Submit>{edit ? "Save" : "Add book"}</Submit>{edit && <Link href="/app/library/books" className="text-[14px]">Cancel</Link>}</div>
          </form>
          {edit && can("library.catalogue.delete") && (
            <form action={deleteBook} className="mt-3"><input type="hidden" name="id" value={edit.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Delete this book</button></form>
          )}
        </Card>
      )}
    </div>
  );
}
