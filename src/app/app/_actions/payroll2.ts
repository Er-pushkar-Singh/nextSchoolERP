"use server";

import { requirePerm } from "@/lib/school";
import { date, errMsg, go, num, str, uuid } from "@/lib/action-util";

export async function savePayrollSettings(f: FormData) {
  const { supabase, school } = await requirePerm("hr.payroll.edit");
  const n = (k: string, d: number, min = 0, max = 1_000_000) => Math.min(max, Math.max(min, num(f, k) ?? d));
  const slabs: { upto: number | null; amount: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const upto = num(f, `slab_upto_${i}`), amount = num(f, `slab_amount_${i}`);
    if (amount !== null && (upto !== null || i > 0)) slabs.push({ upto: upto !== null && upto > 0 ? upto : null, amount: Math.max(0, amount) });
  }
  const sorted = slabs.filter((s) => s.upto !== null).sort((a, b) => a.upto! - b.upto!);
  const open = slabs.find((s) => s.upto === null);
  const pt_slabs = [...sorted, open ?? { upto: null, amount: sorted.length ? sorted[sorted.length - 1].amount : 0 }];
  const { error } = await supabase.from("payroll_settings").upsert({
    school_id: school.id, use_attendance: f.get("use_attendance") === "1", pf_on: f.get("pf_on") === "1", pf_rate: n("pf_rate", 12, 0, 30), pf_ceiling: n("pf_ceiling", 15000),
    esi_on: f.get("esi_on") === "1", esi_rate: n("esi_rate", 0.75, 0, 10), esi_employer_rate: n("esi_employer_rate", 3.25, 0, 10), esi_ceiling: n("esi_ceiling", 21000),
    pt_on: f.get("pt_on") === "1", pt_slabs,
  });
  go("/app/hr/payroll", error ? { error: errMsg(error) } : { ok: "Payroll settings saved. They apply the next time you calculate a draft month." });
}

export async function addAdvance(f: FormData) {
  const { supabase, school } = await requirePerm("hr.payroll.create");
  const { error } = await supabase.rpc("add_advance", { sid: school.id, p_staff: uuid(f, "staff_id"), p_amount: num(f, "amount"), p_emi: num(f, "monthly_emi"), p_on: date(f, "taken_on"), p_reason: str(f, "reason", 200) });
  go("/app/hr/advances", error ? { error: errMsg(error) } : { ok: "Advance recorded. The monthly instalment is deducted from the next payrolls." });
}

export async function cancelAdvance(f: FormData) {
  const { supabase } = await requirePerm("hr.payroll.edit");
  const { error } = await supabase.rpc("cancel_advance", { aid: uuid(f, "id") });
  go("/app/hr/advances", error ? { error: errMsg(error) } : { ok: "Advance cancelled." });
}
