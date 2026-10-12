import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { fullName, money } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { boardLevel, defaultExamYear, KIND_LABEL, readiness, STATUS_LABEL } from "@/lib/board";
import { bulkStatus, startClass } from "../_actions/board";

type Stu = { id: string; admission_no: string; first_name: string; middle_name: string | null; last_name: string | null; father_name: string | null; mother_name: string | null; dob: string | null; gender: string | null; roll_no: number | null; sections: { name: string } | null };
const tone: Record<string, string> = { draft: "draft", checked: "contacted", submitted: "sent", correction: "overdue", accepted: "paid" };

export default async function Board({ searchParams }: { searchParams: Promise<{ class_id?: string; ok?: string; error?: string }> }) {
  const { supabase, school, session, can } = await requirePerm("students.board_reg.view");
  const sp = await searchParams;
  const classes = (await getClasses(supabase, school.id)).filter((c) => boardLevel(c.name));
  const cls = classes.find((c) => c.id === sp.class_id) ?? classes[0];
  const lv = cls ? boardLevel(cls.name) : null;

  let rows: { s: Stu; reg: { id: string; status: string; challan_no: string | null; board_ref: string | null } | null; r: ReturnType<typeof readiness> }[] = [];
  let counts: Record<string, number> = {};
  if (cls && lv && session) {
    const [{ data: studs }, { data: regs }, { data: photos }, { data: sens }, { data: subs }] = await Promise.all([
      supabase.from("students").select("id,admission_no,first_name,middle_name,last_name,father_name,mother_name,dob,gender,roll_no,sections(name)").eq("school_id", school.id).eq("class_id", cls.id).eq("status", "active").order("roll_no", { nullsFirst: false }).order("first_name").limit(2000),
      supabase.from("board_registrations").select("id,student_id,status,challan_no,board_ref").eq("school_id", school.id).eq("session_id", session.id).eq("kind", lv.kind).limit(5000),
      can("students.documents.view") ? supabase.from("student_documents").select("student_id,status").eq("school_id", school.id).eq("doc_type", "photo").not("file_path", "is", null).limit(10000) : Promise.resolve({ data: null }),
      can("students.sensitive.view") ? supabase.from("student_sensitive").select("student_id,apaar_id").eq("school_id", school.id).not("apaar_id", "is", null).limit(10000) : Promise.resolve({ data: null }),
      supabase.from("student_board_subjects").select("student_id,slot").eq("school_id", school.id).eq("session_id", session.id).neq("slot", "7").limit(30000),
    ]);
    const regOf = new Map((regs ?? []).map((r) => [r.student_id, r]));
    const photo = new Set((photos ?? []).filter((p) => p.status !== "rejected").map((p) => p.student_id));
    const apaar = new Set((sens ?? []).map((x) => x.student_id));
    const subj = new Map<string, { n: number; nocode: number }>();
    for (const x of (subs ?? []) as unknown as { student_id: string; slot: string }[]) {
      const c = subj.get(x.student_id) ?? { n: 0, nocode: 0 };
      c.n++;
      subj.set(x.student_id, c);
    }
    rows = ((studs ?? []) as unknown as Stu[]).map((s) => ({
      s, reg: regOf.get(s.id) ?? null,
      r: readiness({ first_name: s.first_name, father_name: s.father_name, mother_name: s.mother_name, dob: s.dob, gender: s.gender, photo: photos === null ? true : photo.has(s.id),
        subjects: subj.get(s.id)?.n ?? 0, subjectsWithoutCode: subj.get(s.id)?.nocode ?? 0, apaar: apaar.has(s.id) }),
    }));
    counts = rows.reduce<Record<string, number>>((m, x) => { const k = x.reg?.status ?? "none"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="UP Board registration" subtitle="Class 9 & 11 advance registration · Class 10 & 12 exam applications — verified before they go to the board"
        actions={cls && can("students.board_reg.export") ? <a href={`/app/board/export?class_id=${cls.id}`} className="btn btn-sm btn-secondary">Nominal list (CSV)</a> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <p role="note" className="m-0 rounded-[12px] border border-line bg-white px-4 py-3 text-[13px] text-muted">
        This keeps the school's own record of what is sent to the board — it does <b>not</b> submit anything to the board portal. Enter the data on the board's portal (prereg.upmsp.edu.in / examreg.upmsp.edu.in), then record the board reference here. Always follow the latest UPMSP notice for dates and fees.
      </p>
      {!classes.length && <Empty>No class named 9, 10, 11 or 12 found. Name the classes exactly like that in Settings → Classes & sessions.</Empty>}

      {cls && lv && (
        <>
          <form className="flex flex-wrap items-end gap-2">
            <Select label="Class" name="class_id" defaultValue={cls.id} options={classes.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
            <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
          </form>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Students" value={rows.length} hint={KIND_LABEL[lv.kind]} icon="students" />
            <Stat label="Not started" value={counts.none ?? 0} icon="notifications" tone={(counts.none ?? 0) ? "amber" : "green"} />
            <Stat label="Draft" value={counts.draft ?? 0} icon="layers" tone="cyan" />
            <Stat label="Checked" value={counts.checked ?? 0} icon="school" tone="violet" />
            <Stat label="Submitted / accepted" value={(counts.submitted ?? 0) + (counts.accepted ?? 0)} hint={counts.correction ? `${counts.correction} need correction` : undefined} icon="revenue" tone="green" />
          </div>

          <div className="flex flex-wrap gap-3 print:hidden">
            {can("students.board_reg.create") && (counts.none ?? 0) > 0 && (
              <form action={startClass} className="flex items-end gap-2"><input type="hidden" name="class_id" value={cls.id} />
                <Input label="Exam year" name="exam_year" type="number" defaultValue={defaultExamYear(session?.name, lv.kind)} className="w-28" />
                <Submit variant="secondary">Start {counts.none} registration(s)</Submit></form>
            )}
            {can("students.board_reg.approve") && (
              <>
                {(counts.draft ?? 0) > 0 && <form action={bulkStatus}><input type="hidden" name="class_id" value={cls.id} /><input type="hidden" name="kind" value={lv.kind} /><input type="hidden" name="target" value="checked" /><Submit>Principal: check all ready drafts</Submit></form>}
                {(counts.checked ?? 0) > 0 && (
                  <form action={bulkStatus} className="flex items-end gap-2"><input type="hidden" name="class_id" value={cls.id} /><input type="hidden" name="kind" value={lv.kind} /><input type="hidden" name="target" value="submitted" />
                    <Input label="Board reference (optional)" name="board_ref" /><Submit>Mark all checked as submitted</Submit></form>
                )}
              </>
            )}
            <Link href={`/app/board/roll?class_id=${cls.id}`} className="btn btn-sm btn-secondary self-end">Print nominal roll</Link>
          </div>

          {rows.length ? (
            <Table head={["Roll", "Student", "Parent", "DOB", "Ready?", "Status", ""]} minWidth={900}>
              {rows.map(({ s, reg, r }) => (
                <tr key={s.id}>
                  <td className={td}>{s.roll_no ?? "—"}</td>
                  <td className={td}><Link href={`/app/board/${s.id}`} className="font-semibold">{fullName(s)}</Link><div className="text-[12px] text-muted">{s.admission_no} · {s.sections?.name}</div></td>
                  <td className={`${td} text-[13px]`}>{s.father_name ?? s.mother_name ?? <span className="text-error">missing</span>}</td>
                  <td className={`${td} text-[13px]`}>{s.dob ?? <span className="text-error">missing</span>}</td>
                  <td className={`${td} text-[13px]`}>{r.ok ? <span className="text-[#0b4f2c]">✓ ready</span> : <span className="text-error">needs {r.missing.join(", ")}</span>}</td>
                  <td className={td}>{reg ? <Badge value={tone[reg.status]} text={STATUS_LABEL[reg.status]} /> : <span className="text-[13px] text-muted">not started</span>}</td>
                  <td className={`${td} text-[13px]`}>{reg?.board_ref ?? ""}</td>
                </tr>
              ))}
            </Table>
          ) : <Empty>No active students in Class {cls.name}.</Empty>}
          <p className="m-0 text-[12px] text-muted">Fee noted per student: {money(50)} registration fee (₹40 to the treasury by challan, ₹10 school) per the 09 Sep 2026 notice — editable on each record if the board changes it.</p>
        </>
      )}
    </div>
  );
}
