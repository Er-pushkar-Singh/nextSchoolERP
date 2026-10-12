# Architecture

## Stack

| Layer | What | Notes |
|---|---|---|
| Web | **Next.js 16.4** (App Router, Server Components, Server Actions), React 19.3, TypeScript | This Next version has breaking changes vs older docs — check `node_modules/next/dist/docs/` before using an unfamiliar API (see `AGENTS.md`). Middleware is `src/proxy.ts` (not `middleware.ts`). |
| Styling | Tailwind CSS 4, design tokens at the top of `src/app/globals.css`, icons from `react-icons/lu` | Shell (sidebar, top bar) in `src/components/shell/` |
| Data | **Supabase** — Postgres + Auth + PostgREST | All business rules and permissions live in Postgres (RLS + SQL functions) |
| Hosting | Vercel; daily cron `/api/cron/billing` (see `vercel.json`) | |
| Validation | Small helpers in `src/lib/action-util.ts` (`str`, `num`, `date`, `uuid`, `oneOf`); `zod` is installed but barely used | |

No client-side data fetching: pages are async Server Components that query Supabase; forms post to Server Actions; actions redirect back with a flash message.

## Multi-tenancy

- One deployment, one database, **many schools**. Every school-owned table has `school_id uuid not null references schools(id) on delete cascade`.
- Isolation is enforced by **Row Level Security** on every table — the app code also filters `.eq("school_id", school.id)`, but RLS is the real guard.
- The current school comes from (in order): the request host (`code.<root domain>` or a custom domain, via `tenant_by_host()`), the `erp_school` cookie, the user's first membership. See `requireSchool()` in `src/lib/school.ts`.
- **Platform staff** (rows in `platform_admins`) can read every school; they can change a school only inside an active **support session** (logged).
- **School groups / trusts**: `school_groups` + `group_members` let an owner see all branches read-only (`/group`).

## Users and logins

| Kind | How they get in | Stored in |
|---|---|---|
| Platform team | Supabase Auth user + `platform_admins` row (role owner/admin/support/billing/sales/viewer) | `platform_admins` |
| School staff | Created by the school admin (temporary password shown once) or self-registration | `school_members` (name/email/phone) + `member_roles` (one or more roles) |
| Parents | **No login needed** — secret link `/p/<portal_token>` per student. (Parent/student *logins* are supported by the permission model — `guardians`, `student_guardians`, `students.user_id` — but there are no screens for them yet.) | `students.portal_token` |

## Permission engine (the most important part)

Defined in `supabase/migrations/0003_permissions.sql`, extended in `0005_platform.sql`. Catalogue in `src/lib/catalog.json`.

