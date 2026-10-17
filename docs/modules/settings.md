# Settings centre & integrations

> Status: Built (steps 1 & 4) · Catalogue: `settings.school`, `settings.integrations`, `settings.audit`, `academics.setup` · Migrations: `0001`, `0006_settings.sql`

## Purpose
One hub for school configuration: profile & branding, classes / sections / subjects / sessions, year-end promotion, module on/off, regional preferences, notification channels, third-party accounts, audit log.

## Screens
| Route | Needs | What's there |
|---|---|---|
| `/app/settings` | any settings perm | Hub cards |
| `/app/settings/school` | `settings.school.view/edit` | Name, address, board, UDISE, phone, UPI ID & bank (shown on parent page), receipt & admission prefixes / next numbers, late fine per day, WhatsApp signature, logo upload (Cloudinary), **modules on/off**, preferences (date format, week start, language, working days, quiet hours). (The grade scale lives in `schools.grade_scale` but has no edit screen yet.) |
| `/app/settings/academic` | `academics.setup.create` | Classes, sections, subjects, sessions, set current session, **promote all** (year end) |
| `/app/settings/notifications` | `settings.school.view` | Which events go by SMS / email / WhatsApp (`schools.prefs.notify`), recent `message_log` |
| `/app/settings/integrations` | `settings.integrations.view/edit` | Razorpay, Cloudinary, Email (SMTP/Resend), SMS (MSG91/DLT), WhatsApp Cloud API — save, test, remove |
| `/app/settings/audit` | `settings.audit.view` | This school's audit log |
| `/app/settings/staff`, `/roles` | see [access.md](access.md) | |
| `/app/settings/billing` | see [subscriptions.md](subscriptions.md) | |

## Server actions
`src/app/app/_actions/settings.ts`: `updateSchool, addClass, deleteClass, addSection, deleteSection, addSubject, deleteSubject, addSession, makeCurrentSession, promoteAll, changePassword, setModule, savePrefs, saveNotifications, uploadLogo`.
`src/app/_actions/integrations.ts`: `saveIntegration, testIntegrationAction, removeIntegration` (school and platform).
Libs: `src/lib/integrations.ts` (`resolveIntegration`, `sendEmail`, `sendSms`, `sendWhatsAppTemplate`, `cloudinaryUpload`, `testIntegration`), `src/lib/integration-defs.ts` (field definitions), `src/lib/crypto.ts` (AES-256-GCM), `src/lib/prefs.ts` (`SchoolPrefs`, `NOTIFY_EVENTS`, defaults).

## Database
- `schools` (profile columns, `prefs jsonb`, `grade_scale jsonb`, numbering counters), `sessions`, `classes`, `sections`, `subjects`
- `integration_settings(school_id null = platform, provider, enabled, config, secret_hints, status)`; `integration_secrets(ciphertext)` — **no RLS policy, only the server's secret key reads it**; `message_log`
- `effective_integrations(sid)` — school's own account, else the platform's shared one when allowed
- `set_current_session`, `promote_students` (moves every active student up one class, same section name; top class → passed out), `set_module_enabled`, `next_school_number`

## Business rules
1. Secrets are encrypted in the app with `SETTINGS_ENCRYPTION_KEY`; the browser only sees hints like `••••a1b2`; never logged.
2. Core modules (dashboard, settings, support) can't be switched off; a school can only switch on modules its plan licenses.
3. Promotion is one-way — warn users; it doesn't touch fees.

## Gaps & ideas
Actually sending automatic SMS/WhatsApp/email on events (prefs + integrations exist; senders are wired only for tests), backups (`settings.backups`), per-class section capacity.

## Backups & data export (step 42, 17 Oct 2026, migration `0044`)
**Settings → Backups & export** (`settings.backups`): *Download full export* (one JSON with every table the person may read — streamed, so large schools work; staff bank / PAN details and stored document layouts are left out), *one table as CSV* (students, fees, attendance, marks, staff …), and a paged **history** (`backup_log`: who, when, tables, rows, size). The export runs as the signed-in user, so row-level security decides what is in it. Table list: `src/lib/backup.ts`. This is the school's own copy; the platform's database backups are separate (Supabase).
