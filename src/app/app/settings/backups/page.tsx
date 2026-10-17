import { requirePerm } from "@/lib/school";
import { Card, Empty, PageHeader, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { BACKUP_TABLES } from "@/lib/backup";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default async function Backups({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("settings.backups.view", "settings.backups.create");
  const sp = await searchParams;
  const pg = pageParams(sp, 10, [10, 25, 50]);
  const { data: log, count } = await supabase.from("backup_log").select("id,kind,tables,row_count,size_bytes,by_name,created_at", { count: "exact" }).eq("school_id", school.id)
    .order("created_at", { ascending: false }).range(pg.offset, pg.offset + pg.size - 1);
  const canExport = can("settings.backups.create");
  const mine = BACKUP_TABLES.filter((t) => !t.perm || can(t.perm));
  const groups = [...new Set(mine.map((t) => t.group))];
  const last = (log ?? [])[0];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="backups" title="Backups & data export" subtitle="Your school's data is yours — download it any time" back={{ href: "/app/settings", label: "Settings centre" }} />
      <Card title="Full export" icon="backups" description="Every table you are allowed to read, as one JSON file (bank / PAN details of staff and the stored layout of documents are left out). Keep it somewhere safe and offline.">
        <div className="flex flex-wrap items-center gap-3">
          {canExport ? <a href="/app/settings/backups/export" className="btn btn-primary">Download full export (JSON)</a> : <span className="text-[14px] text-muted">You can see the history but not download.</span>}
          <span className="text-[13px] text-muted">{last ? `Last export: ${when(last.created_at)} by ${last.by_name ?? "—"}` : "Never exported yet — do one now, and then every month."}</span>
        </div>
        <p className="mt-3 mb-0 text-[13px] text-muted">The platform also keeps automatic database backups for every school. This export is your own copy, for audits, a change of software, or peace of mind.</p>
      </Card>
      {canExport && (
        <Card title="Download one table (CSV)" description="Opens in Excel. Large tables (attendance, marks) can take a minute.">
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g}>
                <h3 className="m-0 mb-1.5 text-[13px] font-bold tracking-wide text-muted uppercase">{g}</h3>
                <div className="flex flex-wrap gap-2">
                  {mine.filter((t) => t.group === g).map((t) => <a key={t.name} href={`/app/settings/backups/export?table=${t.name}`} className="chip no-underline">{t.label}</a>)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Export history">
        {(log ?? []).length ? (
          <Table head={["When", "What", "Tables", "Rows", "Size", "By"]} minWidth={640}>
            {(log ?? []).map((l) => (
              <tr key={l.id}>
                <td className={td}>{when(l.created_at)}</td>
                <td className={td}>{l.kind === "full" ? "Full export" : l.kind.replace("csv:", "CSV · ")}</td>
                <td className={td}>{l.tables}</td>
                <td className={td}>{Number(l.row_count).toLocaleString("en-IN")}</td>
                <td className={td}>{size(Number(l.size_bytes))}</td>
                <td className={td}>{l.by_name ?? "—"}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>No export has been taken yet.</Empty>}
        <div className="mt-3"><Pagination total={count ?? 0} page={pg.page} size={pg.size} sizes={[10, 25, 50]} basePath="/app/settings/backups" params={{}} /></div>
      </Card>
    </div>
  );
}
