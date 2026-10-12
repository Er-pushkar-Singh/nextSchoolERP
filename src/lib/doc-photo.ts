import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { DOC_BUCKET } from "./student-docs";

/** Short-lived signed URLs of students' photographs, for printing ID cards. The caller has already been authorised
 *  to see the document; the files themselves stay private. */
export async function signedPhotoUrls(schoolId: string, studentIds: string[]) {
  const out = new Map<string, string>();
  const db = supabaseAdmin();
  if (!db || !studentIds.length) return out;
  const ids = [...new Set(studentIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("student_documents").select("student_id,file_path").eq("school_id", schoolId).eq("doc_type", "photo")
      .not("file_path", "is", null).neq("status", "rejected").in("student_id", ids.slice(i, i + 200));
    const rows = (data ?? []).filter((r) => r.file_path) as { student_id: string; file_path: string }[];
    if (!rows.length) continue;
    const { data: signed } = await db.storage.from(DOC_BUCKET).createSignedUrls(rows.map((r) => r.file_path), 600);
    (signed ?? []).forEach((s, idx) => { if (s.signedUrl) out.set(rows[idx].student_id, s.signedUrl); });
  }
  return out;
}
