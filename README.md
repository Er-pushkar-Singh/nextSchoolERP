# CodersDuniya School ERP

Multi-school (multi-tenant) school management on **Next.js 16 + Supabase**. One deployment serves every school you sell to; each school only ever sees its own data (enforced by Postgres Row Level Security).

Built for Indian schools: fees first, WhatsApp-first, mobile-first, no app for parents to install.

## What's inside

| Module | Features |
|---|---|
| **Platform** (`/platform`, you) | **Module map** with the default permission matrix, **module licences per school**, sync default roles;  Onboard a school in one form (session, classes Nursery–12, subjects, fee heads created automatically), create its admin login, plan / student limit / price / suspend, open any school to help them, estimated MRR |
| **Dashboard** | Students, today's attendance %, today's & month's collection, overdue fees, latest receipts, admission follow-ups, notices |
| **Students** | Admission form, auto admission numbers, search, class filter, left / passed out, **CSV import from Excel** (with row-level error report), student profile with fee ledger, receipts, concessions, attendance % |
| **Admissions** | Enquiry pipeline (new → contacted → visited → test → admitted / lost), follow-up dates, source tracking, conversion %, WhatsApp, one-click **Admit** (pre-fills the admission form) |
| **Fees** | Fee heads, structure per class (monthly / quarterly / half-yearly / annual / one-time) → **Generate dues** (idempotent), concessions (% or ₹, per head), **collection desk** (find student → pay → oldest dues first, partial OK, late fine), numbered **printable receipts** with amount in words, receipt cancel (admin only, restores dues), **defaulters list with one-tap WhatsApp reminders**, receipts / daily collection report by mode, **CSV exports** |
| **Attendance** | Mobile grid (P / A / Late / Half day / Leave, "All present"), which sections are marked today, **WhatsApp alert to parents of absent students**, printable monthly register |
| **Exams** | Exams per session, subjects + max marks per class, fast marks grid (AB = absent), CBSE-style grades (editable scale), class rank, **printable cumulative report cards**, publish to parents |
| **Notices** | Whole school or one class, copy for WhatsApp group, visible on parent pages |
| **Parent page** `/p/<secret>` | No login: dues + **Pay by UPI** button (opens GPay/PhonePe/Paytm), receipts, attendance %, published results, notices |
| **Settings** | School profile, UPI/bank, numbering, late fine, WhatsApp signature, **modules on/off**, classes/sections/subjects, sessions, year-end promotion, **Staff & access** (several roles per person, class / subject assignment, exceptions), **Roles & permissions matrix editor** |

## Modules, roles & permissions

- **Module map** — `src/lib/catalog.json` is the single source of truth: 18 school modules → 62 sub-modules → 205 permissions (`module.submodule.action`, actions view / create / edit / delete / approve / export / print / publish) and 12 default role templates. After editing it run `npm run catalog`, which regenerates `supabase/migrations/0002_catalog.sql`.
- **Scopes** — every grant has a scope: whole school, assigned (sections / subjects given to that teacher), own, own children (parent), self (student).
- **Default roles** — Principal / School Admin (locked, everything), Vice Principal / Academic Coordinator, Accountant, Front office, Office / HR admin, Class teacher, Subject teacher, Librarian, Transport manager, Hostel warden, Parent, Student. Schools can edit them, create custom roles from any of them, give one person several roles, and add per-person grant / deny exceptions (deny wins).
- **Safety** — nobody edits their own roles or grants what they don't hold; the last Principal can't be removed; receipt cancel needs `fees.receipts.approve` (Accountant collects, Principal approves); marks lock after results are published; a suspended school is read-only; a module the platform hasn't licensed or the school switched off disappears and the database refuses its data.
- **Enforced twice** — pages and actions check permissions (`requirePerm`), and every table's Row Level Security calls `perm_scope()` / `can_student()` / `can_section()`.
- **Test** — `psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/permissions.test.sql` (on a throwaway database) checks every cell of the default matrix plus the scope rules, then rolls back.

## Registration, plans & billing (step 3)

