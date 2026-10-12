import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Stat, Submit, Table, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { cleanSearch, fmtDate, money, todayIST } from "@/lib/format";
import { STAFF_KINDS } from "@/lib/hr";
import { importLogins, saveStaff } from "../_actions/hr";

const SORTS: [string, string][] = [["name", "Name"], ["code", "Employee code"], ["joined", "Newest joined"], ["designation", "Designation"]];

type Row = { id: string; name: string; emp_code: string | null; designation: string | null; department: string | null; kind: string; phone: string | null; email: string | null;
  joining_date: string | null; status: string; user_id: string | null; blocked: boolean; block_reason: string | null; gross: number; total: number };

export default async function StaffDirectory({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("hr.staff.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const status = ["active", "left", "all"].includes(sp.status ?? "") ? sp.status! : "active";
  const kind = STAFF_KINDS.some(([k]) => k === sp.kind) ? sp.kind! : null;
  const login = ["yes", "no"].includes(sp.login ?? "") ? sp.login! : null;
  const blocked = ["yes", "no"].includes(sp.blocked ?? "") ? sp.blocked! : null;
  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : "name";
  const q = cleanSearch(sp.q ?? "").trim();
  const dept = (sp.department ?? "").slice(0, 60) || null;

  const [listQ, countsQ, deptQ, leaveQ] = await Promise.all([
    supabase.rpc("staff_list", { sid: school.id, p_q: q || null, p_kind: kind, p_department: dept, p_status: status, p_login: login, p_blocked: blocked, p_sort: sort, p_limit: size, p_offset: offset }),
    supabase.rpc("staff_counts", { sid: school.id }),
    supabase.from("staff").select("department").eq("school_id", school.id).not("department", "is", null).limit(1000),
    supabase.rpc("leave_summary", { sid: school.id, d1: todayIST(), d2: todayIST() }),
  ]);
  const S = (listQ.data ?? []) as Row[];
  const total = S[0]?.total ? Number(S[0].total) : 0;
  const counts = new Map(((countsQ.data ?? []) as { status: string; n: number; blocked: number; with_login: number }[]).map((c) => [c.status, c]));
  const active = Number(counts.get("active")?.n ?? 0), left = Number(counts.get("left")?.n ?? 0);
  const logins = [...counts.values()].reduce((t, c) => t + Number(c.with_login), 0);
  const blockedCount = [...counts.values()].reduce((t, c) => t + Number(c.blocked), 0);
  const departments = [...new Set(((deptQ.data ?? []) as { department: string }[]).map((d) => d.department).filter(Boolean))].sort();
  const onLeave = new Set(((leaveQ.data ?? []) as { staff_id: string }[]).map((x) => x.staff_id));
  const monthly = S.reduce((t, s) => t + Number(s.gross), 0);
  const kindName = new Map(STAFF_KINDS);
  const params = { q: q || undefined, status: status === "active" ? undefined : status, kind: kind ?? undefined, department: dept ?? undefined, login: login ?? undefined, blocked: blocked ?? undefined, sort: sort === "name" ? undefined : sort };
  const filtered = Boolean(q || kind || dept || login || blocked);
  const exportQs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="hr" title="Staff & payroll" subtitle="Everyone who works at the school — with or without an ERP login"
        actions={<>
          {can("hr.staff.export") && <a href={`/app/hr/export${exportQs ? `?${exportQs}` : ""}`} className="btn btn-sm btn-secondary">Export CSV</a>}
          {can("hr.payroll.view") && <Link href="/app/hr/payroll" className="btn btn-sm btn-secondary">Payroll</Link>}
          <Link href="/app/hr/leave" className="btn btn-sm btn-secondary">Leave</Link>
        </>} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Working staff" value={active} hint={left ? `${left} have left` : undefined} icon="hr" />
        <Stat label="On leave today" value={onLeave.size} icon="leave" tone="amber" href="/app/hr/leave" />
        {can("hr.payroll.view") && <Stat label="Monthly gross (this page)" value={money(monthly)} icon="payroll" tone="green" />}
        <Stat label="ERP logins" value={logins} hint={blockedCount ? `${blockedCount} blocked` : "Teachers & office staff who sign in"} icon="account" tone="violet" />
      </div>

      <form className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
        <div className="col-span-2 sm:w-72"><Input label="Search" name="q" defaultValue={sp.q} placeholder="Name, code, phone, email, designation" /></div>
        <Select label="Type" name="kind" blank="All types" defaultValue={kind} options={STAFF_KINDS} />
        <Select label="Department" name="department" blank="All departments" defaultValue={dept} options={departments} />
        <Select label="Status" name="status" defaultValue={status} options={[["active", "Working"], ["left", "Left"], ["all", "All"]]} />
        <Select label="ERP login" name="login" blank="Any" defaultValue={login} options={[["yes", "Has login"], ["no", "No login"]]} />
        <Select label="Blocked" name="blocked" blank="Any" defaultValue={blocked} options={[["yes", "Blocked only"], ["no", "Not blocked"]]} />
        <Select label="Sort" name="sort" defaultValue={sort} options={SORTS} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Apply</button>
        {(filtered || sort !== "name") && <Link href="/app/hr" className="pb-2 text-[14px]">Clear</Link>}
      </form>

      {listQ.error && <Flash error={`Could not load staff: ${listQ.error.message}`} />}
      {S.length ? (
        <Table head={["Name", "Designation", "Type", "Phone", "Joined", ...(can("hr.payroll.view") ? ["Monthly gross"] : []), ""]} minWidth={760}>
          {S.map((s) => (
            <tr key={s.id} className={s.blocked ? "bg-[#fff7f6]" : ""}>
              <td className={td}><Link href={`/app/hr/staff/${s.id}`} className="font-semibold">{s.name}</Link>{s.emp_code && <span className="ml-1 font-mono text-[12px] text-muted">{s.emp_code}</span>}</td>
              <td className={td}>{s.designation ?? "—"}<div className="text-[12px] text-muted">{s.department ?? ""}</div></td>
              <td className={td}>{kindName.get(s.kind)?.split(" (")[0]}</td>
              <td className={td}>{s.phone ?? "—"}</td>
              <td className={td}>{fmtDate(s.joining_date)}</td>
              {can("hr.payroll.view") && <td className={td}>{Number(s.gross) > 0 ? money(s.gross) : <span className="text-[13px] text-error">not set</span>}</td>}
              <td className={td}>
                <span className="flex flex-wrap gap-1">
                  {s.status === "left" && <Badge value="cancelled" text="Left" />}
                  {s.blocked && <span title={s.block_reason ?? ""}><Badge value="overdue" text="Blocked" /></span>}
                  {onLeave.has(s.id) && <Badge value="due" text="On leave" />}
                  {s.user_id && <Badge value="contacted" text="Login" />}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>{filtered ? "Nobody matches these filters." : status === "left" ? "Nobody has left." : "No staff yet. Add them below, or bring in everyone who already has a login."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/hr" params={params} />

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
