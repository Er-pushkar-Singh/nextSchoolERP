import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge, Card } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Submit } from "@/components/ui/ui";
import { appUrl } from "@/lib/brand";
import { resetFamilyLogin } from "@/app/app/_actions/family";

/** Parent app login of one student: who can sign in, create the login (printable sheet) or reset the password. */
export async function FamilyLoginCard({ supabase, studentId, schoolCode, admissionNo, studentUserId, canCreate, canReset }: {
  supabase: SupabaseClient; studentId: string; schoolCode: string; admissionNo: string; studentUserId: string | null; canCreate: boolean; canReset: boolean;
}) {
  const { data } = await supabase.from("student_guardians").select("is_primary,guardians(name,phone,email,user_id)").eq("student_id", studentId);
  const gs = ((data ?? []) as unknown as { is_primary: boolean; guardians: { name: string; phone: string | null; email: string | null; user_id: string | null } | null }[])
    .map((x) => x.guardians).filter(Boolean) as { name: string; phone: string | null; email: string | null; user_id: string | null }[];
  const parent = gs.find((g) => g.user_id) ?? null;
  const parentId = parent?.email || parent?.phone?.replace(/\D/g, "").slice(-10) || "";
  return (
    <Card title="Parent & student app login" description={`Parents sign in at ${appUrl("/login")} with their mobile number and see fees, attendance, results, homework, leave and messages for all their children.`}>
      <div className="flex flex-col gap-3 text-[14px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Parent: {parent ? <><b className="text-ink">{parent.name}</b> <span className="text-muted">· login {parentId}</span> <Badge value="paid" text="Has login" /></> : <><span className="text-muted">no login yet</span> <Badge value="draft" text="No login" /></>}</span>
          <span className="flex items-center gap-3">
            {!parent && canCreate && (
              <form action="/app/students/family-logins" method="post" target="_blank"><input type="hidden" name="student_id" value={studentId} />
                <button className="btn btn-sm btn-primary cursor-pointer">Create login</button></form>
            )}
            {parent && canReset && (
              <Modal label="Reset password" variant="link" size="sm" title="Reset the parent's password">
                <form action={resetFamilyLogin} className="flex flex-col gap-3"><input type="hidden" name="student_id" value={studentId} /><input type="hidden" name="kind" value="parent" />
                  <p className="m-0 text-[14px]">A new temporary password is made for <b>{parent.name}</b>. It works for all their children and is shown <b>only once</b> on the next screen.</p>
                  <div><Submit>Reset password</Submit></div></form>
              </Modal>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Student: {studentUserId ? <><span className="text-muted">login</span> <code>{schoolCode}/{admissionNo}</code> <Badge value="paid" text="Has login" /></> : <span className="text-muted">no own login (optional, for older classes)</span>}</span>
          <span className="flex items-center gap-3">
            {!studentUserId && canCreate && (
              <form action="/app/students/family-logins" method="post" target="_blank"><input type="hidden" name="student_id" value={studentId} /><input type="hidden" name="include_students" value="on" />
                <button className="btn btn-sm btn-secondary cursor-pointer">Create student login</button></form>
            )}
            {studentUserId && canReset && (
              <Modal label="Reset password" variant="link" size="sm" title="Reset the student's password">
                <form action={resetFamilyLogin} className="flex flex-col gap-3"><input type="hidden" name="student_id" value={studentId} /><input type="hidden" name="kind" value="student" />
                  <p className="m-0 text-[14px]">A new temporary password is made for the student&apos;s own login, shown <b>only once</b> on the next screen.</p>
                  <div><Submit>Reset password</Submit></div></form>
              </Modal>
            )}
          </span>
        </div>
      </div>
    </Card>
  );
}