- **Self-registration** at `/register` (link on the login page): school name, board, city, principal, mobile, email + password. Bot checks (honeypot, time trap, per-IP limit). The school is created with classes, subjects, fee heads and default roles; the registrant becomes Principal. With *require approval* on (default) it stays **read-only until you approve it** in `/platform`.
- **Plans** (`/platform/plans`): monthly and yearly price, per student or flat, minimum billed students, student limit, storage, included modules, trial days. Seeded: Free trial (30 days, all modules), Starter ₹99/student/year or ₹10/month, Standard ₹149 / ₹15, Premium ₹199 / ₹20 — all + 18% GST. Change them any time.
- **Subscriptions** (`/platform/schools/<id>`): apply a plan (licenses its modules, sets the student limit and the period), extend, set grace days, cancel at period end, approve / suspend.
- **Lifecycle:** trial → active → *grace* (default 7 days after the end, a banner warns) → **expired = read-only** (everything visible, nothing can be changed, enforced in the database). Trials get no grace.
- **Invoices:** GST tax invoices `CDS/2026-27/0001` (SAC 998314, CGST+SGST inside UP, IGST outside). The first invoice after a plan change covers the current period; the daily job creates renewal invoices 7 days before the end. Mark paid by hand (UTR) or let Razorpay do it.
- **Razorpay (your account):** set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; webhook URL `https://<app>/api/razorpay/webhook`, event `payment_link.paid`. Each invoice gets a payment link the school pays from *Settings → Plan & billing*; payment extends the plan automatically.
- **Daily job:** `vercel.json` runs `/api/cron/billing` at 09:00 IST; set `CRON_SECRET`.
- **Platform settings** (`/platform/settings`): registration on/off, approval, trial plan, GST %, invoice prefix, grace days, renewal lead time, seller name / GSTIN / state / address.
- Upgrading an existing database: schools without a subscription get a 30-day trial — apply their real plan in `/platform`.
- Test: `supabase/tests/subscriptions.test.sql` (20 checks).

