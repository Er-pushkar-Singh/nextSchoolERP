import type { Metadata, Viewport } from "next";
import { RegisterSW } from "@/components/family/RegisterSW";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "My school", template: "%s · My school" },
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "My school", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#0b1b33", width: "device-width", initialScale: 1 };

export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-surface">{children}<RegisterSW /></div>;
}
