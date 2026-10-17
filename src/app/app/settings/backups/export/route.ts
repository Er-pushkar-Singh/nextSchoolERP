import { requirePerm } from "@/lib/school";
import { BACKUP_BY_NAME, BACKUP_TABLES, type BackupTable } from "@/lib/backup";
import { toCsv } from "@/lib/csv";
import { todayIST } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 1000;
const CAP = 300_000;   // rows per table

type Db = Awaited<ReturnType<typeof requirePerm>>["supabase"];

/** Pages through one table (what the signed-in person may read), calling `each` per page. Returns the row count or an error. */
async function readTable(db: Db, schoolId: string, t: BackupTable, each: (rows: Record<string, unknown>[]) => void): Promise<{ n: number } | { error: string }> {
  let n = 0;
  for (let from = 0; from < CAP; from += PAGE) {
    let q = db.from(t.name).select("*").eq("school_id", schoolId);
    for (const o of t.order) q = q.order(o);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { error: error.message };
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) for (const k of t.drop ?? []) delete r[k];
    if (rows.length) each(rows);
    n += rows.length;
    if (rows.length < PAGE) break;
  }
  return { n };
}

/** GET ?table=students → one CSV · GET (no table) → every table the person may read, as one JSON file. Both are logged. */
export async function GET(req: Request) {
  const { supabase, school, can, myName, user } = await requirePerm("settings.backups.create");
  const u = new URL(req.url);
  const only = u.searchParams.get("table");
  const allowed = BACKUP_TABLES.filter((t) => !t.perm || can(t.perm));
  const log = (kind: string, tables: number, rows: number, size: number) =>
    supabase.from("backup_log").insert({ school_id: school.id, kind, tables, row_count: rows, size_bytes: size, by_user: user.id, by_name: myName || null });

  if (only) {
    const t = BACKUP_BY_NAME.get(only);
    if (!t || !allowed.includes(t)) return new Response("Not available", { status: 404 });
    const all: Record<string, unknown>[] = [];
    const r = await readTable(supabase, school.id, t, (rows) => all.push(...rows));
    if ("error" in r) return new Response(r.error, { status: 400 });
    const cols = [...new Set(all.flatMap((x) => Object.keys(x)))];
    const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    const csv = toCsv([cols, ...all.map((x) => cols.map((c) => cell(x[c])))]);
    await log(`csv:${t.name}`, 1, r.n, csv.length);
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${school.code}-${t.name}-${todayIST()}.csv"`, "Cache-Control": "no-store" } });
  }

  const enc = new TextEncoder();
  let size = 0, rowsTotal = 0, tablesDone = 0;
  const skipped: string[] = [];
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const put = (s: string) => { const b = enc.encode(s); size += b.length; ctrl.enqueue(b); };
      put(`{"format":"school-erp-backup/1","exported_at":${JSON.stringify(new Date().toISOString())},"exported_by":${JSON.stringify(myName || null)},"school":${JSON.stringify({ id: school.id, name: school.name, code: school.code })},"tables":{`);
      let first = true;
      for (const t of allowed) {
        put(`${first ? "" : ","}${JSON.stringify(t.name)}:[`);
        first = false;
        let firstRow = true;
        const r = await readTable(supabase, school.id, t, (rows) => { for (const row of rows) { put(`${firstRow ? "" : ","}${JSON.stringify(row)}`); firstRow = false; } });
        put("]");
        if ("error" in r) skipped.push(`${t.name}: ${r.error}`); else { rowsTotal += r.n; tablesDone++; }
      }
      put(`},"skipped":${JSON.stringify(skipped)}}`);
      await log("full", tablesDone, rowsTotal, size);
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${school.code}-backup-${todayIST()}.json"`, "Cache-Control": "no-store" } });
}