> **Same Supabase project as the website / CRM?** It works: ERP tables never share a name with CRM tables (the ERP's subscription table is `school_subscriptions`), and the ERP setup only resets its own policies. If you ran an older ERP `setup.sql` (before 9 Oct 2026, 13:00) in the CRM's project, it removed the CRM's access policies — run the website's `supabase/setup.sql` once more to restore them. A separate project for the ERP is still the cleaner choice.

## Super Admin panel & multi-tenancy (step 3b)

Everything a SaaS owner needs, under `/platform` (sidebar shows only what your platform role allows):

| Area | What it does |
|---|---|
| **Dashboard** | Schools by status, MRR / ARR, collected this month, overdue, trials ending, open tickets, 12-month revenue & signup charts |
| **Tenants** | Search / filter by status, plan, group; onboarding wizard (school + plan + principal login in one step); tenant page with tabs — overview, subscription (plan, period, invoices), modules on/off, users (add, reset password, remove), activity (audit), support, danger zone (suspend, archive/restore, delete, JSON export of all 30 tables) |
| **Support sessions** | Platform staff are read-only inside a school. "Start support session" (reason + 30/60/120 min) opens writes for that school only; every change is logged against the session; a red banner shows inside the school |
| **Groups / trusts** | Multi-branch chains: group owner / viewer logins see every branch (read-only) and a consolidated `/group` overview |
| **Domains** | Each school gets `code.<root domain>`; custom domains supported; the login page shows the school's logo and name |
| **Billing** | All invoices, filters, CSV export, mark paid, void; plans editor (monthly / yearly per-student prices) |
| **Support desk** | Schools raise tickets from *Help & support*; platform replies, internal notes, status & priority |
| **Announcements** | Banner to all schools, a plan, or chosen schools; dismissible |
| **Audit log** | Every insert/update/delete across ERP tables, logins, plan changes, support sessions |
| **Team** | Platform roles: owner, admin, support, billing, sales, viewer — enforced in the database (`platform_can`) |
| **Settings** | Registration, tenancy (root domain, app host), branding, billing seller details |

**Loaders:** every form submit shows a spinner on the button and a top progress bar until the new page renders; every module has skeleton screens (`loading.tsx`) while data loads.

Tests: `supabase/tests/platform.test.sql` (26 checks) + `permissions.test.sql` (48) + `subscriptions.test.sql` (20) + `settings.test.sql` (13).

## Settings centre & integrations (step 4)

**School side** — sidebar *Settings* → **Settings centre** (`/app/settings`): one hub for school profile & branding (logo upload to Cloudinary, regional preferences: date format, working days, quiet hours), classes & sessions, notifications (which events go by SMS / email / WhatsApp), staff & access, roles, **integrations**, plan & billing and the school's own **audit log**.

**Integrations** (`/app/settings/integrations`, Super Admin: `/platform/settings/integrations`):

| Provider | School uses it for | Platform uses it for | Test |
|---|---|---|---|
| Razorpay | parents paying fees into the school's own account | schools paying subscription invoices | API call with the keys; test/live key check |
| Cloudinary | logo, photos, documents | shared storage (optional) + backups | `/ping` with the keys |
| Email (SMTP or Resend) | mails from the school's address | invoices, welcome mails; shared (optional) | SMTP login / API key, optional test email |
| SMS (MSG91, DLT) | absent alerts, receipts, reminders | shared sender (optional) | test SMS to a number |
| WhatsApp Cloud API | automatic WhatsApp | shared number (optional) | phone-number lookup + optional template message |

- **Secrets are encrypted** with AES-256-GCM in the app server (`SETTINGS_ENCRYPTION_KEY`) and stored in `integration_secrets`, a table no signed-in user can read (no RLS policy; only the server's secret key). The browser only ever sees a hint like `••••a1b2`. Secrets never reach the audit log.
- A school without its own account automatically uses the platform's account when the platform ticks *"Let schools … use this one"* (`effective_integrations()`).
- Platform Razorpay keys saved here take priority over the `RAZORPAY_*` env vars (still a fallback).
- Every test send is logged in `message_log` (shown under *Notifications → Recent messages*).
- Test: `supabase/tests/settings.test.sql` (13 checks).

**New env var:** `SETTINGS_ENCRYPTION_KEY` — 32 random bytes, base64:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → add to `.env.local` and Vercel. Don't change it later (saved keys would have to be re-entered).

**Upgrading an existing database:** run `supabase/migrations/0006_settings.sql` once (or the whole `setup.sql` — safe to re-run). `npm run setup-sql` rebuilds `setup.sql` from the migrations.

## Look & feel

Blue theme with a navy sidebar, [React Icons](https://react-icons.github.io/react-icons/) (Lucide set), collapsible sidebar groups that open on the current section, a top bar with the user menu, a slide-in menu on phones, icon stat cards and a split-screen login. Design tokens live at the top of `src/app/globals.css`; the shell is `src/components/shell/`.

## Setup (≈15 minutes)

1. **New Supabase project** (keep it separate from the website/CRM project), region Mumbai.
2. SQL Editor → paste all of `supabase/setup.sql` → **Run**.
3. Authentication → Users → **Add user** (your email, password, Auto confirm). Run the `insert into public.platform_admins …` line at the bottom of `setup.sql` with your email.
4. `cp .env.example .env.local` and fill in URL, publishable key, **secret key**, app URL and `SETTINGS_ENCRYPTION_KEY`.
5. `npm install && npm run dev` → http://localhost:3000/login → you land on `/platform` → onboard the first school.

Deploy: push to GitHub → import in Vercel → same env vars → add a subdomain such as `erp.codersduniya.com` → set `NEXT_PUBLIC_APP_URL` to it.

### Notes

- **WhatsApp** uses `wa.me` links from the staff member's phone/WhatsApp Web (free, no API approval). The defaulters page has a "Send to next →" queue so 50 reminders take a few minutes. If a school wants fully automatic messages later, plug in the WhatsApp Cloud API or an Indian BSP (Interakt, AiSensy, Gupshup) — message templates are in `src/lib/reminders.ts`.
- **UPI** payments go straight to the school's bank. The school still records them in *Collect fee* (mode UPI + UTR) — that's what creates the receipt. Automatic reconciliation (Razorpay/Cashfree payment links + webhook) is the natural next upgrade.
- Staff logins are created with a temporary password shown once to the admin (no email server needed). Staff change it under their name → *My account*.
- Aggregates (dashboards, defaulters, class summaries) run as SQL functions, so numbers stay correct beyond the API's 1,000-row page limit.
- The plan limit (`student_limit`) and `suspended` status are enforced by database triggers; school admins can't change their own plan.

### Tested

Clicked end-to-end in a browser against a local Supabase-compatible stack (Postgres 16 + PostgREST + mock auth): platform onboarding of 3 schools → settings & staff → admission + CSV import (bad row reported) → fee structure → generate dues (re-run creates 0) → 50% concession → partial UPI payment and receipt → over-payment rejected → defaulters with WhatsApp messages → CSV exports → receipt cancel restores dues → attendance with absentee alerts → monthly register → exam, marks (invalid value rejected), report cards with rank, publish → notice → enquiry → admit → parent page on a phone (UPI link, receipt, results, notices) → teacher blocked from fees → accountant can't cancel receipts or open settings → another school's admin gets 404 on this school's student.

## Where to change things

| What | File |
|---|---|
| Product name, support numbers | `.env` → `src/lib/brand.ts` |
| WhatsApp reminder wording | `src/lib/reminders.ts` |
| Database, permissions, numbering | `supabase/migrations/0001_erp.sql` |
| Navigation & roles per page | `src/app/app/layout.tsx`, `src/lib/school.ts` |
| Colours, sidebar, icons | `src/app/globals.css`, `src/components/shell/` |
| Integration fields | `src/lib/integration-defs.ts` |
