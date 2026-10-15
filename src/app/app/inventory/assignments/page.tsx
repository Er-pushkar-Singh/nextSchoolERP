import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, PageHeader, Select, Table, td } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageParams } from "@/components/ui/Pagination";
import { AssignForm, ReturnForm, TransferForm } from "@/components/inventory/AssetForms";
import { ASSET_STATUS, HOLDER, loadAssignables } from "@/lib/inventory";
import { fmtDate, money } from "@/lib/format";

type Row = { id: string; item_id: string; item_name: string; category: string; qty: number; tag: string | null; holder_kind: string; holder_id: string | null; holder_name: string; holder_sub: string | null;
  assigned_on: string; due_back: string | null; days_overdue: number; status: string; returned_on: string | null; return_condition: string | null; note: string | null; return_note: string | null;
  assigned_by_name: string | null; returned_by_name: string | null; charge: number | null; total: number };
const STATES: [string, string][] = [["active", "With people & rooms"], ["overdue", "Overdue"], ["closed", "Returned"], ["problem", "Damaged / lost / repair"], ["all", "Everything"]];

export default async function Assignments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, school, can } = await requirePerm("inventory.assign.view", "inventory.items.view");
  const sp = await searchParams;
  const { page, size, offset } = pageParams(sp);
  const state = STATES.some(([k]) => k === sp.state) ? sp.state! : "active";
  const holder = ["location", "staff", "student", "department"].includes(sp.holder ?? "") ? sp.holder! : null;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const id = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);
  const item = id(sp.item), staff = id(sp.staff), student = id(sp.student);
  const [{ data }, forms] = await Promise.all([
    supabase.rpc("inventory_assignment_list", { sid: school.id, p_state: state, p_holder: holder, p_q: q || null, p_item: item, p_staff: staff, p_student: student, p_limit: size, p_offset: offset }),
    loadAssignables(supabase, school.id),
  ]);
  const R = (data ?? []) as Row[];
  const total = R[0] ? Number(R[0].total) : 0;
  const params = { state: state === "active" ? undefined : state, holder: holder ?? undefined, q: q || undefined, item: item ?? undefined, staff: staff ?? undefined, student: student ?? undefined };
  const qs = new URLSearchParams(Object.entries({ ...params, page: page > 1 ? String(page) : undefined, size: size !== 25 ? String(size) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
  const back = `/app/inventory/assignments${qs ? `?${qs}` : ""}`;
  const edit = can("inventory.assign.edit");
  const tab = (k: string) => `/app/inventory/assignments?${new URLSearchParams(Object.entries({ state: k === "active" ? undefined : k, holder: holder ?? undefined }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="layers" title="Given out" subtitle="Who and which room holds what — give, take back, move" back={{ href: "/app/inventory", label: "Inventory" }}
        actions={can("inventory.assign.create") ? <Modal label="+ Give an item" title="Give school property" size="lg"><AssignForm items={forms.items} locations={forms.locations} back={back} presetItem={item} /></Modal> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <nav className="flex flex-wrap gap-1.5" aria-label="Show">
        {STATES.map(([k, t]) => <Link key={k} href={tab(k)} className={`rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold no-underline ${state === k ? "border-ink bg-ink text-white" : "border-line bg-white text-body"}`}>{t}</Link>)}
      </nav>
      <form className="flex flex-wrap items-end gap-2">
        {state !== "active" && <input type="hidden" name="state" value={state} />}
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Search
          <input name="q" defaultValue={q} placeholder="Item, tag, room, person, admission no." className="input !min-h-10 w-64 !py-2 text-[15px] font-normal" /></label>
        <Select label="Held by" name="holder" blank="Anyone" defaultValue={holder} options={[["location", "Rooms"], ["staff", "Staff"], ["student", "Students"], ["department", "Departments"]]} />
        <button className="btn btn-sm btn-secondary cursor-pointer">Show</button>
        {(q || holder || item || staff || student) && <Link href={tab(state)} className="pb-2 text-[14px]">Clear</Link>}
      </form>
      {R.length ? (
        <Table head={["Item", "Held by", "Since", "Return by", "Status", ""]} minWidth={980}>
          {R.map((r) => {
            const [tone, text] = ASSET_STATUS[r.status] ?? ASSET_STATUS.active;
            const who = r.holder_kind === "student" && r.holder_id ? <Link href={`/app/students/${r.holder_id}`} className="font-semibold">{r.holder_name}</Link>
              : r.holder_kind === "location" && r.holder_id ? <Link href={`/app/inventory/rooms/${r.holder_id}`} className="font-semibold">{r.holder_name}</Link>
              : <b className="text-ink">{r.holder_name}</b>;
            return (
              <tr key={r.id} className={r.status === "active" ? "" : "opacity-75"}>
                <td className={td}><b className="text-ink">{r.qty} × {r.item_name}</b><div className="text-[12px] text-muted">{[r.category, r.tag && `tag ${r.tag}`].filter(Boolean).join(" · ")}</div>
                  {r.note && <div className="text-[12px] text-muted">{r.note}</div>}</td>
                <td className={td}>{who}<div className="text-[12px] text-muted">{HOLDER[r.holder_kind]}{r.holder_sub ? ` · ${r.holder_sub}` : ""}</div></td>
                <td className={td}>{fmtDate(r.assigned_on)}<div className="text-[12px] text-muted">{r.assigned_by_name}</div></td>
                <td className={td}>{r.due_back ? <>{fmtDate(r.due_back)}{r.days_overdue > 0 && <div><Badge value="overdue" text={`${r.days_overdue} day${r.days_overdue === 1 ? "" : "s"} late`} /></div>}</> : <span className="text-muted">—</span>}</td>
                <td className={td}><Badge value={tone} text={text} />
                  {r.returned_on && <div className="mt-1 text-[12px] text-muted">{fmtDate(r.returned_on)}{r.returned_by_name ? ` · ${r.returned_by_name}` : ""}{r.return_note ? ` · ${r.return_note}` : ""}</div>}
                  {r.charge ? <div className="text-[12px] font-semibold text-error">charged {money(r.charge)}</div> : null}</td>
                <td className={`${td} whitespace-nowrap text-[13px]`}>
                  {r.status === "active" && edit && (
                    <div className="flex flex-col items-start gap-1">
                      <Modal label="Take back" variant="link" title={`Take back — ${r.item_name}`} size="sm"><ReturnForm id={r.id} qty={r.qty} holderKind={r.holder_kind} back={back} /></Modal>
                      <Modal label="Move" variant="link" title={`Move ${r.qty} × ${r.item_name}`}><TransferForm id={r.id} locations={forms.locations} back={back} /></Modal>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty>{state === "overdue" ? "Nothing is overdue." : "Nothing here yet."}</Empty>}
      <Pagination total={total} page={page} size={size} basePath="/app/inventory/assignments" params={params} />
      {sp.give === "1" && item && can("inventory.assign.create") && (
        <Modal defaultOpen closeHref={back} title="Give school property" size="lg"><AssignForm items={forms.items} locations={forms.locations} back={back} presetItem={item} /></Modal>
      )}
    </div>
  );
}
