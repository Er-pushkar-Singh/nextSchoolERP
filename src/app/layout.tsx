import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import "./globals.css";
import { GlobalLoader } from "@/components/GlobalLoader";
import { brand } from "@/lib/brand";

const grotesk = localFont({ src: "../fonts/schibsted-grotesk-var.woff2", variable: "--font-grotesk", weight: "400 900", display: "swap" });
const plexMono = localFont({
  src: [{ path: "../fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" }, { path: "../fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" }],
  variable: "--font-plex-mono", display: "swap", preload: false,
});

export const metadata: Metadata = {
  title: { default: brand.product, template: `%s · ${brand.product}` },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#0b1b33", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${grotesk.variable} ${plexMono.variable} antialiased`}>
      <body className="min-h-screen bg-surface-alt"><Suspense fallback={null}><GlobalLoader /></Suspense>{children}</body>
    </html>
  );
}
