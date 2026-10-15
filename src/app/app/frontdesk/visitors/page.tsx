import { redirect } from "next/navigation";

/** The visitor register lives on the front desk page now (table, filters, add / edit / delete in one place). */
export default async function VisitorsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  redirect(`/app/frontdesk${q ? "?" + q : ""}`);
}
