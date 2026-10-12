import { requirePerm } from "@/lib/school";
import { Card, Flash, PageHeader, Submit } from "@/components/ui/ui";
import { importStudents } from "../../_actions/students";

const SAMPLE = `admission_no,first_name,last_name,class,section,roll_no,gender,dob,father_name,mother_name,guardian_phone,address
1001,Aarav,Sharma,5,A,1,M,14/08/2015,Rakesh Sharma,Sunita Sharma,9876543210,"Gomti Nagar, Lucknow"
,Diya,Verma,LKG,A,,F,2021-02-03,Amit Verma,,9123456780,`;

export default async function Import({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requirePerm("students.import.create");
  const sp = await searchParams;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="students" title="Import students" subtitle="From Excel or Google Sheets: File → Save as / Download → CSV" back={{ href: "/app/students", label: "Students" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <Card title="1 · Columns">
        <p className="mt-0 text-[14px]">The first row must be these headings (any order; only <b>first_name</b> is required). Class must match a class name in Settings (e.g. <code>5</code>, <code>LKG</code>). Dates as <code>DD/MM/YYYY</code> or <code>YYYY-MM-DD</code>. Blank admission no. = auto-number.</p>
        <pre className="overflow-x-auto rounded-lg bg-surface-alt p-3 text-[12px]">{SAMPLE}</pre>
        <a download="students-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`}>Download this template</a>
      </Card>
      <Card title="2 · Upload">
        <form action={importStudents} className="flex flex-col gap-3">
          <input type="file" name="file" accept=".csv,text/csv" className="text-[14px]" />
          <p className="m-0 text-[13px] text-muted">…or paste the CSV text:</p>
          <textarea name="csv" rows={6} className="input font-mono text-[13px]" placeholder={SAMPLE.split("\n")[0]} />
          <div><Submit>Import</Submit></div>
        </form>
      </Card>
    </div>
  );
}
