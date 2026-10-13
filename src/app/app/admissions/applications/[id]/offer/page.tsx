import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { PrintButton } from "@/components/ui/PrintButton";
import { PageHeader } from "@/components/ui/ui";
import { dateInWords, fmtDate, money } from "@/lib/format";
import { ADMISSION_DOCS } from "@/lib/applications";
import { DOC_TYPES } from "@/lib/student-docs";

const dn = new Map(DOC_TYPES);

export default async function Offer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school } = await requirePerm("frontdesk.admissions.view");
  const { data: a } = await supabase.from("admission_applications").select("id,application_no,applicant_name,father_name,status,class_id,session_id,offer_valid_till,decision_note,classes!class_id(name),sessions(name)").eq("id", id).eq("school_id", school.id).maybeSingle();
  if (!a) notFound();
  if (a.status !== "approved" && a.status !== "admitted") notFound();
  const [{ data: quote }, { data: docs }] = await Promise.all([
    supabase.rpc("admission_fee_quote", { app: id }),
    supabase.from("application_documents").select("doc_type,status").eq("application_id", id),
  ]);
  const q = (quote ?? []) as { head: string; label: string; due_date: string; amount: number }[];
  const have = new Set((docs ?? []).filter((d) => ["uploaded", "verified", "not_applicable"].includes(d.status)).map((d) => d.doc_type));
  const bring = ADMISSION_DOCS.filter((k) => !have.has(k) && !["caste_certificate", "income_certificate", "disability_certificate", "apaar_consent"].includes(k));
  const cls = a.classes as unknown as { name: string } | null;
  const sess = a.sessions as unknown as { name: string } | null;

  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden"><PageHeader title="Offer of admission" back={{ href: `/app/admissions/applications/${id}`, label: "Application" }} actions={<PrintButton />} /></div>
      <article className="mx-auto w-full max-w-[720px] rounded-[12px] border border-line bg-white p-8 text-[14px] leading-relaxed text-ink print:max-w-none print:border-0 print:p-0">
        <header className="border-b-2 border-ink pb-3 text-center">
          <h1 className="m-0 text-[22px] font-extrabold">{school.name}</h1>
          <p className="m-0 text-[13px] text-body">{[school.address, school.city, school.pincode].filter(Boolean).join(", ")}{school.phone ? ` · ${school.phone}` : ""}</p>
          {school.affiliation_no && <p className="m-0 text-[12px] text-muted">{school.board} Affiliation No. {school.affiliation_no}</p>}
        </header>
        <p className="mt-4 mb-1 text-right">Application no.: <b className="font-mono">{a.application_no}</b></p>
        <h2 className="my-3 text-center text-[17px] tracking-wide">OFFER OF ADMISSION</h2>
        <p>Dear Parent / Guardian of <b>{a.father_name ? `${a.father_name}`: "the applicant"}</b>,</p>
        <p>We are pleased to offer admission to <b>{a.applicant_name}</b> in <b>Class {cls?.name ?? "—"}</b> for the session <b>{sess?.name ?? ""}</b>.
          {a.offer_valid_till && a.status === "approved" && <> This offer is valid till <b>{dateInWords(a.offer_valid_till)}</b> ({fmtDate(a.offer_valid_till)}); after that the seat may be offered to another applicant.</>}</p>
        {q.length > 0 && (
          <>
            <p className="mb-1 font-bold">Fees payable at admission</p>
            <table className="mb-3 w-full border-collapse">
              <thead><tr className="border-y border-ink text-left"><th className="py-1">Particulars</th><th className="py-1">Due</th><th className="py-1 text-right">Amount</th></tr></thead>
              <tbody>{q.map((r, i) => <tr key={i} className="border-b border-line"><td className="py-1">{r.head} · {r.label}</td><td className="py-1">{fmtDate(r.due_date)}</td><td className="py-1 text-right">{money(r.amount)}</td></tr>)}</tbody>
              <tfoot><tr className="border-t-2 border-ink font-bold"><td className="py-1.5" colSpan={2}>Total</td><td className="py-1.5 text-right">{money(q.reduce((t, r) => t + Number(r.amount), 0))}</td></tr></tfoot>
            </table>
            <p className="mt-0 text-[12px] text-muted">Concessions, if any, are applied when the admission is completed.</p>
          </>
        )}
        {bring.length > 0 && (
          <>
            <p className="mb-1 font-bold">Please bring with you</p>
            <ul className="mt-0">{bring.map((k) => <li key={k}>{dn.get(k) ?? k}</li>)}</ul>
          </>
        )}
        {a.decision_note && <p className="text-[13px] text-muted">Note: {a.decision_note}</p>}
        <p className="mt-10 text-right font-bold">{school.principal_name ? school.principal_name : "Principal"}<br /><span className="font-normal text-muted">{school.name}</span></p>
      </article>
    </div>
  );
}
