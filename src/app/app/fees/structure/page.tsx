import { requirePerm } from "@/lib/school";
import { Card, Empty, Flash, Input, PageHeader, Select, Submit } from "@/components/ui/ui";
import { fmtDate, money } from "@/lib/format";
import { getClasses } from "@/lib/erp";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { addFeeHead, addSchedule, deleteFeeHead, deletePlan, generateDues } from "../../_actions/fees";

const CLASS_SIZES = [5, 10, 20] as const;
type Plan = { id: string; class_id: string; fee_head_id: string; label: string; due_date: string; amount: number };

export default async function Structure({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; page?: string; size?: string }> }) {
  const { supabase, school, session } = await requirePerm("fees.structure.view");
  const sp = await searchParams;
  const [classes, { data: heads }, { data: plans }] = await Promise.all([
    getClasses(supabase, school.id),
    supabase.from("fee_heads").select("id,name").eq("school_id", school.id).order("sort").order("name"),
    session ? supabase.from("fee_plans").select("id,class_id,fee_head_id,label,due_date,amount").eq("session_id", session.id).order("due_date").limit(5000) : Promise.resolve({ data: [] }),
  ]);
  const H = (heads ?? []) as { id: string; name: string }[];
  const P = (plans ?? []) as Plan[];
  const headName = (id: string) => H.find((h) => h.id === id)?.name ?? "—";
  // one card per class that has fees; the cards are paged so a school with many classes stays fast to scroll
  const withFees = classes.filter((c) => P.some((p) => p.class_id === c.id));
  const { page, size, offset } = pageParams(sp, 5, CLASS_SIZES);
  const shown = withFees.slice(offset, offset + size);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="layers" title="Fee structure" subtitle={`Session ${session?.name ?? "—"} · set fees per class, then generate dues for students`} back={{ href: "/app/fees", label: "Fees" }}
        actions={<form action={generateDues}><Submit>Generate dues for all classes</Submit></form>} />
      <Flash ok={sp.ok} error={sp.error} />

      <Card title="Add fees to classes">
        <form action={addSchedule} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Fee head" name="fee_head_id" options={H.map((h) => [h.id, h.name] as [string, string])} />
            <Select label="How often" name="frequency" defaultValue="monthly" options={[["monthly", "Monthly (12)"], ["quarterly", "Quarterly (4)"], ["half_yearly", "Half-yearly (2)"], ["annual", "Once a year"], ["once", "One time (pick date)"]]} />
            <Input label="Amount per instalment (₹)" name="amount" type="number" step="1" min={0} required />
            <Input label="Due on day of month" name="due_day" type="number" min={1} max={28} defaultValue={10} />
            <Input label="One-time: label" name="label" placeholder="Admission fee" />
            <Input label="One-time: due date" name="once_date" type="date" />
          </div>
          <fieldset className="border-0 p-0">
            <legend className="mb-1 text-[13px] font-semibold text-ink">Classes</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-[14px]"><input type="checkbox" name="class_ids" value={c.id} /> {c.name}</label>
              ))}
            </div>
          </fieldset>
          <div><Submit>Add instalments</Submit></div>
        </form>
      </Card>

      <Card title="Fees by class">
        {P.length === 0 ? <Empty>No fees set for this session yet. Use the form above.</Empty> : (
          <div className="flex flex-col gap-4">
            {shown.map((c) => {
              const mine = P.filter((p) => p.class_id === c.id);
              const byHead = [...new Set(mine.map((p) => p.fee_head_id))];
              const total = mine.reduce((s, p) => s + Number(p.amount), 0);
              return (
                <div key={c.id} className="rounded-[10px] border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="m-0 text-[15px] font-bold text-ink">Class {c.name} <span className="font-normal text-muted">· {money(total)} / year</span></h3>
                    <form action={generateDues}><input type="hidden" name="class_id" value={c.id} /><Submit variant="secondary">Generate dues</Submit></form>
                  </div>
                  <ul className="m-0 list-none p-0 text-[14px]">
                    {byHead.map((h) => {
                      const items = mine.filter((p) => p.fee_head_id === h);
                      return (
                        <li key={h} className="flex flex-wrap items-start justify-between gap-2 border-t border-line py-2 first:border-0">
                          <div>
                            <b className="text-ink">{headName(h)}</b> · {items.length} × {money(items[0].amount)}{items.some((i) => Number(i.amount) !== Number(items[0].amount)) ? " (varies)" : ""}
                            <div className="text-[12px] text-muted">{items.slice(0, 4).map((i) => `${i.label} (${fmtDate(i.due_date)})`).join(", ")}{items.length > 4 ? "…" : ""}</div>
                          </div>
                          <form action={deletePlan}>{items.map((i) => <input key={i.id} type="hidden" name="id" value={i.id} />)}<button className="cursor-pointer border-0 bg-transparent text-[13px] text-error underline">Remove</button></form>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4"><Pagination total={withFees.length} page={page} size={size} basePath="/app/fees/structure" params={{}} sizes={CLASS_SIZES} /></div>
      </Card>

      <Card title="Fee heads">
        <ul className="m-0 mb-3 flex list-none flex-wrap gap-2 p-0">
          {H.map((h) => (
            <li key={h.id} className="flex items-center gap-1 rounded-full border border-line px-3 py-1 text-[14px]">
              {h.name}
              <form action={deleteFeeHead}><input type="hidden" name="id" value={h.id} /><button aria-label={`Remove ${h.name}`} className="cursor-pointer border-0 bg-transparent px-1 text-muted">×</button></form>
            </li>
          ))}
        </ul>
        <form action={addFeeHead} className="flex flex-wrap items-end gap-2">
          <Input label="New head" name="name" placeholder="e.g. Lab Fee" />
          <Submit variant="secondary">Add</Submit>
        </form>
      </Card>
    </div>
  );
}
