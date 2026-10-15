# Academic setup

> Status: Built (step 23) · Catalogue: `academics.setup`, `academics.allocation`, `academics.syllabus` (+ `academics.timetable`, see timetable.md) · Migration: `0025_academics_v2.sql` · Older screen: Settings → Classes, subjects & sessions (sessions, classes, sections, subjects, seats, promotion)

## Purpose
Everything that says how the school's academic year is organised: which subjects each class studies and how many periods, who is class teacher / subject teacher of each section (this drives the "assigned" permissions everywhere), section capacity and room, and syllabus coverage per class and subject.

## Screens
| Route | What's there |
|---|---|
| `/app/academics` | Counters (sections, without class teacher, subjects not staffed, over capacity) and the sections table (students / capacity, class teacher, subjects staffed, room) |
| `/app/academics/curriculum` | Per class: tick the subjects, periods a week, optional flag |
| `/app/academics/allocation` | Per section: class teacher, capacity, room, and a teacher for every subject of the class |
| `/app/academics/syllabus` | Coverage by class and subject (done / topics, %), per subject: add topics (one per line), set status, planned date, **verify** completed topics, remove; copy the syllabus to a new session |

## Database (`0025_academics_v2.sql`)
- `class_subjects(class, subject, periods_per_week, is_optional)`, `syllabus_units(session, class, subject, no, title, term, planned_on, status pending|in_progress|done, completed_on, verified_by_name / verified_at, updated_by_name)`; `sections.capacity`, `sections.room`.
- Functions: `academic_overview`, `set_class_teacher`, `set_subject_teacher` (both maintain `staff_assignments` and `sections.class_teacher_id`; one class teacher, one teacher per subject), `syllabus_progress`, `verify_syllabus_unit`, `copy_syllabus`, `can_syllabus`.
- RLS: curriculum readable by every member, written with `academics.setup.edit`; syllabus: school scope sees all, `assigned` scope only the classes / subjects the teacher is allocated to (`can_syllabus`).
- Trigger `syllabus_unit_guard`: stamps who changed it, sets / clears the completion date from the status, and removes the verification when the status or title changes.

## Rules
1. A teacher can only be allocated if they have a login in this school.
2. Verification needs `academics.syllabus.approve` and only applies to completed topics.
3. Copying a syllabus never duplicates a topic with the same class, subject and title; everything starts pending.

## Tests
`supabase/tests/academics_v2.test.sql` (19 checks).

## Gaps & ideas
Weekly lesson plans with homework link, syllabus completion shown to parents, curriculum drives the timetable's subject list and exam subjects, house system, subject groups / streams for Class 11–12, auto-roll of allocation into the next session.

## Refinements (step 25)
- Curriculum: **+ Add subject** per class (pick an existing subject or create a new one by name, with periods a week and optional flag).
