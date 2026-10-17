import Link from "next/link";
import { Card, Flash, Input, Submit } from "@/components/ui/ui";
import { getFamily } from "@/lib/family";
import { familyChangePassword } from "../actions";

export const metadata = { title: "My account" };

export default async function FamilyAccount({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { user, children } = await getFamily();
  const sp = await searchParams;
  const shown = user.email?.endsWith("@family.erp.local") ? `${user.email.replace("@family.erp.local", "")} (mobile)` : user.email?.endsWith("@student.erp.local") ? "Student ID login" : user.email;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <Link href={children[0] ? `/family/${children[0].student_id}` : "/family"} className="text-[14px]">← Back</Link>
      <h1 className="m-0 text-[22px] font-extrabold text-ink">My account</h1>
      <p className="m-0 text-[14px] text-muted">Signed in as <b className="text-ink">{shown}</b></p>
      <Flash ok={sp.ok} error={sp.error} />
      <Card title="Change password" description="Choose a password only you know — the school gave you a temporary one.">
        <form action={familyChangePassword} className="flex flex-col gap-3">
          <Input label="New password" name="password" type="password" required />
          <Input label="Repeat new password" name="confirm" type="password" required />
          <div><Submit>Change password</Submit></div>
        </form>
      </Card>
    </main>
  );
}
