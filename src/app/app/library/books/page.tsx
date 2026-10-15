import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { money } from "@/lib/format";
import { deleteBook, saveBook } from "../../_actions/library";

type Book = { id: string; accession_no: string | null; title: string; author: string | null; publisher: string | null; isbn: string | null; category: string | null; language: string | null;
  shelf: string | null; copies: number; price: number | null; active: boolean; out_now: number; available: number; reserved: number; times_issued: number; total: number };
type Full = Book & { tags: string | null };

function BookForm({ b, back }: { b?: Full | null; back: string }) {
  return (
    <form action={saveBook} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="back" value={back} />
      {b && <input type="hidden" name="id" value={b.id} />}
      <Input label="Title" name="title" required defaultValue={b?.title} className="sm:col-span-2" />
      <Input label="Author" name="author" defaultValue={b?.author} />
      <Input label="Accession no." name="accession_no" defaultValue={b?.accession_no} hint="Unique number on the book" />
      <Input label="Publisher" name="publisher" defaultValue={b?.publisher} />
      <Input label="ISBN" name="isbn" defaultValue={b?.isbn} />
      <Input label="Category" name="category" defaultValue={b?.category} placeholder="Fiction, Reference, NCERT …" />
      <Input label="Language" name="language" defaultValue={b?.language} placeholder="English" />
      <Input label="Shelf / rack" name="shelf" defaultValue={b?.shelf} />
      <Input label="Copies" name="copies" type="number" min={0} max={500} defaultValue={b?.copies ?? 1} />
      <Input label="Price (₹)" name="price" type="number" min={0} step="0.01" defaultValue={b?.price} hint="Charged if the book is lost" />
      <Input label="Tags" name="tags" defaultValue={b?.tags} placeholder="class 9, science, olympiad" />
      {b && <label className="flex items-center gap-2 text-[14px] sm:col-span-3"><input type="checkbox" name="active" defaultChecked={b.active} value="on" /> In circulation (untick to withdraw a damaged or old book)</label>}
      <div className="sm:col-span-3"><Submit>{b ? "Save book" : "Add book"}</Submit></div>
    </form>
  );
}

export default async function Books({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("library.catalogue.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const q = (sp.q ?? "").trim().slice(0, 60);
  const category = (sp.category ?? "").slice(0, 60) || null;
  const language = (sp.language ?? "").slice(0, 30) || null;
  const avail = ["yes", "no", "withdrawn"].includes(sp.avail ?? "") ? sp.avail! : null;
  const editId = sp.edit && /^[0-9a-f-]{36}$/.test(sp.edit) && can("library.catalogue.edit") ? sp.edit : null;

  const [{ data: rows }, { data: facets }, edit] = await Promise.all([
    supabase.rpc("library_book_list", { sid: school.id, p_q: q || null, p_category: category, p_language: language, p_avail: avail, p_limit: size, p_offset: offset }),
    supabase.from("library_books").select("category,language").eq("school_id", school.id).limit(5000),
    editId ? supabase.from("library_books").select("*").eq("id", editId).eq("school_id", school.id).maybeSingle().then((r) => r.data as Full | null) : Promise.resolve(null),
  ]);
  const B = (rows ?? []) as Book[];
  const total = B[0] ? Number(B[0].total) : 0;
  const cats = [...new Set((facets ?? []).map((f) => f.category).filter(Boolean) as string[])].sort();
  const langs = [...new Set((facets ?? []).map((f) => f.language).filter(Boolean) as string[])].sort();
  const params = { q: q || undefined, category: category ?? undefined, language: language ?? undefined, avail: avail ?? undefined };
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  const base = `/app/library/books${qs ? `?${qs}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="library" title="Book catalogue" subtitle={`${total} ${total === 1 ? "title" : "titles"}${q || category || language || avail ? " match" : ""}`} back={{ href: "/app/library", label: "Library" }}
        actions={<>
          <Link href={`/app/library/labels${qs ? `?${qs}` : ""}`} className="btn btn-sm btn-secondary">Print labels</Link>
          {can("library.catalogue.create") && <Modal label="+ Add book" title="Add a book"><BookForm back={base} /></Modal>}
        </>} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Title, author, accession no., ISBN, tag" className="input !min-h-10 w-72 !py-2 text-[15px] font-normal" /></label>
        <Select label="Category" name="category" blank="All" defaultValue={category} options={cats} />
        <Select label="Language" name="language" blank="All" defaultValue={language} options={langs} />
        <Select label="Availability" name="avail" blank="Any" defaultValue={avail} options={[["yes", "Available now"], ["no", "All copies out"], ["withdrawn", "Withdrawn"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Filter</button>
        {(q || category || language || avail) && <Link href="/app/library/books" className="pb-2 text-[14px]">Clear</Link>}
      </form>

      {B.length ? (
        <Table head={["Acc. no.", "Title", "Category / shelf", "Copies", "Issued", ""]} minWidth={860}>
          {B.map((b) => (
            <tr key={b.id}>
              <td className={`${td} font-mono text-[13px]`}>{b.accession_no ?? "—"}</td>
              <td className={td}>
                <b className="text-ink">{b.title}</b>{!b.active && <> <Badge value="muted" text="Withdrawn" /></>}
                <div className="text-[12px] text-muted">{[b.author, b.publisher, b.isbn ? `ISBN ${b.isbn}` : null, b.language].filter(Boolean).join(" · ")}</div>
              </td>
              <td className={td}>{b.category ?? "—"}<div className="text-[12px] text-muted">{b.shelf ? `Shelf ${b.shelf}` : ""}{b.price ? ` · ${money(b.price)}` : ""}</div></td>
              <td className={td}><b className={b.available > 0 ? "text-ink" : "text-error"}>{b.available}</b><span className="text-muted"> / {b.copies}</span>
                {b.reserved > 0 && <div className="text-[12px] text-muted">{b.reserved} reserved</div>}</td>
              <td className={td}>{b.times_issued}×</td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>
                {can("library.catalogue.edit") && <Link href={`${base}${qs ? "&" : "?"}edit=${b.id}`}>Edit</Link>}
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || category || language || avail ? "No book matches these filters." : "The catalogue is empty — add the first book."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/library/books" params={params} />

      {edit && (
        <Modal defaultOpen closeHref={base} title={`Edit: ${edit.title}`}>
          <BookForm b={edit} back={base} />
          {can("library.catalogue.delete") && (
            <form action={deleteBook} className="mt-4 border-t border-line pt-3">
              <input type="hidden" name="id" value={edit.id} />
              <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Delete this book</button>
              <span className="ml-2 text-[12px] text-muted">Only possible when it was never issued.</span>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
