"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { errMsg, go, num, oneOf, str } from "@/lib/action-util";

const BACK = "/app/settings/documents";
const MAX = 330 * 1024;

/** Reads an uploaded image and returns it as an inline data URI (checked by its first bytes, not the file name). */
async function toDataUri(file: Blob): Promise<string | null> {
  const buf = Buffer.from(await file.arrayBuffer());
  const isPng = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp = buf.length > 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
  const mime = isPng ? "image/png" : isJpg ? "image/jpeg" : isWebp ? "image/webp" : null;
  return mime ? `data:${mime};base64,${buf.toString("base64")}` : null;
}

/** Principal's signature or the school seal. */
export async function uploadBrandAsset(f: FormData) {
  const { supabase, school } = await requirePerm("settings.school.edit");
  const kind = oneOf(f, "kind", ["signature", "seal"] as const, "signature");
  const label = kind === "signature" ? "Signature" : "Seal";
  if (f.get("remove") === "1") {
    const { error } = await supabase.from("school_branding").upsert({ school_id: school.id, [kind]: null, updated_at: new Date().toISOString() });
    revalidatePath(BACK);
    go(BACK, error ? { error: errMsg(error) } : { ok: `${label} removed.` });
  }
  const file = f.get("file");
  if (!(file instanceof Blob) || file.size === 0) go(BACK, { error: `Choose the ${label.toLowerCase()} image first.` });
  if (file.size > MAX) go(BACK, { error: `The image is too large (limit ${Math.round(MAX / 1024)} KB). Crop it tightly or save it at a smaller size.` });
  const uri = await toDataUri(file);
  if (!uri) go(BACK, { error: "Use a PNG, JPG or WebP image. A PNG with a transparent background looks best." });
  const { error } = await supabase.from("school_branding").upsert({ school_id: school.id, [kind]: uri, updated_at: new Date().toISOString() });
  revalidatePath(BACK);
  go(BACK, error ? { error: errMsg(error) } : { ok: `${label} saved. It now appears wherever a template has the ${label.toLowerCase()} block.` });
}

export async function saveWatermark(f: FormData) {
  const { supabase, school } = await requirePerm("settings.school.edit");
  const mode = oneOf(f, "watermark_mode", ["none", "logo", "text"] as const, "logo");
  const { error } = await supabase.from("school_branding").upsert({
    school_id: school.id, watermark_mode: mode, watermark_text: str(f, "watermark_text", 40), watermark_opacity: Math.min(30, Math.max(3, Math.round(num(f, "watermark_opacity") ?? 10))), updated_at: new Date().toISOString(),
  });
  revalidatePath(BACK);
  go(BACK, error ? { error: errMsg(error) } : { ok: "Watermark saved." });
}
