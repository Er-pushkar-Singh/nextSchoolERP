import { sanitizeHtml } from "@/lib/html-sanitize";
import { withSample } from "@/lib/design";

const PX_PER_MM = 96 / 25.4;

/** A small preview of a template: its html filled with sample data and scaled to fit. */
export function DesignThumb({ html, w, h, width = 200 }: { html: string; w: number; h: number; width?: number }) {
  const k = width / (w * PX_PER_MM);
  return (
    <div className="overflow-hidden rounded-[8px] border border-line bg-white" style={{ width, height: Math.round(h * PX_PER_MM * k) }} aria-hidden>
      <div style={{ width: `${w}mm`, height: `${h}mm`, transform: `scale(${k})`, transformOrigin: "top left", pointerEvents: "none" }}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(withSample(html)) }} />
    </div>
  );
}

export function dimsOf(t: { page_size?: string | null; orientation?: string | null; card_width_mm?: number | null; card_height_mm?: number | null; design?: { w?: number; h?: number } | null }) {
  if (t.design?.w && t.design?.h) return { w: t.design.w, h: t.design.h };
  if (t.page_size === "card") return { w: t.card_width_mm ?? 86, h: t.card_height_mm ?? 54 };
  const [a, b] = t.page_size === "A5" ? [148, 210] : [210, 297];
  return t.orientation === "landscape" ? { w: b, h: a } : { w: a, h: b };
}
