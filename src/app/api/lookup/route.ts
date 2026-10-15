import { NextResponse } from "next/server";
import { requireSchool } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Type-ahead for pickers: students, staff or login holders of the *current school only* (RLS applies too). */
export async function GET(req: Request) {
  const { supabase, school, canAny } = await requireSchool();
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind");
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 40);
  // students, staff and books are listed as soon as the box is opened (q empty) and narrowed while typing; the rest need 2 letters
    const preload = kind === "student" || kind === "staff" || kind === "book";
    if (q.length < (preload ? 0 : 2)) return NextResponse.json({ hits: [] });
  const like = `%${q.replace(/[%_\\,()]/g, " ")}%`;
  if (kind === "student") {
    if (!canAny("students.profile.view", "frontdesk.visitors.view", "fees.collection.view", "attendance.students.view", "documents.issue.view", "students.board_reg.view",
                "library.circulation.view", "wellbeing.medical.view", "wellbeing.discipline.view", "hostel.allocation.view", "hostel.rollcall.view"))
      return NextResponse.json({ hits: [] }, { status: 403 });
    const { data } = await supabase.rpc("student_lookup", { sid: school.id, p_q: q });
    return NextResponse.json({ hits: ((data ?? []) as { id: string; name: string; admission_no: string; class_name: string | null; father_name: string | null }[]).map((s) => ({
      id: s.id, label: s.name,
      sub: [s.admission_no, s.class_name, s.father_name ? `S/o ${s.father_name}` : null].filter(Boolean).join(" · "),
    })) });
  }
  if (kind === "staff") {
    if (!canAny("hr.staff.view", "frontdesk.visitors.view", "academics.timetable.view", "library.circulation.view", "hostel.allocation.view")) return NextResponse.json({ hits: [] }, { status: 403 });
    const { data } = await supabase.rpc("staff_lookup", { sid: school.id, p_q: q });
    return NextResponse.json({ hits: ((data ?? []) as { id: string; name: string; designation: string | null; emp_code: string | null }[]).map((s) => ({ id: s.id, label: s.name, sub: [s.designation, s.emp_code].filter(Boolean).join(" · ") })) });
  }
  if (kind === "applicant") {
    if (!canAny("frontdesk.admissions.view", "frontdesk.enquiries.view")) return NextResponse.json({ hits: [] }, { status: 403 });
    const [{ data: apps }, { data: enqs }] = await Promise.all([
      supabase.from("admission_applications").select("id,applicant_name,application_no,status").eq("school_id", school.id).not("status", "in", "(admitted,cancelled,rejected)")
        .or(`applicant_name.ilike.${like},application_no.ilike.${like}`).limit(6),
      supabase.from("enquiries").select("id,student_name,phone,status").eq("school_id", school.id).not("status", "in", "(admitted,lost)")
        .or(`student_name.ilike.${like},phone.ilike.${like}`).limit(6),
    ]);
    return NextResponse.json({ hits: [
      ...(apps ?? []).map((a) => ({ id: `a:${a.id}`, label: a.applicant_name, sub: `Application ${a.application_no}` })),
      ...(enqs ?? []).map((e) => ({ id: `e:${e.id}`, label: e.student_name, sub: `Enquiry${e.phone ? ` · ${e.phone}` : ""}` })),
    ] });
  }
  if (kind === "book") {
    if (!canAny("library.circulation.view", "library.catalogue.view")) return NextResponse.json({ hits: [] }, { status: 403 });
    const { data } = await supabase.rpc("library_book_list", { sid: school.id, p_q: q || null, p_limit: 20, p_offset: 0 });
    return NextResponse.json({ hits: ((data ?? []) as { id: string; title: string; author: string | null; accession_no: string | null; available: number; copies: number; active: boolean }[]).map((b) => ({
      id: b.id, label: b.title, sub: [b.accession_no, b.author, !b.active ? "withdrawn" : `${b.available}/${b.copies} available`].filter(Boolean).join(" · "),
    })) });
  }
  if (kind === "member") {
    if (!canAny("academics.allocation.view", "settings.users.view")) return NextResponse.json({ hits: [] }, { status: 403 });
    const { data } = await supabase.from("school_members").select("user_id,name,email").eq("school_id", school.id).or(`name.ilike.${like},email.ilike.${like}`).limit(10);
    return NextResponse.json({ hits: (data ?? []).map((m) => ({ id: m.user_id, label: m.name ?? m.email ?? "User", sub: m.email ?? undefined })) });
  }
  return NextResponse.json({ hits: [] });
}
