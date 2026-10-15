import { requirePerm } from "@/lib/school";
import { Empty, PageHeader } from "@/components/ui/ui";
import { ClassSection } from "@/components/ClassSection";
import { PrintButton } from "@/components/ui/PrintButton";
import { barcodeDataUrl } from "@/lib/barcode";
import { getClasses } from "@/lib/erp";
import { fullName } from "@/lib/format";

const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
type S = { id: string; first_name: string; middle_name: string | null; last_name: string | null; admission_no: string; roll_no: number | null; att_code: string | null };
type W = { id: string; name: string; emp_code: string | null; designation: string | null; att_code: string | null };

/** A sheet of barcode stickers (3 across) for a section, or for all staff — to stick on ID cards that have no barcode yet. */
export default async function BarcodeCards({ searchParams }: { searchParams: Promise<{ class_id?: string; section_id?: string; who?: string }> }) {
  const { supabase, school, can } = await requirePerm("attendance.students.view", "attendance.staff.view");
  const sp = await searchParams;
  const classes = await getClasses(supabase, school.id);
  const cls = uid(sp.class_id), sec = uid(sp.section_id);
  const staffMode = sp.who === "staff" && can("attendance.staff.view");
  const [{ data: st }, { data: wf }] = await Promise.all([
    !staffMode && cls ? (() => { let q = supabase.from("students").select("id,first_name,middle_name,last_name,admission_no,roll_no,att_code").eq("school_id", school.id).eq("status", "active").eq("class_id", cls); if (sec) q = q.eq("section_id", sec); return q.order("roll_no", { nullsFirst: false }).order("first_name").limit(400); })() : Promise.resolve({ data: [] }),
    staffMode ? supabase.from("staff").select("id,name,emp_code,designation,att_code").eq("school_id", school.id).eq("status", "active").order("name").limit(400) : Promise.resolve({ data: [] }),
  ]);
  const cards = staffMode
    ? ((wf ?? []) as W[]).map((w) => ({ id: w.id, code: w.att_code, name: w.name, line: [w.designation, w.emp_code].filter(Boolean).join(" · ") }))
    : ((st ?? []) as S[]).map((s) => ({ id: s.id, code: s.att_code, name: fullName(s), line: `${s.admission_no}${s.roll_no ? ` · Roll ${s.roll_no}` : ""}` }));
  const label = classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, l: `${c.name}-${s.name}`, c: c.id }))).find((x) => x.id === sec)?.l ?? classes.find((c) => c.id === cls)?.name;

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <PageHeader icon="attendance" title="Barcode cards" subtitle="Stickers with each person's attendance barcode — print on A4 label sheets" back={{ href: "/app/attendance/barcode", label: "Barcode attendance" }}
          actions={cards.length ? <PrintButton /> : undefined} />
      </div>
      <form className="grid items-end gap-2 sm:grid-cols-4 print:hidden">
        <ClassSection key={`${cls}-${sec}`} classes={classes} classId={cls} sectionId={sec} />
        <div className="flex gap-2"><button className="btn btn-sm btn-primary cursor-pointer border-0">Show students</button>
          {can("attendance.staff.view") && <a href="/app/attendance/barcodes?who=staff" className="btn btn-sm btn-secondary">All staff</a>}</div>
      </form>
      {cards.length ? (
        <>
          <p className="m-0 hidden text-[13px] font-semibold print:block">{school.name} — {staffMode ? "Staff" : `Class ${label ?? ""}`}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 print:grid-cols-3">
            {cards.map((c) => (
              <div key={c.id} className="flex flex-col items-center gap-1 rounded-[8px] border border-dashed border-line-strong px-2 py-2.5 text-center [break-inside:avoid]">
                <p className="m-0 w-full truncate text-[12px] font-bold text-ink">{c.name}</p>
                {c.code ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={barcodeDataUrl(c.code)} alt={`Barcode ${c.code}`} className="h-11 w-full max-w-[200px]" />
                ) : <span className="text-[11px] text-error">No card code</span>}
                <p className="m-0 font-mono text-[10px] tracking-[0.15em] text-body">{c.code}</p>
                <p className="m-0 text-[10.5px] text-muted">{c.line}</p>
              </div>
            ))}
          </div>
        </>
      ) : <Empty>{staffMode ? "No active staff." : cls ? "No active students here." : "Choose a class (and section) to print its barcode stickers."}</Empty>}
    </div>
  );
}
