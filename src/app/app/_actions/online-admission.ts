"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, str } from "@/lib/action-util";

export async function saveOnlineSettings(f: FormData) {
  const { supabase, school } = await requirePerm("frontdesk.online_form.edit");
  const to = "/app/admissions/online";
  const class_ids = f.getAll("class_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const closes = date(f, "closes_on");
  const { error } = await supabase.from("online_admission_settings").upsert({
    school_id: school.id, enabled: f.get("enabled") === "1", class_ids, intro: str(f, "intro", 600), instructions: str(f, "instructions", 1500),
    fee_note: str(f, "fee_note", 400), closes_on: closes, ask_documents: f.get("ask_documents") === "1",
  }, { onConflict: "school_id" });
  revalidatePath(to);
  go(to, error ? { error: errMsg(error) } : { ok: f.get("enabled") === "1" ? "Online admission is OPEN. Share the link with parents." : "Saved. The online form is switched off." });
}
