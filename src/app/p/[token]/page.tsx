import type { Metadata } from "next";
import { ParentView } from "@/components/family/ParentView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Student", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Parent({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string; pay_error?: string }> }) {
  const { token } = await params;
  return <ParentView token={token} sp={await searchParams} />;
}
