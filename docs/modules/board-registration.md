# UP Board registration (Class 9–12)

> Status: Built 12 Oct 2026 (step 6) · Catalogue: `students.board_reg` · Migration: `0008_student_compliance.sql` · Lib: `src/lib/board.ts` · Routes: `/app/board`

## Purpose
The school's own record of what it sends to the UP Board (UPMSP): Class 9 / 11 **advance registration** and Class 10 / 12 **exam application**. It prepares and verifies the data, freezes what the principal checked, tracks the board fee challan, the board reference and correction requests. **It does not submit anything to the board portal** (prereg.upmsp.edu.in / examreg.upmsp.edu.in) — staff enter the data there, then record the reference here.

## What the official notice says (verified 12 Oct 2026)
Source: UPMSP notice ref. मा०शि०प०/सिस्टम सेल/874(1-10), 09.09.2026 — <https://upmsp.edu.in/Downloads/Vigyapti_Class_09th_11th_Registration_2026-27_10092026.pdf>.
- Fee ₹50 per student; ₹40 per student by challan to the treasury, ₹10 stays in the school account. Upload on upmsp.edu.in by **30 Sep 2026**.
- Principal checks the uploaded details (name, mother / father name, DOB, gender, subject, photo) **1–4 Oct 2026**; corrections **5–8 Oct 2026** (no new students); photo nominal roll + challan copy to the District Inspector of Schools office by **15 Oct 2026**.
- APAAR ID is **not mandatory** in registration / exam forms but the Board strongly requests it, created with the parent's consent (notice ref. 801(1-7), 27.08.2026).
- The dates and fee change every year — nothing is hard-coded except as an editable default on each record.

## Who uses it
| Role | Permissions |
|---|---|
| Front office | `students.board_reg.view/create/edit` — prepare drafts, subjects, fee / challan |
| Vice Principal | view / create / edit / export |
| Principal | everything, **only the principal can check, submit or accept** (`approve`) |

## Screens
| Route | What's there |
|---|---|
| `/app/board` | Class 9–12 picker; counts (not started / draft / checked / submitted); per student: parent present, DOB present, "ready?" with what's missing, status; **start registrations for the class**, **principal: check all ready drafts**, **mark all checked as submitted**; print nominal roll; CSV |
| `/app/board/[studentId]` | Data the board will receive + readiness; start; subjects (tick + elective, board code shown); fee & challan; workflow buttons; frozen snapshot with a warning if the student's data changed after checking; history |
| `/app/board/roll?class_id=` | Printable nominal roll with subject codes, status, fee and treasury totals, signature lines |
| `/app/board/export?class_id=` | CSV (`students.board_reg.export`) |

## Database (0008)
- `student_subjects(student, session, subject, is_elective)`; board codes live in `subjects.code` (edited in Settings → Classes & subjects).
- `board_registrations(student, session, kind advance_registration|exam_application, class_level 9–12, exam_year, status, snapshot jsonb, fee_total, fee_to_treasury, fee_paid_on, challan_no/date, checked_by/at, submitted_on, board_ref, correction_note)`, unique `(student, session, kind)`.
- `board_registration_events` — written by trigger `log_board_registration` on every create / status change / fee change / reference.
- `build_board_snapshot(student, session)` — name, parents, DOB, gender, category, class, subjects with codes, APAAR / PEN, photo flag.
- Trigger `guard_board_registration`: allowed transitions `draft→checked`, `checked→draft|submitted`, `submitted→accepted|correction`, `correction→checked`; moving into those states needs `students.board_reg.approve`; **checking requires** name, father's or mother's name, DOB, gender, photograph (not rejected) and ≥ 1 subject, and freezes the snapshot; snapshot can't be edited by hand; a correction request needs the board's remark; fee / year can't change while locked.

## Business rules
1. Class names must be exactly 9, 10, 11, 12 (`boardLevel()`): 9 & 11 → advance registration, 10 & 12 → exam application.
2. Default exam year: session 2026-27 → advance registration for 2028, exam application for 2027 (editable).
3. Records are never deleted; history stays.
4. Parent name rule: either parent's name satisfies the check (single-parent / guardian families).

## Tests
`supabase/tests/student_compliance.test.sql` — draft by front office, only principal checks, missing photo / gender blocks, snapshot freeze, snapshot not editable, correction needs a note, illegal jumps refused, history.

## Gaps & ideas
Official field list for **Class 10 / 12 exam applications** was not read in full (notice ref. 10.09.2026) — verify on <https://upmsp.edu.in/> before relying on it; board-specific subject groups / combination validation; photo on the printed nominal roll (the board asks for a *photo-attached* roll — the printout here has no photos); correction deadlines per year; import board acknowledgement file.

## Update — official 2027 forms (step 8, 12 Oct 2026)
Source: UPMSP "Exam Form HS Private 2027" and "Exam Form Intermediate Private 2027" (field numbers, subject codes, combination rules). The institutional forms use the same fields.
- **Official subject codes** (`board_subject_codes`: HS 901–975 + 701–704, Intermediate 101–245) replace free-form subject picking. Subjects are stored as `student_board_subjects(slot, code)` in the order of the form's boxes (HS slots 1–6, `trade`, 7 = 944 automatic; Intermediate slots in order, 7 = 173 automatic).
- **Combination rules** are checked by `src/lib/board-rules.ts` (HS: 1st 901/902; 2nd language / English / classical; 3rd 928 or 930 for girls; 931; 932; 6th optional not repeating the 2nd language; trade). Intermediate: groups A, B, C, F1, F2, I with their counts and exclusions. `npm run test:rules` runs 29 checks. **Re-verify against the notice every year.**
- **Readiness for the principal's check** (database trigger): English and Hindi names, parent names (Hindi too), DOB, gender, category, medium, address (district / state / PIN), mobile, photograph, subjects; Intermediate also needs the subject group.
- **Board form data sheet** `/app/board/[id]/sheet`: every item numbered as on the Board's form (fields 1–37 HS, 1–40 Intermediate) with codes (sex 1/2/3, category 1–5 SC/ST/OBC/General/EWS, medium 1/2, exam type 1/2), empty items highlighted, signature lines. Aadhaar is shown in full only to the approver.
- **UPMSP user ID and centre number** are stored on the school (Settings → School profile).
- Snapshots (frozen at the principal's check) now carry Hindi names, address parts, subjects with names / codes, group, APAAR / PEN, Aadhaar last 4 only.
- Earlier-exam details (items 29–38: class 9 registration, high-school passing year / roll no. / codes, other board, ITI) are kept per student in `student_prior_exams`.
- Not covered: the special-category sections (jail inmates, army personnel, ITI-to-equivalence, agriculture part-2 details) are available only as free "Other" earlier-exam entries; they are rare for institutional candidates.
