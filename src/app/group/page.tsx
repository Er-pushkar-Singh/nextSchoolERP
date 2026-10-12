import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/school";
import { Card, Empty, PageHeader, Stat, Table, td } from "@/components/ui/ui";
import { Logo } from "@/components/ui/Logo";
import { money } from "@/lib/format";
import { signOut, switchSchool } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Group overview" };

type Row = { group_id: string; group_name: string; school_id: string; school_name: string; students: number; collected_month: number; overdue: number; attendance_today: number | null };

/** For trust / chain owners: every branch on one screen. */
export default async function Group() {
  const { supabase, groups, user } = await getMe();
  if (!groups.length) redirect("/app");
  const { data } = await supabase.rpc("group_overview");
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.group_id))];
  return (
    <div className="page-bg min-h-screen"><header className="sb"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4"><Logo name="Group overview" sub="All branches" href="/group" dark /><form action={signOut}><button className="cursor-pointer rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-white/20">Sign out · {user.email}</button></form></div></header>
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
      {ids.length ? ids.map((gid) => {
        const br = rows.filter((r) => r.group_id === gid);
        return (
          <div key={gid} className="flex flex-col gap-4">
            <PageHeader icon="groups" title={br[0].group_name} subtitle={`${br.length} branches`} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat icon="students" tone="blue" label="Active students" value={br.reduce((s, r) => s + Number(r.students), 0).toLocaleString("en-IN")} />
              <Stat icon="fees" tone="green" label="Fees collected this month" value={money(br.reduce((s, r) => s + Number(r.collected_month), 0))} />
              <Stat icon="revenue" tone="rose" label="Overdue fees" value={money(br.reduce((s, r) => s + Number(r.overdue), 0))} />
              <Stat icon="attendance" tone="cyan" label="Branches marked attendance today" value={`${br.filter((r) => r.attendance_today !== null).length} / ${br.length}`} />
            </div>
            <Card title="Branches">
              <Table head={["Branch", "Students", "Collected this month", "Overdue", "Attendance today", ""]} minWidth={760}>
                {br.map((r) => (
                  <tr key={r.school_id}>
                    <td className={`${td} font-semibold text-ink`}>{r.school_name}</td>
                    <td className={td}>{r.students}</td>
                    <td className={td}>{money(r.collected_month)}</td>
                    <td className={`${td} ${Number(r.overdue) > 0 ? "text-error" : ""}`}>{money(r.overdue)}</td>
                    <td className={td}>{r.attendance_today === null ? "not marked" : `${r.attendance_today}%`}</td>
                    <td className={td}><form action={switchSchool}><input type="hidden" name="school_id" value={r.school_id} /><button className="cursor-pointer rounded-md border border-line bg-white px-2 py-1 text-[13px]">Open</button></form></td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        );
      }) : <Empty>No branches linked to your group yet.</Empty>}
    </div></div>
  );
}
