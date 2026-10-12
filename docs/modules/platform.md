# Super Admin (platform)

> Status: Built (steps 3 & 3b) · Area: `/platform` · Not part of the school catalogue — uses **platform roles**

## Purpose
The CodersDuniya team's console for running the SaaS: onboard and manage schools (tenants), plans and invoices, support, announcements, audit, team.

## Who uses it
Rows in `platform_admins` with a role. `platform_can(area, write)` / `platformCan()` (`src/lib/platform.ts`) decide access per area: `tenants, billing, plans, support, team, settings, audit, announcements, impersonate`.

| Role | Can |
|---|---|
| owner | everything |
| admin | everything except changing the team |
| support | support desk, open support sessions; read tenants/plans/audit/settings |
| billing | billing; read tenants/plans/audit/support/settings |
| sales | tenants (onboard); read plans/support/billing/settings |
| viewer | read everything except impersonate |

## Screens
| Route | What's there |
|---|---|
| `/platform` | Dashboard: schools by status, MRR/ARR, collected this month, overdue, trials ending, open tickets, 12-month revenue & signup charts (`platform_dashboard()`) |
| `/platform/tenants`, `/tenants/new`, `/tenants/[id]` | Tenant list (search / filter by status, plan, group); onboarding wizard (school + plan + principal login); tenant page with tabs: overview, subscription, modules, users, activity, support, danger zone (suspend, archive/restore, delete, JSON export) |
| `/platform/tenants/[id]/export` | JSON export of every school table (list `TABLES` in the route — **add new tables here**) |
| `/platform/schools/[id]` | Older school page: plan, subscription, approve / suspend |
| `/platform/modules` | Module map + default permission matrix (from `catalog.json`), "built" badges |
| `/platform/plans`, `/platform/billing` (+ `/export`) | Plans editor; all subscription invoices (filters, CSV, mark paid, void) — see [subscriptions.md](subscriptions.md) |
| `/platform/groups` | School groups / trusts and their owner / viewer logins |
| `/platform/support`, `/support/[id]` | Ticket desk — see [support.md](support.md) |
| `/platform/announcements` | Banners to all schools, a plan, or chosen schools |
| `/platform/audit` | Audit log across all schools |
| `/platform/team` | Platform users and roles |
| `/platform/settings`, `/settings/integrations` | Registration, tenancy (root domain, app host), branding, billing seller details; platform integration accounts |

## Server actions
- `src/app/platform/actions.ts`: `createTenant, updateTenant, setSchoolStatus, archiveTenant, restoreTenant, deleteTenant, setLicence, syncRoles, viewSchool, startSupport, endSupport, addTenantUser, resetTenantUserPassword, removeTenantUser, changePlan, updateSubscription, createInvoice, markInvoicePaid, voidInvoice, savePlan, savePlatformSettings`
- `src/app/platform/_actions/ops.ts`: `replyTicket, updateTicket, saveAnnouncement, deleteAnnouncement, addTeamMember, updateTeamMember, saveGroup, deleteGroup, addGroupMember, removeGroupMember`

## Database (0005_platform.sql mainly)
- `platform_admins(user_id, role, active)`; `platform_role()`, `platform_can()`, `is_platform_admin()`
- `support_sessions` — `start_support_session(sid, reason, minutes)`, `end_support_session`, `active_support_session(sid)`. While active, `perm_scope()` gives the staff member whole-school write access to that school only; every change is logged against the session.
- `audit_log` + `audit_row()` trigger on most tables, `log_event()` for named events (plan.applied, support.start, school.exported…)
- `school_groups`, `group_members`, `in_school_group()`, `group_overview()`
- Domains: `schools.subdomain` (default = code), `custom_domain`, `tenant_by_host(host)`
- `announcements`, `my_announcements(sid)`; `platform_counts`, `platform_dashboard`, `platform_tenant_stats`
- `create_school()` / `_create_school_core()` seeds session, classes Nursery–12 (section A), subjects, fee heads, modules, roles. `archive_school`, `restore_school`, `approve_school`.

## Business rules
1. Platform staff are **read-only** inside a school without a support session.
2. Deleting a school cascades to all its data (fixed 12 Oct 2026 — it used to fail; see gotchas).
3. Team changes need `platform_can('team', true)` (owner only).

## Connects to
Everything — licences modules (`school_modules.licensed`) and plans for each school; support tickets; announcements shown in the school app layout.

## Tests
`supabase/tests/platform.test.sql` (26 checks).

## Gaps & ideas
Usage-based alerts (schools inactive for N days), impersonation of a specific user, bulk announcements by email/WhatsApp.
