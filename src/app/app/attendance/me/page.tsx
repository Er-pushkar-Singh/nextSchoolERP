import { requireSchool } from "@/lib/school";
import { Card, Empty, PageHeader } from "@/components/ui/ui";
import { CheckIn } from "@/components/attendance/CheckIn";
import { fmtDate, todayIST, addDays } from "@/lib/format";

const WORD: Record<string, string> = { P: "Present", A: "Absent", L: "Late", H: "Half day", LV: "Leave", OD: "On duty" };

export default async function MyAttendance() {
  const { supabase, school, user } = await requireSchool();
  const { data: me } = await supabase.from("staff").select("id,name").eq("school_id", school.id).eq("user_id", user.id).eq("status", "active").maybeSingle();
  const today = todayIST();
  const { data: rows } = me
    ? await supabase.from("staff_attendance").select("date,status,in_time,out_time,source").eq("staff_id", me.id).gte("date", addDays(today, -30)).order("date", { ascending: false })
    : { data: [] };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="attendance" title="My attendance" subtitle={me ? me.name : "Staff check-in"} back={{ href: "/app/attendance", label: "Attendance" }} />
      {!me ? <Empty>Your login is not linked to a staff record yet. Ask the office to link it in HR → Staff.</Empty> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Check in"><CheckIn /></Card>
          <Card title="Last 30 days">
            {(rows ?? []).length ? (
              <ul className="m-0 list-none divide-y divide-line p-0 text-[14px]">
                {(rows ?? []).map((r) => (
                  <li key={r.date} className="flex items-center justify-between gap-2 py-2">
                    <span>{fmtDate(r.date)}</span>
                    <span className="text-muted">{r.in_time ? String(r.in_time).slice(0, 5) : "—"}{r.out_time ? ` – ${String(r.out_time).slice(0, 5)}` : ""}</span>
                    <b className={r.status === "A" ? "text-error" : "text-ink"}>{WORD[r.status] ?? r.status}</b>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-[14px] text-muted">No attendance recorded yet.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
