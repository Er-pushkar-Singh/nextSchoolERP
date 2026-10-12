import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { PageHeader } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, fullName, money } from "@/lib/format";
import { boardLevel, KIND_LABEL, STATUS_LABEL } from "@/lib/board";

/** Printable nominal roll of a class: what the principal signs and the DIOS office receives with the challan. */
export default async function Roll({ searchParams }: { searchParams: Promise<{ class_id?: string }> }) {
  const { supabase, school, session } = await requirePerm("students.board_reg.view");
  const sp = await searchParams;
  if (!sp.class_id || !/^[0-9a-f-]{36}$/.test(sp.class_id) || !session) notFound();
  const { data: c } = await supabase.from("classes").select("name").eq("id", sp.class_id).eq("school_id", school.id).maybeSingle();
  const lv = boardLevel(c?.name);
  if (!c || !lv) notFound();
  const [{ data: studs }, { data: regs }, { data: subs }] = await Promise.all([
    supabase.from("students").select("id,admission_no,first_name,middle_name,last_name,father_name,mother_name,dob,gender,roll_no,sections(name)").eq("school_id", school.id).eq("class_id", sp.class_id).eq("status", "active").order("roll_no", { nullsFirst: false }).order("first_name").limit(3000),
    supabase.from("board_registrations").select("student_id,status,snapshot,fee_total,fee_to_treasury,challan_no,challan_date").eq("school_id", school.id).eq("session_id", session.id).eq("kind", lv.kind).limit(5000),
    supabase.from("student_subjects").select("student_id,subjects(name,code)").eq("school_id", school.id).eq("session_id", session.id).limit(30000),
  ]);
  type S = { id: string; admission_no: string; first_name: string; middle_name: string | null; last_name: string | null; father_name: string | null; mother_name: string | null; dob: string | null; gender: string | null; roll_no: number | null; sections: { name: string } | null };
  const list = (studs ?? []) as unknown as S[];
  const regOf = new Map((regs ?? []).map((r) => [r.student_id, r]));
  const subOf = new Map<string, string[]>();
  for (const x of (subs ?? []) as unknown as { student_id: string; subjects: { name: string; code: string | null } | null }[]) {
    subOf.set(x.student_id, [...(subOf.get(x.student_id) ?? []), `${x.subjects?.code ?? x.subjects?.name ?? ""}`]);
  }
  const counted = (regs ?? []).filter((r) => ["checked", "submitted", "accepted"].includes(r.status));
  const total = counted.reduce((t, r) => t + Number(r.fee_total), 0);
  const treasury = counted.reduce((t, r) => t + Number(r.fee_to_treasury), 0);

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4">
      <div className="print:hidden"><PageHeader title={`Nominal roll · Class ${c.name}`} back={{ href: `/app/board?class_id=${sp.class_id}`, label: "Board registration" }} actions={<PrintButton />} /></div>
      <article className="rounded-[12px] border border-line bg-white p-5 text-[12px] text-ink print:border-0 print:p-0">
        <header className="mb-3 border-b-2 border-ink pb-2 text-center">
          <h1 className="m-0 text-[18px] font-extrabold">{school.name}</h1>
          <p className="m-0">{[school.address, school.city].filter(Boolean).join(", ")}{school.udise_code ? ` · UDISE ${school.udise_code}` : ""}{school.affiliation_no ? ` · Aff. ${school.affiliation_no}` : ""}</p>
          <p className="mt-1 mb-0 text-[14px] font-bold">UP Board · {KIND_LABEL[lv.kind]} · Class {c.name} · Session {session.name}</p>
        </header>
        <table className="w-full border-collapse text-left">
          <thead><tr className="bg-surface-alt">{["Sr", "Adm. no", "Student", "Father", "Mother", "DOB", "Sex", "Subject codes", "Status"].map((h) => <th key={h} className="border border-ink px-1.5 py-1">{h}</th>)}</tr></thead>
          <tbody>
            {list.map((s, i) => (
              <tr key={s.id}>
                <td className="border border-ink px-1.5 py-1">{i + 1}</td>
                <td className="border border-ink px-1.5 py-1">{s.admission_no}</td>
                <td className="border border-ink px-1.5 py-1 font-semibold">{fullName(s)}</td>
                <td className="border border-ink px-1.5 py-1">{s.father_name ?? ""}</td>
                <td className="border border-ink px-1.5 py-1">{s.mother_name ?? ""}</td>
                <td className="border border-ink px-1.5 py-1">{fmtDate(s.dob)}</td>
                <td className="border border-ink px-1.5 py-1">{s.gender ?? ""}</td>
                <td className="border border-ink px-1.5 py-1">{(subOf.get(s.id) ?? []).join(", ")}</td>
                <td className="border border-ink px-1.5 py-1">{STATUS_LABEL[regOf.get(s.id)?.status ?? ""] ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 mb-0">Students counted (checked / submitted / accepted): <b>{counted.length}</b> · Fee: <b>{money(total)}</b> · To treasury by challan: <b>{money(treasury)}</b> · School share: <b>{money(total - treasury)}</b></p>
        <div className="mt-10 flex justify-between"><span>Class teacher</span><span>Principal (signature & seal)</span></div>
      </article>
    </div>
  );
}
