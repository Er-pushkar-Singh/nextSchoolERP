import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExamApp } from "@/components/exam/ExamApp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Online examination", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ExamByLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{24}$/.test(token)) notFound();
  return <ExamApp examToken={token} />;
}
