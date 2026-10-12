import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";

export const metadata: Metadata = { title: "Application received", robots: { index: false, follow: false } };

export default async function Done({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ no?: string; failed?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10 text-center">
      <h1 className="m-0 text-[24px] font-extrabold text-ink">Application received ✓</h1>
      <p className="m-0 rounded-[14px] border-2 border-wa bg-wa-tint p-5 text-[16px] text-[#0b4f2c]">
        Your application number is<br /><b className="text-[24px] font-mono">{sp.no}</b>
      </p>
      <div className="flex justify-center"><CopyButton text={sp.no ?? ""} label="Copy number" /></div>
      <p className="m-0 text-[14px]">Please keep this number. The school will contact you on the mobile number you gave. You can track the status with the application number and that mobile number.</p>
      {sp.failed && <p className="m-0 rounded-lg bg-[#fff4e0] p-3 text-[13px] text-[#7a4b00]">These documents could not be uploaded: {sp.failed}. Please bring them to the school.</p>}
      <Link href={`/apply/${code}/track?no=${encodeURIComponent(sp.no ?? "")}`} className="font-semibold">Track this application →</Link>
    </div>
  );
}
