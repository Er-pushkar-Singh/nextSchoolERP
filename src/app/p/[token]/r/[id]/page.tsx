import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { portalHome, portalStudent } from "@/lib/portal";
import { PrintButton } from "@/components/ui/PrintButton";
import { amountInWords, fmtDate, fullName, money, todayIST } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipt", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ParentReceipt({ params, searchParams }: { params: Promise<{ token: string; id: string }>; searchParams: Promise<{ ret?: string }> }) {
  const { token, id } = await params;
  const { ret } = await searchParams;
  const back = portalHome(token, ret);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, s } = await portalStudent(token);
  if (s.blocked_at && (!s.blocked_till || s.blocked_till >= todayIST())) notFound();
  const { data: r } = await db.from("fee_receipts").select("receipt_no,paid_on,amount,mode,reference,cancelled,fee_receipt_lines(amount,fee_dues(label,due_date))").eq("id", id).eq("student_id", s.id).maybeSingle();
  if (!r || r.cancelled) notFound();
  const lines = (r.fee_receipt_lines as unknown as { amount: number; fee_dues: { label: string; due_date: string } | null }[]);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <div className="flex justify-between print:hidden"><Link href={back}>← Back</Link><PrintButton /></div>
      <article className="rounded-[12px] border border-line bg-white p-5 text-[14px] text-ink print:border-0">
        <header className="border-b-2 border-ink pb-2 text-center">
          <h1 className="m-0 text-[20px] font-extrabold">{s.schools.name}</h1>
          <p className="m-0 text-[12px]">{[s.schools.address, s.schools.city].filter(Boolean).join(", ")}</p>
          <p className="mt-1 mb-0 font-bold">FEE RECEIPT</p>
        </header>
        <p className="my-3">No. <b className="font-mono">{r.receipt_no}</b> · {fmtDate(r.paid_on)}<br />{fullName(s)} · Class {s.classes?.name}{s.sections ? `-${s.sections.name}` : ""} · Adm. {s.admission_no}</p>
        <table className="w-full border-collapse"><tbody>
          {lines.map((l, i) => <tr key={i} className="border-b border-line"><td className="py-1">{l.fee_dues?.label}</td><td className="py-1 text-right">{money(l.amount)}</td></tr>)}
          <tr className="font-bold"><td className="py-2">Total</td><td className="py-2 text-right">{money(r.amount)}</td></tr>
        </tbody></table>
        <p className="mb-0">{amountInWords(Number(r.amount))} · {r.mode.replace("_", " ").toUpperCase()}{r.reference ? ` · ${r.reference}` : ""}</p>
      </article>
    </div>
  );
}
