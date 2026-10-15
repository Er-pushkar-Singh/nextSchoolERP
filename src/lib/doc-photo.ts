import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { DOC_BUCKET } from "./student-docs";

/**
 * Photographs of students for printing (ID cards, marksheets, admit cards). The caller has already been authorised to see the
 * document; the files stay private.
 *
 * Up to 30 students: the picture is read here and returned as an inline `data:` image, so the printed page never depends on a
 * link that can expire, be blocked or still be loading when the print dialog opens. Larger batches (a class of ID cards) get
 * 1-hour signed links instead.
 */
export async function signedPhotoUrls(schoolId: string, studentIds: string[]) {
  const out = new Map<string, string>();
  const db = supabaseAdmin();
  if (!db || !studentIds.length) return out;
  const ids = [...new Set(studentIds)];
  const inline = ids.length <= 30;
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("student_documents").select("student_id,file_path,created_at").eq("school_id", schoolId).eq("doc_type", "photo")
      .not("file_path", "is", null).neq("status", "rejected").in("student_id", ids.slice(i, i + 200)).order("created_at", { ascending: false });
    const seen = new Set<string>();
    const rows = ((data ?? []) as { student_id: string; file_path: string }[]).filter((r) => r.file_path && !seen.has(r.student_id) && seen.add(r.student_id));
    if (!rows.length) continue;
    const { data: signed } = await db.storage.from(DOC_BUCKET).createSignedUrls(rows.map((r) => r.file_path), 3600);
    for (const [idx, s] of (signed ?? []).entries()) {
      if (!s.signedUrl) continue;
      const sid = rows[idx].student_id;
      if (!inline) { out.set(sid, s.signedUrl); continue; }
      try {
        const r = await fetch(s.signedUrl, { cache: "no-store" });
        const type = (r.headers.get("content-type") ?? "").split(";")[0];
        const buf = Buffer.from(await r.arrayBuffer());
        if (r.ok && /^image\/(png|jpeg|webp)$/.test(type) && buf.length <= 1_500_000) out.set(sid, `data:${type};base64,${buf.toString("base64")}`);
        else out.set(sid, s.signedUrl);
      } catch { out.set(sid, s.signedUrl); }
    }
  }
  return out;
}
