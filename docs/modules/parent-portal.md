# Parent page

> Status: Built · No login · Routes: `/p/[token]`, `/p/[token]/r/[id]` (receipt) · Code: `src/app/p/[token]/page.tsx`, `src/lib/portal.ts`

## Purpose
One private link per student that parents open on their phone — no app, no password. It is the main way families see the ERP.

## How it works
- Token = `students.portal_token` (32 hex chars). `portalStudent(token)` looks the student up with the **admin client** (secret key, bypasses RLS), so every query on this page must filter by that student / school explicitly.
- Shared from the student profile (copy / WhatsApp; shown only to people with `students.parent_link.view`) and in reminder messages. Reset the link from the profile (`reset_portal_token()`, needs `students.parent_link.edit`) to revoke it. The token cannot be changed any other way.
- `robots: noindex`, `referrer: no-referrer`.

## Sections (in order)
1. School header, student name / class / adm. no.
2. **Fees** — due now, rest of session, **Pay by UPI** deep link to the school's UPI ID (amount pre-filled), bank details, unpaid instalments, receipts (printable).
3. **Attendance** — session %, recent absences.
4. **Results** — published exams only, per subject marks/grade, rank.
5. **Homework** (if module on) — last 14 days or not yet due; **Study material** — all for the class.
6. **School transport** (if on and allocated) — route, stop, pickup/drop time, bus number, driver & attendant phone.
7. **Library** (if on) — books with the child, due / overdue.
8. **Notices** — latest 10.

Step-5 sections show only when `school_modules` has the module licensed and enabled.

## Gaps & ideas
Online fee payment (Razorpay) with automatic receipt, parent leave request for the child, PTM booking, photo gallery, Hindi language toggle (`prefs.language`), installable PWA.
