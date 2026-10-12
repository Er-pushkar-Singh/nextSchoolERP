"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { boardLevel, defaultExamYear, type RegKind } from "@/lib/board";
import { checkRegistration } from "@/lib/board-check";
import { levelOf } from "@/lib/board-rules";

const KINDS = ["advance_registration", "exam_application"] as const;

/** Start a draft registration for one student. */
export async function startRegistration(f: FormData) {
  const { supabase, school, session } = await requirePerm("students.board_reg.create");
  const stu = uuid(f, "student_id");
  const to = `/app/board/${stu}`;
  if (!session) go("/app/board", { error: "Set a current session first (Settings → Classes & sessions)." });
  const { data: s } = await supabase.from("students").select("id,classes(name)").eq("id", stu!).eq("school_id", school.id).maybeSingle();
  const lv = boardLevel((s as unknown as { classes: { name: string } | null } | null)?.classes?.name);
  if (!s || !lv) go("/app/board", { error: "Board registration is for students of Class 9, 10, 11 or 12." });
  const year = Math.round(num(f, "exam_year") ?? defaultExamYear(session!.name, lv!.kind));
  const { error } = await supabase.from("board_registrations").insert({
    school_id: school.id, student_id: stu, session_id: session!.id, kind: lv!.kind, class_level: lv!.level, exam_year: year,
  });
  revalidatePath("/app/board");
  go(to, error ? { error: /unique|duplicate/i.test(error.message) ? "A registration already exists for this student." : errMsg(error) } : { ok: "Registration started. Add subjects and the photograph, then ask the principal to check it." });
}

/** Start drafts for every active student of a class that has none yet. */
export async function startClass(f: FormData) {
  const { supabase, school, session } = await requirePerm("students.board_reg.create");
  const cls = uuid(f, "class_id");
  if (!session || !cls) go("/app/board", { error: "Pick a class." });
  const { data: c } = await supabase.from("classes").select("name").eq("id", cls!).eq("school_id", school.id).maybeSingle();
  const lv = boardLevel(c?.name);
  if (!lv) go("/app/board", { error: "Board registration is for Class 9, 10, 11 and 12 only." });
  const [{ data: studs }, { data: have }] = await Promise.all([
    supabase.from("students").select("id").eq("school_id", school.id).eq("class_id", cls!).eq("status", "active").limit(3000),
    supabase.from("board_registrations").select("student_id").eq("school_id", school.id).eq("session_id", session!.id).eq("kind", lv!.kind).limit(10000),
  ]);
  const hv = new Set((have ?? []).map((h) => h.student_id));
  const year = Math.round(num(f, "exam_year") ?? defaultExamYear(session!.name, lv!.kind));
  const rows = (studs ?? []).filter((s) => !hv.has(s.id)).map((s) => ({ school_id: school.id, student_id: s.id, session_id: session!.id, kind: lv!.kind, class_level: lv!.level, exam_year: year }));
  if (!rows.length) go(`/app/board?class_id=${cls}`, { ok: "Every student of this class already has a registration." });
  const { error } = await supabase.from("board_registrations").insert(rows);
  revalidatePath("/app/board");
  go(`/app/board?class_id=${cls}`, error ? { error: errMsg(error) } : { ok: `Started ${rows.length} registration(s) as draft.` });
}

/** The subject group (Intermediate) and the exam type of the registration. */
export async function saveGroup(f: FormData) {
  const { supabase, school } = await requirePerm("students.board_reg.edit");
  const id = uuid(f, "id");
  const stu = uuid(f, "student_id");
  const g = oneOf(f, "subject_group", ["", "A", "B", "C", "F1", "F2", "I"] as const, "");
  const { error } = await supabase.from("board_registrations").update({ subject_group: g || null, exam_type: oneOf(f, "exam_type", ["full", "part"] as const, "full") })
    .eq("id", id!).eq("school_id", school.id);
  revalidatePath(`/app/board/${stu}`);
  go(`/app/board/${stu}`, error ? { error: /locked/i.test(error.message) ? "This registration is locked. Send it back to draft first." : errMsg(error) } : { ok: "Saved." });
}

/** Saves the chosen subjects by their official board codes, in the order of the form's boxes. */
export async function saveBoardSubjects(f: FormData) {
  const { supabase, school, session } = await requirePerm("students.board_reg.edit");
  const stu = uuid(f, "student_id");
  const to = `/app/board/${stu}`;
  if (!session) go(to, { error: "Set a current session first." });
  const { data: reg } = await supabase.from("board_registrations").select("id,class_level,status,subject_group").eq("student_id", stu!).eq("session_id", session!.id).maybeSingle();
  if (!reg) go(to, { error: "Start the registration first." });
  if (!["draft", "correction"].includes(reg!.status)) go(to, { error: "This registration is locked. Send it back to draft first." });
  const level = levelOf(reg!.class_level);
  const slots = level === "hs" ? ["1", "2", "3", "4", "5", "6", "trade"] : ["1", "2", "3", "4", "5", "6"];
  const rows: { school_id: string; student_id: string | null; session_id: string; level: string; slot: string; code: string }[] = [];
  for (const slot of slots) {
    const code = str(f, `slot_${slot}`, 4);
    if (code && /^\d{3}$/.test(code)) rows.push({ school_id: school.id, student_id: stu, session_id: session!.id, level, slot, code });
  }
  // the compulsory 7th subject is added by the form itself
  rows.push({ school_id: school.id, student_id: stu, session_id: session!.id, level, slot: "7", code: level === "hs" ? "944" : "173" });
  const keep = rows.map((r) => r.slot);
  const { error } = await supabase.from("student_board_subjects").upsert(rows, { onConflict: "student_id,session_id,level,slot" });
  if (error) go(to, { error: /foreign key|violates/i.test(error.message) ? "One of the codes is not an official subject code for this exam." : errMsg(error) });
  await supabase.from("student_board_subjects").delete().eq("student_id", stu!).eq("session_id", session!.id).eq("level", level).not("slot", "in", `(${keep.join(",")})`);
  const res = await checkRegistration(supabase, stu!, session!.id, reg!.class_level, reg!.subject_group);
  revalidatePath(to);
  go(to, res.ok ? { ok: "Subjects saved — the combination follows the Board's rules." } : { error: `Saved, but: ${res.errors.slice(0, 3).join(" ")}` });
}

