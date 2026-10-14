# Roadmap

What exists, what is only a permission in the catalogue, and a suggested order. Update this whenever something ships.

## Built (12 Oct 2026)

Platform & SaaS: Super Admin, tenants, plans, GST invoices, Razorpay links, support sessions, audit, groups, domains, announcements, support desk, integrations.
School: Dashboard, Students (+ CSV import, promotion, parent link), Admissions enquiries, Attendance (students), Exams & report cards, Fees (structure → dues → collection → receipts → defaulters), Notices, Settings centre, Roles & permissions, **Homework & material, Transport, Staff & payroll, Library** (step 5 — the Standard plan is now complete).
Parent page: fees + UPI, receipts, attendance, results, homework, material, transport, library, notices.

## In the catalogue but not built

| Catalogue code | Name | Plan that sells it | Notes |
|---|---|---|---|
| `accounts.vouchers`, `accounts.books` | Accounts (income / expense vouchers, day book, ledger) | Premium | Fee receipts and salaries could post automatically |
| `hostel.rooms`, `hostel.allocation` | Hostel | Premium | Rooms / beds, allocation, hostel fee via `fee_dues.source_key` like transport |
| `inventory.items`, `inventory.sales` | Inventory & sales | Premium | Uniform / books shop, stock, sale receipts |
| `wellbeing.medical`, `wellbeing.discipline` | Health & discipline | Premium | Medical visits, incidents |
| `academics.timetable` | Timetable | all | Periods, teacher clash check, substitution |
| `academics.syllabus` | Syllabus / lesson plan | all | Coverage tracking, approve |
| `attendance.staff` | Staff attendance | all | Feeds payroll LOP |
| `attendance.leave` | Student leave requests | all | From parent page / parent login |
| `exams.admit_cards` | Admit cards | all | Printable, roll numbers |
| `frontdesk.visitors` | Visitor log | all | |
| `comms.templates`, `comms.calendar`, `comms.messages` | Message templates, school calendar, parent–teacher messages | all | |
| `transport.tracking` | Live bus tracking | Standard+ | Needs a driver app or GPS vendor |
| `reports.udise` | UDISE+ export | all | |
| `settings.backups` | Backups | core | |

Also not built: parent / student **logins** (data model ready: `guardians`, `student_guardians`, `students.user_id`), automatic SMS / WhatsApp / email sending on events (integrations + preferences exist, senders only used for tests).

## Done in step 9
Online admission form (public, with tracking), Documents & templates (editable templates, versioned, issue / bulk / cancel, ID cards).

## Done in step 10
Fees 2.0 — online payment (school's own Razorpay + webhook receipts), refunds, cheques, late fine rule, concession approvals, advance wallet, split payments, day close, reports, arrears carry-forward.

## Done in step 11
Admissions pipeline dashboard, follow-ups, offer validity + lapse, waitlist promotion, bulk marks / merit list, offer letter, CSV; fees sibling discount, promise-to-pay, copy structure, split instalment, outstanding report, daily fine job; demo seed data.

## Next module — planned
**Communications 2.0** (automatic SMS / WhatsApp / email via an outbox and daily jobs): see [plans/communications.md](plans/communications.md).

## Done in step 12
Student and staff management at scale — database-side search / filters / sort / pagination, CSV export, block (ban) and unblock incl. real login shut-off, safe delete, bulk actions.

## Done in step 13
Admission as one guided flow: enquiry → details → documents → test → decision → admission fee → class & section, with gates, one file and one timeline.

## Done in step 14
Student / board 404 fix (ambiguous embed), fee templates (receipt, demand notice, statement), payment methods (cash, debit / credit card, others, gateway, payment links), payment-link register.

## Done in step 16
Template studio: Canva-style designer for ID cards, certificates, receipts and letters; per-module gallery and registry.

## Done in step 18
Transport live tracking (driver page, parent map, office map, trips) and database-side lists for vehicles, riders, routes.

## Done in step 19
Modern attendance: QR scan (camera / USB), gate kiosk, biometric & RFID endpoint + CSV import, staff check-in by location, staff attendance day/month, low-attendance report, QR cards and a QR block for ID cards.

## Suggested order (updated)
1. **Accounts** (next)  2. Automatic SMS / WhatsApp on events (fee reminders, receipts, absence)  3. Timetable + calendar  5. Hostel / inventory / health  6. Parent & student logins (PWA), admit cards (a template + exam data), UDISE+ export

## Earlier order (kept for reference) (highest value for Indian schools first)

1. **Online fee payment** (`fees.online`) — parents pay on the parent page, receipt is created automatically. Biggest money impact; most pieces exist.
2. **Automatic messages** — absent alert, fee receipt, fee reminder, result published by SMS / WhatsApp using the saved integrations and notification preferences.
3. ~~Certificates~~ — done in step 7.
4. ~~Staff attendance~~ — done in step 19 (suggested unpaid days; auto-posting to payroll still manual).
5. **Timetable** (+ substitution) and **School calendar / holidays**.
6. **Accounts** (vouchers, day book, fee & salary auto-posting) — completes Premium.
7. **Hostel**, **Inventory & sales**, **Health & discipline** — rest of Premium.
8. **Parent / student login + mobile PWA**, admit cards, online admission form, UDISE export.

## Compliance status (12 Oct 2026 audit, then step 6)

Done (step 8 added end-to-end admissions, UPMSP 2027 subject codes + rules, Aadhaar (encrypted), board data sheet): enrolment history, protected identity / health tier (PEN, APAAR + consent), private documents with verification and a "pending" state, guardians / emergency / pickup, structured address and previous school, UP Board Class 9-12 registration records, audit coverage + masking, student-edit policy fix, DOB / PIN / phone / email validation.

Still open:
- **UDISE+ export and validation**: needs the official 2026-27 student DCF (not retrieved; confirm on udiseplus.gov.in) before mapping fields.
- **Class 10 / 12 exam-application field list**: read the 10.09.2026 UPMSP notice in full and compare with `board_registrations`.
- Parent-link expiry / OTP; encrypt staff PAN / bank (only masked in the audit log so far); period-wise attendance; subject-combination rules per board; consent / correction screens beyond the audit trail; retention and deletion policy; 
- The live database still needs `setup.sql` applied (see the ops list below).

## Ops to do before selling widely

- Put the project under **git** (snapshots are only `.tgz` files today).
- Apply `setup.sql` (includes the 12 Oct 2026 security fix) to the production Supabase project, then click-test every module.
- Dashboard widgets for step-5 modules; README screenshots / user guide for schools.
