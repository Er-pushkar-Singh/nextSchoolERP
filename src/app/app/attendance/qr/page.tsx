import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { PrintButton } from "@/components/ui/PrintButton";
import { Empty, Flash, PageHeader, Select } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { ClassSection } from "@/components/ClassSection";
import { getClasses } from "@/lib/erp";
import { qrDataUrl } from "@/lib/qr";
import { fullName } from "@/lib/format";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
type Card = { code: string; name: string; line1: string; line2: string };

/** Plain QR cards for people who have no ID card yet. For real ID cards add a QR block in the template studio. */
export default async function QrCards({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("attendance.students.view", "attendance.staff.view");
  const sp = await searchParams;
  const who = sp.who === "staff" && can("attendance.staff.view") ? "staff" : "students";
  const cls = uid(sp.class_id), sec = uid(sp.section_id);
  const { page, size, offset } = pageParams(sp, 50);
  const classes = await getClasses(supabase, school.id);

  let cards: Card[] = [];
  let total = 0;
  if (who === "students") {
    let q = supabase.from("students").select("first_name,middle_name,last_name,admission_no,att_code,roll_no,class:classes!class_id(name),section:sections!section_id(name)", { count: "exact" })
      .eq("school_id", school.id).eq("status", "active").order("first_name").range(offset, offset + size - 1);
    if (cls) q = q.eq("class_id", cls);
    if (sec) q = q.eq("section_id", sec);
    const { data, count } = await q;
    total = count ?? 0;
    cards = (data ?? []).map((s) => {
      const c = (Array.isArray(s.class) ? s.class[0] : s.class) as { name: string } | null;
      const x = (Array.isArray(s.section) ? s.section[0] : s.section) as { name: string } | null;
      return { code: s.att_code as string, name: fullName(s), line1: [c?.name, x?.name].filter(Boolean).join("-"), line2: `Adm. ${s.admission_no}` };
    });
  } else {
    const { data, count } = await supabase.from("staff").select("name,designation,emp_code,att_code", { count: "exact" })
      .eq("school_id", school.id).eq("status", "active").order("name").range(offset, offset + size - 1);
    total = count ?? 0;
    cards = (data ?? []).map((s) => ({ code: s.att_code as string, name: s.name, line1: s.designation ?? "Staff", line2: s.emp_code ?? "" }));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 print:hidden">
        <PageHeader icon="attendance" title="QR cards" subtitle="Cut-out attendance cards" back={{ href: "/app/attendance", label: "Attendance" }} actions={cards.length ? <PrintButton /> : undefined} />
        <Flash ok={sp.ok} error={sp.error} />
        <form className="grid items-end gap-2 sm:grid-cols-4">
          <Select label="For" name="who" defaultValue={who} options={[["students", "Students"], ...(can("attendance.staff.view") ? [["staff", "Staff"] as [string, string]] : [])]} />
          {who === "students" && <ClassSection key={`${cls}-${sec}`} classes={classes} classId={cls} sectionId={sec} />}
          <div><button className="btn btn-sm btn-primary cursor-pointer border-0">Show</button></div>
        </form>
        <p className="m-0 text-[13px] text-muted">
          Want the QR on the school ID card itself? Open <Link href="/app/templates">Templates</Link>, pick an ID card and add the <b>QR code</b> block.
        </p>
      </div>

      {cards.length ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          {cards.map((c) => (
            <li key={c.code} className="flex flex-col items-center gap-1 rounded-[10px] border border-line bg-white p-3 text-center print:break-inside-avoid">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl(c.code)} alt={`QR code of ${c.name}`} width={120} height={120} />
              <b className="text-[13px] text-ink">{c.name}</b>
              <span className="text-[11px] text-muted">{c.line1}</span>
              <span className="text-[11px] text-muted">{c.line2}</span>
              <span className="text-[9px] text-muted">{school.name}</span>
            </li>
          ))}
        </ul>
      ) : <Empty>No one to show.</Empty>}
      <div className="print:hidden">
        <Pagination total={total} page={page} size={size} basePath="/app/attendance/qr" params={{ who, class_id: cls ?? undefined, section_id: sec ?? undefined }} />
      </div>
    </div>
  );
}
