import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { CopyButton } from "@/components/CopyButton";
import { Input, Submit } from "@/components/ui/ui";
import { appUrl } from "@/lib/brand";
import { todayIST } from "@/lib/format";
import { createStaffLogin, resetStaffPassword } from "@/app/app/_actions/staff-login";
import { blockStaff, unblockStaff } from "@/app/app/_actions/people";
import { setStaffStatus } from "@/app/app/_actions/hr";

export type StaffLite = { id: string; name: string; email: string | null; user_id: string | null; status: string; blocked: boolean };
export type RoleLite = { id: string; name: string };
export type StaffCan = { edit: boolean; block: boolean; loginCreate: boolean; loginEdit: boolean; letters: boolean };

const Back = ({ to }: { to: string }) => <input type="hidden" name="back" value={to} />;

/** Sign-in details shown once after a login is created or a password reset. */
export function CredentialsBanner({ cred, school }: { cred: { email: string; pw: string } | null; school: string }) {
  if (!cred) return null;
  const msg = `Sign in to ${school}: ${appUrl("/login")}\nEmail: ${cred.email}\nPassword: ${cred.pw}\n(Please change it after signing in: your name → My account.)`;
  return (
    <div role="status" className="rounded-[12px] border-2 border-wa bg-wa-tint p-4 text-[14px] text-[#0b4f2c]">
      <b>Share these sign-in details privately — shown only once:</b>
      <p className="my-2 font-mono">{appUrl("/login")}<br />Login: {cred.email}<br />Temporary password: {cred.pw}</p>
      <CopyButton text={msg} label="Copy message" />
    </div>
  );
}

/** Everything that can be done to one staff member, as small buttons (list rows and the profile header). */
export function StaffActions({ s, back, roles, can, profile = false, sections = [] }: { s: StaffLite; back: string; roles: RoleLite[]; can: StaffCan; profile?: boolean; sections?: [string, string][] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      {!profile && <Link href={`/app/hr/staff/${s.id}`}>Open</Link>}
      {can.letters && <Link href={`/app/hr/staff/${s.id}#letters`}>Letters</Link>}

      {!s.user_id && can.loginCreate && (
        <Modal label="Create login" variant="link" size="md" title={`Create ERP login — ${s.name}`}>
          <form action={createStaffLogin} className="flex flex-col gap-3">
            <input type="hidden" name="staff_id" value={s.id} /><Back to={back} />
            <p className="m-0 text-[14px] text-muted">A sign-in is created with a temporary password, shown once on the next screen. The roles decide what this person can open.</p>
            <Input label="Email (sign-in name)" name="email" type="email" required defaultValue={s.email} />
            <fieldset className="m-0 border-0 p-0"><legend className="mb-1 text-[13px] font-semibold text-ink">Roles</legend>
              <div className="grid gap-1 sm:grid-cols-2">{roles.map((r) => <label key={r.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="role_ids" value={r.id} /> {r.name}</label>)}</div>
            </fieldset>
            {sections.length > 0 && (
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Class teacher of (optional)
                <select name="class_section_id" className="input !min-h-10 !py-2 text-[15px] font-normal"><option value="">— none —</option>{sections.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
                <span className="text-[12px] font-normal text-muted">A teacher sees only the students of the classes assigned to them.</span>
              </label>
            )}
            <div><Submit>Create login</Submit></div>
          </form>
        </Modal>
      )}
      {s.user_id && can.loginEdit && (
        <Modal label="Reset password" variant="link" size="sm" title={`Reset password — ${s.name}`}>
          <form action={resetStaffPassword} className="flex flex-col gap-3">
            <input type="hidden" name="staff_id" value={s.id} /><Back to={back} />
            <p className="m-0 text-[14px]">A new temporary password is generated for <b>{s.email ?? s.name}</b>. The old password stops working at once and the new one is shown <b>only once</b> on the next screen — copy it and hand it over privately.</p>
            <div><Submit>Reset password</Submit></div>
          </form>
        </Modal>
      )}

      {can.block && (s.blocked ? (
        <form action={unblockStaff}><input type="hidden" name="id" value={s.id} /><Back to={back} />
          <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Unblock</button></form>
      ) : (
        <Modal label="Block" variant="link" size="sm" title={`Block ${s.name}`}>
          <form action={blockStaff} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={s.id} /><Back to={back} />
            <p className="m-0 text-[14px] text-muted">{s.user_id ? "Their ERP login is switched off immediately. Payroll and records stay." : "Marks the record as blocked."}</p>
            <Input label="Reason" name="reason" required />
            <Input label="Blocked until (optional)" name="till" type="date" />
            <div><Submit variant="secondary">Block</Submit></div>
          </form>
        </Modal>
      ))}

      {can.edit && (s.status === "active" ? (
        <Modal label="Mark left" variant="link" size="sm" title={`${s.name} has left`}>
          <form action={setStaffStatus} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value="left" /><Back to={back} />
            <Input label="Last working day" name="leaving_date" type="date" defaultValue={todayIST()} />
            <p className="m-0 text-[13px] text-muted">They are paid up to this date in that month&apos;s payroll. The relieving and experience letters become available.</p>
            <div><Submit variant="secondary">Mark as left</Submit></div>
          </form>
        </Modal>
      ) : (
        <form action={setStaffStatus}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="status" value="active" /><Back to={back} />
          <button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-blue underline">Rejoin</button></form>
      ))}
    </div>
  );
}
