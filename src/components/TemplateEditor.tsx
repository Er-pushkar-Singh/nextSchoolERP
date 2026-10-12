import { Card, Input, Select, Submit } from "@/components/ui/ui";
import { CopyButton } from "@/components/CopyButton";
import { AUDIENCES, CATEGORIES, PLACEHOLDERS, fieldsToText, type TemplateField } from "@/lib/documents";
import { deleteTemplate, saveTemplate } from "@/app/app/_actions/documents";

export type Tpl = {
  id?: string; code?: string; name?: string; category?: string; audience?: string; body_html?: string; page_size?: string; orientation?: string;
  card_width_mm?: number | null; card_height_mm?: number | null; numbering_prefix?: string; on_issue?: string; one_per_student?: boolean; valid_days?: number | null;
  fields?: TemplateField[]; active?: boolean; is_system?: boolean;
};

export function TemplateEditor({ t, canEdit, canDelete }: { t: Tpl; canEdit: boolean; canDelete: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <form action={saveTemplate} className="flex flex-col gap-5">
        {t.id && <input type="hidden" name="id" value={t.id} />}
        <fieldset disabled={!canEdit} className="m-0 flex flex-col gap-5 border-0 p-0">
          <Card title="Settings" icon="settings">
            <div className="grid gap-3 sm:grid-cols-4">
              <Input label="Template name" name="name" required defaultValue={t.name} className="sm:col-span-2" />
              {!t.id && <Input label="Code" name="code" placeholder="fee_clearance" hint="Letters, numbers, underscore — fixed after creation" />}
              <Select label="Type" name="category" defaultValue={t.category ?? "certificate"} options={CATEGORIES} />
              <Select label="Issued to" name="audience" defaultValue={t.audience ?? "student"} options={AUDIENCES} />
              <Select label="Page" name="page_size" defaultValue={t.page_size ?? "A4"} options={[["A4", "A4"], ["A5", "A5"], ["card", "Card (set size)"]]} />
              <Select label="Orientation" name="orientation" defaultValue={t.orientation ?? "portrait"} options={[["portrait", "Portrait"], ["landscape", "Landscape"]]} />
              <Input label="Card width (mm)" name="card_width_mm" type="number" min={30} max={300} defaultValue={t.card_width_mm} hint="86 for a standard card" />
              <Input label="Card height (mm)" name="card_height_mm" type="number" min={30} max={300} defaultValue={t.card_height_mm} hint="54 for a standard card" />
              <Input label="Number prefix" name="numbering_prefix" defaultValue={t.numbering_prefix ?? "DOC"} hint="e.g. TC → TC/2026-27/0001" />
              <Input label="Valid for (days)" name="valid_days" type="number" min={1} defaultValue={t.valid_days} hint="Blank: ID cards → session end" />
              <Select label="When issued" name="on_issue" defaultValue={t.on_issue ?? "none"} options={[["none", "Nothing else"], ["mark_transferred", "Mark the student transferred (TC)"]]} />
              <label className="flex items-center gap-2 pt-6 text-[14px] text-ink"><input type="checkbox" name="one_per_student" value="1" defaultChecked={t.one_per_student} className="h-4 w-4" /> One per person (a second needs “duplicate”)</label>
              <Select label="Status" name="active" defaultValue={t.active === false ? "0" : "1"} options={[["1", "On"], ["0", "Off"]]} />
            </div>
          </Card>
          <Card title="Questions asked when issuing" icon="notifications" description="One per line: key|Label|text, date or number|required — the answer is available as {{extra.key}}.">
            <textarea name="fields_text" rows={4} defaultValue={fieldsToText(t.fields ?? [])} className="input font-mono text-[13px]" placeholder={"reason|Reason for leaving|text|required\nleft_on|Date of leaving|date"} />
          </Card>
          <Card title="Layout (HTML)" icon="layers" description="Plain HTML with inline styles. Scripts and forms are removed. Insert fields as {{student.name}}; images {{student.photo}} and {{school.logo}} become pictures.">
            <textarea name="body_html" rows={22} required defaultValue={t.body_html} spellCheck={false} className="input font-mono text-[12.5px] leading-5" />
          </Card>
        </fieldset>
        {canEdit && <div className="flex flex-wrap gap-3"><Submit>{t.id ? "Save template" : "Create template"}</Submit></div>}
      </form>

      <Card title="Fields you can use" icon="school" description="Click to copy a placeholder, then paste it into the layout.">
        <div className="flex flex-col gap-3">
          {PLACEHOLDERS.map((g) => (
            <div key={g.group}>
              <p className="m-0 mb-1 text-[13px] font-bold text-ink">{g.group}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map(([k, label]) => <span key={k} className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-[12px]" title={label}><code>{`{{${k}}}`}</code><CopyButton text={`{{${k}}}`} label="copy" /></span>)}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {t.id && canDelete && !t.is_system && (
        <form action={deleteTemplate}><input type="hidden" name="id" value={t.id} /><button className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-error underline">Delete this template</button></form>
      )}
    </div>
  );
}
