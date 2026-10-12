# Students

> Status: Built · Catalogue: `students.profile`, `students.import`, `students.promotion`, `students.parent_link`, `students.sensitive`, `students.documents`, `students.board_reg`, `students.certificates` (built) · Migrations: `0001_erp.sql`, `0008_student_compliance.sql`, `0009_certificates.sql`

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

## Step 6 additions (12 Oct 2026 — from the compliance audit)

**New student fields** (`students`): `middle_name, application_no, admission_category (general|rte|staff_ward|sibling|other), admission_class_id, previous_school / board / class, permanent_address, district, block_tehsil, pincode (6 digits), state, locality_type (rural|urban), mother_tongue, nationality, distance_km, left_on, left_reason, tc_no, tc_issued_on`. Status is now `active | left | transferred | withdrawn | passed_out`. The legacy free-text `transport_route` and `notes` are gone from the form (notes moved to the protected tier; real transport is the Transport module).
*Demographic fields are optional columns; whether the current UDISE+ DCF requires each of them is still to be confirmed against the 2026-27 DCF.*

**Protected tier** `student_sensitive` (needs `students.sensitive.view/edit`): `pen, apaar_id (12 digits, unique per school), apaar_status, apaar_consent (+ by, on), identity_verified_on, identity_note, allergies, medical_conditions, medication, disability, accommodations, doctor_*, internal_notes`. **Aadhaar is deliberately not stored.** Roles: Principal (all), Vice Principal & Front office (view + edit), Class teacher (view, own section).

**Documents** `student_documents` + private storage bucket `student-docs` (`src/lib/student-docs.ts`, `_actions/student-records.ts`): 12 types + other; PDF / JPG / PNG by magic bytes, photo up to 1 MB (JPG/PNG), others up to 5 MB; status `pending` (promised by a date, never blocks admission) / `uploaded` / `verified` / `rejected` (reason required) / `not_applicable`; uploader, verifier and times stamped; download only through `/app/students/[id]/documents/[docId]` (permission check, 60-second signed URL, logged).

**Contacts**: guardians / emergency / pickup persons via SQL functions `add_student_contact` / `remove_student_contact` (one primary per student; the primary phone becomes the WhatsApp number; emergency and pickup contacts need a phone). `guardians` are readable only through a child the user may see.

**Enrolment history** `student_enrolments`: one row per spell in a class (session, class and section names snapshotted, roll no., outcome `continuing|promoted|detained|passed_out|left|transferred|withdrawn|changed`). Kept by a trigger on `students`. `promote_students(sid, detain[])` records `promoted`, supports **holding students back**, refuses to run inside the same session (switch to the new session first) and refuses to run twice. Report cards are built from this history (`exams/[id]/report`), so promoted / left students keep their cards.

**Safety fixes**: students can be edited only with `students.profile.edit` for that student (parent-link / promotion permissions no longer grant it); the parent link changes only through `reset_portal_token()` (needs `students.parent_link.edit`) and is shown only with `students.parent_link.view`; DOB must give an age of 2 to 30; a class / section with students can't be deleted; the audit log now covers marks, fee dues, enquiries, guardians, enrolments, sensitive data, documents and board records, with contact / address / health values masked.

**CSV import** accepts the new columns (middle name, alt phone, email, permanent address, city, district, block, PIN, state, category, mother tongue, previous school / class).
**Certificates**: see [certificates.md](certificates.md).

**Step 8 (admissions & board forms)**: Hindi names, student mobile, street / post office, religion, caste, medium, BPL, previous-year marks / days, class seats and age limits; `student_prior_exams`; Aadhaar stored **encrypted** (AES-256-GCM via `SETTINGS_ENCRYPTION_KEY`, consent required, Verhoeff-checked, last 4 shown) in the restricted tier; disability type / %; the student form is now `StudentFields` (shared with the application form).

**Student page** now has: photograph, Identity & health card, Documents, Guardians & emergency contacts, Class history, and a status form with TC details.

## Gaps & ideas
Sibling linking, ID cards, bulk section / roll-number assignment, parent-link expiry or OTP, UDISE+ export (needs the current-year DCF, see `docs/roadmap.md`).
