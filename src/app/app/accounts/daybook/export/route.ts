import { requirePerm } from "@/lib/school";
import { toCsv } from "@/lib/csv";
import { period, SOURCE_LABEL } from "@/lib/accounts";

/** The day book for the chosen filters, every page, as CSV. */
export async function GET(req: Request) {
  const { supabase, school } = await requirePerm("accounts.books.export", "accounts.vouchers.export");
  const u = new URL(req.url);
  const g = (k: string) => u.searchParams.get(k) || null;
  const uuidOk = (v: string | null) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const { from, to } = period({ from: g("from") ?? undefined, to: g("to") ?? undefined });
  const dir = g("dir") === "in" || g("dir") === "out" ? g("dir") : null;
  const rows: string[][] = [["Date", "Head", "Party", "Source", "Voucher / receipt", "Book", "Mode", "Reference", "Narration", "Money in", "Money out"]];
  for (let p = 0; p < 40; p++) {
    const { data } = await supabase.rpc("account_daybook", { sid: school.id, d1: from, d2: to, p_book: uuidOk(g("book")), p_dir: dir, p_head: g("head"), p_source: g("source"), p_q: g("q"), p_limit: 500, p_offset: p * 500 });
    const list = (data ?? []) as { on_date: string; head: string; party: string | null; source: string; voucher_no: string | null; ref: string | null; book_name: string | null; mode: string | null;
      narration: string | null; dir: string; amount: number }[];
    for (const r of list) {
      rows.push([r.on_date, r.head, r.party ?? "", SOURCE_LABEL[r.source] ?? r.source, r.voucher_no ?? "", r.book_name ?? "", r.mode ?? "", r.ref ?? "", r.narration ?? "",
        r.dir === "in" ? String(r.amount) : "", r.dir === "out" ? String(r.amount) : ""]);
    }
    if (list.length < 500) break;
  }
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="daybook-${from}-to-${to}.csv"`, "Cache-Control": "no-store" } });
}
