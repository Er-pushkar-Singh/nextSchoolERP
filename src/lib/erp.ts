import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ClassRow = { id: string; name: string; sort: number; seats?: number | null; min_age_years?: number | null; max_age_years?: number | null; sections: { id: string; name: string }[] };

/** Classes with their sections, in school order. */
export async function getClasses(supabase: SupabaseClient, schoolId: string) {
  const { data } = await supabase.from("classes").select("id,name,sort,seats,min_age_years,max_age_years,sections(id,name)").eq("school_id", schoolId).order("sort");
  return ((data ?? []) as ClassRow[]).map((c) => ({ ...c, sections: [...c.sections].sort((a, b) => a.name.localeCompare(b.name)) }));
}

export const classOptions = (classes: ClassRow[]) => classes.map((c) => [c.id, `Class ${c.name}`] as [string, string]);
export const sectionOptions = (classes: ClassRow[]) =>
  classes.flatMap((c) => c.sections.map((s) => [s.id, `${c.name}-${s.name}`] as [string, string]));

export type Due = { id: string; label: string; due_date: string; amount: number; concession: number; fine: number; paid: number; status: string };
export const balance = (d: Pick<Due, "amount" | "concession" | "fine" | "paid">) =>
  Math.max(0, Number(d.amount) - Number(d.concession) + Number(d.fine) - Number(d.paid));

/** Allocate a payment across dues, oldest due date first. */
export function allocate(dues: Due[], amount: number) {
  let left = Math.round(amount * 100) / 100;
  const lines: { due_id: string; amount: number }[] = [];
  for (const d of [...dues].sort((a, b) => a.due_date.localeCompare(b.due_date))) {
    if (left <= 0) break;
    const bal = balance(d);
    if (bal <= 0) continue;
    const take = Math.min(bal, left);
    lines.push({ due_id: d.id, amount: Math.round(take * 100) / 100 });
    left = Math.round((left - take) * 100) / 100;
  }
  return { lines, unallocated: left };
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function gradeFor(percent: number, scale: { min: number; grade: string }[]) {
  return [...scale].sort((a, b) => b.min - a.min).find((g) => percent >= g.min)?.grade ?? "—";
}
