# Timetable & school calendar

> Status: Built (step 21) · Catalogue: `academics.timetable`, `comms.calendar` · Migration: `0023_timetable_calendar.sql`

## Purpose
A weekly timetable per class-section built on a bell schedule, a per-teacher view, a **cover board** that lists periods whose teacher is on leave or absent and proposes only genuinely free teachers, a workload report, and a school calendar (holidays, vacations, exams, PTM, events) that also reduces the working days used for staff attendance / payroll.

## Screens
| Route | What's there | Needs |
|---|---|---|
| `/app/timetable` | Section picker; grid days × periods with subject / teacher / room per cell; save all; copy a day to other days; print | view; edit to change |
| `/app/timetable/teacher` | Weekly grid of one teacher (default: me), free periods, cover duty in the next 14 days; print | view |
| `/app/timetable/cover` | Pick a date: periods needing cover, free-teacher dropdown (lightest day first), assign / remove | view; edit to assign |
| `/app/timetable/load` | Periods per week, sections, subjects and busiest day per teacher | edit |
| `/app/timetable/periods` | Bell schedule: name, times, break flag, add / remove | edit |
| `/app/calendar` | Month grid (Mon first), colour by type, filter, list, add / edit / delete, coming up | `comms.calendar.*` |

## Database
- Tables: `periods(no, name, start/end, is_break)`, `timetable_slots(section, day 1–7, period, subject, staff, room)` with `unique(section, day, period)` and **`unique(staff, day, period)`** (a teacher can't be in two places), `substitutions(slot, on_date, substitute)`, `school_events(kind holiday|vacation|exam|ptm|event|other, start/end ≤ 120 days)`.
- Functions: `ensure_timetable_defaults` (8 periods + lunch), `set_slot` (friendly clash message, empty cell deletes), `copy_day`, `free_staff`, `cover_needed`, `save_substitution`, `remove_substitution`, `teacher_load`, `holiday_on`; `staff_attendance_month` now excludes holidays / vacations from working days.
- RLS: slots readable with `academics.timetable.view` (scope `assigned` → own sections via `can_section`) or by the teacher themself; writes only through the functions; calendar read needs `comms.calendar.view` (every role), write `create/edit/delete` at school scope.

## Rules
1. A teacher cannot teach two sections in the same period (database constraint; the app reports the clash and saves the other cells).
2. Breaks take no classes; deleting a period removes its cells.
3. Cover is needed when the teacher has approved (non-half-day) leave or is marked `A`/`LV` in staff attendance; the substitute must not have a class, another cover or leave/absence in that period; the date must be the period's weekday within −7…+60 days.
4. Holidays and vacations are excluded from working days in `staff_attendance_month`; the attendance page shows a banner on such days but never blocks marking.

## Tests
`supabase/tests/timetable.test.sql` (26 checks).

## Gaps & ideas
Parent page / parent login timetable, timetable per student's optional subjects, auto-generation (constraint solver), lab / room clashes, exam datesheet from the calendar, notices from calendar events, ICS export, substitutions notifying the teacher by WhatsApp.
