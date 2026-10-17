import { NextResponse, type NextRequest } from "next/server";
import { requirePerm } from "@/lib/school";
import { FAMILY_STUDENT_SELECT, familyRoleIds, provisionFamily, type Provisioned } from "@/lib/family-admin";
import { appUrl } from "@/lib/brand";

export const dynamic = "force-dynamic";

const esc = (t: string | null | undefined) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MAX = 120;

/**
 * Creates parent (and optionally student) logins for a class / section and answers with a printable sheet of the sign-in details.
 * The passwords are only on this page — they are not stored anywhere readable.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return new NextResponse("Bad origin", { status: 403 });
  const { supabase, school, can } = await requirePerm("settings.users.create");
  if (!can("students.profile.edit") && !can("students.parent_link.edit")) return new NextResponse("Not allowed", { status: 403 });
  const f = await req.formData();
  const uuid = (k: string) => { const v = String(f.get(k) ?? ""); return /^[0-9a-f-]{36}$/.test(v) ? v : null; };
  const section = uuid("section_id"), cls = uuid("class_id"), one = uuid("student_id");
  const withStudents = f.get("include_students") === "on";
  if (!section && !cls && !one) return new NextResponse("Choose a class, a section or a student.", { status: 400 });

  let q = supabase.from("students").select(FAMILY_STUDENT_SELECT).eq("school_id", school.id).eq("status", "active");
  if (one) q = q.eq("id", one);
  else if (section) q = q.eq("section_id", section);
  else if (cls) q = q.eq("class_id", cls);
  const { data, error } = await q.order("roll_no", { nullsFirst: false }).order("first_name").limit(MAX + 1);
  if (error) return new NextResponse(esc(error.message), { status: 400 });
  const students = ((data ?? []) as unknown as Parameters<typeof provisionFamily>[2][]).slice(0, MAX);
  const more = (data ?? []).length > MAX;

  const roles = await familyRoleIds(supabase, school.id);
  const rows: Provisioned[] = [];
  for (const s of students) rows.push(...(await provisionFamily(supabase, { id: school.id, code: school.code }, s, roles, { student: withStudents })));
  const created = rows.filter((r) => r.pw).length;
  const details = { created, students: students.length };
  await supabase.rpc("log_event", { p_action: "family.logins_created", p_school: school.id, p_entity: "students", p_entity_id: one, p_details: details });

  const login = appUrl("/login");
  const wa = (r: Provisioned) => {
    if (!r.pw || !r.mobile) return "";
    const text = `Dear ${r.who}, you can now see ${r.student}'s fees, attendance, results and homework on ${school.name}'s parent app.\nOpen: ${login}\nLogin: ${r.loginId}\nPassword: ${r.pw}\nPlease change the password after you sign in.`;
    return `<a href="https://wa.me/91${esc(r.mobile)}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a>`;
  };
  const body = rows.map((r) => `<tr class="${r.error ? "bad" : ""}"><td>${esc(r.student)}<div class="m">${esc(r.cls)} · Adm. ${esc(r.adm)}</div></td><td>${esc(r.who)}</td><td class="mono">${esc(r.loginId)}</td>`
    + `<td class="mono">${r.pw ? esc(r.pw) : `<span class="m">${esc(r.error ?? r.note ?? "")}</span>`}</td><td class="np">${wa(r)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Parent logins — ${esc(school.name)}</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#0b1b33}h1{font-size:20px;margin:0 0 4px}.m{color:#52607a;font-size:12px}.mono{font-family:ui-monospace,monospace}
table{border-collapse:collapse;width:100%;margin-top:14px}th,td{border:1px solid #cfd6e4;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f2f6ff}tr.bad td{background:#fdecea}
.box{border:2px solid #25a35a;background:#e9f8ef;padding:10px 12px;border-radius:10px;margin-top:10px}button{padding:8px 14px;border-radius:8px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer}
@media print{.np{display:none}button{display:none}.box{border-color:#999;background:#fff}}</style></head><body>
<h1>${esc(school.name)} — parent &amp; student sign-in details</h1>
<p class="m">${created} new login(s) for ${students.length} student(s). Sign in at <b>${esc(login)}</b> with the mobile number (or Student ID) and the password below. Keep this sheet private: <b>the passwords are shown only now</b>. Give each family its own slip.</p>
${more ? `<p class="box">More than ${MAX} students matched — only the first ${MAX} were done. Run it again for the rest.</p>` : ""}
<button onclick="print()">Print</button>
<table><thead><tr><th>Student</th><th>Parent</th><th>Login</th><th>Password</th><th class="np"></th></tr></thead><tbody>${body}</tbody></table>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex" } });
}
