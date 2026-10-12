import { Badge, Empty, Table, td } from "@/components/ui/ui";

export type AuditRow = { id: number; at: string; action: string; entity: string | null; entity_id: string | null; actor_email: string | null; actor_kind: string; support_session: string | null; details: Record<string, unknown>; school_id?: string | null };

export function AuditTable({ rows, schoolName }: { rows: AuditRow[]; schoolName?: (id: string | null | undefined) => string }) {
  if (!rows.length) return <Empty>No activity recorded yet.</Empty>;
  return (
    <Table head={["When", ...(schoolName ? ["School"] : []), "Who", "What", "Details"]} minWidth={900}>
      {rows.map((r) => (
        <tr key={r.id}>
          <td className={`${td} whitespace-nowrap text-[13px]`}>{new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</td>
          {schoolName && <td className={`${td} text-[13px]`}>{schoolName(r.school_id)}</td>}
          <td className={`${td} text-[13px]`}>{r.actor_email || r.actor_kind}{r.actor_kind === "platform" && <Badge value="contacted" text={r.support_session ? "support session" : "platform"} />}</td>
          <td className={`${td} text-[13px]`}><b className="text-ink">{r.action}</b> {r.entity}</td>
          <td className={`${td} max-w-[420px] text-[12px] text-muted`}><code className="break-all">{summarize(r.details)}</code></td>
        </tr>
      ))}
    </Table>
  );
}

function summarize(d: Record<string, unknown>) {
  if (d.changed && typeof d.changed === "object") return Object.entries(d.changed as Record<string, [unknown, unknown]>).map(([k, [a, b]]) => `${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join("; ").slice(0, 300);
  if (d.row && typeof d.row === "object") { const r = d.row as Record<string, unknown>; return ["name", "first_name", "receipt_no", "admission_no", "amount", "number", "title", "role", "status"].filter((k) => r[k] !== undefined && r[k] !== null).map((k) => `${k}: ${String(r[k])}`).join(" · ").slice(0, 300); }
  return JSON.stringify(d).slice(0, 300);
}

