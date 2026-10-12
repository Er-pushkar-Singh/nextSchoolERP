"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/school";
import { date, errMsg, go, oneOf, str, uuid } from "@/lib/action-util";
import { todayIST } from "@/lib/format";

const KINDS = ["homework", "material"] as const;

export async function saveHomework(f: FormData) {
  const kind = oneOf(f, "kind", KINDS, "homework");
  const id = uuid(f, "id");
  const { supabase, school, session, myName, can } = await requirePerm(`homework.${kind}.${id ? "edit" : "create"}`);
  const back = `/app/homework?kind=${kind}`;
  const class_id = uuid(f, "class_id");
  const title = str(f, "title", 200);
  const link = str(f, "link_url", 500);
  if (!class_id || !title) go(back, { error: "Class and title are required." });
  if (link && !/^https?:\/\//i.test(link)) go(back, { error: "The link must start with http:// or https://" });
  const assigned_on = date(f, "assigned_on") ?? todayIST();
  const due_on = kind === "homework" ? date(f, "due_on") : null;
  if (due_on && due_on < assigned_on) go(back, { error: "The due date can't be before the date it was given." });
  const row = {
    class_id, section_id: uuid(f, "section_id"), subject_id: uuid(f, "subject_id"), title,
    details: str(f, "details", 4000), link_url: link, assigned_on, due_on,
  };
  const { data, error } = id
    ? await supabase.from("homework").update(row).eq("id", id).eq("school_id", school.id).select("id")
    : await supabase.from("homework").insert({ ...row, school_id: school.id, kind, session_id: session?.id ?? null, created_by_name: myName || null }).select("id");
  revalidatePath("/app/homework");
  if (!error && !data?.length) go(back, { error: "You can't change this one." });
  if (error) {
    const scoped = !can(`homework.${kind}.delete`) || !row.section_id;
    go(back, { error: /row-level security/i.test(error.message) && scoped
      ? "You can only post for the sections and subjects assigned to you (pick a section, not “All sections”)."
      : errMsg(error) });
  }
  go(back, { ok: id ? "Saved." : kind === "homework" ? "Homework posted — parents see it on their page." : "Study material shared." });
}

export async function deleteHomework(f: FormData) {
  const kind = oneOf(f, "kind", KINDS, "homework");
  const { supabase, school } = await requirePerm(`homework.${kind}.delete`);
  const { error, count } = await supabase.from("homework").delete({ count: "exact" }).eq("id", uuid(f, "id")!).eq("school_id", school.id);
  revalidatePath("/app/homework");
  go(`/app/homework?kind=${kind}`, error ? { error: errMsg(error) } : count ? { ok: "Deleted." } : { error: "You can't delete this one." });
}
