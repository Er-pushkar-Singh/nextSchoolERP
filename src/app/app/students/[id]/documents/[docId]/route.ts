import { NextResponse } from "next/server";
import { requirePerm } from "@/lib/school";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DOC_BUCKET } from "@/lib/student-docs";

/** Permission-checked download: RLS decides whether this user may see the row; the file itself is private. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(docId)) return new NextResponse("Not found", { status: 404 });
  const { supabase, school } = await requirePerm("students.documents.view");
  const { data: d } = await supabase.from("student_documents").select("file_path,file_name").eq("id", docId).eq("student_id", id).eq("school_id", school.id).maybeSingle();
  if (!d?.file_path) return new NextResponse("Not found", { status: 404 });
  const db = supabaseAdmin();
  if (!db) return new NextResponse("Storage not configured", { status: 503 });
  const { data, error } = await db.storage.from(DOC_BUCKET).createSignedUrl(d.file_path, 60, { download: d.file_name ?? true });
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  await supabase.rpc("log_event", { p_action: "document.downloaded", p_school: school.id, p_entity: "student_documents", p_entity_id: docId, p_details: { student_id: id } });
  const res = NextResponse.redirect(data.signedUrl, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
