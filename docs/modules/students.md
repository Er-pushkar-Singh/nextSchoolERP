# Students

> Status: Built · Catalogue: `students.profile`, `students.import`, `students.promotion`, `students.parent_link` (built); `students.sensitive`, `students.certificates` (not yet) · Migration: `0001_erp.sql`

## Purpose
The student register: admission, profile, class/section, parents' contacts, status, and the hub that links fees, attendance, transport, library and the parent page.

## Who uses it
Principal, Vice Principal, Front office (create), Class teacher (`assigned` view/edit of own section), Accountant (view).

## Screens
| Route | What's there |
|---|---|
| `/app/students` | Search (name, adm. no., father, phone), class filter, status tabs (active / left / passed out), paging |
| `/app/students/new` | Admission form (`StudentForm`); `?enquiry=<id>` pre-fills from an enquiry and marks it admitted |
| `/app/students/import` | CSV import from Excel; columns `admission_no, first_name, last_name, class, section, roll_no, gender, dob, father_name, mother_name, guardian_phone, address`; row-level error report |
| `/app/students/[id]` | Profile: stats (dues, overdue, attendance %), **parent page link** (copy / WhatsApp / reset), transport & library cards, fee ledger, receipts, concessions (add / remove / apply to dues), edit form, status (left / passed out) |

## Server actions
`src/app/app/_actions/students.ts`: `saveStudent` (auto admission no. via `next_school_number(sid,'admission')`), `setStudentStatus`, `newPortalLink` (new `portal_token`), `addConcession`, `applyConcessions`, `removeConcession`, `importStudents`.

## Database
`students` (admission_no, names, gender, dob, class_id, section_id, roll_no, father/mother, guardian_phone (WhatsApp), alt_phone, email, address, category, blood_group, status `active|left|passed_out`, `portal_token` (32 hex), `user_id` for a future student login). RLS: read `can_student(…'students.profile.view')`, edit scope-aware. Triggers: `guard_student_insert` (plan student limit, read-only state), `students_updated_at`.

## Business rules
1. Admission numbers are per-school sequences with a prefix (`schools.admission_prefix`, `next_admission_no`).
2. Active students ≤ plan `student_limit`.
3. The parent link token is secret; resetting it kills the old link.

## Connects to
Fees (dues, receipts, concessions), Attendance, Exams (marks, report cards), Admissions (enquiry → admit), Transport (allocation), Library (issues), Homework (by class/section), parent page.

## Tests
`permissions.test.sql` (scopes on students).

## Gaps & ideas
Transfer / leaving certificate and bonafide certificate (`students.certificates`), sensitive fields (Aadhaar, medical) behind `students.sensitive`, photo upload (Cloudinary exists), sibling linking, ID cards, bulk section/roll-number assignment.
