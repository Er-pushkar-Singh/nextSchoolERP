import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkHs, checkInter, levelOf, type Check, type Group } from "./board-rules";

/** Loads the student's chosen board subjects and runs the UPMSP combination rules for the registration's level. */
export async function checkRegistration(supabase: SupabaseClient, studentId: string, sessionId: string, classLevel: number, group: string | null): Promise<Check & { codes: string[] }> {
  const level = levelOf(classLevel);
  const [{ data: subs }, { data: stu }] = await Promise.all([
    supabase.from("student_board_subjects").select("slot,code").eq("student_id", studentId).eq("session_id", sessionId).eq("level", level),
    supabase.from("students").select("gender").eq("id", studentId).maybeSingle(),
  ]);
  const rows = (subs ?? []) as { slot: string; code: string }[];
  if (level === "hs") {
    const sel = Object.fromEntries(rows.map((r) => [r.slot, r.code]));
    return { ...checkHs(sel, { gender: stu?.gender ?? null, vocationalAllowed: true }), codes: rows.map((r) => r.code) };
  }
  const codes = rows.filter((r) => r.slot !== "7").sort((a, b) => Number(a.slot) - Number(b.slot)).map((r) => r.code);
  return { ...checkInter(group as Group | null, codes), codes };
}
