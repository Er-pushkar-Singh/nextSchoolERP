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

## Parent & student logins — the family portal (step 41, 17 Oct 2026, migration `0043`)
Parents and students now have real logins next to the secret link. They sign in on the normal sign-in page and land in **`/family`** (a login whose roles are all parent / student roles is sent there automatically; `requireSchool().familyOnly`).

- **User names**: a parent signs in with the **mobile number** (stored as `<mobile>@family.erp.local`) or a real e-mail; a student with **`SCHOOLCODE/ADMISSION-NO`** (`<adm>.<code>@student.erp.local`). `loginEmail()` in `src/lib/logins.ts` turns what was typed into the real e-mail. One parent login serves all their children (brothers and sisters share a mobile number).
- **Creating logins** (office): Students → **Parent logins** (a section at a time, optional student logins) or the student's own page → *Parent & student app login*. `POST /app/students/family-logins` creates the logins (`provisionFamily()` in `src/lib/family-admin.ts`) and answers with a **printable sheet** (passwords only on that page; per-row WhatsApp link). Existing parents are skipped. **Reset password** per parent / student (same rule as staff: refused for a login that also belongs to another school).
- **Screens** (`src/app/family`): *Who* (child switcher) → **Home** (the same student page as the secret link: fees with Razorpay / UPI, receipts, attendance, results, homework, bus, library, notices — shared `ParentView`), **Leave** (apply / cancel / history), **Messages** (conversation with the class team, unread badge), **Account** (change password). Everything is paged.
- **Safety**: `family_children()` / `is_my_child()` are the only way in; `requireChild(studentId)` 404s for anyone else's child. The home page reads with the service key *after* that check (like the secret link does).
- **Install on the phone**: `/manifest.webmanifest` (`src/app/manifest.ts`), icons in `public/icons` (`node scripts/gen-icons.mjs`), `public/sw.js` (offline page; signed-in pages are never cached).
- **Tests**: `family_portal.test.sql` (own children only, leave rules, LV in the register, class-team messages, isolation).
- **Gaps**: OTP by SMS (needs an approved DLT template — until then the office hands over the printed password), push notifications, parent-teacher meeting booking, student-side timetable tab.
