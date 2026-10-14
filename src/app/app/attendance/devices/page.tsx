import { requirePerm } from "@/lib/school";
import { Badge, Card, Empty, Flash, Input, PageHeader, Select, Submit, Table, Textarea, td } from "@/components/ui/ui";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { CopyButton } from "@/components/CopyButton";
import { appUrl } from "@/lib/brand";
import { addDevice, importPunches, removeDevice, rotateDevice, saveAttendanceSettings, toggleDevice } from "../../_actions/attendance";

const KIND: Record<string, string> = { qr_kiosk: "QR kiosk (tablet / phone)", biometric: "Biometric machine", rfid: "RFID / card reader" };
const when = (t: string) => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const RESULT: Record<string, string> = { in: "present", out: "out", already: "repeat", unknown: "unknown", inactive: "not on roll" };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default async function Devices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school } = await requirePerm("attendance.students.edit");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const result = ["in", "out", "already", "unknown", "inactive"].includes(sp.result ?? "") ? sp.result! : null;

  let punchQ = supabase.from("attendance_punches")
    .select("id,punched_at,source,direction,result,raw,subject,device:attendance_devices(name),student:students(first_name,last_name,admission_no),staff:staff(name)", { count: "exact" })
    .eq("school_id", school.id).order("punched_at", { ascending: false }).range(offset, offset + size - 1);
  if (result) punchQ = punchQ.eq("result", result);
  const [{ data: devices }, { data: cfg }, { data: punches, count }] = await Promise.all([
    supabase.from("attendance_devices").select("*").eq("school_id", school.id).order("created_at"),
    supabase.from("attendance_settings").select("*").eq("school_id", school.id).maybeSingle(),
    punchQ,
  ]);
  const base = appUrl("/api/attendance/punch");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="attendance" title="Devices & timings" subtitle="Gate kiosks, biometric machines, card readers and the late-mark time" back={{ href: "/app/attendance", label: "Attendance" }} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Timings">
          <form action={saveAttendanceSettings} className="grid gap-3 sm:grid-cols-3">
            <Input label="School starts" name="school_start" type="time" defaultValue={String(cfg?.school_start ?? "08:00").slice(0, 5)} />
            <Input label="Late after" name="late_after" type="time" defaultValue={String(cfg?.late_after ?? "08:15").slice(0, 5)} hint="A first scan after this is marked Late" />
            <Input label="Staff check-in radius (m)" name="geofence_m" type="number" min={30} max={2000} defaultValue={cfg?.geofence_m ?? 150} hint="Around the school location" />
            <div className="sm:col-span-3"><Submit>Save timings</Submit></div>
          </form>
        </Card>
        <Card title="Add a device">
          <form action={addDevice} className="grid gap-3 sm:grid-cols-3">
            <Input label="Name" name="name" required placeholder="Main gate tablet" />
            <Select label="Type" name="kind" defaultValue="qr_kiosk" options={Object.entries(KIND)} />
            <Input label="Place" name="location" placeholder="Gate 1" />
            <div className="sm:col-span-3"><Submit>Add device</Submit></div>
          </form>
        </Card>
      </div>

      {(devices ?? []).length ? (
        <Table head={["Device", "Type", "Link / token", "Last seen", ""]} minWidth={860}>
          {(devices ?? []).map((d) => (
            <tr key={d.id}>
              <td className={td}><b className="text-ink">{d.name}</b><div className="text-[12px] text-muted">{d.location ?? ""}{d.active ? "" : " · switched off"}</div></td>
              <td className={td}>{KIND[d.kind] ?? d.kind}</td>
              <td className={`${td} text-[12px]`}>
                {d.kind === "qr_kiosk" ? (
                  <CopyButton text={appUrl(`/scan/${d.token}`)} label="Copy kiosk link" />
                ) : (
                  <div className="flex flex-col gap-1">
                    <span className="text-muted">POST {base}</span>
                    <code className="break-all">{`{"token":"${d.token}","code":"<id>","at":"2026-04-01T08:12:00+05:30"}`}</code>
                    <CopyButton text={d.token} label="Copy token" />
                  </div>
                )}
              </td>
              <td className={`${td} text-[13px] text-muted`}>{d.last_seen_at ? when(d.last_seen_at) : "Never"}</td>
              <td className={`${td} whitespace-nowrap text-[13px]`}>
                <div className="flex flex-wrap items-center gap-3">
                  <form action={toggleDevice}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="active" value={d.active ? "0" : "1"} /><button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">{d.active ? "Switch off" : "Switch on"}</button></form>
                  <form action={rotateDevice}><input type="hidden" name="id" value={d.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-blue underline">New link</button></form>
                  <form action={removeDevice}><input type="hidden" name="id" value={d.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-error underline">Remove</button></form>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : <Empty>No device yet. Add a QR kiosk for the gate, or connect a biometric machine.</Empty>}

      <Card title="Import punches from a biometric machine" description="One punch per line: code, date and time (IST). The code is the card QR code, admission number or employee code.">
        <form action={importPunches} className="flex flex-col gap-3">
          <Textarea label="Punches" name="punches" rows={5} placeholder={"A1042,2026-04-01 08:05\nE003,2026-04-01 08:20\nA1042,2026-04-01 13:55"} />
          <div><Submit>Import</Submit></div>
        </form>
      </Card>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="m-0 text-[18px] font-bold text-ink">Recent punches</h2>
          <form className="flex items-end gap-2">
            <Select label="Result" name="result" blank="All" defaultValue={result} options={[["in", "Marked present"], ["out", "Out-time"], ["already", "Repeat"], ["unknown", "Unknown code"], ["inactive", "Not on roll"]]} />
            <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
          </form>
        </div>
        {(punches ?? []).length ? (
          <Table head={["Time", "Who", "Source", "Device", "Result"]} minWidth={680}>
            {(punches ?? []).map((p) => {
              const st = one(p.student as { first_name: string; last_name: string | null; admission_no: string } | { first_name: string; last_name: string | null; admission_no: string }[] | null);
              const sf = one(p.staff as { name: string } | { name: string }[] | null);
              const dv = one(p.device as { name: string } | { name: string }[] | null);
              return (
                <tr key={p.id}>
                  <td className={`${td} whitespace-nowrap text-[13px]`}>{when(p.punched_at)}</td>
                  <td className={td}>{st ? `${st.first_name} ${st.last_name ?? ""}`.trim() : sf ? sf.name : <span className="text-muted">{p.raw ?? "—"}</span>}<div className="text-[12px] text-muted">{st?.admission_no ?? (sf ? "Staff" : "")}</div></td>
                  <td className={`${td} text-[13px] capitalize`}>{p.source}</td>
                  <td className={`${td} text-[13px]`}>{dv?.name ?? "—"}</td>
                  <td className={td}><Badge value={p.result === "unknown" || p.result === "inactive" ? "overdue" : p.result === "already" ? "pending" : "active"} text={RESULT[p.result] ?? p.result} /></td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>No punches yet.</Empty>}
        <Pagination total={count ?? 0} page={page} size={size} basePath="/app/attendance/devices" params={{ result: result ?? undefined }} />
      </div>
    </div>
  );
}
