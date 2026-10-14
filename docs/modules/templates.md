# Template studio (visual designer for every printable)

> Status: Built (step 16, 13 Oct 2026) · Catalogue: `documents.templates.*` (view / create / edit / delete) · Migration: `0018_template_designer.sql` · Routes: `/app/templates`, `/app/documents/templates/[id]/design`, classic list `/app/documents/templates`

## Purpose
One place to design and manage every printed thing the school produces — ID cards, certificates, letters, admit cards, library / bus cards, fee receipts, demand notices, statements — with a drag-and-drop canvas (move, resize, rotate, text, shapes, lines, images, photo and logo slots, fields from the school's records), live preview with sample data, versions and a gallery of ready-made designs per module.

## Pieces
| Piece | File | What it does |
|---|---|---|
| Canvas model, compiler, gallery, registry | `src/lib/design.ts` | `Design` JSON (page mm, items), `normalizeDesign()` (clamps / validates anything from the browser), `compileDesign()` (design → absolutely positioned HTML in mm), `withSample()` (previews), `PRESETS` (starter designs), `TEMPLATE_MODULES` (module registry) |
| Designer | `src/components/TemplateDesigner.tsx` | Client canvas: select / multi-select, move, 8-handle resize, rotate, snap to grid and page edges / centre, zoom, undo / redo (60 steps), layers (hide / lock / reorder), align, duplicate, keyboard (Del, Ctrl+Z/Y/D/A, arrows), fields palette, page size & background, **preview with sample data** |
| Studio hub | `src/app/app/templates/page.tsx` | Per module: the school's templates (thumbnails), gallery designs ("Use this design"), planned kinds, blank canvas |
| Save / create | `src/app/app/_actions/templates.ts` | `saveDesign` (HTML is compiled **on the server** from the design JSON, then sanitised), `useDesign` (gallery → new template, or replaces a standard fee template's layout), `newBlankDesign` |
| Storage | `document_templates.design jsonb`, `.module`, `.preset`; `document_template_versions.design` | The canvas is the editable source; `body_html` is what the database renders (placeholders, escaping, sanitising are unchanged) |

## Rules
1. **The design JSON is the source; HTML is derived.** Never trust HTML sent from the browser; `saveDesign` recompiles.
2. Everything is in millimetres; text sizes in points; only `https` image links; colours are validated; limits: 200 items, 30–300 mm pages.
3. Placeholders are `{{group.key}}` (list in `src/lib/documents.ts` → `PLACEHOLDERS`); `{{student.photo}}` and `{{school.logo}}` are slots (photo / logo items); `{{fee.*_html}}` insert server-built tables (only keys starting `fee.` and ending `_html` are inserted raw).
4. A template written as HTML has no canvas; "Design visually" starts blank and the old HTML stays in the version history.
5. Fee templates (`category = 'fees'`) are edited here too; their data builders are in the database (`fee_template_data`, `render_fee_document`).
6. Printing a card: page size comes from the design (A4 / A5 / card mm); the existing Documents issue / bulk screens print them unchanged.

## Adding templates for a new module (do this when a module is built)
1. Add the module (or new kinds) to `TEMPLATE_MODULES` in `src/lib/design.ts` with `ready: true` once the data builder exists.
2. Supply the data: a SQL function that returns the jsonb passed to `render_document(body, data)` (see `document_data()` for students / staff, `fee_template_data()` for fees) — HTML-escaped by the renderer; list the new keys in `PLACEHOLDERS` (`src/lib/documents.ts`) and `SAMPLE` (`src/lib/design.ts`).
3. Add one or more starter designs to `PRESETS` (a `build()` returning a `Design`; use `target` to apply to a standard template of the module).
4. Add a print / issue screen that calls the renderer and shows `sanitizeHtml(html)`.
5. Tests: `scripts/test-rules.mjs` already compiles every preset; add SQL checks for the data builder.

## Tests
`scripts/test-rules.mjs` (design compile / escaping / clamping / page mapping, all presets), `supabase/tests/designer.test.sql` (storage, versions with design, sanitising, permissions).

## Gaps & ideas
Upload images (today: https links), barcode element (a QR block exists: attendance code), curved text, tables as an element, custom fonts, multi-page documents, copy / paste between templates, template sharing between branches of a group, admission offer letter and payslip data builders (listed as "coming" in the studio).
