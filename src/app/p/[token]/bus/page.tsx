import type { Metadata } from "next";
import { portalHome, portalStudent } from "@/lib/portal";
import { todayIST } from "@/lib/format";
import { ParentBus } from "@/components/transport/ParentBus";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "School bus", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function BusPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ret?: string }> }) {
  const { token } = await params;
  const { ret } = await searchParams;
  const back = portalHome(token, ret);
  const { s } = await portalStudent(token);
  if (s.blocked_at && (!s.blocked_till || s.blocked_till >= todayIST())) {
    return <div className="mx-auto max-w-md px-4 py-16 text-center text-[15px]">This page is not available right now. Please contact the school office.</div>;
  }
  return <ParentBus token={token} studentName={s.first_name} backHref={back} />;
}

