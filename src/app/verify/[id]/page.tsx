import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signedPhotoUrls } from "@/lib/doc-photo";
import { sanitizeHtml } from "@/lib/html-sanitize";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Document verification", robots: { index: false, follow: false } };

type V = {
  doc_no: string; template_name: string; category: string; issued_on: string; valid_until: string | null; status: string; is_duplicate: boolean; issued_by: string | null;
  student_id: string | null; staff_id: string | null; school_id: string;
  school: { name: string; city: string | null; logo: string | null; phone: string | null };
  person: Record<string, string | null> | null;
  current: { name: string; admission_no: string; status: string; class: string | null } | null;
  exam: Record<string, string> | null;
};
const date = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

/**
 * Public page behind the QR printed on marksheets, report cards and certificates. Anyone who scans it (another school, an
 * employer, a parent) sees whether the document is genuine and the details it was issued with. The id in the link is random.
 */
export default async function Verify({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabaseAdmin();
  const ok = /^[0-9a-f-]{36}$/.test(id);
  const { data } = ok && db ? await db.rpc("verify_document", { p_id: id }) : { data: null };
  const v = data as V | null;
  const photo = v?.student_id ? (await signedPhotoUrls(v.school_id, [v.student_id])).get(v.student_id) ?? null : null;
  const p = v?.person ?? {};
  const genuine = v && v.status === "issued";

  return (
    <main className="min-h-screen bg-[#f3f6fb] px-4 py-8">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        {!v ? (
          <section className="rounded-[16px] border border-[#f3b8b1] bg-white p-6 text-center shadow-sm">
            <p className="m-0 text-[40px]">⚠️</p>
            <h1 className="m-0 mt-2 text-[20px] font-extrabold text-[#7a1a12]">Not found</h1>
            <p className="m-0 mt-2 text-[14px] text-[#5b6478]">No document matches this code. It may be forged or mistyped — please check with the school.</p>
          </section>
        ) : (
          <>
            <header className="flex items-center gap-3 rounded-[16px] border border-[#e3e8f0] bg-white p-4 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {v.school.logo && <img src={v.school.logo} alt="" className="h-12 w-12 rounded-lg object-contain" />}
              <div><p className="m-0 text-[17px] font-extrabold text-[#1c2333]">{v.school.name}</p><p className="m-0 text-[13px] text-[#5b6478]">{[v.school.city, v.school.phone].filter(Boolean).join(" · ")}</p></div>
            </header>
            <section className={`rounded-[16px] border p-5 text-center shadow-sm ${genuine ? "border-[#a8d8bc] bg-[#effaf3]" : "border-[#f3b8b1] bg-[#fdecea]"}`}>
              <p className="m-0 text-[36px]">{genuine ? "✅" : "⛔"}</p>
              <h1 className={`m-0 mt-1 text-[21px] font-extrabold ${genuine ? "text-[#0b4f2c]" : "text-[#7a1a12]"}`}>{genuine ? "Genuine document" : "This document was CANCELLED"}</h1>
              <p className="m-0 mt-1 text-[14px] text-[#3d4559]">{v.template_name} · No. <b className="font-mono">{v.doc_no}</b>{v.is_duplicate ? " (duplicate copy)" : ""}</p>
              <p className="m-0 mt-1 text-[13px] text-[#5b6478]">Issued on {date(v.issued_on)}{v.valid_until ? ` · valid until ${date(v.valid_until)}` : ""}{v.issued_by ? ` · by ${v.issued_by}` : ""}</p>
            </section>
            <section className="flex gap-4 rounded-[16px] border border-[#e3e8f0] bg-white p-5 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photo && <img src={photo} alt="Photograph" className="h-32 w-[104px] shrink-0 rounded-lg border border-[#e3e8f0] object-cover" />}
              <dl className="m-0 grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
                {([["Name", p.name], ["Father", p.father_name], ["Mother", p.mother_name], ["Date of birth", p.dob], ["Admission no.", p.admission_no], ["Class", p.class_section],
                   ["Designation", p.designation], ["Employee code", p.emp_code]] as [string, string | null | undefined][])
                  .filter(([, x]) => x).map(([k, x]) => (<div key={k} className="contents"><dt className="text-[#5b6478]">{k}</dt><dd className="m-0 font-semibold text-[#1c2333]">{x}</dd></div>))}
              </dl>
            </section>
            {v.exam && v.exam.name && (
              <section className="rounded-[16px] border border-[#e3e8f0] bg-white p-5 shadow-sm">
                <h2 className="m-0 text-[16px] font-bold text-[#1c2333]">{v.exam.name} {v.exam.session ? `· ${v.exam.session}` : ""}</h2>
                <p className="m-0 mt-1 text-[14px]">Result <b>{v.exam.result}</b> · {v.exam.total} / {v.exam.max_total} · <b>{v.exam.percent}</b>{v.exam.grade ? ` · grade ${v.exam.grade}` : ""}{v.exam.rank ? ` · rank ${v.exam.rank}` : ""}</p>
                {v.exam.marks_html && <div className="mt-3 overflow-x-auto text-[13px]" dangerouslySetInnerHTML={{ __html: sanitizeHtml(v.exam.marks_html) }} />}
              </section>
            )}
            {v.current && (
              <p className="m-0 text-center text-[12.5px] text-[#5b6478]">School record today: {v.current.name} · {v.current.admission_no} · {v.current.class ? `Class ${v.current.class} · ` : ""}{v.current.status.replace("_", " ")}</p>
            )}
            <p className="m-0 text-center text-[12px] text-[#8a93a8]">Compare these details with the paper. If anything differs, contact the school.</p>
          </>
        )}
      </div>
    </main>
  );
}
