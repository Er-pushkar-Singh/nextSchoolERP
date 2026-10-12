# Homework & study material

> Status: Built 12 Oct 2026 (step 5) · Catalogue: `homework.homework`, `homework.material` · Plans: Standard, Premium, Trial · Migration: `0007_standard_modules.sql`

## Purpose
Teachers post daily homework and share study material (Drive / YouTube / PDF links) for a class or a section; parents see it on their page; one tap copies it for the class WhatsApp group.

## Who uses it
| Role | Permissions (scope) |
|---|---|
| Class teacher, Subject teacher | `homework.homework.*`, `homework.material.*` (**assigned**) |
| Vice Principal | view (school) |
| Principal | everything |
| Parent / Student (future logins) | view (child / self) |

## Screens
`/app/homework?kind=homework|material` — tabs (if both allowed); form (class + section or "All sections", subject, date given, title, submit-by date for homework, details, link); filter by class/section; cards with due badge, **Copy for WhatsApp group**, edit (`?edit=<id>`), delete. Teachers with assigned scope only see their own sections / subjects in the form.

## Server actions
`src/app/app/_actions/homework.ts`: `saveHomework` (create / edit; permission chosen from `kind`), `deleteHomework`.

## Database
`homework(school_id, session_id, kind 'homework'|'material', class_id, section_id null = all sections, subject_id, title, details, link_url (http/https only), assigned_on, due_on ≥ assigned_on, created_by, created_by_name)`.
- RLS uses `can_class_item(school_id, 'homework.' || kind || '.<action>', class_id, section_id, subject_id)`.
- `guard_class_section` trigger: the section must belong to the class.

## Business rules
1. Assigned teachers can post only for sections (and subjects) in their `staff_assignments`; posting to "All sections" requires being assigned to every section of the class.
2. Parents see their child's section items plus whole-class items, current session only; homework from the last 14 days or not yet due; all material.

## Connects to
Parent page; Settings → Staff & access (assignments decide what teachers can post).

## Tests
`standard_modules.test.sql` — teacher limited to own section & subject, can't post to whole class, parent sees own section + class material, other school sees nothing.

## Gaps & ideas
File upload (Cloudinary) instead of only links, submissions / checking by teachers, homework diary print per class per day, push to WhatsApp group via API, timetable-aware subject list, lesson plans / syllabus (`academics.syllabus`).