export async function saveFee(f: FormData) {
  const { supabase, school } = await requirePerm("students.board_reg.edit");
  const id = uuid(f, "id");
  const stu = uuid(f, "student_id");
  const total = num(f, "fee_total"), treasury = num(f, "fee_to_treasury");
  const to = `/app/board/${stu}`;
  if (total === null || treasury === null || total < 0 || treasury < 0 || treasury > total) go(to, { error: "Enter the fee and the part that goes to the treasury (not more than the fee)." });
  const { error } = await supabase.from("board_registrations").update({
    fee_total: total, fee_to_treasury: treasury, fee_paid_on: date(f, "fee_paid_on"), challan_no: str(f, "challan_no", 40), challan_date: date(f, "challan_date"),
    exam_year: Math.round(num(f, "exam_year") ?? 0) || null,
  }).eq("id", id!).eq("school_id", school.id);
  revalidatePath(to);
  go(to, error ? { error: errMsg(error) } : { ok: "Saved." });
}

const FLOW = ["draft", "checked", "submitted", "correction", "accepted"] as const;

/** Principal / office moves a registration along its workflow. */
export async function setRegistrationStatus(f: FormData) {
  const { supabase, school, myName } = await requirePerm("students.board_reg.edit", "students.board_reg.approve");
  const id = uuid(f, "id");
  const stu = uuid(f, "student_id");
  const status = oneOf(f, "status", FLOW, "draft");
  const to = stu ? `/app/board/${stu}` : "/app/board";
  const patch: Record<string, unknown> = { status };
  if (status === "checked") {
    patch.checked_by_name = myName || null;
    const { data: r } = await supabase.from("board_registrations").select("student_id,session_id,class_level,subject_group").eq("id", id!).eq("school_id", school.id).maybeSingle();
    if (r) {
      const res = await checkRegistration(supabase, r.student_id, r.session_id, r.class_level, r.subject_group);
      if (!res.ok) go(to, { error: `Subject combination does not follow the Board's rules: ${res.errors.slice(0, 3).join(" ")}` });
    }
  }
  if (status === "submitted") { patch.board_ref = str(f, "board_ref", 60); patch.submitted_on = date(f, "submitted_on"); }
  if (status === "correction") patch.correction_note = str(f, "correction_note", 400);
  if (status === "accepted") patch.board_ref = str(f, "board_ref", 60);
  const { data, error } = await supabase.from("board_registrations").update(patch).eq("id", id!).eq("school_id", school.id).select("id");
  revalidatePath("/app/board");
  go(to, error ? { error: errMsg(error) } : data?.length ? { ok: `Status: ${status}.` } : { error: "Not allowed." });
}

/** Bulk move for a class: check every ready draft, or mark every checked record submitted. */
export async function bulkStatus(f: FormData) {
  const { supabase, school, session } = await requirePerm("students.board_reg.approve");
  const cls = uuid(f, "class_id");
  const kind = oneOf(f, "kind", KINDS, "advance_registration") as RegKind;
  const target = oneOf(f, "target", ["checked", "submitted"] as const, "checked");
  const to = `/app/board?class_id=${cls ?? ""}`;
  if (!session) go(to, { error: "Set a current session first." });
  const from = target === "checked" ? "draft" : "checked";
  const { data: studs } = cls ? await supabase.from("students").select("id").eq("school_id", school.id).eq("class_id", cls).eq("status", "active").limit(3000) : { data: [] };
  const ids = new Set((studs ?? []).map((s) => s.id));
  const { data: regs } = await supabase.from("board_registrations").select("id,student_id").eq("school_id", school.id).eq("session_id", session!.id).eq("kind", kind).eq("status", from).limit(5000);
  const mine = (regs ?? []).filter((r) => ids.has(r.student_id));
  let ok = 0, failed = 0;
  const ref = str(f, "board_ref", 60);
  const detail = new Map<string, { class_level: number; subject_group: string | null }>();
  if (target === "checked") {
    const { data: more } = await supabase.from("board_registrations").select("id,class_level,subject_group").in("id", mine.map((m) => m.id));
    for (const m of more ?? []) detail.set(m.id, m);
  }
  for (const r of mine) {
    if (target === "checked") {
      const d = detail.get(r.id);
      const res = d ? await checkRegistration(supabase, r.student_id, session!.id, d.class_level, d.subject_group) : null;
      if (res && !res.ok) { failed++; continue; }
    }
    const patch: Record<string, unknown> = target === "checked" ? { status: "checked" } : { status: "submitted", ...(ref ? { board_ref: ref } : {}) };
    const { error } = await supabase.from("board_registrations").update(patch).eq("id", r.id);
    if (error) failed++; else ok++;
  }
  revalidatePath("/app/board");
  go(to, { ok: `${ok} record(s) moved to “${target}”.${failed ? ` ${failed} could not be moved (missing details — open them to see what is missing).` : ""}` });
}
