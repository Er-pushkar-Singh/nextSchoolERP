# Admissions (enquiry → application → admitted student)

> Status: Built — enquiries (step 1) and the full application pipeline (12 Oct 2026, step 8) · Catalogue: `frontdesk.enquiries`, `frontdesk.admissions` (view, create, edit, approve, export) · Migration: `0010_admissions.sql`

## Purpose
Take a child from first enquiry to a fully-created student record without re-typing: application with every detail the school and the UP Board ask for, documents (with "pending" allowed), entrance test / interview, principal's decision, waitlist, RTE, seats and age checks, application fee, and one-click **Admit** that creates the student, class history, documents, contacts and fee dues.

## Who uses it
| Role | Permissions |
|---|---|
| Front office | enquiries all; applications `view / create / edit / export` |
| Vice Principal | applications `view / create / edit / approve / export` |
| Principal | everything (only approvers can approve, waitlist, reject and **admit**) |
| Accountant | enquiries view |

## Flow
```
Enquiry (new → contacted → visited → test)            /app/admissions
   └─ "Start application"                              /app/admissions/applications/new?enquiry=
Application  submitted → under_review → test_scheduled → approved ─┐
                              └──────────→ waitlisted (numbered) ──┤→ ADMIT → student + enrolment + dues
                              └──────────→ rejected (reason)  /  cancelled
```
Transitions are enforced by the database trigger `guard_application`; `admitted` can only be reached through `admit_application()`.

## Screens
| Route | What's there |
|---|---|
| `/app/admissions` | Enquiry pipeline (unchanged); each enquiry links to *Start application* |
| `/app/admissions/applications` | Funnel (enquiries → applications → approved → admitted, conversion), seats per class (seats, students now, approved-not-admitted, free, waitlisted), filters, list |
| `…/applications/new` | The full form: class applied, source, RTE flag / reference; student (English + Hindi names, DOB, gender, category, religion, caste, BPL, medium, mobile…), parents (+ Hindi names), address (street, village, post office, tehsil, district, state, PIN, rural/urban, distance), previous school, up to 4 contacts (primary / emergency / pickup), one earlier exam, restricted tier (PEN, APAAR, Aadhaar with consent, health, disability) |
| `…/applications/[id]` | Summary and age / seat warnings; **documents** (upload, verify / reject with reason, mark pending with a date, not applicable); test & interview; application fee; decision; **Admit** (class / section / roll / admission no. / date); history |
| `…/applications/[id]/print` | Printable application form with photo box, declaration, signature lines, and a cut-off acknowledgement slip |
| Settings → Classes & sessions | Seats and min / max age per class (age counted on the session start date) |

## Database (0010)
`admission_applications(application_no APP/2026-27/0001, session, class applied, enquiry, status, applicant_name / father / phone (list), form jsonb, rte_applicant, rte_reference, test_*, interview_*, waitlist_no, decision_*, fee_*, student_id, admitted_on)`; `application_documents` (same fields as student documents; private files under `<school>/applications/<id>/`); `admission_application_events` (trigger-written history).
Functions: `create_application()` (numbering, duplicate guard, enquiry progress), `admit_application()` (copies profile, restricted tier, contacts, earlier exams, documents; bills dues through the internal `bill_student_dues()`; links enquiry; closes the application), `admission_seats()`.
`form` keys are the `students` column names (+ `contacts[]`, `prior[]`, PEN / APAAR / health keys, `aadhaar_enc` ciphertext), so the application is a draft student.

## Business rules
1. Only the principal-level approver approves / waitlists / rejects / admits; rejection needs a reason; a test needs a date.
2. A missing document never blocks admission — it is recorded as pending and moves to the student.
3. Same name + DOB + father in the same session is refused unless the form says it's a different child.
4. Age and seat limits **warn**, they never block (the principal decides).
5. Admit is atomic: if the student limit of the plan is reached the whole admit rolls back with a clear message.
6. The applicant's phone and form contents are not written to the audit log.

## Tests
`supabase/tests/admissions.test.sql` (40 checks).

## Gaps & ideas
Online admission form for parents (`frontdesk.online_form`), SMS / WhatsApp on each status change, application fee through Razorpay, sibling discount rules, interview slots calendar, merit list ranking, bulk admit of approved applicants, entrance-test question paper module.

## Online admission form (step 9, 12 Oct 2026)
Parents fill the application themselves at `/apply/<school code>` — no login — and it lands in *Admission applications* marked **Online** (status *Received*), with its documents attached.
- **Staff setup**: `/app/admissions/online` — open / close, which classes, last date, welcome text, instructions, fee note, ask for documents, shareable link + WhatsApp share. Permission `frontdesk.online_form.view / edit`.
- **Parent side**: `/apply/<code>` (form with Hindi names, address, previous school, one extra contact, optional uploads of photo / birth certificate / marksheet / TC / address proof), `/apply/<code>/done` (application number), `/apply/<code>/track` (status by application number + the mobile number given: status message, test / interview date, waitlist number, documents received / pending).
- **Safeguards**: honeypot field, minimum fill time, 5 forms per hour per network, 4 per day per mobile, same name + DOB + father refused, school must be open / writable, class must be open; all through `public_create_application()` which only the server's secret key can call. **Aadhaar and the restricted tier are not asked online.**
- **Not included**: online payment of the application fee (record it at the desk), SMS / e-mail to the parent on each status change.

## Admissions add-ons (step 11, 12 Oct 2026) — migration `0013_admissions_fees_addons.sql`
| Route | What's there |
|---|---|
| `/app/admissions/pipeline` | Funnel by stage, source-wise conversion, average days to decision, seats per class with **Promote waitlist**, approved offers with validity and **Cancel expired offers**, follow-ups due, admission settings (offer days, automatic sibling discount) |
| `/app/admissions/followups` | Open / completed follow-ups for applications **and** enquiries: channel, outcome, "Done + next" booking, WhatsApp link, add new |
| `/app/admissions/applications/test-sheet?class_id=` | Marks for every applicant of a class in one go, **merit ranking**, tick rows and move them to under review / approved / waitlisted / rejected in bulk (failures reported per row) |
| `/app/admissions/applications/export` | CSV of the filtered list |
| `/app/admissions/applications/[id]/offer` | Printable **offer letter** (class, validity, fees payable, documents to bring) |
| application page | sibling-in-school notice, offer validity banner, follow-ups card, "fees the family will be asked to pay" (from the class fee structure) |

Rules: approval stamps `offer_valid_till` = today + `admission_settings.offer_days`; an expired offer is cancelled by `lapse_expired_offers()` (principal) and the seat is released; `promote_waitlist()` approves waitlisted applicants in waitlist order while seats are free; siblings are matched by parent phone or father + mother name (`student_siblings`, `application_siblings`); at **Admit**, `bill_student_dues()` first applies the school's sibling discount (Fees → Fee settings) so the new dues already carry it.
Tables: `admission_settings`, `application_followups`; `admission_applications.offer_valid_till`. Tests: `supabase/tests/addons.test.sql`.
