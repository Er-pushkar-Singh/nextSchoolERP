import type { Branding } from "@/lib/branding";

/**
 * The sheet a document is printed on: the school's watermark (logo or text, set in Settings → Documents) behind the content.
 * The watermark is a real element (not a CSS background), so it appears in print / PDF as well.
 */
export function DocSheet({ branding, logoUrl, schoolName, children, className = "", style }: {
  branding: Branding; logoUrl: string | null; schoolName: string; children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  const mode = branding.watermark_mode === "logo" && !logoUrl ? "none" : branding.watermark_mode;
  const opacity = Math.min(30, Math.max(3, branding.watermark_opacity)) / 100;
  return (
    <div className={`relative isolate overflow-hidden ${className}`} style={style}>
      {mode !== "none" && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden select-none" style={{ opacity }}>
          {mode === "logo" && logoUrl
            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={logoUrl} alt="" style={{ width: "55%", maxHeight: "70%", objectFit: "contain" }} />
            : <span style={{ transform: "rotate(-30deg)", fontSize: "clamp(36px, 9vw, 84px)", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center", lineHeight: 1.1, color: "#0f172a", maxWidth: "90%" }}>
              {branding.watermark_text || schoolName}
            </span>}
        </div>
      )}
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
