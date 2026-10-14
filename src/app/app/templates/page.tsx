import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit } from "@/components/ui/ui";
import { DesignThumb, dimsOf } from "@/components/DesignThumb";
import { PRESETS, TEMPLATE_MODULES, compileDesign } from "@/lib/design";
import { newBlankDesign, useDesign } from "../_actions/templates";

type T = { id: string; code: string; name: string; category: string; audience: string; module: string | null; body_html: string; page_size: string; orientation: string;
  card_width_mm: number | null; card_height_mm: number | null; design: { w?: number; h?: number } | null; active: boolean; version: number; is_system: boolean };

const moduleOf = (t: T) => t.module ?? (t.category === "fees" ? "fees" : t.audience === "staff" ? "staff" : "students");

export default async function TemplateStudio({ searchParams }: { searchParams: Promise<{ module?: string; ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("documents.templates.view");
  const sp = await searchParams;
  const { data } = await supabase.from("document_templates")
    .select("id,code,name,category,audience,module,body_html,page_size,orientation,card_width_mm,card_height_mm,design,active,version,is_system").eq("school_id", school.id).order("name");
  const all = (data ?? []) as T[];
  const canCreate = can("documents.templates.create");
  const canEdit = can("documents.templates.edit");
  const mods = TEMPLATE_MODULES.filter((m) => !sp.module || m.module === sp.module);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon="academics" title="Template studio" subtitle="Design ID cards, certificates, receipts and letters visually — every module's templates in one place"
        actions={<Link href="/app/documents/templates" className="btn btn-sm btn-secondary">Classic list</Link>} />
      <Flash ok={sp.ok} error={sp.error} />

      <nav className="flex flex-wrap gap-2 text-[14px]" aria-label="Module">
        <Link href="/app/templates" className={`chip ${!sp.module ? "!border-ink" : ""}`}>All modules</Link>
        {TEMPLATE_MODULES.map((m) => <Link key={m.module} href={`/app/templates?module=${m.module}`} className={`chip ${sp.module === m.module ? "!border-ink" : ""}`}>{m.name}</Link>)}
      </nav>

      {canCreate && (
        <Card title="Start from a blank canvas" icon="layers">
          <form action={newBlankDesign} className="flex flex-wrap items-end gap-3">
            <Input label="Name" name="name" placeholder="e.g. Sports day pass" />
            <Select label="Size" name="size_hint" options={[["210x297", "A4 portrait"], ["297x210", "A4 landscape"], ["148x210", "A5 portrait"], ["86x54", "ID card landscape"], ["54x86", "ID card portrait"]]} />
            <Select label="For" name="audience" options={[["student", "Students"], ["staff", "Staff"]]} />
            <BlankSize />
            <Submit>Open the designer</Submit>
          </form>
        </Card>
      )}

      {mods.map((m) => {
        const mine = all.filter((t) => moduleOf(t) === m.module);
        const presets = PRESETS.filter((p) => p.module === m.module);
        return (
          <section key={m.module} className="flex flex-col gap-3">
            <h2 className="m-0 text-[18px] font-extrabold text-ink">{m.name}</h2>
            {mine.length > 0 && (
              <div className="flex flex-wrap gap-4">
                {mine.map((t) => {
                  const d = dimsOf(t);
                  return (
                    <article key={t.id} className="flex w-[216px] flex-col gap-2 rounded-[14px] border border-line bg-white p-2 shadow-[var(--shadow-card)]">
                      <DesignThumb html={t.body_html} w={d.w} h={d.h} />
                      <div className="px-1">
                        <p className="m-0 text-[14px] font-bold text-ink">{t.name}</p>
                        <p className="m-0 text-[12px] text-muted">{d.w}×{d.h} mm · v{t.version} {!t.active && <Badge value="cancelled" text="off" />} {t.design ? "" : "· HTML"}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[13px]">
                          {canEdit && <Link href={`/app/documents/templates/${t.id}/design${t.design ? "" : "?start=1"}`} className="font-semibold">Design</Link>}
                          <Link href={`/app/documents/templates/${t.id}`}>Settings</Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {presets.length > 0 && (
              <>
                <p className="m-0 text-[13px] font-semibold text-muted">Gallery — ready-made designs</p>
                <div className="flex flex-wrap gap-4">
                  {presets.map((p) => {
                    const dsn = p.build();
                    return (
                      <article key={p.key} className="flex w-[216px] flex-col gap-2 rounded-[14px] border border-dashed border-line-strong bg-white/70 p-2">
                        <DesignThumb html={compileDesign(dsn)} w={dsn.w} h={dsn.h} />
                        <div className="px-1">
                          <p className="m-0 text-[14px] font-bold text-ink">{p.name}</p>
                          <p className="m-0 text-[12px] text-muted">{p.description}</p>
                          {canCreate && (
                            <form action={useDesign} className="mt-2"><input type="hidden" name="preset" value={p.key} />
                              <button className="btn btn-sm btn-primary cursor-pointer border-0">{p.target ? "Apply to my template" : "Use this design"}</button></form>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
            <div className="flex flex-wrap gap-2 text-[12px] text-muted">
              {m.kinds.filter((k) => !k.ready).map((k) => <span key={k.key} className="rounded-full border border-line px-2 py-0.5" title={k.note}>Coming: {k.name}</span>)}
            </div>
          </section>
        );
      })}
      {school.name && <p className="m-0 text-[12px] text-muted">Every new module registers what it can print here, with its fields and starter designs (see docs/modules/templates.md).</p>}
    </div>
  );
}

function BlankSize() {
  return (
    <>
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Width (mm)<input name="w" type="number" min={30} max={300} placeholder="auto" className="input !min-h-10 !w-24 !py-2 text-[15px] font-normal" /></label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">Height (mm)<input name="h" type="number" min={30} max={300} placeholder="auto" className="input !min-h-10 !w-24 !py-2 text-[15px] font-normal" /></label>
    </>
  );
}
