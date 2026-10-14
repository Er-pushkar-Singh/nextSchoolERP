# School ERP — developer docs

Reference for anyone (human or Claude) changing this codebase. **Read this page first, then only the module file you need.**
The top-level [`README.md`](../README.md) is the product / setup guide; these docs explain *how the code works* and *where things live*.

## Map

| File | Read it when you… |
|---|---|
| [architecture.md](architecture.md) | touch anything for the first time — stack, multi-tenancy, permission engine, request flow, folder layout |
| [conventions.md](conventions.md) | write a page, server action, migration or test — the patterns every module follows, plus a **new-module checklist** |
| [gotchas.md](gotchas.md) | something behaves oddly — known traps and bugs already fixed (don't reintroduce them) |
| [roadmap.md](roadmap.md) | plan new work — what is built, what exists only as permissions, suggested order |

### Modules

| # | Module | Doc | Catalogue code(s) | Status |
|---|---|---|---|---|
| 1 | Super Admin / platform | [modules/platform.md](modules/platform.md) | platform roles (not in catalogue) | Built |
| 2 | Registration, plans & subscription billing | [modules/subscriptions.md](modules/subscriptions.md) | `settings.billing` | Built |
| 3 | Staff access, roles & permissions | [modules/access.md](modules/access.md) | `settings.users`, `settings.roles` | Built |
| 4 | Settings centre & integrations | [modules/settings.md](modules/settings.md) | `settings.*`, `academics.setup` | Built |
| 5 | Dashboard | [modules/dashboard.md](modules/dashboard.md) | `dashboard.overview` | Built |
| 6 | Students | [modules/students.md](modules/students.md) | `students.*` | Built (identity, documents, contacts, history added in step 6; certificates in step 7) |
| 7 | Admissions (enquiry → application → admit) | [modules/admissions.md](modules/admissions.md) | `frontdesk.enquiries`, `frontdesk.admissions` | Built (step 8; online form step 9; visitors: not yet) |
| 8 | Attendance | [modules/attendance.md](modules/attendance.md) | `attendance.students` | Built (step 19: QR, kiosk, biometric/RFID, staff check-in; student leave: not yet) |
| 9 | Exams & results | [modules/exams.md](modules/exams.md) | `exams.*` | Built (admit cards: not yet) |
| 10 | Fees | [modules/fees.md](modules/fees.md) | `fees.*` | Built (Fees 2.0: split / advance / cheques / refunds / online, step 10) |
| 11 | Notices | [modules/notices.md](modules/notices.md) | `comms.notices` | Built (templates, calendar, messages: not yet) |
| 12 | Parent page | [modules/parent-portal.md](modules/parent-portal.md) | none — secret link | Built |
| 13 | Homework & study material | [modules/homework.md](modules/homework.md) | `homework.*` | Built (step 5) |
| 14 | Transport | [modules/transport.md](modules/transport.md) | `transport.*` | Built (step 5; GPS tracking: not yet) |
| 15 | Staff & payroll (HR) | [modules/hr-payroll.md](modules/hr-payroll.md) | `hr.*` | Built (step 5) |
| 16 | Library | [modules/library.md](modules/library.md) | `library.*` | Built (step 5) |
| 17 | Help & support desk | [modules/support.md](modules/support.md) | `support.tickets` | Built |
| 18 | UP Board registration (Class 9-12) | [modules/board-registration.md](modules/board-registration.md) | `students.board_reg` | Built (step 6; no direct portal submission) |
| 19 | Certificates (old fixed layouts) | [modules/certificates.md](modules/certificates.md) | `students.certificates` | Built (step 7) — superseded by 20 |
| 20 | Documents & templates (TC, ID cards, letters) | [modules/documents.md](modules/documents.md) | `documents.templates`, `documents.issue` | Built (step 9) |
| 25 | Front office (visitors, calls, post, gate pass) | [modules/front-office.md](modules/front-office.md) | `frontdesk.visitors` | Built (step 22) |
| 26 | Academic setup (curriculum, allocation, syllabus) | [modules/academics.md](modules/academics.md) | `academics.*` | Built (step 23) |
| 23 | Timetable & school calendar | [modules/timetable.md](modules/timetable.md) | `academics.timetable`, `comms.calendar` | Built (step 21) |
| 22 | Accounts (day book & vouchers) | [modules/accounts.md](modules/accounts.md) | `accounts.*` | Built (step 20) |
| 21 | Template studio (visual designer, gallery, module registry) | [modules/templates.md](modules/templates.md) | `documents.templates` | Built (step 16) |

Not built yet (permissions exist, no screens): Accounts, Hostel, Inventory & sales, Health & discipline, Timetable, Syllabus, and the sub-modules marked "not yet" above — see [roadmap.md](roadmap.md).

## Each module doc has the same sections

1. **Purpose** — what problem it solves for the school
2. **Who uses it** — roles and permission keys (with scope)
3. **Screens** — routes and what is on them
4. **Server actions & API** — functions in `src/app/app/_actions/*.ts`, route handlers
5. **Database** — tables, SQL functions, triggers, RLS rules
6. **Business rules** — the invariants the code / database enforce
7. **Connects to** — other modules it reads or writes
8. **Tests** — which SQL test covers it
9. **Gaps & ideas** — known limitations and next steps

## Keeping these docs useful

- When you change a module, update its doc **in the same change** (routes, tables, rules). Stale docs are worse than none.
- New module → copy [modules/_template.md](modules/_template.md), add a row above, follow the checklist in [conventions.md](conventions.md).
- Record surprises in [gotchas.md](gotchas.md) so nobody hits them twice.
- Dates: write absolute dates (e.g. 12 Oct 2026), never "last week".

_Last full review: 12 Oct 2026 (after step 24 — front office, academic setup, payroll v2)._
