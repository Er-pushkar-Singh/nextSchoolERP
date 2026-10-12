# Exams & results

> Status: Built · Catalogue: `exams.setup`, `exams.marks`, `exams.results` (built); `exams.admit_cards` (not yet) · Migration: `0001_erp.sql`, RLS in `0003`

## Purpose
Set up exams, enter marks fast, and print CBSE-style cumulative report cards with grades and class rank; publish results to parents.

## Who uses it
Exam coordinator / VP (setup), Subject teacher (`assigned` marks for own subject + section), Class teacher (results view/print), Principal (publish, approve changes after publish).

## Screens
| Route | What's there |
|---|---|
| `/app/exams` | Exams of the current session; create |
| `/app/exams/[id]` | Subjects + max marks per class (bulk: classes × subjects), publish / unpublish, delete |
| `/app/exams/[id]/marks` | Marks grid per class/section; blank = not entered, `AB` = absent; invalid values rejected |
| `/app/exams/[id]/report` | Printable cumulative report cards (all exams of the session so far), grade per subject and overall, rank in class |

## Server actions
`src/app/app/_actions/academics.ts`: `createExam, togglePublish, deleteExam, setExamSubjects, removeExamSubject, saveMarks`. Results maths: `classResults()` in `src/lib/results.ts`; grades `gradeFor()` in `src/lib/erp.ts` using `schools.grade_scale` (default A1 91+ … E).

## Database
`exams(session_id, name, start_date, sort, published)`, `exam_subjects(exam_id, class_id, subject_id, max_marks)`, `marks(exam_id, student_id, subject_id, marks, absent)`. `marks_writable()` — teacher's scope + subject, and **after publishing only `exams.marks.approve` can change marks**.

## Connects to
Parent page (published exams only), student profile.

## Tests
`permissions.test.sql` (subject teacher limited to own subject/section).

## Gaps & ideas
Admit cards (`exams.admit_cards`), co-scholastic grades and remarks, attendance on report card, term weighting (CBSE term 1/2), exam timetable, result analysis per subject/teacher, SMS/WhatsApp on publish.
