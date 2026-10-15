"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";

/** Replaces the subject list of one class: fields sub_<subjectId> (checkbox), ppw_<subjectId>, opt_<subjectId>. */
export async function saveCurriculum(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.edit");
  const cls = uuid(f, "class_id");
  if (!cls) go("/app/academics/curriculum", { error: "Choose a class." });
  const rows: Record<string, unknown>[] = [];
  for (const k of f.keys()) {
    const m = /^sub_([0-9a-f-]{36})$/.exec(k);
    if (!m) continue;
    rows.push({ school_id: school.id, class_id: cls, subject_id: m[1], periods_per_week: Math.min(20, Math.max(0, Math.round(Number(f.get(`ppw_${m[1]}`)) || 0))), is_optional: f.get(`opt_${m[1]}`) === "1" });
  }
  const del = await supabase.from("class_subjects").delete().eq("class_id", cls!).eq("school_id", school.id);
  if (del.error) go("/app/academics/curriculum", { error: errMsg(del.error) });
  if (rows.length) {
    const { error } = await supabase.from("class_subjects").insert(rows);
    if (error) go("/app/academics/curriculum", { error: errMsg(error) });
  }
  revalidatePath("/app/academics");
  go("/app/academics/curriculum", { ok: `Subjects of the class saved (${rows.length}).` });
}

export async function saveAllocation(f: FormData) {
  const { supabase, school } = await requirePerm("academics.allocation.edit", "academics.allocation.create");
  const section = uuid(f, "section_id");
  const back = `/app/academics/allocation?section=${section}`;
  if (!section) go("/app/academics/allocation", { error: "Choose a section." });
  const ok = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const r1 = await supabase.rpc("set_class_teacher", { sid: school.id, p_section: section, p_user: ok(str(f, "class_teacher", 40)) });
  if (r1.error) go(back, { error: errMsg(r1.error) });
  const problems: string[] = [];
  for (const k of f.keys()) {
    const m = /^t_([0-9a-f-]{36})$/.exec(k);
    if (!m) continue;
    const { error } = await supabase.rpc("set_subject_teacher", { sid: school.id, p_section: section, p_subject: m[1], p_user: ok(str(f, k, 40)) });
    if (error) problems.push(error.message);
  }
  const cap = num(f, "capacity");
  await supabase.from("sections").update({ capacity: cap && cap > 0 ? Math.min(200, Math.round(cap)) : null, room: str(f, "room", 30) }).eq("id", section).eq("school_id", school.id);
  revalidatePath("/app/academics");
  go(back, problems.length ? { error: problems[0].slice(0, 160) } : { ok: "Allocation saved." });
}

export async function addUnit(f: FormData) {
  const { supabase, school, session } = await requirePerm("academics.syllabus.create");
  const cls = uuid(f, "class_id"), sub = uuid(f, "subject_id");
  const back = `/app/academics/syllabus?class=${cls}&subject=${sub}`;
  const titles = String(f.get("titles") ?? "").split(/\r?\n/).map((t) => t.trim()).filter(Boolean).slice(0, 60);
  if (!cls || !sub || !session) go("/app/academics/syllabus", { error: "Choose a class and subject (and a current session)." });
  if (!titles.length) go(back, { error: "Type at least one chapter / topic." });
  const { data: last } = await supabase.from("syllabus_units").select("no").eq("school_id", school.id).eq("session_id", session!.id).eq("class_id", cls!).eq("subject_id", sub!).order("no", { ascending: false }).limit(1);
  let no = last?.[0]?.no ?? 0;
  const term = str(f, "term", 30);
  const { error } = await supabase.from("syllabus_units").insert(titles.map((title) => ({ school_id: school.id, session_id: session!.id, class_id: cls, subject_id: sub, no: ++no, title: title.slice(0, 160), term })));
  go(back, error ? { error: errMsg(error) } : { ok: `${titles.length} topic${titles.length === 1 ? "" : "s"} added.` });
}

export async function setUnitStatus(f: FormData) {
  const { supabase, school } = await requirePerm("academics.syllabus.edit");
  const id = uuid(f, "id");
  const back = `/app/academics/syllabus?class=${uuid(f, "class_id")}&subject=${uuid(f, "subject_id")}`;
  const { error } = await supabase.from("syllabus_units").update({ status: oneOf(f, "status", ["pending", "in_progress", "done"] as const, "pending"), planned_on: date(f, "planned_on"), note: str(f, "note", 300) })
    .eq("id", id!).eq("school_id", school.id);
  go(back, error ? { error: errMsg(error) } : { ok: "Updated." });
}

export async function verifyUnit(f: FormData) {
  const { supabase } = await requirePerm("academics.syllabus.approve");
  const back = `/app/academics/syllabus?class=${uuid(f, "class_id")}&subject=${uuid(f, "subject_id")}`;
  const { error } = await supabase.rpc("verify_syllabus_unit", { uid2: uuid(f, "id"), p_ok: f.get("ok") !== "0" });
  go(back, error ? { error: errMsg(error) } : { ok: "Verified." });
}

export async function deleteUnit(f: FormData) {
  const { supabase, school } = await requirePerm("academics.syllabus.delete");
  const back = `/app/academics/syllabus?class=${uuid(f, "class_id")}&subject=${uuid(f, "subject_id")}`;
  const { error } = await supabase.from("syllabus_units").delete().eq("id", uuid(f, "id")!).eq("school_id", school.id);
  go(back, error ? { error: errMsg(error) } : { ok: "Topic removed." });
}

export async function copySyllabus(f: FormData) {
  const { supabase, school } = await requirePerm("academics.syllabus.create");
  const { data, error } = await supabase.rpc("copy_syllabus", { sid: school.id, from_session: uuid(f, "from"), to_session: uuid(f, "to") });
  go("/app/academics/syllabus", error ? { error: errMsg(error) } : { ok: `Copied ${data ?? 0} topics to the new session.` });
}

/** Adds one subject to one class: picks an existing subject or creates a new one by name, then maps it with periods a week. */
export async function addSubjectToClass(f: FormData) {
  const { supabase, school } = await requirePerm("academics.setup.edit", "academics.setup.create");
  const cls = uuid(f, "class_id");
  const back = "/app/academics/curriculum";
  if (!cls) go(back, { error: "Choose a class." });
  let subject = uuid(f, "subject_id");
  const name = str(f, "new_name", 60);
  if (!subject && name) {
    const { data: ex } = await supabase.from("subjects").select("id").eq("school_id", school.id).ilike("name", name).maybeSingle();
    if (ex) subject = ex.id;
    else {
      const { data: made, error } = await supabase.from("subjects").insert({ school_id: school.id, name }).select("id").single();
      if (error) go(back, { error: errMsg(error) });
      subject = made!.id;
    }
  }
  if (!subject) go(back, { error: "Choose a subject or type a new subject name." });
  const { error } = await supabase.from("class_subjects").upsert(
    { school_id: school.id, class_id: cls, subject_id: subject, periods_per_week: Math.min(20, Math.max(0, Math.round(num(f, "periods") ?? 5))), is_optional: f.get("optional") === "1" },
    { onConflict: "class_id,subject_id" });
  revalidatePath("/app/academics");
  go(back, error ? { error: errMsg(error) } : { ok: "Subject added to the class." });
}
