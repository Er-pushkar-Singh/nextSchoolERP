import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Input, Select, Textarea } from "@/components/ui/ui";
import { StudentFields } from "@/components/StudentFields";
import { submitOnline } from "./actions";
import { fmtDate, nowMs, todayIST } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admission application" };

export default async function Apply({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  if (!/^[a-z0-9-]{3,40}$/.test(code)) notFound();
  const db = supabaseAdmin();
  if (!db) notFound();
  const { data: school } = await db!.from("schools").select("id,name,address,city,phone,email,logo_url,status").eq("code", code).is("archived_at", null).maybeSingle();
  if (!school) notFound();
  const [{ data: st }, { data: classes }, { data: session }] = await Promise.all([
    db!.from("online_admission_settings").select("*").eq("school_id", school.id).maybeSingle(),
    db!.from("classes").select("id,name,sort,sections(id,name)").eq("school_id", school.id).order("sort"),
    db!.from("sessions").select("name").eq("school_id", school.id).eq("is_current", true).maybeSingle(),
  ]);
  const today = todayIST();
  const stamp = nowMs();
  const closed = !st?.enabled || (st.closes_on && st.closes_on < today);
  const open = (classes ?? []).filter((c) => !st?.class_ids?.length || st.class_ids.includes(c.id));
  const header = (
    <header className="flex items-center gap-3 border-b border-line pb-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {school.logo_url && <img src={school.logo_url} alt="" className="h-14 w-14 object-contain" />}
      <div>
        <h1 className="m-0 text-[22px] font-extrabold text-ink">{school.name}</h1>
        <p className="m-0 text-[13px] text-muted">{[school.address, school.city].filter(Boolean).join(", ")}{school.phone ? ` · ${school.phone}` : ""}</p>
      </div>
    </header>
  );
  if (closed || !open.length) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
        {header}
        <p className="m-0 rounded-[12px] border border-line bg-white p-5 text-[15px]">
          {st?.enabled && st.closes_on && st.closes_on < today
            ? `Online admission for this session closed on ${fmtDate(st.closes_on)}.`
            : "Online admission is not open right now."} Please contact the school office{school.phone ? ` on ${school.phone}` : ""}.
        </p>
        <Link href={`/apply/${code}/track`} className="text-[14px] font-semibold">Track an application →</Link>
      </div>
    );
  }
  const v = () => null;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
      {header}
      <div>
        <h2 className="m-0 text-[20px] font-bold text-ink">Admission application{session ? ` · Session ${session.name}` : ""}</h2>
        {st?.intro && <p className="mt-1 mb-0 text-[15px] whitespace-pre-line">{st.intro}</p>}
        <p className="mt-2 mb-0 text-[13px] text-muted">Fields marked in the school's record as needed for the UP Board (Hindi names, mobile, address) help us avoid corrections later. You will get an application number — keep it.</p>
        <Link href={`/apply/${code}/track`} className="text-[14px] font-semibold">Already applied? Track your application →</Link>
      </div>
      {sp.error && <div role="alert" className="rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">{sp.error} <span className="text-[#7a1a12]/70">— go back, correct it and submit again.</span></div>}
      {st?.instructions && <div className="rounded-[12px] border border-line bg-white p-4 text-[14px] whitespace-pre-line"><b>Instructions</b><br />{st.instructions}</div>}

      <form action={submitOnline} encType="multipart/form-data" className="flex flex-col gap-6 rounded-[14px] border border-line bg-white p-5">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="t" value={stamp} />
        <div aria-hidden className="hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>

        <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-3">
          <legend className="mb-2 text-[15px] font-bold text-ink">Admission sought</legend>
          <Select label="Class" name="applied_class_id" blank="Select class" options={open.map((c) => [c.id, `Class ${c.name}`] as [string, string])} />
          <label className="flex items-center gap-2 pt-6 text-[14px] font-semibold text-ink"><input type="checkbox" name="rte_applicant" value="1" className="h-4 w-4" /> Applying under RTE (25% quota)</label>
        </fieldset>

        <StudentFields v={v} classes={[]} showClass={false} showAdmission={false} />

        <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-[15px] font-bold text-ink">Another contact (guardian / emergency / person who may collect the child)</legend>
          <Input label="Name" name="c_name_0" /><Input label="Relation" name="c_relation_0" /><Input label="Mobile" name="c_phone_0" type="tel" />
          <label className="flex items-center gap-4 pt-6 text-[13px]"><span className="flex items-center gap-1"><input type="checkbox" name="c_emergency_0" value="1" /> Emergency</span><span className="flex items-center gap-1"><input type="checkbox" name="c_pickup_0" value="1" /> May collect the child</span></label>
        </fieldset>

        <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-[15px] font-bold text-ink">Health (optional)</legend>
          <Input label="Allergies" name="allergies" /><Input label="Medical conditions" name="medical_conditions" />
        </fieldset>

        {st?.ask_documents !== false && (
          <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2">
            <legend className="mb-2 text-[15px] font-bold text-ink">Documents (optional now — you can bring them to the school)</legend>
            {[["photo", "Passport-size photograph (JPG / PNG, up to 1 MB)"], ["birth_certificate", "Birth certificate (PDF / JPG / PNG, up to 5 MB)"], ["previous_marksheet", "Previous report card"], ["transfer_certificate", "Transfer certificate"], ["address_proof", "Address proof"]].map(([k, l]) => (
              <label key={k} className="flex flex-col gap-1 text-[13px] font-semibold text-ink">{l}
                <input type="file" name={`doc_${k}`} accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="input !min-h-10 !py-1.5 text-[14px] font-normal" />
              </label>
            ))}
          </fieldset>
        )}

        <Textarea label="Anything else you want the school to know" name="admission_notes" rows={2} />
        {st?.fee_note && <p className="m-0 rounded-lg bg-blue-soft px-3 py-2 text-[13px]">{st.fee_note}</p>}
        <label className="flex items-start gap-2 text-[14px] text-ink">
          <input type="checkbox" name="declaration" value="1" className="mt-1 h-4 w-4" />
          <span>I declare that the information given is true. I understand that admission is subject to the school's approval and verification of original documents.</span>
        </label>
        <div><button className="btn btn-primary cursor-pointer border-0">Submit application</button></div>
      </form>
      <p className="text-center text-[12px] text-muted">Your details are used only for admission by {school.name}.</p>
    </div>
  );
}
