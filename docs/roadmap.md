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
| `students.certificates`, `students.sensitive` | TC / bonafide / character certificates; Aadhaar & medical fields | all | TC is a very common request |
| `fees.online`, `fees.refunds` | Online fee payment, refunds | all | School's own Razorpay keys already storable; needs webhook → `collect_fee` |
| `frontdesk.admissions`, `frontdesk.online_form`, `frontdesk.visitors` | Admission approval, public admission form, visitor log | all | |
| `comms.templates`, `comms.calendar`, `comms.messages` | Message templates, school calendar, parent–teacher messages | all | |
| `transport.tracking` | Live bus tracking | Standard+ | Needs a driver app or GPS vendor |
| `reports.udise` | UDISE+ export | all | |
| `settings.backups` | Backups | core | |

Also not built: parent / student **logins** (data model ready: `guardians`, `student_guardians`, `students.user_id`), automatic SMS / WhatsApp / email sending on events (integrations + preferences exist, senders only used for tests).

## Suggested order (highest value for Indian schools first)

1. **Online fee payment** (`fees.online`) — parents pay on the parent page, receipt is created automatically. Biggest money impact; most pieces exist.
2. **Automatic messages** — absent alert, fee receipt, fee reminder, result published by SMS / WhatsApp using the saved integrations and notification preferences.
3. **Certificates** — Transfer certificate, bonafide, character certificate (printable, numbered).
4. **Staff attendance** → feeds payroll unpaid days.
5. **Timetable** (+ substitution) and **School calendar / holidays**.
6. **Accounts** (vouchers, day book, fee & salary auto-posting) — completes Premium.
7. **Hostel**, **Inventory & sales**, **Health & discipline** — rest of Premium.
8. **Parent / student login + mobile PWA**, admit cards, online admission form, UDISE export.

## Ops to do before selling widely

- Put the project under **git** (snapshots are only `.tgz` files today).
- Apply `setup.sql` (includes the 12 Oct 2026 security fix) to the production Supabase project, then click-test every module.
- Dashboard widgets for step-5 modules; README screenshots / user guide for schools.
