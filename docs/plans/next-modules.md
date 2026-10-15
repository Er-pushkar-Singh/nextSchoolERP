# Plan — next modules (after step 24)

> Written 14 Oct 2026, after front office, academic setup and payroll v2. Order = value to a running school first, what unlocks other things second. Each step is one migration + tests + screens + docs, like the earlier steps.

## State of play (updated 15 Oct 2026)
Built: students, admissions (pipeline), front office, attendance (manual / QR / biometric / staff), fees, accounts (day book & vouchers), timetable & calendar, academic setup & syllabus, exams & results (offline + online), homework, **library v2, health & discipline, hostel, reports & analysis**, transport (live), staff & payroll, documents & template studio (with signature, seal, watermark, mandatory documents), settings, support.
Not built (catalogue): parent / student logins, automatic messaging, exam admit cards & datesheet, student leave, inventory & sales, UDISE+ file export (the strength table exists), backups / data export.
**Steps 28 (health & discipline), 29 (hostel) and the report half of 31 are done** — what remains of them: student leave, UDISE+ DCF file, CBSE / UP Board registration exports, scheduled summary email.

## Step 25 — Automatic messages (Communications 2.0)   · biggest visible value
Outbox + templates + worker, as designed in `docs/plans/communications.md`. New producers since that plan was written: **substitution assigned**, **gate pass released** (parent), **visitor arrived** (staff), **low attendance** weekly, **payslip ready**, **advance recovered**.
- Needs from you: MSG91 / WhatsApp Business credentials and approved template names (DLT), or we ship email + wa.me links first.
- Done when: a fee receipt, an absence and a result publish each produce exactly one message, retries work, quiet hours respected.

## Step 26 — Parent & student logins (PWA)
Data model exists (`guardians`, `student_guardians`, `students.user_id`, scopes `child` / `self`). Login by mobile OTP, one account for all children.
- Screens: child switcher, today (attendance, homework, timetable, bus on map), fees (pay online, receipts), results, notices & calendar, leave request, gate-pass request, documents.
- Reuses: parent page queries, `child_bus`, timetable, `fee` payment links.
- Done when: a parent can pay a fee, see the bus and apply leave without the secret link.

## Step 27 — Exams 2.0: datesheet, admit cards, grading, report cards
Exam schedule per class (room, date, shift, invigilator from timetable teachers), **admit cards** through the template studio (roll no., photo, QR), grade scales and co-scholastic areas (CBSE / UP Board styles), term-wise weightage, rank, report card template, marks entry lock and re-evaluation log.
- Uses: calendar (`exam` events), template studio presets, academic curriculum.

## Step 28 — Student leave & health/discipline (wellbeing)
- **Leave** (`attendance.leave`): parent applies (step 26) or office on a call; teacher approves; attendance shows `LV` automatically; notification.
- **Medical room**: visits, medicines, allergy flags on the profile, emergency contact; **discipline**: incidents, actions, parent informed; counsellor notes with restricted access.

## Step 29 — Hostel
Rooms and beds, allocation per session, hostel fee through `fee_dues.source_key` (same pattern as transport), warden attendance (roll call at night via the QR scanner), leave-out / late-entry register, visitor log for the hostel, mess menu and mess attendance.

## Step 30 — Inventory, uniform & book shop
Items with stock, purchase vouchers (post to accounts), sales to students with receipt (post to day book, optionally to the fee ledger), low-stock alerts, issue to staff / classes, asset register.

## Step 31 — Reports & compliance
UDISE+ export (DCF), student strength / category reports, CBSE LOC / UP Board registration exports, fee collection & defaulter reports by period (pivot), attendance and result analytics, **principal's dashboard** with trends, scheduled email of the daily summary.

## Step 32 — Platform hardening
Backups & data export per school (CSV / SQL), restore drill, retention policy, audit log viewer polish, rate limiting on public endpoints (kiosk, punch, driver, online admission), error reporting, load test with the scale seed (`demo_scale.sql`), SSO for groups, per-school domain polish.

## Cross-cutting items to slot in when touched
| Item | Where |
|---|---|
| Voucher print + bill attachments | Accounts (with step 31) |
| Form 16 / TDS, ECR file, arrears | Payroll (after step 31) |
| Timetable subject list from curriculum; exam subjects from curriculum | Academics / Exams (step 27) |
| ZKTeco ADMS push protocol for biometric | Attendance (when a school buys a machine) |
| Pre-registered visitor QR pass | Front office (with step 26) |
| Staff attendance → payroll prefill is automatic; **half-day leave** in payroll | Payroll |

## Suggested sequence
`25 messages → 26 parent login → 27 exams 2.0 → 28 leave & wellbeing → 31 reports → 29 hostel → 30 inventory → 32 hardening`
Steps 29 and 30 are plan-gated (Premium) and only needed by some schools, so they can move later or be sold as add-ons.
