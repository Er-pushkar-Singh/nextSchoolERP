import type { SupabaseClient } from "@supabase/supabase-js";

export type Branding = { signature: string | null; seal: string | null; watermark_mode: "none" | "logo" | "text"; watermark_text: string | null; watermark_opacity: number };
export const NO_BRANDING: Branding = { signature: null, seal: null, watermark_mode: "logo", watermark_text: null, watermark_opacity: 10 };

export async function getBranding(supabase: SupabaseClient, schoolId: string): Promise<Branding> {
  const { data } = await supabase.from("school_branding").select("signature,seal,watermark_mode,watermark_text,watermark_opacity").eq("school_id", schoolId).maybeSingle();
  return { ...NO_BRANDING, ...((data ?? {}) as Partial<Branding>) };
}

/** Fills the signature / seal slots of a rendered document; when none is uploaded the slot stays empty for a hand signature. */
export function withBrand(html: string, b: Branding) {
  return html.replace(/<img([^>]*?)data-brand="(signature|seal)"([^>]*?)src=""([^>]*)>/g, (_m, a: string, kind: "signature" | "seal", c: string, d: string) => {
    const src = kind === "signature" ? b.signature : b.seal;
    return src ? `<img${a}data-brand="${kind}"${c}src="${src}"${d}>` : `<span style="display:block;width:100%;height:100%"></span>`;
  });
}
