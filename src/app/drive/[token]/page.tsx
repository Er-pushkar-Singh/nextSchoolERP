import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DriverConsole } from "@/components/transport/DriverConsole";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Driver", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Drive({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{24}$/.test(token)) notFound();
  return <DriverConsole token={token} />;
}
