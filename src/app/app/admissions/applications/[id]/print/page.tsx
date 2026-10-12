import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { PageHeader } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate, money } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { maskAadhaar } from "@/lib/aadhaar";
import { DOC_TYPES } from "@/lib/student-docs";
import { ADMISSION_DOCS, type AppForm } from "@/lib/applications";

const dn = new Map(DOC_TYPES);

/** Printable application form + acknowledgement slip for the parent. */
export default async function PrintApplication({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session } = await requirePerm("frontdesk.admissions.view");
  const { data: a } = await supabase.from("admission_applications").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!a) notFound();
  const [classes, { data: docs }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("application_documents").select("doc_type,status").eq("application_id", id),
  ]);
  const f = (a.form ?? {}) as AppForm;
  const cls = classes.find((c) => c.id === a.class_id);
  const have = new Map((docs ?? []).map((d) => [d.doc_type, d.status]));
  const gender = f.gender === "M" ? "Male" : f.gender === "F" ? "Female" : f.gender === "O" ? "Transgender / other" : "";
  const cell = "border border-ink px-2 py-1";
  const kv = (k: string, v?: string | number | null) => (
    <tr><td className={`${cell} w-[34%] bg-surface-alt`}>{k}</td><td className={`${cell} font-semibold`}>{v || ""}</td></tr>
  );
  return (
    <div className="mx-auto flex max-w-[800px] flex-col gap-4">
      <div className="print:hidden"><PageHeader title={`Application ${a.application_no}`} back={{ href: `/app/admissions/applications/${id}`, label: "Application" }} actions={<PrintButton />} /></div>
      <article className="rounded-[12px] border border-line bg-white p-6 text-[12.5px] text-ink print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-2">
          <div>
            <h1 className="m-0 text-[20px] font-extrabold uppercase">{school.name}</h1>
            <p className="m-0">{[school.address, school.city, school.pincode].filter(Boolean).join(", ")}</p>
            <p className="m-0">{[school.board, school.affiliation_no ? `Aff. ${school.affiliation_no}` : null, school.phone].filter(Boolean).join(" · ")}</p>
            <p className="mt-2 mb-0 text-[15px] font-bold">ADMISSION APPLICATION FORM — Session {session?.name ?? ""}</p>
            <p className="m-0">Application no. <b>{a.application_no}</b> · Date {fmtDate(a.applied_on)} · Class applied for: <b>{cls?.name ?? "—"}</b>{a.rte_applicant ? " · RTE" : ""}</p>
          </div>
          <div className="flex h-28 w-24 flex-none items-center justify-center border border-ink text-center text-[10px] text-muted">Paste passport-size photograph</div>
        </header>

        <h2 className="mt-3 mb-1 text-[13px] font-bold uppercase">Student</h2>
        <table className="w-full border-collapse"><tbody>
          {kv("Name (English)", [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(" ").toUpperCase())}
          {kv("Name (Hindi)", f.name_hi as string)}
          {kv("Date of birth", f.dob ? fmtDate(f.dob as string) : "")}
          {kv("Gender", gender)}{kv("Category", f.category as string)}{kv("Religion / caste", [f.religion, f.caste].filter(Boolean).join(" / "))}
          {kv("Medium", f.medium as string)}{kv("Blood group", f.blood_group as string)}{kv("Mother tongue", f.mother_tongue as string)}{kv("Nationality", f.nationality as string)}
          {kv("Aadhaar", f.aadhaar_last4 ? maskAadhaar(f.aadhaar_last4 as string) : "")}{kv("APAAR ID / PEN", [f.apaar_id, f.pen].filter(Boolean).join(" / "))}
          {kv("Student mobile", f.mobile as string)}
        </tbody></table>

        <h2 className="mt-3 mb-1 text-[13px] font-bold uppercase">Parents & contacts</h2>
        <table className="w-full border-collapse"><tbody>
          {kv("Father's name", [f.father_name, f.father_name_hi && `(${f.father_name_hi})`].filter(Boolean).join(" "))}
          {kv("Mother's name", [f.mother_name, f.mother_name_hi && `(${f.mother_name_hi})`].filter(Boolean).join(" "))}
          {kv("Phone / WhatsApp", [f.guardian_phone, f.alt_phone].filter(Boolean).join(", "))}{kv("Email", f.email as string)}
          {(f.contacts ?? []).map((c, i) => kv(`Contact ${i + 1}${c.is_emergency ? " (emergency)" : ""}${c.can_pickup ? " (pickup)" : ""}`, `${c.name}${c.relation ? ` — ${c.relation}` : ""}${c.phone ? ` — ${c.phone}` : ""}`))}
        </tbody></table>

        <h2 className="mt-3 mb-1 text-[13px] font-bold uppercase">Address</h2>
        <table className="w-full border-collapse"><tbody>
          {kv("Current address", [f.street, f.address, f.city, f.post_office, f.block_tehsil, f.district, f.state, f.pincode].filter(Boolean).join(", "))}
          {kv("Permanent address", f.permanent_address as string)}
        </tbody></table>

        <h2 className="mt-3 mb-1 text-[13px] font-bold uppercase">Previous school</h2>
        <table className="w-full border-collapse"><tbody>
          {kv("School / board / class", [f.previous_school, f.previous_board, f.previous_class].filter(Boolean).join(" · "))}
          {kv("Last exam % / days attended", [f.previous_year_percent, f.previous_year_days].filter((x) => x !== null && x !== undefined && x !== "").join(" / "))}
        </tbody></table>

        <h2 className="mt-3 mb-1 text-[13px] font-bold uppercase">Documents</h2>
        <p className="m-0">{ADMISSION_DOCS.map((k) => `${have.get(k) && ["uploaded", "verified"].includes(have.get(k)!) ? "☑" : have.get(k) === "pending" ? "◐" : "☐"} ${dn.get(k)}`).join("   ")}</p>
        <p className="m-0 text-[11px] text-muted">☑ received · ◐ will be submitted later · ☐ not received</p>

        <h2 className="mt-3 mb-1 text-[13px] font-bold uppercase">Declaration</h2>
        <p className="m-0 text-justify">I declare that the information given above is true to the best of my knowledge. I will abide by the rules of the school, and I understand that admission is subject to approval and to the submission of the original documents.</p>
        <div className="mt-10 grid grid-cols-3 gap-6 text-center text-[11px]">
          <span className="border-t border-ink pt-1">Parent / guardian signature</span><span className="border-t border-ink pt-1">Received by</span><span className="border-t border-ink pt-1">Principal</span>
        </div>

        <div className="mt-8 border-t-2 border-dashed border-ink pt-3">
          <p className="m-0 text-center text-[11px] text-muted">— cut here · acknowledgement for the parent —</p>
          <p className="m-0 mt-1 font-bold">{school.name} — Application received</p>
          <p className="m-0">Application no. <b>{a.application_no}</b> · {a.applicant_name} · Class {cls?.name ?? "—"} · {fmtDate(a.applied_on)}{a.fee_amount ? ` · Fee ${money(a.fee_amount)} received` : ""}</p>
          <p className="m-0 text-[11px] text-muted">Keep this slip. Quote the application number for any enquiry.</p>
        </div>
      </article>
    </div>
  );
}
