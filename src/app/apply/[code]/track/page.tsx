import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/ui";
import { fmtDate } from "@/lib/format";
import { APP_STATUS, APP_TONE } from "@/lib/applications";
import { DOC_TYPES } from "@/lib/student-docs";
import { lookupStatus } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Track application", robots: { index: false, follow: false } };

type Result = { application_no: string; name: string; status: string; applied_on: string; class: string | null; test_on: string | null; interview_on: string | null; waitlist_no: number | null; decision_note: string | null; school: string;
  documents: { doc_type: string; status: string; due_by: string | null; reason: string | null }[] };
const dn = new Map(DOC_TYPES);
const MESSAGE: Record<string, string> = {
  submitted: "We have received your application.", under_review: "The school is reviewing your application.", test_scheduled: "A test / interview has been scheduled.",
  approved: "Your application is approved. The school office will contact you to complete the admission.", waitlisted: "Your application is on the waiting list.",
  rejected: "We are sorry — the application could not be accepted.", admitted: "Admission is complete. Welcome!", cancelled: "This application was cancelled.",
};

export default async function Track({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ no?: string; phone?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  if (!/^[a-z0-9-]{3,40}$/.test(code)) notFound();
  let result: Result | null = null;
  let searched = false;
  if (sp.no && sp.phone) {
    searched = true;
    const db = supabaseAdmin();
    if (db) {
      const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      const { data } = await db.rpc("public_application_status", { p_code: code, p_no: sp.no, p_phone: sp.phone, p_ip_hash: createHash("sha256").update(`${ip}|${code}`).digest("hex").slice(0, 24) });
      result = (data as Result | null) ?? null;
    }
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="m-0 text-[22px] font-extrabold text-ink">Track your application</h1>
      <form action={lookupStatus} className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-4">
        <input type="hidden" name="code" value={code} />
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Application number<input name="no" defaultValue={sp.no} required placeholder="APP/2026-27/0001" className="input !min-h-10 text-[15px] font-normal" /></label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Parent's mobile number (given in the form)<input name="phone" defaultValue={sp.phone} required inputMode="numeric" className="input !min-h-10 text-[15px] font-normal" /></label>
        <div><button className="btn btn-primary cursor-pointer border-0">Check status</button></div>
      </form>
      {searched && !result && <p role="alert" className="m-0 rounded-[12px] border border-[#f3b8b1] bg-[#fdecea] px-4 py-3 text-[14px] text-[#7a1a12]">No application matches that number and mobile. Check both and try again.</p>}
      {result && (
        <section className="rounded-[14px] border border-line bg-white p-5">
          <p className="m-0 text-[13px] text-muted">{result.school}</p>
          <h2 className="m-0 text-[18px] font-bold text-ink">{result.name} <span className="font-mono text-[13px] font-normal text-muted">{result.application_no}</span></h2>
          <p className="mt-2 mb-0"><Badge value={APP_TONE[result.status]} text={APP_STATUS[result.status] + (result.waitlist_no ? ` #${result.waitlist_no}` : "")} /></p>
          <p className="mt-2 mb-0 text-[15px]">{MESSAGE[result.status]}</p>
          <p className="mt-2 mb-0 text-[13px] text-muted">Class {result.class ?? "—"} · applied {fmtDate(result.applied_on)}{result.test_on ? ` · test on ${fmtDate(result.test_on)}` : ""}{result.interview_on ? ` · interview on ${fmtDate(result.interview_on)}` : ""}</p>
          {result.decision_note && <p className="mt-2 mb-0 text-[14px]">Note from the school: {result.decision_note}</p>}
          {result.documents.length > 0 && (
            <ul className="m-0 mt-3 list-none p-0 text-[14px]">
              {result.documents.map((d) => (
                <li key={d.doc_type} className="flex justify-between gap-2 border-t border-line py-1.5">
                  <span>{dn.get(d.doc_type) ?? d.doc_type}</span>
                  <span className="text-muted">{d.status.replace("_", " ")}{d.status === "pending" && d.due_by ? ` · by ${fmtDate(d.due_by)}` : ""}{d.reason ? ` · ${d.reason}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
