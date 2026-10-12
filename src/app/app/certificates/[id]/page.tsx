import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { Flash, PageHeader, Submit } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { dateInWords, fmtDate, money } from "@/lib/format";
import { CERT_KINDS, type CertDetails } from "@/lib/certificates";
import { cancelCertificate } from "../../_actions/certificates";

export default async function Certificate({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, can } = await requirePerm("students.certificates.view");
  const sp = await searchParams;
  const { data: c } = await supabase.from("student_certificates").select("*").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!c) notFound();
  const d = c.details as CertDetails;
  const title = CERT_KINDS.find(([k]) => k === c.kind)?.[1].replace(/ \(.*\)/, "") ?? "Certificate";
  const he = d.gender === "F" ? "she" : d.gender === "M" ? "he" : "the student";
  const his = d.gender === "F" ? "her" : d.gender === "M" ? "his" : "the";
  const son = d.gender === "F" ? "daughter" : d.gender === "M" ? "son" : "ward";
  const parents = [d.father_name, d.mother_name].filter(Boolean).join(" and ");
  const cls = `${d.class ?? ""}${d.section ? `-${d.section}` : ""}`;
  const can_print = can("students.certificates.print");

  const rows: [string, string | null | undefined][] = c.kind === "transfer" ? [
    ["Name of the student", d.name], ["Admission no.", d.admission_no], ["Father's / guardian's name", d.father_name], ["Mother's name", d.mother_name],
    ["Nationality", d.nationality], ["Category", d.category], ["Date of birth (as per school record)", dateInWords(d.dob)],
    ["Date of admission", fmtDate(d.admission_date)], ["Class at admission", d.admission_class], ["Class in which last studied", cls],
    ["Last examination passed", d.last_exam], ["Result", d.result], ["Whether qualified for promotion", d.promotion],
    ["Fee dues", Number(d.dues_outstanding) > 0 ? `${money(d.dues_outstanding)} outstanding` : "All dues cleared"],
    ["Date of leaving", fmtDate(d.left_on)], ["Reason for leaving", d.reason],
    ["Working days / days present", d.working_days ? `${d.working_days} / ${d.days_present ?? "—"}` : null], ["General conduct", d.conduct],
    ["APAAR ID", d.apaar_id], ["Remarks", d.remarks],
  ] : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="print:hidden">
        <PageHeader icon="academics" title={`${title} · ${c.cert_no}`} back={{ href: "/app/certificates", label: "Certificates" }}
          actions={can_print && c.status === "issued" ? <PrintButton /> : undefined} />
        <Flash ok={sp.ok} error={sp.error} />
      </div>
      <article className="relative rounded-[12px] border border-line bg-white p-8 text-[14px] leading-7 text-ink print:border-0 print:p-0">
        {c.status === "cancelled" && <div className="absolute inset-0 flex items-center justify-center text-[80px] font-extrabold tracking-widest text-[#e11d48]/20 select-none">CANCELLED</div>}
        {c.is_duplicate && <p className="m-0 text-right text-[13px] font-bold tracking-widest">DUPLICATE</p>}
        <header className="border-b-2 border-ink pb-3 text-center">
          {school.logo_url && <img src={school.logo_url} alt="" className="mx-auto mb-1 h-14 w-14 object-contain" />}
          <h1 className="m-0 text-[22px] font-extrabold uppercase">{school.name}</h1>
          <p className="m-0 text-[12px]">{[school.address, school.city, school.pincode].filter(Boolean).join(", ")}</p>
          <p className="m-0 text-[12px]">{[school.board, school.affiliation_no ? `Affiliation No. ${school.affiliation_no}` : null, school.udise_code ? `UDISE ${school.udise_code}` : null, school.phone].filter(Boolean).join(" · ")}</p>
        </header>
        <div className="mt-3 flex justify-between text-[13px]"><span>No.: <b>{c.cert_no}</b></span><span>Date: <b>{fmtDate(c.issued_on)}</b></span></div>
        <h2 className="my-4 text-center text-[18px] font-extrabold tracking-wide uppercase underline">{title}</h2>

        {c.kind === "transfer" ? (
          <table className="w-full border-collapse text-[13.5px]">
            <tbody>
              {rows.filter(([, v]) => v).map(([k, v], i) => (
                <tr key={k}><td className="w-10 border border-ink px-2 py-1">{i + 1}</td><td className="w-[42%] border border-ink px-2 py-1">{k}</td><td className="border border-ink px-2 py-1 font-semibold">{v}</td></tr>
              ))}
            </tbody>
          </table>
        ) : c.kind === "bonafide" ? (
          <p className="text-justify">
            This is to certify that <b>{d.name}</b>, {son} of <b>{parents || "—"}</b>, is a bonafide student of this school, studying in Class <b>{cls}</b> in the session <b>{d.session}</b> (Admission no. {d.admission_no}).
            {" "}As per the school record {his} date of birth is <b>{dateInWords(d.dob)}</b>.
            {d.remarks ? <> {d.remarks}</> : null}
          </p>
        ) : c.kind === "character" ? (
          <p className="text-justify">
            This is to certify that <b>{d.name}</b>, {son} of <b>{parents || "—"}</b>, (Admission no. {d.admission_no}) has been a student of this school{d.admission_date ? ` since ${fmtDate(d.admission_date)}` : ""} and is studying in Class <b>{cls}</b>.
            {" "}To the best of my knowledge {he} bears a <b>{(d.conduct ?? "good").toLowerCase()}</b> moral character and {his} conduct has been <b>{(d.conduct ?? "good").toLowerCase()}</b>.
            {d.remarks ? <> {d.remarks}</> : null}
          </p>
        ) : (
          <p className="text-justify">
            This is to certify that <b>{d.name}</b>, {son} of <b>{parents || "—"}</b>, (Admission no. {d.admission_no}) is studying in Class <b>{cls}</b> of this school in the session <b>{d.session}</b>
            {d.last_exam ? <>; {he} last appeared in <b>{d.last_exam}</b>{d.result ? ` with result: ${d.result}` : ""}</> : null}.
            {d.remarks ? <> {d.remarks}</> : null}
          </p>
        )}
        <div className="mt-16 flex justify-between text-[13px]"><span>Prepared by{c.issued_by_name ? `: ${c.issued_by_name}` : ""}</span><span className="text-center">Principal<br /><span className="text-[11px] text-muted">(signature & school seal)</span></span></div>
        {c.status === "cancelled" && <p className="mt-4 mb-0 text-[12px] text-error print:hidden">Cancelled: {c.cancelled_reason}</p>}
      </article>

      {c.status === "issued" && can("students.certificates.approve") && (
        <form action={cancelCertificate} className="flex flex-wrap items-end gap-2 print:hidden">
          <input type="hidden" name="id" value={id} />
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Cancel this certificate — reason
            <input name="reason" required className="input !min-h-10 !py-2 text-[15px] font-normal" /></label>
          <Submit variant="secondary">Cancel certificate</Submit>
        </form>
      )}
      <p className="m-0 text-[12px] text-muted print:hidden"><Link href={`/app/students/${c.student_id}`}>Student page</Link></p>
    </div>
  );
}
