# Certificates (TC, bonafide, character, study) — original fixed layouts

> **Superseded by [documents.md](documents.md)** (templates the school edits). Kept so certificates already issued stay readable and printable; use *Documents & templates* for new ones.

> Status: Built 12 Oct 2026 (step 7) · Catalogue: `students.certificates` (view, create, print, approve) · Migration: `0009_certificates.sql` · Routes: `/app/certificates`

## Purpose
Issue numbered, printable certificates from the student record, keep every one on file, and stop a second TC being handed out without it being marked as a duplicate.

## Who uses it
| Role | Permissions |
|---|---|
| Front office, Vice Principal | view, create, print |
| Principal | everything, **only the principal can cancel** (`approve`) |
| Teachers | none |

## Screens
| Route | What's there |
|---|---|
| `/app/certificates` | Find a student then pick the type; list of issued certificates (type filter) |
| `/app/certificates/new?student=&kind=` | Form: issue date, conduct, last exam / result / promotion / date and reason of leaving / working days / remarks (TC); warnings for outstanding fees, missing DOB or parent name; "mark student transferred"; "duplicate copy" |
| `/app/certificates/[id]` | Printable certificate (school header with affiliation and UDISE, DOB in figures and words), cancel with reason, CANCELLED watermark |
| student page | Certificates card with the student's certificates and quick links |

## Database
- `student_certificates(kind transfer|bonafide|character|study, cert_no unique per school, issued_on, is_duplicate, details jsonb snapshot, status issued|cancelled, cancelled_*)`, `certificate_counters(school, kind, session)`.
- `issue_certificate(sid, stu, kind, issued_on, extra, mark_left, by)` — checks `students.certificates.create`, rejects future dates, numbers `TC/2026-27/0001` (`-D` suffix for a duplicate), snapshots name, parents, DOB, class, admission data, outstanding fees and only whitelisted extra fields; for a TC with "mark left" it sets the student to `transferred` with TC number and date (the enrolment trigger closes the class history).
- `cancel_certificate(id, reason)` — `students.certificates.approve`, reason required; the number stays on record.
- RLS: read through `can_student(... 'students.certificates.view')`; no direct insert / update / delete.

## Business rules
1. A second TC for the same student needs the "duplicate copy" tick and is numbered `-D`.
2. A certificate's content is frozen at issue: later edits to the student do not change it.
3. Outstanding fees are shown on the TC and as a warning; they do not block issue (school policy).

## Tests
`supabase/tests/certificates.test.sql` (18 checks).

## Gaps & ideas
Exact TC layout differs by board / state — adjust the wording in `src/app/app/certificates/[id]/page.tsx` to the school's printed format; Hindi text; QR-code verification; SMS to parent on issue.
