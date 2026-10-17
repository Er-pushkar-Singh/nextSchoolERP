import { ParentView } from "@/components/family/ParentView";
import { requireChild } from "@/lib/family";

export default async function ChildHome({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<{ paid?: string; pay_error?: string }> }) {
  const { studentId } = await params;
  const { token } = await requireChild(studentId);
  return <ParentView token={token} sp={await searchParams} ret={`/family/${studentId}`} />;
}
