import { requireSchool } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Submit } from "@/components/ui/ui";
import { changePassword } from "../_actions/settings";

export default async function Account({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { user, roleNames } = await requireSchool();
  const sp = await searchParams;
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <PageHeader icon="account" title="My account" subtitle={`${user.email} · ${roleNames.join(", ")}`} />
      <Flash ok={sp.ok} error={sp.error} />
      <Card title="Change password">
        <form action={changePassword} className="flex flex-col gap-3">
          <Input label="New password" name="password" type="password" required />
          <Input label="Repeat new password" name="confirm" type="password" required />
          <div><Submit>Change password</Submit></div>
        </form>
      </Card>
    </div>
  );
}
