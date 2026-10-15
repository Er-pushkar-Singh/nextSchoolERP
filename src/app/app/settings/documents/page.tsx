import Link from "next/link";
import { requirePerm } from "@/lib/school";
import { Badge, Card, Flash, Input, PageHeader, Select, Submit, Table, td } from "@/components/ui/ui";
import { getBranding } from "@/lib/branding";
import { MANDATORY_DOCS } from "@/lib/documents";
import { presetByKey } from "@/lib/design";
import { DocSheet } from "@/components/DocSheet";
import { saveWatermark, uploadBrandAsset } from "../../_actions/branding";
import { useDesign } from "../../_actions/templates";
import { seedTemplates } from "../../_actions/documents";

type T = { id: string; code: string; name: string; active: boolean; preset: string | null };

export default async function DocumentSettings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, can } = await requirePerm("settings.school.view");
  const sp = await searchParams;
  const edit = can("settings.school.edit");
  const [b, { data: tpls }] = await Promise.all([
    getBranding(supabase, school.id),
    supabase.from("document_templates").select("id,code,name,active,preset").eq("school_id", school.id),
  ]);
  const T = (tpls ?? []) as T[];
  const find = (d: (typeof MANDATORY_DOCS)[number]) => T.find((t) => (t.preset && d.presets?.includes(t.preset)) || d.codes?.includes(t.code) || (d.presets ?? []).some((p) => t.code.startsWith(p)));
  const ready = MANDATORY_DOCS.filter((d) => find(d)?.active).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="settings" title="Documents & branding" subtitle="Principal's signature, school seal, watermark and the mandatory documents" back={{ href: "/app/settings", label: "Settings centre" }} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Principal's signature" description="Printed on certificates, marksheets and report cards wherever the template has a signature block. Use a PNG with a transparent background.">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-24 w-48 items-center justify-center rounded-lg border border-dashed border-line bg-white p-2">
              {b.signature /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={b.signature} alt="Principal's signature" className="max-h-full max-w-full object-contain" /> : <span className="text-[13px] text-muted">Not uploaded</span>}
            </div>
            {edit && (
              <form action={uploadBrandAsset} className="flex flex-col gap-2">
                <input type="hidden" name="kind" value="signature" />
                <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-[13px]" />
                <div className="flex gap-2"><Submit variant="secondary">Upload signature</Submit></div>
              </form>
            )}
          </div>
          {edit && b.signature && <form action={uploadBrandAsset} className="mt-2"><input type="hidden" name="kind" value="signature" /><input type="hidden" name="remove" value="1" /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove signature</button></form>}
          <p className="mt-3 mb-0 text-[12px] text-muted">Principal&apos;s name comes from <Link href="/app/settings/school">School profile</Link> ({school.principal_name ?? "not set"}).</p>
        </Card>

        <Card title="School seal / stamp" description="Optional round seal printed near the signature.">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-dashed border-line bg-white p-2">
              {b.seal /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={b.seal} alt="School seal" className="max-h-full max-w-full object-contain" /> : <span className="text-[13px] text-muted">None</span>}
            </div>
            {edit && (
              <form action={uploadBrandAsset} className="flex flex-col gap-2">
                <input type="hidden" name="kind" value="seal" />
                <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-[13px]" />
                <div><Submit variant="secondary">Upload seal</Submit></div>
              </form>
            )}
          </div>
          {edit && b.seal && <form action={uploadBrandAsset} className="mt-2"><input type="hidden" name="kind" value="seal" /><input type="hidden" name="remove" value="1" /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Remove seal</button></form>}
        </Card>
      </div>

      <Card title="Watermark" description="A faint mark behind the content of printed certificates, marksheets, report cards and letters (not on ID cards).">
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={saveWatermark} className="grid gap-3 sm:grid-cols-2">
            <fieldset disabled={!edit} className="contents">
              <Select label="Watermark" name="watermark_mode" defaultValue={b.watermark_mode} options={[["logo", "School logo"], ["text", "Text (e.g. school name)"], ["none", "None"]]} />
              <Input label="Opacity (3–30 %)" name="watermark_opacity" type="number" min={3} max={30} defaultValue={b.watermark_opacity} />
              <Input label="Text (for the text watermark)" name="watermark_text" defaultValue={b.watermark_text ?? ""} placeholder={school.name} className="sm:col-span-2" />
            </fieldset>
            {edit && <div className="sm:col-span-2"><Submit>Save watermark</Submit></div>}
          </form>
          <DocSheet branding={b} logoUrl={school.logo_url} schoolName={school.name} className="min-h-[170px] rounded-lg border border-line bg-white">
            <div className="p-4 text-[13px] text-body">
              <b className="block text-[15px] text-ink">{school.name}</b>
              This is how a printed page looks: your text sits on top of the watermark. {b.signature /* eslint-disable-next-line @next/next/no-img-element */ ? <img src={b.signature} alt="" className="mt-2 block h-10" /> : null}
            </div>
          </DocSheet>
        </div>
        {!school.logo_url && b.watermark_mode === "logo" && <p className="mt-3 mb-0 text-[13px] text-[#b45309]">No school logo is set, so no watermark will print. Upload the logo in School profile or choose a text watermark.</p>}
      </Card>

      <Card title={`Mandatory documents — ${ready} of ${MANDATORY_DOCS.length} ready`} description="Every school needs these. Add the ones that are missing from the gallery, then adjust them in the template studio.">
        <Table head={["Document", "Why", "Status", ""]} minWidth={760}>
          {MANDATORY_DOCS.map((d) => {
            const t = find(d);
            const preset = d.presets?.[0] ? presetByKey(d.presets[0]) : null;
            return (
              <tr key={d.key}>
                <td className={td}><b className="text-ink">{d.name}</b></td>
                <td className={`${td} text-[13px] text-muted`}>{d.why}</td>
                <td className={td}>{t ? (t.active ? <Badge value="paid" text="Ready" /> : <Badge value="due" text="Switched off" />) : <Badge value="overdue" text="Missing" />}</td>
                <td className={`${td} text-[13px]`}>
                  <div className="flex flex-wrap items-center gap-3">
                    {t && <Link href={`/app/documents/templates/${t.id}/design`}>Open design</Link>}
                    {t && <Link href={`/app/documents/templates/${t.id}`}>Settings</Link>}
                    {!t && preset && can("documents.templates.create") && (
                      <form action={useDesign}><input type="hidden" name="preset" value={preset.key} /><button className="btn btn-sm btn-primary cursor-pointer border-0">Add from gallery</button></form>
                    )}
                    {!t && !preset && can("documents.templates.create") && (
                      <form action={seedTemplates}><button className="btn btn-sm btn-secondary cursor-pointer">Add the standard set</button></form>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
        <p className="mt-3 mb-0 text-[12px] text-muted">Marksheet and report card need the result to be <b>declared</b> first (Exams → exam → Declare result). Issue them from Documents → Issue a document.</p>
      </Card>
    </div>
  );
}
