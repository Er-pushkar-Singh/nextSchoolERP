import { readPasswordOnce } from "@/lib/logins";
import { CopyButton } from "@/components/CopyButton";
import { appUrl } from "@/lib/brand";

/** Shows a just-created temporary password once (read from a 2-minute httpOnly cookie). */
export async function NewPassword() {
  const p = await readPasswordOnce();
  if (!p) return null;
  return (
    <div role="note" className="mb-5 rounded-[12px] border-2 border-wa bg-wa-tint p-4 text-[14px] text-[#0b4f2c]">
      <b>New sign-in details — shown once, share privately:</b>
      <p className="my-2 font-mono">{appUrl("/login")}<br />Email: {p.email}<br />Temporary password: <span data-testid="temp-pw">{p.pw}</span></p>
      <CopyButton text={`${appUrl("/login")}\nEmail: ${p.email}\nPassword: ${p.pw}\n(Please change it under your name → My account.)`} label="Copy message" />
    </div>
  );
}
