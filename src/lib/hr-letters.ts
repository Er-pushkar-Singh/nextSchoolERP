import type { SupabaseClient } from "@supabase/supabase-js";
import { compileDesign, HR_LETTERS, normalizeDesign, pageOf } from "./design";
import { sanitizeHtml } from "./html-sanitize";

/** Letter order on the staff page: what a new joiner needs first. */
export const HR_LETTER_ORDER = HR_LETTERS.map((p) => p.key);

const PREFIX: Record<string, string> = {
  offer_letter: "OFR", appointment_letter: "APT", confirmation_letter: "CNF", increment_letter: "INC", salary_certificate: "SAL",
  experience_letter: "EXP", relieving_letter: "REL", staff_noc: "NOC", warning_letter: "WRN",
};

/** Installs the standard HR letters the school does not have yet. Returns how many were added. */
export async function ensureHrLetters(supabase: SupabaseClient, schoolId: string): Promise<{ added: number; error?: string }> {
  const { data: have, error: e0 } = await supabase.from("document_templates").select("preset,code").eq("school_id", schoolId).eq("audience", "staff");
  if (e0) return { added: 0, error: e0.message };
  const presets = new Set((have ?? []).map((t) => t.preset).filter(Boolean));
  const codes = new Set((have ?? []).map((t) => t.code));
  const rows = HR_LETTERS.filter((p) => !presets.has(p.key)).map((p) => {
    const design = normalizeDesign(p.build());
    let code = p.key.slice(0, 40);
    for (let i = 2; codes.has(code); i++) code = `${p.key.slice(0, 36)}_${i}`;
    codes.add(code);
    return {
      school_id: schoolId, code, name: p.name, category: p.category, audience: p.audience, body_html: sanitizeHtml(compileDesign(design)), design, ...pageOf(design),
      numbering_prefix: PREFIX[p.key] ?? "HR", fields: p.fields ?? [], module: p.module, preset: p.key, one_per_student: false,
    };
  });
  if (!rows.length) return { added: 0 };
  const { error } = await supabase.from("document_templates").insert(rows);
  return error ? { added: 0, error: error.message } : { added: rows.length };
}
