import type { Metadata } from "next";
import { ExamApp } from "@/components/exam/ExamApp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Online examination", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ExamPortal() {
  return <ExamApp />;
}
