import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Table, td } from "@/components/ui/ui";
import { fmtDate, todayIST } from "@/lib/format";
import { classOptions, getClasses } from "@/lib/erp";
import { APP_STATUS, APP_TONE } from "@/lib/applications";
import { bulkStatus, saveTestSheet } from "../../../_actions/admissions2";

type A = { id: string; application_no: string; applicant_name: string; father_name: string | null; status: string; test_on: string | null; test_marks: number | null; test_max: number | null; rte_applicant: boolean; waitlist_no: number | null };

export default async function TestSheet({ searchParams }: { searchParams: Promise<{ class_id?: string; ok?: string; error?: string }> }) {
  const { supabase, school, session, can } = await requirePerm("frontdesk.admissions.view");
  const sp = await searchParams;
  const classes = await getClasses(supabase, school.id);
  const cls = sp.class_id && /^[0-9a-f-]{36}$/.test(sp.class_id) ? sp.class_id : null;
  let rows: A[] = [];
  if (cls && session) {
    const { data } = await supabase.from("admission_applications").select("id,application_no,applicant_name,father_name,status,test_on,test_marks,test_max,rte_applicant,waitlist_no")
      .eq("school_id", school.id).eq("session_id", session.id).eq("class_id", cls).not("status", "in", "(cancelled)").order("test_marks", { ascending: false, nullsFirst: false }).order("applicant_name").limit(300);
    rows = (data ?? []) as A[];
  }
  const canEdit = can("frontdesk.admissions.edit");
  const max = rows.find((r) => r.test_max !== null)?.test_max ?? 50;
  const scored = rows.filter((r) => r.test_marks !== null);
  const rank = new Map(scored.map((r, i) => [r.id, i + 1]));
  const open = (s: string) => !["admitted", "cancelled"].includes(s);
  const back = `/app/admissions/applications/test-sheet?class_id=${cls ?? ""}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="exams" title="Entrance test — marks & merit list" back={{ href: "/app/admissions/pipeline", label: "Pipeline" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap items-end gap-2">
        <Select label="Class applied for" name="class_id" blank="Choose class" defaultValue={cls} options={classOptions(classes)} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>
      {!cls ? <Empty>Choose a class to enter marks for all its applicants in one go and see the merit list.</Empty> : rows.length === 0 ? <Empty>No applications for this class.</Empty> : (
        <form className="flex flex-col gap-4">
          <input type="hidden" name="back" value={back} />
          {canEdit && (
            <Card title="Enter marks" description="Leave a row blank to keep it as it is. Ranks update after saving.">
              <div className="mb-3 flex flex-wrap gap-3">
                <Input label="Maximum marks" name="max" type="number" min={1} step="0.5" defaultValue={max} />
                <Input label="Test date" name="test_on" type="date" defaultValue={todayIST()} />
              </div>
            </Card>
          )}
          <Table head={["", "Rank", "Applicant", "Application", "Marks", "Status"]} minWidth={760}>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className={td}>{canEdit && open(a.status) && <><input type="checkbox" name="id" value={a.id} aria-label={`Select ${a.applicant_name}`} /></>}</td>
                <td className={`${td} font-bold text-ink`}>{rank.get(a.id) ?? "—"}</td>
                <td className={`${td} font-semibold text-ink`}><Link href={`/app/admissions/applications/${a.id}`}>{a.applicant_name}</Link>{a.rte_applicant && <span className="ml-1 rounded bg-blue-tint px-1.5 text-[11px] font-bold text-blue-strong">RTE</span>}
                  <div className="text-[12px] font-normal text-muted">{a.father_name ?? ""}</div></td>
                <td className={`${td} font-mono text-[13px]`}>{a.application_no}</td>
                <td className={td}>
                  {canEdit && open(a.status) ? (
                    <span className="flex items-center gap-1"><input name={`marks_${a.id}`} type="number" step="0.01" min={0} defaultValue={a.test_marks ?? ""} aria-label={`Marks for ${a.applicant_name}`} className="input !min-h-9 w-24 !py-1 text-[14px]" /> <span className="text-[13px] text-muted">/ {a.test_max ?? max}</span></span>
                  ) : a.test_marks !== null ? `${a.test_marks}/${a.test_max ?? "?"}` : a.test_on ? fmtDate(a.test_on) : "—"}
                </td>
                <td className={td}><Badge value={APP_TONE[a.status]} text={APP_STATUS[a.status] + (a.waitlist_no ? ` #${a.waitlist_no}` : "")} /></td>
              </tr>
            ))}
          </Table>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-3">
              <button formAction={saveTestSheet} className="btn btn-primary cursor-pointer border-0">Save marks</button>
              <span className="text-[13px] text-muted">or for the ticked rows:</span>
              <Select label="Move to" name="status" options={[["under_review", "Under review"], ["approved", "Approved"], ["waitlisted", "Waitlisted"], ["rejected", "Rejected"]]} />
              <Input label="Note (needed to reject)" name="note" />
              <button formAction={bulkStatus} className="btn btn-secondary cursor-pointer">Apply to ticked</button>
            </div>
          )}
          <p className="m-0 text-[13px] text-muted">Approving and rejecting needs the principal; other rows are reported if they could not be changed.</p>
        </form>
      )}
    </div>
  );
}
