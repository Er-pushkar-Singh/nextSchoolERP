# Attendance (students)

> Status: Built · Catalogue: `attendance.students` (built); `attendance.leave` (student leave), `attendance.staff` (not yet) · Migration: `0001_erp.sql`

## Purpose
Daily class attendance on a phone in under a minute, with same-day WhatsApp alerts to parents of absent students.

## Who uses it
Class teacher (`assigned` create/edit for own section), Principal / VP (school).

## Screens
| Route | What's there |
|---|---|
| `/app/attendance` | Pick class/section/date → mobile grid: **P / A / L (late) / H (half day) / LV (leave)**, "All present"; which sections are marked today; after saving, a `WaQueue` of WhatsApp messages for absent students ("Send to next →") |
| `/app/attendance/register` | Printable monthly register per section |

## Server actions
`saveAttendance` in `src/app/app/_actions/academics.ts` — upsert on `(student_id, date)`; refuses future dates.

## Database
`attendance(student_id, class_id, section_id, date, status, marked_by, marked_at)`, unique `(student_id, date)`. RLS: read `can_student(…'attendance.students.view')`, write `can_section(…'attendance.students.create', section)`. `attendance_summary(sid, day)`.

## Business rules
Present for % = P, L, H. One mark per student per day (re-saving overwrites).

## Connects to
Dashboard, student profile %, parent page (session %), recent absences.

## Gaps & ideas
Student leave requests from parents (`attendance.leave`), **staff attendance** (`attendance.staff`) feeding payroll LOP, automatic SMS/WhatsApp via integrations, holiday calendar, low-attendance report.
