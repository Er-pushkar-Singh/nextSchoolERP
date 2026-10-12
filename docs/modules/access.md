# Staff access, roles & permissions

> Status: Built (step 2) · Catalogue: `settings.users`, `settings.roles`, `academics.allocation` · Migration: `0003_permissions.sql` (+ `0002_catalog.sql` generated)

## Purpose
Decide who in a school can see and do what: logins for staff, roles (several per person), which sections/subjects a teacher is assigned to, and per-person exceptions. The engine itself is described in [architecture.md](../architecture.md#permission-engine-the-most-important-part).

## Who uses it
Principal / School Admin (locked role with every permission), Office admin (`settings.users.*`).

## Screens
| Route | What's there |
|---|---|
| `/app/settings/staff` | People with logins: add (creates Supabase user, temporary password shown once), roles per person, class/subject assignments (`staff_assignments`; class teacher = subject null), per-person grant/deny overrides, remove |
| `/app/settings/roles`, `/app/settings/roles/[id]` | Role list; permission matrix editor per role (module › sub-module › actions, with scope), create custom role from a template, reset to template, delete custom role |
| `/app/account` | Own name / password change |

## Server actions
`src/app/app/_actions/access.ts`: `addStaff, setStaffRoles, removeStaff, addAssignment, removeAssignment, setOverride, createRole, saveRolePermissions, resetRole, deleteRole`. Login creation via `src/lib/logins.ts` (`ensureLogin`, `resetPassword`, `showPasswordOnce` — cookie `erp_newpw`).

## Database
`roles`, `role_permissions`, `member_roles`, `member_overrides`, `staff_assignments`, `school_members`, `guardians`, `student_guardians`, `school_modules`; templates `role_templates`, `role_template_permissions`. Functions: `perm_scope, has_perm, has_perm_school, has_module_perm, can_student, can_section, can_class_item, assigned_to_section, my_permissions, sync_role_templates, reset_role_to_template, seed_school_modules, set_module_enabled`.

Guards (triggers): `guard_role_permissions` (can't edit a locked role, a role you hold, or grant what you don't have), `guard_member_roles` (can't change your own roles, can't assign a role with permissions you lack, last Principal can't be removed), `guard_overrides`.

## Business rules
1. Deny override beats any grant.
2. Nobody can edit their own roles / permissions or grant what they don't hold.
3. A school always keeps at least one Principal.
4. The Principal role always carries every permission, including new ones (`sync_role_templates`).
5. Teachers' "assigned" scope = rows in `staff_assignments` (section, optional subject).

## Connects to
Every module. **HR staff records** (`staff` table, [hr-payroll.md](hr-payroll.md)) are separate from logins; link them with `staff.user_id`.

## Tests
`supabase/tests/permissions.test.sql` (48 checks: every cell of the default matrix + scopes).

## Gaps & ideas
Parent / student logins (model supports them, no screens), bulk role assignment, invite by email instead of temporary password.
