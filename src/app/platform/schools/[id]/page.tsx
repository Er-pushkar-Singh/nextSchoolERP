import { redirect } from "next/navigation";

/** Old URL — the tenant page moved to /platform/tenants/[id]. */
export default async function OldSchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/platform/tenants/${id}`);
}
