import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "./supabase/admin";

/** Parent page data, looked up by the student's secret link token (server-side, secret key). */
export const portalStudent = cache(async (token: string) => {
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const db = supabaseAdmin();
  if (!db) throw new Error("SUPABASE_SECRET_KEY is not configured");
  const { data: s } = await db.from("students")
    .select("id,school_id,admission_no,first_name,last_name,father_name,class_id,section_id,status,blocked_at,blocked_till,classes!class_id(name),sections(name), schools(id,name,address,city,phone,email,upi_id,bank_details,status,grade_scale,board,affiliation_no,principal_name,pincode)")
    .eq("portal_token", token).maybeSingle();
  if (!s) notFound();
  return { db, s: s as unknown as {
    id: string; school_id: string; admission_no: string; first_name: string; last_name: string | null; father_name: string | null; class_id: string | null; section_id: string | null; status: string; blocked_at: string | null; blocked_till: string | null;
    classes: { name: string } | null; sections: { name: string } | null;
    schools: { id: string; name: string; address: string | null; city: string | null; phone: string | null; email: string | null; upi_id: string | null; bank_details: string | null; status: string; grade_scale: { min: number; grade: string }[]; board: string; affiliation_no: string | null; principal_name: string | null; pincode: string | null };
  } };
});
