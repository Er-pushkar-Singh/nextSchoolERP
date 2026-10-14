"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const nums = (f: FormData, k: string) => f.getAll(k).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);

/** Saves a whole class grid. Field names: s_<day>_<periodId> (subject), t_… (teacher), r_… (room). */
export async function saveTimetable(f: FormData) {
  const { supabase, school } = await requirePerm("academics.timetable.edit");
  const section = uuid(f, "section_id");
  const back = `/app/timetable?section=${section}`;
  if (!section) go("/app/timetable", { error: "Choose a section." });
  const cells = new Map<string, { day: number; period: string }>();
  for (const k of f.keys()) {
    const m = /^[str]_([1-7])_([0-9a-f-]{36})$/.exec(k);
    if (m) cells.set(`${m[1]}_${m[2]}`, { day: Number(m[1]), period: m[2] });
  }
  let saved = 0;
  const problems: string[] = [];
  for (const [key, c] of cells) {
    const subject = str(f, `s_${key}`, 40), teacher = str(f, `t_${key}`, 40), room = str(f, `r_${key}`, 30);
    const ok = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    const { error } = await supabase.rpc("set_slot", { sid: school.id, p_section: section, p_day: c.day, p_period: c.period, p_subject: ok(subject), p_staff: ok(teacher), p_room: room });
    if (error) problems.push(error.message.replace(/^.*?:\s*/, "")); else saved++;
  }
  revalidatePath("/app/timetable");
  const uniq = [...new Set(problems)];
  go(back, uniq.length ? { error: `${saved} cells saved. Not saved: ${uniq.slice(0, 3).join(" · ")}${uniq.length > 3 ? ` (+${uniq.length - 3} more)` : ""}` } : { ok: "Timetable saved." });
}

export async function copyDay(f: FormData) {
  const { supabase, school } = await requirePerm("academics.timetable.edit");
  const section = uuid(f, "section_id");
  const from = num(f, "from") ?? 1;
  const to = nums(f, "to");
  if (!section || !to.length) go("/app/timetable", { error: "Choose the days to copy to." });
  const { data, error } = await supabase.rpc("copy_day", { sid: school.id, p_section: section, p_from: from, p_to: to });
  go(`/app/timetable?section=${section}`, error ? { error: errMsg(error) } : { ok: `Copied ${data ?? 0} periods.` });
}

export async function saveSubstitution(f: FormData) {
  const { supabase, school } = await requirePerm("academics.timetable.edit");
  const day = date(f, "date") ?? todayIST();
  const { error } = await supabase.rpc("save_substitution", { sid: school.id, p_slot: uuid(f, "slot_id"), p_date: day, p_staff: uuid(f, "staff_id"), p_reason: str(f, "reason", 200) });
  go(`/app/timetable/cover?date=${day}`, error ? { error: errMsg(error) } : { ok: "Substitute assigned." });
}

export async function removeSubstitution(f: FormData) {
  const { supabase } = await requirePerm("academics.timetable.edit");
  const day = date(f, "date") ?? todayIST();
  const { error } = await supabase.rpc("remove_substitution", { sub: uuid(f, "id") });
  go(`/app/timetable/cover?date=${day}`, error ? { error: errMsg(error) } : { ok: "Substitute removed." });
}

export async function savePeriod(f: FormData) {
  const { supabase, school } = await requirePerm("academics.timetable.edit");
  const id = uuid(f, "id");
  const t = (k: string) => { const v = str(f, k, 5); return v && /^\d{2}:\d{2}$/.test(v) ? v : null; };
  const row = { name: str(f, "name", 30), start_time: t("start_time"), end_time: t("end_time"), is_break: f.get("is_break") === "1" };
  if (!row.name || !row.start_time || !row.end_time) go("/app/timetable/periods", { error: "Name, start and end time are required." });
  if (row.end_time! <= row.start_time!) go("/app/timetable/periods", { error: "End time must be after start time." });
  let error;
  if (id) ({ error } = await supabase.from("periods").update(row).eq("id", id).eq("school_id", school.id));
  else {
    const { data: last } = await supabase.from("periods").select("no").eq("school_id", school.id).order("no", { ascending: false }).limit(1);
    const no = (last?.[0]?.no ?? 0) + 1;
    if (no > 20) go("/app/timetable/periods", { error: "At most 20 periods." });
    ({ error } = await supabase.from("periods").insert({ ...row, school_id: school.id, no }));
  }
  go("/app/timetable/periods", error ? { error: errMsg(error) } : { ok: id ? "Period updated." : "Period added." });
}

export async function deletePeriod(f: FormData) {
  const { supabase, school } = await requirePerm("academics.timetable.edit");
  const { error } = await supabase.from("periods").delete().eq("id", uuid(f, "id")).eq("school_id", school.id);
  go("/app/timetable/periods", error ? { error: errMsg(error) } : { ok: "Period removed with its timetable cells." });
}

export async function saveEvent(f: FormData) {
  const { supabase, school, myName } = await requirePerm("comms.calendar.create", "comms.calendar.edit");
  const id = uuid(f, "id");
  const start = date(f, "start_date");
  const end = date(f, "end_date") ?? start;
  const title = str(f, "title", 120);
  if (!title || !start || !end) go("/app/calendar", { error: "Title and date are required." });
  const row = { title, kind: oneOf(f, "kind", ["holiday", "vacation", "exam", "ptm", "event", "other"] as const, "event"), start_date: start, end_date: end, description: str(f, "description", 500) };
  const { error } = id
    ? await supabase.from("school_events").update(row).eq("id", id).eq("school_id", school.id)
    : await supabase.from("school_events").insert({ ...row, school_id: school.id, created_by_name: myName || null });
  go(`/app/calendar?month=${start!.slice(0, 7)}`, error ? { error: /check/i.test(error.message) ? "The end date must be on or after the start date (at most 120 days)." : errMsg(error) } : { ok: "Saved to the calendar." });
}

export async function deleteEvent(f: FormData) {
  const { supabase, school } = await requirePerm("comms.calendar.delete");
  const { error } = await supabase.from("school_events").delete().eq("id", uuid(f, "id")).eq("school_id", school.id);
  go("/app/calendar", error ? { error: errMsg(error) } : { ok: "Removed from the calendar." });
}
