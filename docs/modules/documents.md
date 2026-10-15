# Documents & templates (TC, bonafide, ID cards, letters …)

> Status: Built 12 Oct 2026 (step 9) · Catalogue: `documents.templates` (view, create, edit, delete), `documents.issue` (view, create, print, approve, export) · Migration: `0011_online_admission_documents.sql` · Routes: `/app/documents`

## Purpose
Every document the school hands out comes from a **template the school controls**: TC, bonafide, character, study, no-dues, admission letter, student and staff ID cards, experience certificate — and any new type the school creates. A template is edited once; every issued document is a numbered, frozen copy made from it. This module replaces the fixed layouts of the step-7 certificates (those stay available under *Old-format certificates*).

## Who uses it
| Role | Permissions |
|---|---|
| Principal | everything (only the principal / approvers can **cancel** a document) |
| Vice Principal | templates view / create / edit; issue view / create / print / export |
| Front office, Office admin | templates view; issue view / create / print |
| Teachers | none |

## Screens
| Route | What's there |
|---|---|
| `/app/documents` | Stats; find a student or staff member → one-click issue with any template; issued list (number, template, person, status, filters) |
| `/app/documents/templates` | All templates (type, audience, size, number prefix, version, on / off); *Add missing standard templates*; new template |
| `/app/documents/templates/[id]` | Editor: settings, **questions asked at issue**, HTML layout, placeholder palette (click to copy), live **preview with a real student / staff member**, **version history with restore**, delete (custom ones only) |
| `/app/documents/issue?template=&student=|staff=` | The form at issue time: date, template questions (required ones enforced), "mark transferred" for a TC, "duplicate copy" for one-per-person templates, warnings for fee dues / missing DOB or parent |
| `/app/documents/[id]` | The issued document, printable at its page / card size; CANCELLED watermark; cancel with reason |
| `/app/documents/bulk` | ID cards (or any non-one-per-person template) for a class / section / all staff in one click, then a print sheet (cards flow on A4) |
| student page | "Documents issued (templates)" card with quick-issue links |

## How a template works
- **Layout** is plain HTML with inline styles; placeholders look like `{{student.name}}`, `{{school.name}}`, `{{doc.no}}`, `{{extra.reason}}` (full list in the editor; built in `src/lib/documents.ts`). `{{student.photo}}` and `{{school.logo}}` become pictures.
- **Questions**: `key|Label|text|required` per line; answers appear as `{{extra.key}}`.
- **Page**: A4 / A5 / card (width × height in mm), portrait / landscape; a card template prints several to a page.
- **Numbering**: `<prefix>/<session>/<0001>`, `-D` suffix for duplicates; counters per template and session.
- **On issue**: nothing, or *mark the student transferred* (TC): sets status, leaving date, reason, TC number and closes the class history.
- **One per person**: a second document needs "duplicate copy"; bulk issue is refused for these.
- **Validity**: `valid_days`, otherwise ID cards are valid until the session end.

## Database (0011)
`document_templates` (+ `document_template_versions` written by trigger on every layout / question change), `issued_documents` (**html snapshot**, data snapshot, template version, status, cancellation).
- `render_document(body, data)` — the only renderer (SQL), HTML-escapes every value; `document_data()` builds the data from the school's records (never from the browser); only fields the template declares (plus a few standard ones) are accepted from the form.
- `issue_document()`, `issue_documents_bulk()`, `preview_document()`, `cancel_issued_document()`, `seed_document_templates()`; new schools get the standard set by trigger.
- `sanitize_template_html()` on every save (scripts, iframes, forms, event handlers, `javascript:` removed); the app strips again with an allow-list (`src/lib/html-sanitize.ts`) before showing anything.
- RLS: templates readable with templates.view or issue.view/create; written by create / edit / delete; issued documents readable with issue.view, written only through the functions.

## School branding, watermark and mandatory documents (15 Oct 2026, migration `0031`)
- **Settings → Documents** (`/app/settings/documents`): upload the **principal's signature** and the **school seal** (PNG / JPG / WebP ≤ 330 KB, checked by file signature), choose a **watermark** (logo or seal, opacity), and see the **mandatory documents** checklist (marksheet, report card, result certificate, TC, bonafide, character, DOB, migration, admit card, student / staff ID, fee receipt) with *Add from gallery* for what is missing.
- Placeholders `{{school.signature}}` and `{{school.seal}}` and the designer's **Signature** / **Seal** items fill from `school_branding` at print time (stored as validated data URIs, so they print everywhere).
- Every printed page goes through `DocSheet`, which draws the watermark as a real element, so it survives printing.
- **Photos at print time**: the app inlines photographs as data URIs (≤ 30 per page, else 1-hour signed links), the global print stylesheet forces exact colours / images, and **Print** waits until every image has loaded.
- Exam documents (marksheet, report card, result certificate) take their data from declared results: `{{exam.*}}` fields, `exam.subjects_html`, and the "exam" question type at issue.

## Business rules
1. An issued document never changes: later template edits or student edits do not touch it; cancel and re-issue instead.
2. Teachers cannot see templates or documents; other schools see nothing.
3. Standard templates can be switched off or edited, not deleted.
4. Photographs stay private: the printed page gets a 10-minute signed link, nothing is stored in the document.

## Tests
`supabase/tests/online_documents.test.sql` (templates, rendering, escaping, sanitising, versions, issue rules, duplicate / TC, bulk, staff documents, cancellation, isolation) and `npm run test:rules` (HTML sanitiser).

## Gaps & ideas
Visual (drag-and-drop) template editor, QR code / barcode on ID cards, Hindi templates set, admit cards from exam data, mail-merge letters to a whole class, e-signature of the principal as an image, SMS / WhatsApp the document link to the parent.

## Verification QR and barcodes (15 Oct 2026, migration `0041`)
- `{{doc.verify_qr}}` (designer: "Verification QR") prints a QR with the link `/verify/<document id>`. The public page shows whether the document is **genuine or cancelled**, the number, dates, the student's photo and details as printed, the exam result with marks (marksheets / report cards) and the student's current record. Every marksheet, report card, result, bonafide, DOB, migration certificate and admit card in the gallery carries it.
- `{{student.barcode}}` / `{{staff.barcode}}` print the attendance barcode.
- **Transfer Certificate rule**: no TC (template studio or the old certificate screen) while fees are pending — `issue_document` / `issue_certificate` call `_tc_fee_gate`. Fee settings choose "every fee" (default) or "every instalment due till today". The issue screen shows the clearance (fees, library books, school property, hostel bed) and disables Issue until fees are clear.
