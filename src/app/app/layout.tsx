import Link from "next/link";
import type { Metadata } from "next";
import { LuArrowLeftRight, LuCircleAlert, LuShieldCheck } from "react-icons/lu";
import { requireSchool } from "@/lib/school";
import { addDays, fmtDate, todayIST } from "@/lib/format";
import { Shell, type NavEntry } from "@/components/shell/Shell";
import { UserMenu } from "@/components/shell/UserMenu";
import type { IconName } from "@/components/shell/icons";
import { Logo } from "@/components/ui/Logo";
import { signOut, switchSchool } from "../actions";
import { endSupport } from "../platform/actions";
import { Announcements } from "@/components/Announcements";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "School" };

type Leaf = { href: string; label: string; any: string[] };
type Entry = { key: string; label: string; icon: IconName; section?: string; href?: string; any?: string[]; items?: Leaf[] };

const NAV: Entry[] = [
  { key: "dash", label: "Dashboard", icon: "dashboard", href: "/app", any: ["dashboard.overview.view"], section: "Overview" },
  { key: "students", label: "Students", icon: "students", section: "Academics", items: [
    { href: "/app/students", label: "All students", any: ["students.profile.view"] },
    { href: "/app/students/new", label: "Add student", any: ["students.profile.create"] },
    { href: "/app/board", label: "UP Board registration", any: ["students.board_reg.view"] },
    { href: "/app/documents", label: "Documents & templates", any: ["documents.issue.view", "documents.templates.view"] },
    { href: "/app/templates", label: "Template studio", any: ["documents.templates.view"] },
    { href: "/app/certificates", label: "Old-format certificates", any: ["students.certificates.view"] },
  ] },
  { key: "frontdesk", label: "Front office", icon: "admissions", section: "Front office", items: [
    { href: "/app/frontdesk", label: "Front desk", any: ["frontdesk.visitors.view", "frontdesk.enquiries.view", "frontdesk.admissions.view"] },
    { href: "/app/frontdesk/visitors", label: "Visitor register", any: ["frontdesk.visitors.view"] },
    { href: "/app/frontdesk/calls", label: "Call log", any: ["frontdesk.visitors.view"] },
    { href: "/app/frontdesk/postal", label: "Postal register", any: ["frontdesk.visitors.view"] },
    { href: "/app/frontdesk/gatepass", label: "Student gate pass", any: ["frontdesk.visitors.view"] },
    { href: "/app/admissions", label: "Admissions & enquiries", any: ["frontdesk.enquiries.view"] },
    { href: "/app/admissions/applications", label: "Admission applications", any: ["frontdesk.admissions.view"] },
    { href: "/app/admissions/pipeline", label: "Admission pipeline", any: ["frontdesk.admissions.view"] },
    { href: "/app/admissions/followups", label: "Admission follow-ups", any: ["frontdesk.admissions.view", "frontdesk.enquiries.view"] },
    { href: "/app/admissions/online", label: "Online admission form", any: ["frontdesk.online_form.view"] },
  ] },
  { key: "attendance", label: "Attendance", icon: "attendance", items: [
    { href: "/app/attendance", label: "Mark attendance", any: ["attendance.students.view"] },
    { href: "/app/attendance/register", label: "Monthly register", any: ["attendance.students.view"] },
    { href: "/app/attendance/scan", label: "Scan QR", any: ["attendance.students.create", "attendance.staff.create"] },
    { href: "/app/attendance/staff", label: "Staff attendance", any: ["attendance.staff.view"] },
    { href: "/app/attendance/low", label: "Low attendance", any: ["attendance.students.view"] },
    { href: "/app/attendance/devices", label: "Devices & timings", any: ["attendance.students.edit"] },
  ] },
  { key: "academics", label: "Academic setup", icon: "academics", items: [
    { href: "/app/academics", label: "Overview", any: ["academics.setup.view"] },
    { href: "/app/academics/curriculum", label: "Curriculum", any: ["academics.setup.view"] },
    { href: "/app/academics/allocation", label: "Teacher allocation", any: ["academics.allocation.view", "academics.setup.view"] },
    { href: "/app/academics/syllabus", label: "Syllabus & lesson plans", any: ["academics.syllabus.view"] },
  ] },
  { key: "timetable", label: "Timetable", icon: "academics", items: [
    { href: "/app/timetable", label: "Class timetable", any: ["academics.timetable.view"] },
    { href: "/app/timetable/teacher", label: "Teacher timetable", any: ["academics.timetable.view"] },
    { href: "/app/timetable/cover", label: "Cover & substitutes", any: ["academics.timetable.view"] },
    { href: "/app/timetable/load", label: "Teacher workload", any: ["academics.timetable.edit"] },
    { href: "/app/timetable/periods", label: "Bell schedule", any: ["academics.timetable.edit"] },
  ] },
  { key: "exams", label: "Exams & results", icon: "exams", items: [
    { href: "/app/exams", label: "Exams (offline)", any: ["exams.setup.view", "exams.marks.view"] },
    { href: "/app/exams/online", label: "Online exams", any: ["exams.setup.view", "exams.marks.view"] },
    { href: "/app/exams/questions", label: "Question bank", any: ["exams.setup.view", "exams.marks.view"] },
  ] },
  { key: "homework", label: "Homework & material", icon: "homework", href: "/app/homework", any: ["homework.homework.view", "homework.material.view"] },
  { key: "library", label: "Library", icon: "library", items: [
    { href: "/app/library", label: "Issue & return", any: ["library.circulation.view"] },
    { href: "/app/library/books", label: "Book catalogue", any: ["library.catalogue.view"] },
    { href: "/app/library/reservations", label: "Reservations", any: ["library.circulation.view"] },
    { href: "/app/library/settings", label: "Loan rules", any: ["library.catalogue.edit"] },
  ] },
  { key: "wellbeing", label: "Health & discipline", icon: "health", items: [
    { href: "/app/health", label: "Medical room", any: ["wellbeing.medical.view"] },
    { href: "/app/health/records", label: "Health records", any: ["wellbeing.medical.view"] },
    { href: "/app/discipline", label: "Discipline", any: ["wellbeing.discipline.view"] },
  ] },
  { key: "fees", label: "Fees", icon: "fees", section: "Finance", items: [
    { href: "/app/fees", label: "Overview", any: ["fees.collection.view", "fees.structure.view", "fees.defaulters.view", "fees.receipts.view"] },
    { href: "/app/fees/collect", label: "Collect fee", any: ["fees.collection.create"] },
    { href: "/app/fees/defaulters", label: "Defaulters", any: ["fees.defaulters.view"] },
    { href: "/app/fees/receipts", label: "Receipts", any: ["fees.receipts.view"] },
    { href: "/app/fees/structure", label: "Fee structure", any: ["fees.structure.view"] },
    { href: "/app/fees/concessions", label: "Concessions", any: ["fees.concessions.view"] },
    { href: "/app/fees/charges", label: "Charges & fines", any: ["fees.dues.create"] },
    { href: "/app/fees/cheques", label: "Cheques", any: ["fees.collection.view"] },
    { href: "/app/fees/followups", label: "Promises to pay", any: ["fees.defaulters.view"] },
    { href: "/app/fees/links", label: "Online payments & links", any: ["fees.online.view"] },
    { href: "/app/fees/templates", label: "Fee templates", any: ["fees.structure.view", "documents.templates.view"] },
    { href: "/app/fees/refunds", label: "Refunds", any: ["fees.refunds.view"] },
    { href: "/app/fees/daybook", label: "Day book", any: ["fees.collection.view"] },
    { href: "/app/fees/reports", label: "Reports", any: ["fees.collection.view", "fees.receipts.view"] },
    { href: "/app/fees/settings", label: "Fee settings", any: ["fees.structure.view"] },
  ] },
  { key: "accounts", label: "Accounts", icon: "revenue", items: [
    { href: "/app/accounts", label: "Overview", any: ["accounts.vouchers.view", "accounts.books.view"] },
    { href: "/app/accounts/vouchers", label: "Vouchers", any: ["accounts.vouchers.view"] },
    { href: "/app/accounts/daybook", label: "Day book", any: ["accounts.books.view", "accounts.vouchers.view"] },
    { href: "/app/accounts/setup", label: "Books & heads", any: ["accounts.vouchers.view", "accounts.books.view"] },
  ] },
  { key: "transport", label: "Transport", icon: "transport", section: "Operations", items: [
    { href: "/app/transport", label: "Routes & stops", any: ["transport.routes.view"] },
    { href: "/app/transport/live", label: "Live bus map", any: ["transport.tracking.view"] },
    { href: "/app/transport/students", label: "Students on transport", any: ["transport.allocation.view"] },
    { href: "/app/transport/vehicles", label: "Vehicles", any: ["transport.routes.view"] },
  ] },
  { key: "inventory", label: "Inventory & sales", icon: "layers", items: [
    { href: "/app/inventory", label: "Overview", any: ["inventory.items.view", "inventory.sales.view", "inventory.purchase.view"] },
    { href: "/app/inventory/sell", label: "New bill (counter)", any: ["inventory.sales.create"] },
    { href: "/app/inventory/sales", label: "Sales", any: ["inventory.sales.view"] },
    { href: "/app/inventory/items", label: "Items & stock", any: ["inventory.items.view"] },
    { href: "/app/inventory/purchases", label: "Purchases", any: ["inventory.purchase.view"] },
    { href: "/app/inventory/ledger", label: "Stock ledger", any: ["inventory.items.view"] },
  ] },
  { key: "hostel", label: "Hostel", icon: "hostel", items: [
    { href: "/app/hostel", label: "Overview", any: ["hostel.rooms.view", "hostel.allocation.view", "hostel.rollcall.view"] },
    { href: "/app/hostel/rooms", label: "Rooms & beds", any: ["hostel.rooms.view"] },
    { href: "/app/hostel/allocation", label: "Bed allocation & fee", any: ["hostel.allocation.view"] },
    { href: "/app/hostel/rollcall", label: "Night roll call", any: ["hostel.rollcall.view"] },
    { href: "/app/hostel/outpass", label: "Outpass & visitors", any: ["hostel.rollcall.view"] },
    { href: "/app/hostel/mess", label: "Mess menu", any: ["hostel.mess.view"] },
  ] },
  { key: "hr", label: "Staff & payroll", icon: "hr", items: [
    { href: "/app/hr", label: "Staff directory", any: ["hr.staff.view"] },
    { href: "/app/hr/leave", label: "Leave", any: ["hr.leave.view", "hr.leave.create", "hr.leave.approve"] },
    { href: "/app/hr/payroll", label: "Payroll", any: ["hr.payroll.view"] },
    { href: "/app/hr/advances", label: "Salary advances", any: ["hr.payroll.view"] },
  ] },
  { key: "reports", label: "Reports & analysis", icon: "reports", section: "Reports", items: [
    { href: "/app/reports", label: "Principal dashboard", any: ["reports.overview.view"] },
    { href: "/app/reports/enrolment", label: "Enrolment", any: ["reports.overview.view", "reports.academic.view"] },
    { href: "/app/reports/attendance", label: "Attendance", any: ["reports.overview.view", "reports.academic.view"] },
    { href: "/app/reports/fees", label: "Fee collection", any: ["reports.fees.view", "reports.overview.view"] },
    { href: "/app/reports/academics", label: "Exam results", any: ["reports.academic.view"] },
    { href: "/app/reports/udise", label: "UDISE strength", any: ["reports.overview.view", "reports.udise.export"] },
  ] },
  { key: "notices", label: "Notices", icon: "notices", href: "/app/notices", any: ["comms.notices.view"], section: "Communication" },
  { key: "messages", label: "Messages", icon: "notifications", items: [
    { href: "/app/messages", label: "Sent & waiting", any: ["comms.outbox.view"] },
    { href: "/app/messages/compose", label: "Send a message", any: ["comms.broadcast.create"] },
    { href: "/app/messages/templates", label: "Templates", any: ["comms.templates.view"] },
  ] },
  { key: "calendar", label: "School calendar", icon: "notices", href: "/app/calendar", any: ["comms.calendar.view"] },
  { key: "settings", label: "Settings", icon: "settings", section: "Administration", items: [
    { href: "/app/settings", label: "Settings centre", any: ["settings.school.view", "settings.users.view", "settings.roles.view", "academics.setup.create", "settings.billing.view", "settings.integrations.view", "settings.audit.view"] },
    { href: "/app/settings/school", label: "School profile", any: ["settings.school.view"] },
    { href: "/app/settings/academic", label: "Classes & sessions", any: ["academics.setup.create"] },
    { href: "/app/settings/staff", label: "Staff & access", any: ["settings.users.view"] },
    { href: "/app/settings/roles", label: "Roles & permissions", any: ["settings.roles.view"] },
    { href: "/app/settings/integrations", label: "Integrations", any: ["settings.integrations.view"] },
    { href: "/app/settings/notifications", label: "Notifications", any: ["settings.school.view"] },
    { href: "/app/settings/billing", label: "Plan & billing", any: ["settings.billing.view"] },
    { href: "/app/settings/audit", label: "Audit log", any: ["settings.audit.view"] },
  ] },
  { key: "support", label: "Help & support", icon: "support", href: "/app/support", any: ["support.tickets.view"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, school, session, memberships, isPlatform, groups, user, canAny, can, roleNames, myName, subState, subEnd, subGrace, support } = await requireSchool();
  const { data: ann } = await supabase.rpc("my_announcements", { sid: school.id });
  const nav: NavEntry[] = NAV.flatMap((n): NavEntry[] => {
    if (n.items) {
      const items = n.items.filter((i) => canAny(...i.any)).map(({ href, label }) => ({ href, label }));
      return items.length ? [{ key: n.key, label: n.label, icon: n.icon, section: n.section, items }] : [];
    }
    return canAny(...(n.any ?? [])) ? [{ key: n.key, label: n.label, icon: n.icon, section: n.section, href: n.href }] : [];
  });
  // keep each section label only on the first visible entry of that section
  const seen = new Set<string>();
  let current: string | undefined;
  for (const n of NAV) {
    if (n.section) current = n.section;
    const v = nav.find((x) => x.key === n.key);
    if (!v) continue;
    v.section = current && !seen.has(current) ? current : undefined;
    if (current) seen.add(current);
  }
  const menuLinks: { href: string; label: string; icon: IconName }[] = [{ href: "/app/account", label: "My account", icon: "account" }];
  if (isPlatform) menuLinks.push({ href: "/platform", label: "Super Admin", icon: "tenants" });
  if (groups.length) menuLinks.push({ href: "/group", label: "Group overview", icon: "groups" });
  return (
    <Shell
      root="/app"
      nav={nav}
      brand={<Logo name={school.name} sub={`Session ${session?.name ?? "—"}`} logoUrl={school.logo_url} dark />}
      sidebarFooter={
        <div className="rounded-xl bg-white/[0.06] px-3 py-2.5 text-[12px] text-[#aebde3]">
          <p className="m-0 flex items-center gap-1.5 font-semibold text-white"><LuShieldCheck aria-hidden="true" size={14} />{roleNames.join(", ") || "No role"}</p>
          <p className="m-0 mt-0.5">Plan: <span className="capitalize">{school.plan}</span> · {school.code}</p>
        </div>
      }
      topbar={
        <>
          {(memberships.length > 1 || isPlatform) && (
            <form action={switchSchool} className="mr-auto flex min-w-0 items-center gap-1.5">
              <LuArrowLeftRight aria-hidden="true" size={16} className="hidden flex-none text-muted sm:block" />
              <select name="school_id" defaultValue={school.id} aria-label="Switch school" className="min-w-0 max-w-[200px] rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink">
                {memberships.map((m) => <option key={m.school_id} value={m.school_id}>{m.school_name}</option>)}
                {!memberships.some((m) => m.school_id === school.id) && <option value={school.id}>{school.name}</option>}
              </select>
              <button className="flex-none cursor-pointer rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] font-semibold text-ink hover:border-blue hover:text-blue-strong">Switch</button>
            </form>
          )}
          <UserMenu name={myName} email={user.email ?? ""} role={roleNames.join(", ")} links={menuLinks} signOut={signOut} />
        </>
      }
    >
      {isPlatform && !memberships.some((m) => m.school_id === school.id) && (
        <div role="note" className={`mb-5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-4 py-3 text-[14px] print:hidden ${support ? "border-[#c4b5fd] bg-[#f3efff] text-[#4c1d95]" : "border-line bg-white text-body"}`}>
          {support
            ? <span><b>Support session</b> in {school.name} until {new Date(support.expires_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} — “{support.reason}”. Every change is logged.</span>
            : <span>You are viewing <b>{school.name}</b> as platform staff — <b>read-only</b>. Start a support session on the school's page to make changes.</span>}
          <form action={endSupport}><input type="hidden" name="school_id" value={school.id} /><button className="cursor-pointer rounded-md border border-current bg-transparent px-3 py-1 text-[13px] font-semibold">{support ? "End session" : "Back to Super Admin"}</button></form>
        </div>
      )}
      <Announcements items={(ann ?? []) as { id: string; title: string; body: string | null; level: "info" | "warning" | "critical" }[]} />
      <SubBanner state={subState} end={subEnd} grace={subGrace} canPay={can("settings.billing.view")} />
      {children}
    </Shell>
  );
}

function SubBanner({ state, end, grace, canPay }: { state: string; end: string | null; grace: number; canPay: boolean }) {
  const today = todayIST();
  const left = end ? Math.round((Date.parse(end) - Date.parse(today)) / 86400000) : null;
  let msg: string | null = null, tone = "warn";
  if (state === "pending") msg = "Your school is waiting for approval by CodersDuniya. You can look around; changes are switched on once approved.";
  else if (state === "suspended") { msg = "This school account is suspended. Data is read-only. Please contact support."; tone = "bad"; }
  else if (state === "expired") { msg = `The subscription ended on ${fmtDate(end)}. Everything is read-only until it is renewed.`; tone = "bad"; }
  else if (state === "grace" && end) msg = `The subscription ended on ${fmtDate(end)}. Renew by ${fmtDate(addDays(end, grace))} to avoid read-only mode.`;
  else if (state === "trial" && left !== null && left <= 10) msg = left >= 0 ? `Free trial: ${left + 1} day${left ? "s" : ""} left (until ${fmtDate(end)}).` : null;
  if (!msg) return null;
  return (
    <div role="note" className={`mb-5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-4 py-3 text-[14px] print:hidden ${tone === "bad" ? "border-[#f3b8b1] bg-[#fdecea] text-[#7a1a12]" : "border-[#f1d39a] bg-[#fff4e0] text-[#7a4b00]"}`}>
      <span className="flex items-center gap-2"><LuCircleAlert aria-hidden="true" size={18} className="flex-none" />{msg}</span>
      {canPay && state !== "pending" && <Link href="/app/settings/billing" className="font-semibold">Plan & billing →</Link>}
    </div>
  );
}
