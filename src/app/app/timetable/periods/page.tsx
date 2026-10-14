import { requirePerm } from "@/lib/school";
import { Card, Flash, Input, PageHeader, Submit, Table, td } from "@/components/ui/ui";
import { hhmm, type Period } from "@/lib/timetable";
import { deletePeriod, savePeriod } from "../../_actions/timetable";

export default async function Periods({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("academics.timetable.view");
  const sp = await searchParams;
  await supabase.rpc("ensure_timetable_defaults", { sid: school.id });
  const { data } = await supabase.from("periods").select("*").eq("school_id", school.id).order("no");
  const P = (data ?? []) as Period[];
  const edit = can("academics.timetable.edit");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="academics" title="Bell schedule" subtitle="Periods and breaks of the school day" back={{ href: "/app/timetable", label: "Timetable" }} />
      <Flash ok={sp.ok} error={sp.error} />
      <Table head={["#", "Name", "Start", "End", "Break", ""]} minWidth={700}>
        {P.map((p) => (
          <tr key={p.id}>
            <td className={td}>{p.no}</td>
            {edit ? (
              <td colSpan={5} className={td}>
                <form action={savePeriod} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <Input label="Name" name="name" defaultValue={p.name} required className="w-36" />
                  <Input label="Start" name="start_time" type="time" defaultValue={hhmm(p.start_time)} required />
                  <Input label="End" name="end_time" type="time" defaultValue={hhmm(p.end_time)} required />
                  <label className="flex items-center gap-1 pb-2 text-[13px]"><input type="checkbox" name="is_break" value="1" defaultChecked={p.is_break} />Break</label>
                  <button className="btn btn-sm btn-secondary cursor-pointer">Save</button>
                </form>
                <form action={deletePeriod} className="mt-1"><input type="hidden" name="id" value={p.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-error underline">Remove (also clears its cells)</button></form>
              </td>
            ) : (<><td className={td}>{p.name}</td><td className={td}>{hhmm(p.start_time)}</td><td className={td}>{hhmm(p.end_time)}</td><td className={td}>{p.is_break ? "Break" : ""}</td><td className={td} /></>)}
          </tr>
        ))}
      </Table>
      {edit && (
        <Card title="Add a period">
          <form action={savePeriod} className="flex flex-wrap items-end gap-3">
            <Input label="Name" name="name" required placeholder="Period 9" />
            <Input label="Start" name="start_time" type="time" required />
            <Input label="End" name="end_time" type="time" required />
            <label className="flex items-center gap-1 pb-2 text-[13px]"><input type="checkbox" name="is_break" value="1" />Break</label>
            <Submit>Add</Submit>
          </form>
        </Card>
      )}
    </div>
  );
}
