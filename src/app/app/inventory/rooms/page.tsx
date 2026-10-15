import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { getClasses } from "@/lib/erp";
import { money } from "@/lib/format";
import { createClassRooms } from "../../_actions/inventory";
import { LocationForm } from "@/components/inventory/LocationForm";

type Loc = { id: string; name: string; kind: string; class_name: string | null; section_name: string | null; building: string | null; in_charge: string | null; active: boolean; kinds: number; units: number; value: number };
const KINDS: [string, string][] = [["classroom", "Classroom"], ["lab", "Lab"], ["office", "Office"], ["library", "Library"], ["staffroom", "Staff room"], ["hostel", "Hostel"], ["ground", "Ground / sports"], ["store", "Store"], ["other", "Other"]];

export default async function Rooms({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; q?: string }> }) {
  const { supabase, school, can } = await requirePerm("inventory.assign.view", "inventory.items.view");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 40);
  const [{ data }, classes] = await Promise.all([supabase.rpc("inventory_location_summary", { sid: school.id }), getClasses(supabase, school.id)]);
  const L = ((data ?? []) as Loc[]).filter((l) => !q || `${l.name} ${l.class_name ?? ""} ${l.building ?? ""}`.toLowerCase().includes(q));
  const cls = classes.map((c) => [c.id, `Class ${c.name}`] as [string, string]);
  const secs = classes.flatMap((c) => c.sections.map((s) => [s.id, `${c.name}-${s.name}`] as [string, string]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="school" title="Rooms & places" subtitle="Classrooms, labs and offices — and what is installed in each" back={{ href: "/app/inventory", label: "Inventory" }}
        actions={can("inventory.items.create") ? <>
          <form action={createClassRooms}><button className="btn btn-sm btn-secondary cursor-pointer">Create a classroom for every section</button></form>
          <Modal label="+ Add room" title="Add a room / place"><LocationForm classes={cls} sections={secs} back="/app/inventory/rooms" /></Modal>
        </> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Find a room" aria-label="Find a room" className="input !min-h-10 max-w-xs !py-2" /><button className="btn btn-sm btn-secondary cursor-pointer">Find</button></form>
      {L.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {L.map((l) => (
            <Link key={l.id} href={`/app/inventory/rooms/${l.id}`} className={`flex flex-col gap-1 rounded-[14px] border bg-white p-4 no-underline shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-blue ${l.active ? "border-line" : "border-dashed border-line-strong opacity-70"}`}>
              <span className="flex items-start justify-between gap-2"><b className="text-[16px] text-ink">{l.name}</b><Badge value="normal" text={KINDS.find(([k]) => k === l.kind)?.[1] ?? l.kind} /></span>
              <span className="text-[12.5px] text-muted">{[l.class_name && `Class ${l.class_name}${l.section_name ? `-${l.section_name}` : ""}`, l.building, l.in_charge && `in-charge ${l.in_charge}`].filter(Boolean).join(" · ") || "—"}</span>
              <span className="mt-2 flex items-baseline justify-between text-[14px]"><span><b className="text-[20px] text-ink">{l.units}</b> <span className="text-muted">units · {l.kinds} kinds</span></span><span className="text-muted">{money(l.value)}</span></span>
            </Link>
          ))}
        </div>
      ) : <Empty>{q ? "No room matches." : "No rooms yet — create a classroom for every section in one click, then add labs and offices."}</Empty>}
    </div>
  );
}
