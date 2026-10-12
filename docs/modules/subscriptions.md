# Registration, plans & subscription billing

> Status: Built (step 3) · Catalogue: `settings.billing` (school side) · Migration: `0004_subscriptions.sql`

## Purpose
How a school signs up, which plan it is on, what it can use, and how CodersDuniya invoices and collects money (GST invoices, Razorpay payment links).

## Who uses it
- Anyone: `/register` (self-registration).
- School: Principal (`settings.billing.view/create`) sees plan, invoices, pays.
- Platform: `billing` / `tenants` areas.

## Screens
| Route | What's there |
|---|---|
| `/register` | School name, board, city, principal, mobile, email + password; bot checks (honeypot, time trap, per-IP limit) → `register_school()` |
| `/app/settings/billing`, `/app/settings/billing/[id]` | School's plan, period, status, invoices, "Pay now" (Razorpay link), printable GST invoice |
| `/platform/plans` | Plans: monthly / yearly price, per-student or flat, minimum billed students, student limit, storage, included modules, trial days |
| `/platform/schools/[id]`, tenant "subscription" tab | Apply plan, extend, grace days, cancel at period end, invoices |
| `/platform/billing` | All invoices, filters, CSV export, mark paid (UTR), void |
| `/api/razorpay/webhook` | `payment_link.paid` → `mark_subscription_invoice_paid()` → plan extended |
| `/api/cron/billing` | Daily 09:00 IST (`vercel.json`, `CRON_SECRET`): `billing_run()` creates renewal invoices 7 days before period end, attaches payment links |

Code: `src/lib/billing.ts` (types, `getSubscription`, `attachPaymentLink`), `src/lib/razorpay.ts`.

## Database
- `plans(code, price_type, price_monthly, price_yearly, min_students, student_limit, storage_mb, trial_days, modules[])` — seeded: trial (30 days, all modules), **starter** ₹99/student/yr (frontdesk, students, academics, attendance, exams, fees, comms, reports), **standard** ₹149 (starter + homework, hr, transport, library), **premium** ₹199 (everything). +18% GST.
- `school_subscriptions(school_id, plan_id, billing_cycle, status, current_period_start/end, grace_days, …)`
- `subscription_invoices` (number `CDS/2026-27/0001`, SAC 998314, CGST+SGST in UP else IGST), `invoice_counters`
- `platform_settings` key/value (registration, billing seller, grace days, renewal lead time, GST %, invoice prefix)
- Functions: `subscription_state(sid)` → `trial | ok | grace | expired | pending | suspended`; `school_writable(sid)`; `apply_plan()` (licenses modules + limits); `create_subscription_invoice()`; `mark_subscription_invoice_paid()`; `billing_run()`; `register_school()`; `guard_student_insert()` (student limit + read-only).

## Business rules
1. Lifecycle: trial → active → **grace** (default 7 days, banner) → **expired = read-only** (enforced in the DB via `perm_scope`). Trials get no grace.
2. `apply_plan` sets `school_modules.licensed` from the plan; unlicensed modules disappear from the sidebar and the DB refuses their data.
3. Active student count can't exceed `student_limit`.
4. Registration with *require approval* on → school is `pending` (read-only) until approved in `/platform`.

## Connects to
Every module (licensing, read-only mode); layout banner `SubBanner` in `src/app/app/layout.tsx`.

## Tests
`supabase/tests/subscriptions.test.sql`.

## Gaps & ideas
Proration on mid-period upgrades, auto-suspend after long expiry, coupon codes, storage-usage enforcement.
