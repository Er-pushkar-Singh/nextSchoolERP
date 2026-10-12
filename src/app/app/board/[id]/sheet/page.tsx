import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/school";
import { PageHeader } from "@/components/ui/ui";
import { PrintButton } from "@/components/ui/PrintButton";
import { fmtDate } from "@/lib/format";
import { boardLevel } from "@/lib/board";
import { levelOf } from "@/lib/board-rules";
import { decryptJson } from "@/lib/crypto";
import { maskAadhaar } from "@/lib/aadhaar";

const SEX: Record<string, [string, string]> = { M: ["1", "Male / पुरुष"], F: ["2", "Female / महिला"], O: ["3", "Transgender / ट्रांसजेंडर"] };
const CAT: Record<string, [string, string]> = { SC: ["1", "SC"], ST: ["2", "ST"], OBC: ["3", "OBC"], General: ["4", "General"], EWS: ["5", "EWS"] };

/** The numbered data sheet that matches the Board's printed exam form (HS / Intermediate 2027), for verification and signing
 *  before the entries are keyed into the Board's portal. It does not replace the Board's own form. */
export default async function BoardSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, school, session, can } = await requirePerm("students.board_reg.view");
  if (!session) notFound();
  const [{ data: s }, { data: reg }, { data: sens }, { data: subs }, { data: codes }, { data: prior }, { data: photo }] = await Promise.all([
    supabase.from("students").select("*, classes(name), sections(name)").eq("id", id).eq("school_id", school.id).maybeSingle(),
    supabase.from("board_registrations").select("*").eq("student_id", id).eq("session_id", session.id).maybeSingle(),
    can("students.sensitive.view") ? supabase.from("student_sensitive").select("pen,apaar_id,aadhaar_enc,aadhaar_last4,disability_type").eq("student_id", id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("student_board_subjects").select("slot,code").eq("student_id", id).eq("session_id", session.id),
    supabase.from("board_subject_codes").select("level,code,name_en,name_hi"),
    supabase.from("student_prior_exams").select("*").eq("student_id", id),
    supabase.from("student_documents").select("status").eq("student_id", id).eq("doc_type", "photo").not("file_path", "is", null).maybeSingle(),
  ]);
  if (!s || !reg) notFound();
  const cn = (s as unknown as { classes: { name: string } | null }).classes?.name;
  const lv = boardLevel(cn);
  if (!lv) notFound();
  const level = levelOf(lv.level);
  const hs = level === "hs";
  const nm = new Map((codes ?? []).filter((c) => c.level === level).map((c) => [c.code, c]));
  const slot = (k: string) => (subs ?? []).find((x) => x.slot === k)?.code ?? null;
  const subj = (k: string) => { const c = slot(k); return c ? `${c} — ${nm.get(c)?.name_en ?? ""}${nm.get(c)?.name_hi ? ` (${nm.get(c)!.name_hi})` : ""}` : null; };
  const up = (t: string | null | undefined) => (t ? t.toUpperCase() : null);
  const full = [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" ");
  const sx = s.gender ? SEX[s.gender] : null;
  const ct = s.category ? CAT[s.category] : null;
  const priorOf = (l: string) => (prior ?? []).find((p) => p.level === l);
  let aadhaar: string = maskAadhaar(sens?.aadhaar_last4);
  if (sens?.aadhaar_enc && can("students.board_reg.approve")) {
    try { aadhaar = decryptJson(sens.aadhaar_enc as string).n ?? aadhaar; } catch { /* key changed: keep masked */ }
  }
  const address = [s.street ?? s.address, s.city, s.post_office, s.block_tehsil, s.district, s.state, s.pincode].filter(Boolean).join(", ");
  const subjects = hs
    ? [["17", "1st compulsory subject", subj("1")], ["18", "2nd compulsory subject", subj("2")], ["19", "3rd compulsory subject", subj("3")], ["20", "4th compulsory subject", subj("4")],
       ["21", "5th compulsory subject", subj("5")], ["22", "6th optional subject", subj("6")], ["23", "7th compulsory subject", subj("7") ?? "944 — Moral, Yoga, Sports & Physical Education"], ["24", "Pre-vocational / vocational trade", subj("trade")]]
    : [["18", "1st subject", subj("1")], ["19", "2nd subject", subj("2")], ["20", "3rd subject", subj("3")], ["21", "4th subject", subj("4")], ["22", "5th subject", subj("5")],
       ["23", "6th subject", subj("6")], ["24", "7th subject", subj("7") ?? "173 — Moral, Yoga, Sports & Physical Education"]];

  const rows: [string, string, string | null | undefined][] = hs ? [
    ["1", "Institution user ID (6 digits) / संस्थागत विद्यालय की यूजर आईडी", (school as unknown as { upmsp_user_id?: string }).upmsp_user_id],
    ["2", "Centre number given by the DIOS (4 digits) / अग्रसारण केन्द्र संख्या", (school as unknown as { upmsp_center_no?: string }).upmsp_center_no],
    ["3", "Name of the school / विद्यालय का नाम", school.name],
    ["4", "Candidate's name (capital letters)", up(full)], ["5", "Mother's name (capital letters)", up(s.mother_name)], ["6", "Father's name (capital letters)", up(s.father_name)],
    ["7", "परीक्षार्थी का नाम हिन्दी में", s.name_hi], ["8", "माता का नाम हिन्दी में", s.mother_name_hi], ["9", "पिता का नाम हिन्दी में", s.father_name_hi],
    ["10", "Address (street / village-town-city / post office / tehsil-block / district / state / PIN)", up(address)],
    ["11", "Nationality (1 Indian · 2 Other)", (s.nationality ?? "Indian").toLowerCase().startsWith("ind") ? "1 — Indian" : `2 — ${s.nationality}`],
    ["12", "Sex code", sx ? `${sx[0]} — ${sx[1]}` : null], ["13", "Category code", ct ? `${ct[0]} — ${ct[1]}` : null],
    ["14", "Medium of question paper (1 Hindi · 2 English)", s.medium === "hindi" ? "1 — Hindi" : s.medium === "english" ? "2 — English" : null],
    ["15", "Exam type (1 Full · 2 Part exam under Reg. 17(1))", reg.exam_type === "part" ? "2 — Part exam" : "1 — Full exam"],
    ["16", "Date of birth (dd/mm/yyyy)", s.dob ? fmtDate(s.dob) : null],
  ] : [
    ["1", "Institution user ID (6 digits)", (school as unknown as { upmsp_user_id?: string }).upmsp_user_id],
    ["2", "Centre number given by the DIOS (4 digits)", (school as unknown as { upmsp_center_no?: string }).upmsp_center_no],
    ["4", "Name of the school / विद्यालय का नाम", school.name],
    ["5", "Candidate's name (capital letters)", up(full)], ["6", "Mother's name (capital letters)", up(s.mother_name)], ["7", "Father's name (capital letters)", up(s.father_name)],
    ["8", "परीक्षार्थी का नाम हिन्दी में", s.name_hi], ["9", "माता का नाम हिन्दी में", s.mother_name_hi], ["10", "पिता का नाम हिन्दी में", s.father_name_hi],
    ["11", "Address (street / village-town-city / post office / tehsil-block / district / state / PIN)", up(address)],
    ["12", "Nationality (1 Indian · 2 Other)", (s.nationality ?? "Indian").toLowerCase().startsWith("ind") ? "1 — Indian" : `2 — ${s.nationality}`],
    ["13", "Sex code", sx ? `${sx[0]} — ${sx[1]}` : null], ["14", "Category code", ct ? `${ct[0]} — ${ct[1]}` : null],
    ["15", "Medium of question paper (1 Hindi · 2 English)", s.medium === "hindi" ? "1 — Hindi" : s.medium === "english" ? "2 — English" : null],
    ["16", "Subject group (A, B, C, F1, F2, I)", reg.subject_group],
    ["17", "Exam type (1 Full · 2 Additional subjects Reg. 17(2))", reg.exam_type === "part" ? "2 — Additional subjects" : "1 — Full exam"],
  ];
  const tail: [string, string, string | null | undefined][] = hs ? [
    ["25", "Candidate's mobile number (10 digits)", s.mobile], ["26", "Aadhaar number (12 digits)", aadhaar], ["27", "APAAR ID (12 digits)", sens?.apaar_id], ["28", "PEN", sens?.pen],
    ["31", "Class 9 advance registration — year / number / school / codes", priorOf("class9_registration") ? [priorOf("class9_registration")!.exam_year, priorOf("class9_registration")!.registration_no, priorOf("class9_registration")!.school_name, `${priorOf("class9_registration")!.district_code ?? ""}/${priorOf("class9_registration")!.school_code ?? ""}`].filter(Boolean).join(" · ") : null],
    ["37", "Candidate's e-mail ID", s.email],
  ] : [
    ["27", "Candidate's mobile number (10 digits)", s.mobile], ["28", "Aadhaar number (12 digits)", aadhaar], ["29", "APAAR ID (12 digits)", sens?.apaar_id], ["30", "PEN", sens?.pen],
    ["26", "High School passed — board / year / roll no.", priorOf("high_school") ? [priorOf("high_school")!.board_name, priorOf("high_school")!.exam_year, priorOf("high_school")!.roll_no].filter(Boolean).join(" · ") : null],
    ["31–34", "Class 11 advance registration — year / number / school / board / codes", priorOf("class11_registration") ? [priorOf("class11_registration")!.exam_year, priorOf("class11_registration")!.registration_no, priorOf("class11_registration")!.school_name, priorOf("class11_registration")!.board_name].filter(Boolean).join(" · ") : null],
    ["40", "Candidate's e-mail ID", s.email],
  ];
  const all = [...rows, ...(subjects as [string, string, string | null][]), ...tail];
  const missing = all.filter(([, , v]) => !v).length;

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4">
      <div className="print:hidden"><PageHeader title={`Board form data sheet · ${full}`} back={{ href: `/app/board/${id}`, label: "Board registration" }} actions={<PrintButton />}
        subtitle={`${hs ? "High School exam / Class 9 registration" : "Intermediate exam / Class 11 registration"} · field numbers follow the Board's 2027 form · ${missing} field(s) still empty`} /></div>
      <article className="rounded-[12px] border border-line bg-white p-5 text-[12.5px] text-ink print:border-0 print:p-0">
        <header className="mb-3 flex items-start justify-between gap-4 border-b-2 border-ink pb-2">
          <div>
            <h1 className="m-0 text-[17px] font-extrabold">{school.name}</h1>
            <p className="m-0">UP Board (UPMSP) — {hs ? "High School" : "Intermediate"} · {reg.kind === "advance_registration" ? `Class ${lv.level} advance registration` : "Examination application"} · Session {session.name} · Exam year {reg.exam_year ?? "—"}</p>
            <p className="m-0 text-[11px] text-muted">Data sheet for verification before online entry. Adm. no. {s.admission_no} · Class {cn}{s.sections ? `-${(s as unknown as { sections: { name: string } }).sections.name}` : ""}</p>
          </div>
          <div className="flex h-24 w-20 flex-none items-center justify-center border border-ink text-center text-[10px] text-muted">{photo ? "Photo on file — stick the printed photo here" : "Paste passport photo"}</div>
        </header>
        <table className="w-full border-collapse">
          <thead><tr className="bg-surface-alt text-left"><th className="w-14 border border-ink px-2 py-1">No.</th><th className="border border-ink px-2 py-1">Item</th><th className="border border-ink px-2 py-1">Entry</th></tr></thead>
          <tbody>
            {all.map(([n, label, value]) => (
              <tr key={`${n}-${label}`}>
                <td className="border border-ink px-2 py-1">{n}</td>
                <td className="border border-ink px-2 py-1">{label}</td>
                <td className={`border border-ink px-2 py-1 font-semibold ${value ? "" : "bg-[#fff4e0] text-[#7a4b00]"}`}>{value || "— not entered —"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {reg.board_roll_no || reg.board_reg_no ? <p className="mt-2 mb-0">Board roll no. (अनुक्रमांक): <b>{reg.board_roll_no ?? "—"}</b> · Board registration no.: <b>{reg.board_reg_no ?? "—"}</b></p> : null}
        <p className="mt-4 mb-0 text-[12px]">I have checked every entry above against the school records and the birth certificate; the spelling of my / my ward&apos;s name, parents&apos; names, date of birth and subjects is correct.</p>
        <div className="mt-10 grid grid-cols-3 gap-6 text-center text-[11px]">
          <span className="border-t border-ink pt-1">Candidate / parent signature</span><span className="border-t border-ink pt-1">Checked by (teacher)</span><span className="border-t border-ink pt-1">Principal (signature &amp; seal)</span>
        </div>
      </article>
    </div>
  );
}
