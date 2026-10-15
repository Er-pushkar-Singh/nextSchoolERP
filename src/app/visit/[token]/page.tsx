import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VisitForm } from "@/components/frontdesk/VisitForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visitor check-in", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Visit({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{24}$/.test(token)) notFound();
  return <VisitForm token={token} />;
}
