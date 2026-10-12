import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { cleanSearch, fmtDate, money, todayIST } from "@/lib/format";
import { STAFF_KINDS, sumLines, type Staff } from "@/lib/hr";
import { importLogins, saveStaff } from "../_actions/hr";

export default async function StaffDirectory({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; status?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("hr.staff.view");
  const sp = await searchParams;
  const status = sp.status === "left" ? "left" : "active";
  const q = cleanSearch(sp.q ?? "").trim();
  let query = supabase.from("staff").select("*").eq("school_id", school.id).eq("status", status).order("name").limit(1000);
  if (STAFF_KINDS.some(([k]) => k === sp.kind)) query = query.eq("kind", sp.kind!);
  if (q) query = query.or(`name.ilike.%${q}%,emp_code.ilike.${q}%,phone.ilike.%${q}%,designation.ilike.%${q}%`);
  const [{ data }, { count: activeCount }, { count: logins }, today] = await Promise.all([
    query,
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("school_id", school.id).eq("status", "active"),
    supabase.from("school_members").select("user_id", { count: "exact", head: true }).eq("school_id", school.id),
    supabase.rpc("leave_summary", { sid: school.id, d1: todayIST(), d2: todayIST() }),
  ]);
  const S = (data ?? []) as Staff[];
  const onLeave = new Set(((today.data ?? []) as { staff_id: string }[]).map((x) => x.staff_id));
  const monthly = S.reduce((t, s) => t + sumLines(s.earnings), 0);
  const kind = new Map(STAFF_KINDS);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="hr" title="Staff & payroll" subtitle="Everyone who works at the school — with or without an ERP login"
        actions={<>
          {can("hr.payroll.view") && <Link href="/app/hr/payroll" className="btn btn-sm btn-secondary">Payroll</Link>}
          <Link href="/app/hr/leave" className="btn btn-sm btn-secondary">Leave</Link>
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active staff" value={activeCount ?? 0} icon="hr" />
        <Stat label="On leave today" value={onLeave.size} icon="leave" tone="amber" href="/app/hr/leave" />
        {can("hr.payroll.view") && <Stat label={status === "active" ? "Monthly gross (shown)" : "Gross of those shown"} value={money(monthly)} icon="payroll" tone="green" />}
        <Stat label="ERP logins" value={logins ?? 0} hint="Teachers & office staff who sign in" icon="account" tone="violet" />
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, code, phone, designation" />
        <Select label="Type" name="kind" blank="All" defaultValue={sp.kind} options={STAFF_KINDS} />
        <Select label="Status" name="status" defaultValue={status} options={[["active", "Working"], ["left", "Left"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
      </form>

      {S.length ? (
        <Table head={["Name", "Designation", "Type", "Phone", "Joined", ...(can("hr.payroll.view") ? ["Monthly gross"] : []), ""]} minWidth={760}>
          {S.map((s) => (
            <tr key={s.id}>
              <td className={td}><Link href={`/app/hr/staff/${s.id}`} className="font-semibold">{s.name}</Link>{s.emp_code && <span className="ml-1 font-mono text-[12px] text-muted">{s.emp_code}</span>}</td>
              <td className={td}>{s.designation ?? "—"}<div className="text-[12px] text-muted">{s.department ?? ""}</div></td>
              <td className={td}>{kind.get(s.kind)?.split(" (")[0]}</td>
              <td className={td}>{s.phone ?? "—"}</td>
              <td className={td}>{fmtDate(s.joining_date)}</td>
              {can("hr.payroll.view") && <td className={td}>{s.earnings.length ? money(sumLines(s.earnings)) : <span className="text-[13px] text-error">not set</span>}</td>}
              <td className={td}>
                <span className="flex flex-wrap gap-1">
                  {onLeave.has(s.id) && <Badge value="due" text="On leave" />}
                  {s.user_id && <Badge value="contacted" text="Login" />}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{q || sp.kind ? "Nobody matches." : status === "left" ? "Nobody has left." : "No staff yet. Add them below, or bring in everyone who already has a login."}</Empty>}

      {can("hr.staff.create") && (
        <Card title="Add staff" icon="hr" description="Teachers, office staff, drivers, guards, helpers — anyone on the payroll."
          actions={<form action={importLogins}><Submit>Add everyone with a login</Submit></form>}>
          <form action={saveStaff} className="grid gap-3 sm:grid-cols-4">
            <Input label="Full name" name="name" required className="sm:col-span-2" />
            <Input label="Employee code" name="emp_code" placeholder="EMP-014" />
            <Select label="Type" name="kind" defaultValue="teaching" options={STAFF_KINDS} />
            <Input label="Designation" name="designation" placeholder="PGT Physics" />
            <Input label="Department" name="department" placeholder="Science" />
            <Input label="Phone" name="phone" type="tel" />
            <Input label="Date of joining" name="joining_date" type="date" />
            <div className="flex items-end sm:col-span-4"><Submit>Add staff member</Submit></div>
          </form>
        </Card>
      )}
    </div>
  );
}