- **Permission key** = `module.submodule.action`, e.g. `fees.collection.create`. Actions: view, create, edit, delete, approve, export, print, publish.
- **Catalogue** (`src/lib/catalog.json` → generated `0002_catalog.sql`): 19 modules → 64 sub-modules → 209 permissions, plus 12 **role templates** (Principal, Vice Principal, Accountant, Front office, Office/HR admin, Class teacher, Subject teacher, Librarian, Transport manager, Hostel warden, Parent, Student). `built: true` on a sub-module marks it as having screens.
- **Scope** of every grant: `school` (everything) › `assigned` (sections/subjects in `staff_assignments`) › `own` (own records) › `child` (parent's children) › `self` (the student).
- Roles are copied per school (`roles`, `role_permissions`); people get roles via `member_roles`; per-person exceptions in `member_overrides` (grant/deny, **deny wins**).
- A permission is only effective when the **module is licensed by the plan and switched on by the school** (`school_modules`, `module_on()`), and write actions only while the subscription is live (`school_writable()`).

Key SQL functions:

| Function | Returns |
|---|---|
| `perm_scope(sid, key)` | widest scope the current user has, or NULL |
| `has_perm(sid, key)` | any scope |
| `has_perm_school(sid, key)` | whole-school scope (**always true/false, never NULL** — see gotchas) |
| `can_student(sid, key, student, subject?)` | scope-aware check on a student's record |
| `can_section(sid, key, section, subject?)` | scope-aware check on a section |
| `can_class_item(sid, key, class, section?, subject?)` | scope-aware check on class-level items (homework) |
| `my_permissions(sid)` | everything the user can do — loaded once per request by `requireSchool()` |
| `my_staff_id(sid)` | the HR `staff.id` linked to the signed-in user |

**Enforced twice**: pages and actions call `requirePerm(...)` (UX + early exit), and RLS policies call the functions above (security). Never rely on the app check alone.

## Request flow

```
browser → src/proxy.ts (refresh Supabase session; /app, /platform, /group need a user)
        → src/app/app/layout.tsx  (requireSchool(): school, session, perms → builds the sidebar from NAV + permissions,
                                   shows subscription / support banners)
        → page.tsx                 (requirePerm("x.y.view"), queries with the user's Supabase client → RLS applies)
        → <form action={serverAction}>  (_actions/*.ts: requirePerm, validate, insert/update/rpc, go(path, {ok|error}))
```

Two Supabase clients:
- `supabaseServer()` (`src/lib/supabase/server.ts`) — the signed-in user, **RLS applies**. Use this everywhere in the app.
- `supabaseAdmin()` (`src/lib/supabase/admin.ts`) — secret key, **bypasses RLS**. Only for: the parent page (`src/lib/portal.ts`), creating logins (`src/lib/logins.ts`), integration secrets, webhooks and cron.

## Folder layout

```
src/
  app/
    app/                 school app (staff) — one folder per module, + _actions/*.ts (server actions per module)
    platform/            Super Admin (CodersDuniya team)  + actions.ts, _actions/ops.ts
    p/[token]/           parent page (public, secret link)  + r/[id] receipt
    group/               group / trust overview
    login/, register/    sign-in and school self-registration
    api/cron/billing     daily subscription job       api/razorpay/webhook   payment-link webhook
    _actions/integrations.ts   shared by school + platform integration screens
  components/            ui/ui.tsx (PageHeader, Card, Stat, Table, Input, Select, Badge, Flash…), shell/, feature widgets
  lib/                   school.ts (auth/context), erp.ts (classes, dues maths), format.ts, csv.ts, catalog.json,
                         billing.ts, razorpay.ts, integrations.ts, crypto.ts, portal.ts, results.ts, reminders.ts,
                         transport.ts, hr.ts, prefs.ts, platform.ts, tenants.ts, logins.ts, brand.ts
supabase/
  migrations/0001…0007   the schema, in order (each file safe to re-run)
  setup.sql              all migrations concatenated (npm run setup-sql) — one paste into the Supabase SQL editor
  tests/*.test.sql       SQL tests (run in a transaction, roll back)
scripts/                 gen-catalog.mjs (catalog.json → 0002), build-setup.mjs (→ setup.sql)
docs/                    you are here
```

## Migrations

| File | Adds |
|---|---|
| `0001_erp.sql` | schools, sessions, classes/sections/subjects, students, enquiries, fees, attendance, exams/marks, notices, reporting functions |
| `0002_catalog.sql` | **generated** module/permission catalogue + role templates (`npm run catalog`) |
| `0003_permissions.sql` | permission engine, roles, overrides, staff assignments, guardians, all RLS policies of 0001 tables |
| `0004_subscriptions.sql` | plans, subscriptions, GST invoices, registration, subscription state / read-only mode |
| `0005_platform.sql` | platform roles, support sessions, audit log, groups, domains, announcements, tickets |
| `0006_settings.sql` | integrations (encrypted secrets), school prefs, message log |
| `0007_standard_modules.sql` | homework, transport, HR/payroll, library + two security/bug fixes |

All migrations are idempotent (`create … if not exists`, `create or replace`, `drop policy if exists`). After editing any migration run `npm run setup-sql`.

## Environment

See `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`, `SETTINGS_ENCRYPTION_KEY` (never change once set), `CRON_SECRET`, optional `RAZORPAY_*` fallback and branding vars.
