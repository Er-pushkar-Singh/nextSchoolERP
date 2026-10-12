import Link from "next/link";
import { requireSchool } from "@/lib/school";
import { Card, Flash, PageHeader, Stat, Badge } from "@/components/ui/ui";
import { fmtDate, hourIST, money, todayIST } from "@/lib/format";
import { pct } from "@/lib/erp";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string; welcome?: string }> }) {
  const { supabase, school, session, can, canAny, myName } = await requireSchool();
  const { denied, welcome } = await searchParams;
  const today = todayIST();
  const fees = canAny("fees.collection.view", "fees.receipts.view");
  const sid = school.id;

  const [students, att, counts, fs, receipts, enq, notices] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", sid).eq("status", "active"),
    supabase.rpc("attendance_summary", { sid, on_day: today }),
    supabase.rpc("class_counts", { sid }),
    fees && session ? supabase.rpc("fee_summary", { sid, sess: session.id, on_day: today }) : Promise.resolve({ data: null }),
    fees ? supabase.from("fee_receipts").select("id,receipt_no,amount,mode,paid_on,cancelled,students(first_name,last_name,admission_no)").eq("school_id", sid).order("created_at", { ascending: false }).limit(8) : Promise.resolve({ data: [] }),
    can("frontdesk.enquiries.view") ? supabase.from("enquiries").select("id,student_name,class_sought,status,follow_up_date").eq("school_id", sid).in("status", ["new", "contacted", "visited", "test"]).lte("follow_up_date", today).order("follow_up_date").limit(8) : Promise.resolve({ data: [] }),
    supabase.from("notices").select("id,title,published_on").eq("school_id", sid).order("published_on", { ascending: false }).limit(5),
  ]);

  const a = (att.data ?? []) as { marked: number; present: number; absent: number; section_id: string }[];
  const marked = a.reduce((s, x) => s + Number(x.marked), 0);
  const present = a.reduce((s, x) => s + Number(x.present), 0);
  const absent = a.reduce((s, x) => s + Number(x.absent), 0);
  const sectionsWithStudents = ((counts.data ?? []) as { section_id: string | null }[]).filter((c) => c.section_id).length;
  const f = fs.data as { billed: number; collected: number; overdue: number; overdue_students: number; today: number; today_count: number; month: number } | null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon="dashboard"
        title={`${hourIST() < 12 ? "Good morning" : "Hello"}${myName && !myName.includes("@") ? `, ${myName.split(" ")[0]}` : ""}`}
        subtitle={`${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })} · ${school.name}`}
      />
      {denied && <Flash error="Your role doesn't have access to that page." />}
      {welcome && <Flash ok="Welcome! Your school is created with classes Nursery–12, subjects and fee heads. Next: Settings → Staff & access, then add students." />}
      {!session && <Flash error="No current academic session. Ask the school admin to set one in Settings." />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="students" tone="blue" label="Active students" value={students.count ?? 0} href="/app/students" />
        <Stat icon="attendance" tone="cyan" label="Attendance today" value={marked ? `${pct(present, marked)}%` : "Not marked"} hint={`${a.length}/${sectionsWithStudents} sections marked · ${absent} absent`} href="/app/attendance" />
        {f && (
          <>
            <Stat icon="fees" tone="green" label="Collected today" value={money(f.today)} hint={`${f.today_count} receipts · ${money(f.month)} this month`} href="/app/fees/receipts" />
            <Stat icon="revenue" tone="rose" label="Overdue fees" value={money(f.overdue)} hint={`${f.overdue_students} students · ${pct(Number(f.collected), Number(f.billed))}% of session collected`} href="/app/fees/defaulters" />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {fees && (
          <Card title="Latest receipts" actions={can("fees.collection.create") ? <Link href="/app/fees/collect" className="btn btn-sm btn-primary">Collect fee</Link> : undefined}>
            <ul className="m-0 list-none p-0">
              {((receipts.data ?? []) as unknown as { id: string; receipt_no: string; amount: number; mode: string; paid_on: string; cancelled: boolean; students: { first_name: string; last_name: string | null; admission_no: string } | null }[]).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
                  <Link href={`/app/fees/receipts/${r.id}`} className="font-mono text-[13px]">{r.receipt_no}</Link>
                  <span className="text-muted">{r.students?.first_name} {r.students?.last_name ?? ""} · {fmtDate(r.paid_on)}</span>
                  <span className="flex items-center gap-2 font-semibold text-ink">{money(r.amount)} {r.cancelled ? <Badge value="cancelled" /> : <Badge value={r.mode} text={r.mode.toUpperCase().replace("_", " ")} />}</span>
                </li>
              ))}
              {!receipts.data?.length && <li className="text-[14px] text-muted">No receipts yet.</li>}
            </ul>
          </Card>
        )}
        {can("frontdesk.enquiries.view") && (
          <Card title="Admission follow-ups due" actions={<Link href="/app/admissions" className="text-[14px]">All enquiries</Link>}>
            <ul className="m-0 list-none p-0">
              {((enq.data ?? []) as { id: string; student_name: string; class_sought: string | null; status: string; follow_up_date: string }[]).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
                  <Link href={`/app/admissions?edit=${e.id}`} className="font-semibold">{e.student_name}</Link>
                  <span className="flex items-center gap-2 text-muted">Class {e.class_sought ?? "—"} · {fmtDate(e.follow_up_date)} <Badge value={e.status} /></span>
                </li>
              ))}
              {!enq.data?.length && <li className="text-[14px] text-muted">No follow-ups due.</li>}
            </ul>
          </Card>
        )}
        <Card title="Notices" actions={<Link href="/app/notices" className="text-[14px]">All notices</Link>}>
          <ul className="m-0 list-none p-0">
            {((notices.data ?? []) as { id: string; title: string; published_on: string }[]).map((n) => (
              <li key={n.id} className="flex justify-between gap-2 border-t border-line py-2 text-[14px] first:border-0">
                <span className="font-semibold text-ink">{n.title}</span><span className="text-muted">{fmtDate(n.published_on)}</span>
              </li>
            ))}
            {!notices.data?.length && <li className="text-[14px] text-muted">No notices yet.</li>}
          </ul>
        </Card>
        <Card title="Quick actions">
          <div className="flex flex-wrap gap-2">
            {can("attendance.students.create") && <Link href="/app/attendance" className="btn btn-sm btn-secondary">Mark attendance</Link>}
            {can("students.profile.create") && <Link href="/app/students/new" className="btn btn-sm btn-secondary">New admission</Link>}
            {can("fees.defaulters.view") && <Link href="/app/fees/defaulters" className="btn btn-sm btn-secondary">Send fee reminders</Link>}
            {can("exams.marks.create") && <Link href="/app/exams" className="btn btn-sm btn-secondary">Enter marks</Link>}
          </div>
        </Card>
      </div>
    </div>
  );
}
