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

## Exams v2 (steps 27–28, migrations `0029_exam_results.sql`, `0030_online_exams.sql`)

### Offline exams — refined
- **Date sheet and pass marks** per class-subject (`exam_subjects.exam_date / start_time / end_time / room / pass_marks`); printable date sheet on the exam page; copy subjects from another exam.
- **Marks entry progress** per class (`exam_marks_progress`): entered / expected, absentees, missing. **Lock / unlock** per class (`exam_class_status.marks_locked`); a trigger (`marks_lock_guard`) refuses writes to a locked class.
- **Declare result** (one button for the whole exam or per class; `declare_exam_result`): refuses when marks are missing unless "declare anyway"; stores total, max, percent, grade (school grade scale), rank (competition rank by total) and pass / fail (each subject ≥ pass mark, default 33%; absent counts as fail) in `exam_results`, locks the class. **Withdraw** reopens it; **withhold / release** per student (survives re-declaration); teacher **remark** per student.
- **Result sheet** `/app/exams/[id]/results`: filter class / result / search, pagination, CSV; **report cards** show Result, Percentage, Grade, Rank, remark, and "result withheld"; an "not declared" banner while undeclared. Publishing to parents is still the separate "Publish" switch.

### Online exams (computer-based)
- **Question bank** `/app/exams/questions`: class + subject, single / multiple answers / true-false, marks, negative marks, difficulty, chapter, explanation; filters, paging, add / edit modal, switch off, **paste import** (`question | A | B | C | D | correct | marks | difficulty | chapter`).
- **Online exam** `/app/exams/online[/id]`: fixed paper (picked from the bank) or **random draw** of N questions per student from a pool (chapter / difficulty); duration, window (opens / closes, India time), shuffle questions and options, negative marking, pass %, exam code, tab-switch limit, full-screen requirement, result display (immediately / after declaration / never), answer review; optional link to an offline exam so **declaring pushes the scaled score into its marks** (absentees AB).
- **Student side** `/exam` and `/exam/<token>`: sign in with school code (not needed from the link), **admission number + date of birth**; one device at a time; server clock (remaining time comes from the database); questions and options shuffled on the server; **answer key never sent to the browser**; answers saved one by one; auto-submit at the deadline; tab switch / window blur / full-screen exit are logged and **end the attempt** beyond the limit; copy, paste, right-click and common shortcuts blocked; 8 wrong sign-ins lock the admission number / address for 15 minutes; session cookie is httpOnly + SameSite strict, only its hash is stored.
- **Monitoring**: attempts list (writing now, switches, flagged), auto-refresh while live, CSV; close exam submits running attempts; declare result.
- Student functions are `service_role` only (`exam_login`, `exam_start`, `exam_state`, `exam_answer`, `exam_event`, `exam_submit`, `exam_result`); the browser talks to `/api/exam`.
- Tests: `exam_results.test.sql` (17 checks), `online_exams.test.sql` (33 checks).
- Gaps: short-answer / essay questions with manual marking, images in questions, question-level analytics, proctoring by camera, re-attempt by teacher, student logins (step 26 of the plan) instead of DOB.
