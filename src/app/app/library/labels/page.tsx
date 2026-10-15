import { requirePerm } from "@/lib/school";
import { Empty, PageHeader } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { qrDataUrl } from "@/lib/qr";

type B = { id: string; accession_no: string | null; title: string; author: string | null; shelf: string | null };

/** Book labels: the accession number as a QR code + text, 3 across, for the spine or inside cover. */
export default async function Labels({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school } = await requirePerm("library.catalogue.view");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const { data } = await supabase.rpc("library_book_list", { sid: school.id, p_q: q || null, p_category: sp.category || null, p_language: sp.language || null, p_avail: sp.avail || null, p_limit: 120, p_offset: 0 });
  const books = ((data ?? []) as B[]).filter((b) => b.accession_no);
  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <PageHeader icon="library" title="Book labels" subtitle={`${books.length} label${books.length === 1 ? "" : "s"} — up to 120 at a time; filter the catalogue to choose which`} back={{ href: "/app/library/books", label: "Catalogue" }} actions={<PrintButton />} />
      </div>
      {books.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 print:grid-cols-3">
          {books.map((b) => (
            <div key={b.id} className="flex items-center gap-3 rounded-[8px] border border-dashed border-line-strong p-2.5 [break-inside:avoid]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl(b.accession_no!)} alt="" width={64} height={64} className="h-16 w-16 shrink-0" />
              <div className="min-w-0 text-[11px] leading-tight">
                <p className="m-0 truncate text-[10px] font-bold tracking-wide text-muted uppercase">{school.name}</p>
                <p className="m-0 mt-0.5 font-mono text-[14px] font-extrabold text-ink">{b.accession_no}</p>
                <p className="m-0 mt-0.5 line-clamp-2 text-body">{b.title}</p>
                {b.shelf && <p className="m-0 text-muted">Shelf {b.shelf}</p>}
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>No book with an accession number matches.</Empty>}
    </div>
  );
}
