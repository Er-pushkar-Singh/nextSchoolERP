import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit } from "@/components/ui/ui";
import { fullName, money, todayIST } from "@/lib/format";
import { issueDocument } from "../../_actions/documents";
import type { TemplateField } from "@/lib/documents";

const STD: Record<string, [string, "text" | "date" | "number"]> = {
  reason: ["Reason", "text"], remarks: ["Remarks", "text"], last_exam: ["Last examination passed", "text"], result: ["Result", "text"], promotion: ["Promotion", "text"],
  conduct: ["Conduct", "text"], working_days: ["Working days", "number"], days_present: ["Days present", "number"], left_on: ["Date of leaving", "date"],
};

export default async function Issue({ searchParams }: { searchParams: Promise<{ template?: string; student?: string; staff?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("documents.issue.create");
  const sp = await searchParams;
  const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const tplId = uid(sp.template), stu = uid(sp.student), stf = uid(sp.staff);
  if (!tplId || (!stu && !stf)) notFound();
  const { data: t } = await supabase.from("document_templates").select("*").eq("id", tplId).eq("school_id", school.id).maybeSingle();
  if (!t || !t.active) notFound();
  const [{ data: s }, { data: w }, { data: dues }, { data: prev }] = await Promise.all([
    stu ? supabase.from("students").select("id,first_name,middle_name,last_name,admission_no,status,dob,father_name,classes!class_id(name),sections(name)").eq("id", stu).eq("school_id", school.id).maybeSingle() : Promise.resolve({ data: null }),
    stf ? supabase.from("staff").select("id,name,designation,emp_code,status").eq("id", stf).eq("school_id", school.id).maybeSingle() : Promise.resolve({ data: null }),
    stu ? supabase.from("fee_dues").select("amount,concession,fine,paid").eq("student_id", stu) : Promise.resolve({ data: [] }),
    supabase.from("issued_documents").select("doc_no").eq("school_id", school.id).eq("template_code", t.code).eq("status", "issued").eq(stu ? "student_id" : "staff_id", (stu ?? stf)!).limit(5),
  ]);
  if (!s && !w) notFound();
  // exams for which this student has a declared result (for marksheet / report card templates)
  const { data: res } = stu && ((t.fields as TemplateField[]) ?? []).some((f) => f.type === "exam")
    ? await supabase.from("exam_results").select("exam_id,exams(id,name,sort)").eq("student_id", stu).eq("school_id", school.id)
    : { data: [] };
  const declared = ((res ?? []) as unknown as { exams: { id: string; name: string; sort: number } | { id: string; name: string; sort: number }[] | null }[])
    .map((r) => (Array.isArray(r.exams) ? r.exams[0] : r.exams)).filter(Boolean).sort((a, b) => b!.sort - a!.sort) as { id: string; name: string; sort: number }[];
  // a Transfer Certificate waits until the fees are paid (the database enforces it too)
  const isTc = t.on_issue === "mark_transferred" || String(t.numbering_prefix ?? "").toUpperCase() === "TC";
  const { data: clr } = isTc && stu ? await supabase.rpc("student_clearance", { sid: school.id, stu }) : { data: null };
  const clearance = clr as { owed: number; books_out: number; assets_out: number; hostel_bed: boolean; fees_clear: boolean; mode: string } | null;
  const tcBlocked = Boolean(clearance && !clearance.fees_clear);
  const owed = (dues ?? []).reduce((a, d) => a + Math.max(0, Number(d.amount) - Number(d.concession) + Number(d.fine) - Number(d.paid)), 0);
  const fields = (t.fields as TemplateField[]) ?? [];
  const known = new Set(fields.map((f) => f.key));
  const who = s ? fullName(s) : w!.name;
  const sec = s ? (s as unknown as { sections: { name: string } | null }).sections : null;
  const cls = s ? (s as unknown as { classes: { name: string } | null }).classes : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title={t.name} back={{ href: "/app/documents", label: "Documents" }}
        subtitle={<>{who}{s ? ` · Adm. ${s.admission_no} · Class ${cls?.name}${sec ? `-${sec.name}` : ""}` : w ? ` · ${w.emp_code ?? ""} ${w.designation ?? ""}` : ""}</>} />
      <Flash error={sp.error} />
      <div className="flex flex-wrap gap-2">
        {owed > 0 && <Badge value="overdue" text={`Fee dues outstanding: ${money(owed)} — the document will say so`} />}
        {s && !s.dob && <Badge value="due" text="Date of birth is missing on the record" />}
        {s && !s.father_name && <Badge value="due" text="Father's name is missing on the record" />}
        {s && s.status !== "active" && <Badge value="contacted" text={`Status: ${s.status.replace("_", " ")}`} />}
      </div>
      {clearance && (
        <Card title={tcBlocked ? "Transfer Certificate on hold — fees pending" : "Clearance"} icon="fees">
          {tcBlocked ? (
            <p className="m-0 text-[14px]">₹{Number(clearance.owed).toLocaleString("en-IN")} is still pending ({clearance.mode === "all" ? "every fee of the student must be paid" : "every instalment due till today must be paid"}).
              {" "}<Link href={`/app/fees/collect?student=${stu}`} className="font-semibold">Collect the fee →</Link></p>
          ) : <p className="m-0 text-[14px] text-[#15803d]">All fees are paid.</p>}
          <div className="mt-2 flex flex-wrap gap-2 text-[13px]">
            {clearance.books_out > 0 && <Badge value="high" text={`${clearance.books_out} library book(s) not returned`} />}
            {clearance.assets_out > 0 && <Badge value="high" text={`${clearance.assets_out} school item(s) not returned`} />}
            {clearance.hostel_bed && <Badge value="high" text="Still has a hostel bed — vacate it" />}
          </div>
        </Card>
      )}
      <Card title="Details" description="Name, parents, class and the other fields come from the record at the moment of issue.">
        <form action={issueDocument} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="template_id" value={tplId} />
          {stu && <input type="hidden" name="student_id" value={stu} />}
          {stf && <input type="hidden" name="staff_id" value={stf} />}
          <Input label="Issue date" name="issued_on" type="date" defaultValue={todayIST()} />
          {fields.map((f) => f.type === "exam" ? (
            <Select key={f.key} label={f.label} name={`x_${f.key}`} required={f.required} className="sm:col-span-2" blank="Choose the examination…"
              options={(declared ?? []).map((e) => [e.id, e.name] as [string, string])} hint={!(declared ?? []).length ? "No exam has a declared result yet." : undefined} />
          ) : (
            <Input key={f.key} label={f.label} name={`x_${f.key}`} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} required={f.required} className={f.type === "text" ? "sm:col-span-2" : ""} />
          ))}
          {/* standard questions used in the layout but not declared by the template */}
          {Object.entries(STD).filter(([k]) => !known.has(k) && t.body_html.includes(`extra.${k}`)).map(([k, [label, type]]) => (
            <Input key={k} label={label} name={`x_${k}`} type={type} className={type === "text" ? "sm:col-span-2" : ""} />
          ))}
          {t.on_issue === "mark_transferred" && s?.status === "active" && (
            <label className="flex items-center gap-2 text-[14px] text-ink sm:col-span-4"><input type="checkbox" name="mark_left" value="1" defaultChecked className="h-4 w-4" /> Mark the student as <b>transferred</b> (closes the class record, stops fee billing)</label>
          )}
          {t.one_per_student && (prev ?? []).length > 0 && (
            <label className="flex items-center gap-2 text-[14px] text-ink sm:col-span-4"><input type="checkbox" name="duplicate" value="1" className="h-4 w-4" /> Duplicate copy (already issued: {(prev ?? []).map((p) => p.doc_no).join(", ")})</label>
          )}
          <div className="sm:col-span-4">{tcBlocked ? <button type="button" disabled className="btn btn-primary cursor-not-allowed border-0 opacity-50">Issue (fees pending)</button> : <Submit>Issue</Submit>} <Link href={`/app/documents/templates/${tplId}`} className="ml-3 text-[13px]">View / edit template</Link></div>
        </form>
      </Card>
    </div>
  );
}
