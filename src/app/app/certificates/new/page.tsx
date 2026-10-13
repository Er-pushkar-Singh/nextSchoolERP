import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit, Textarea } from "@/components/ui/ui";
import { fmtDate, fullName, money, todayIST } from "@/lib/format";
import { CERT_KINDS } from "@/lib/certificates";
import { issueCertificate } from "../../_actions/certificates";

export default async function NewCertificate({ searchParams }: { searchParams: Promise<{ student?: string; kind?: string; error?: string }> }) {
  const { supabase, school } = await requirePerm("students.certificates.create");
  const sp = await searchParams;
  if (!sp.student || !/^[0-9a-f-]{36}$/.test(sp.student)) notFound();
  const kind = CERT_KINDS.some(([k]) => k === sp.kind) ? sp.kind! : "bonafide";
  const { data: s } = await supabase.from("students")
    .select("id,admission_no,first_name,middle_name,last_name,father_name,mother_name,dob,status,tc_no,admission_date,classes!class_id(name),sections(name)").eq("id", sp.student).eq("school_id", school.id).maybeSingle();
  if (!s) notFound();
  const [{ data: dues }, { data: prev }] = await Promise.all([
    supabase.from("fee_dues").select("amount,concession,fine,paid").eq("student_id", s.id),
    supabase.from("student_certificates").select("cert_no,kind,status").eq("student_id", s.id).eq("status", "issued").eq("kind", kind).limit(5),
  ]);
  const owed = (dues ?? []).reduce((t, d) => t + Math.max(0, Number(d.amount) - Number(d.concession) + Number(d.fine) - Number(d.paid)), 0);
  const cn = (s as unknown as { classes: { name: string } | null }).classes?.name;
  const tc = kind === "transfer";
  const title = CERT_KINDS.find(([k]) => k === kind)![1];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title={title} back={{ href: "/app/certificates", label: "Certificates" }}
        subtitle={<>{fullName(s)} · Adm. {s.admission_no} · Class {cn}{(s as unknown as { sections: { name: string } | null }).sections ? `-${(s as unknown as { sections: { name: string } }).sections.name}` : ""}</>} />
      <Flash error={sp.error} />
      <div className="flex flex-wrap gap-2">
        {owed > 0 && <Badge value="overdue" text={`Fee dues outstanding: ${money(owed)} — the certificate will say so`} />}
        {!s.dob && <Badge value="due" text="Date of birth is missing on the student record" />}
        {!s.father_name && !s.mother_name && <Badge value="due" text="Parent name is missing on the student record" />}
        {s.status !== "active" && <Badge value="contacted" text={`Student status: ${s.status.replace("_", " ")}`} />}
      </div>
      <Card title="Details" description="Name, parents, DOB, class and admission date are taken from the student record at the moment of issue.">
        <form action={issueCertificate} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="student_id" value={s.id} /><input type="hidden" name="kind" value={kind} />
          <Input label="Issue date" name="issued_on" type="date" defaultValue={todayIST()} />
          <Select label="Conduct" name="conduct" defaultValue="Good" options={["Excellent", "Very good", "Good", "Satisfactory"]} />
          {(tc || kind === "study") && <Input label="Last examination passed" name="last_exam" placeholder="Annual exam 2025-26" className="sm:col-span-2" />}
          {(tc || kind === "study") && <Input label="Result" name="result" placeholder="Passed / Failed" />}
          {tc && <Input label="Promotion" name="promotion" placeholder="Promoted to Class 9" className="sm:col-span-2" />}
          {tc && <Input label="Date of leaving" name="left_on" type="date" defaultValue={todayIST()} />}
          {tc && <Input label="Reason for leaving" name="reason" required className="sm:col-span-2" placeholder="Parent's transfer / change of residence" />}
          {tc && <Input label="Working days" name="working_days" type="number" min={0} />}
          {tc && <Input label="Days present" name="days_present" type="number" min={0} />}
          <Textarea label="Remarks" name="remarks" rows={2} className="sm:col-span-4" />
          {tc && (
            <div className="flex flex-col gap-2 sm:col-span-4">
              {s.status === "active" && <label className="flex items-center gap-2 text-[14px] text-ink"><input type="checkbox" name="mark_left" value="1" defaultChecked className="h-4 w-4" /> Mark the student as <b>transferred</b> (closes the class record, stops fee billing)</label>}
              {(prev ?? []).length > 0 && (
                <label className="flex items-center gap-2 text-[14px] text-ink"><input type="checkbox" name="duplicate" value="1" className="h-4 w-4" /> Duplicate copy (a TC was already issued: {(prev ?? []).map((p) => p.cert_no).join(", ")})</label>
              )}
            </div>
          )}
          <div className="sm:col-span-4"><Submit>Issue {title.split(" (")[0].toLowerCase()}</Submit> <span className="text-[12px] text-muted">Issued on {fmtDate(todayIST())} unless changed. You can print it next.</span></div>
        </form>
      </Card>
    </div>
  );
}
