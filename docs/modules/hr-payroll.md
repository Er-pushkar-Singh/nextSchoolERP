# Staff & payroll (HR)

> Status: Built 12 Oct 2026 (step 5) · Catalogue: `hr.staff`, `hr.leave`, `hr.payroll` · Plans: Standard, Premium · Migration: `0007_standard_modules.sql` · Lib: `src/lib/hr.ts`

## Purpose
Staff directory for everyone on the payroll (teachers, office, drivers, guards — with or without an ERP login), leave requests and balances, and monthly salary with payslips and a bank sheet.

## Who uses it
| Role | Permissions (scope) |
|---|---|
| Office / HR admin | `hr.staff.*`, `hr.leave.view/create`, `hr.payroll.view/create/edit/export/print` (school) |
| Accountant | `hr.payroll.view/create` |
| Principal | everything — the only default role with `hr.leave.approve` and `hr.payroll.approve` |
| Teachers, librarian, transport manager, warden | `hr.leave.view/create` (**own**) — apply for own leave, see own payslips |

## Screens
| Route | What's there |
|---|---|
| `/app/hr` | Stats (active staff, on leave today, monthly gross, logins), search / type / status filter, list, add staff, **Add everyone with a login** (creates staff rows for `school_members` without one, skipping family roles) |
| `/app/hr/staff/[id]` | Profile, ERP-login link, **salary structure** (earnings + deductions rows, per month), bank / IFSC / PAN / UAN, leave quota (CL, SL, EL per session) with used, recent leave, payslips, mark left / rejoin, delete (only without payslips) |
| `/app/hr/leave` | Own balances, **apply** (approvers / HR can apply for anyone), **waiting for approval** (approve / reject with note; own requests can't be decided by yourself), my leave (cancel pending), **my payslips**, all leave with status filter |
| `/app/hr/payroll` | Warning for staff without salary structure, **Run payroll** (month, working days — blank = calendar days), months list (staff, net, paid count, status) |
| `/app/hr/payroll/[id]` | Totals, payslip table (days paid, gross, deductions, adjustment, net, paid), per-slip change (unpaid days, ± adjustment + note) while draft, **Approve & lock / Reopen**, mark ticked rows paid (date, mode, UTR), delete draft |
| `/app/hr/payroll/[id]/export` | Bank sheet CSV (name, account, IFSC, PAN, UAN, days, gross, deductions, net, paid ref) — `hr.payroll.export` |
| `/app/hr/payroll/slip/[id]` | Printable payslip (logo, earnings vs deductions, net in words, masked account). Visible to payroll viewers, or to the employee once approved (RLS) |

## Server actions
`src/app/app/_actions/hr.ts`: `saveStaff, setStaffStatus, deleteStaff, importLogins, applyLeave, decideLeave, cancelLeave, generatePayroll, updatePayslip, setRunStatus, deleteRun, markPaid`.

## Database
- `staff(user_id unique per school, emp_code unique, name, designation, department, kind teaching|non_teaching|support, contact, joining_date, leaving_date, status active|left, pan, uan, bank_*, earnings jsonb [{name, amount}], deductions jsonb, leave_quota jsonb {"CL":12,"SL":7,"EL":0})`
- `staff_leaves(staff_id, kind CL|SL|EL|LWP|OD|other, from_date, to_date, half_day, days generated, reason, status pending|approved|rejected|cancelled, decided_by, decided_by_name, decided_at, decision_note)`
- `payroll_runs(month = 1st of month, unique per school, status draft|approved, approved_by/at)`
- `payslips(run_id, staff_id unique per run, working_days, lop_days, base_earnings, earnings (prorated), deductions, gross, total_deductions, adjustment, adjustment_note, net generated, paid_on, pay_mode, pay_ref)`
- Functions: `my_staff_id(sid)`, `lwp_days(staff, d1, d2)`, `leave_summary(sid, d1, d2)` (approved days per staff & kind; invoker rights), `generate_payroll(sid, month, days?)`, helpers `payroll_run_approved`, `has_my_payslip` (break RLS recursion).
- Triggers: `guard_staff_leave` (approve perm, **no self-approval**, closed requests stay closed, **no overlapping** pending/approved requests, stamps decider), `payslip_compute` (prorates earnings = base × (days − LOP) / days, totals; **locks** approved months; no "paid" before approval), `guard_payroll_run` (approve needs payslips; can't reopen once anything is paid; can't delete approved).

## Business rules
1. Payroll includes active staff with a salary structure who joined by month end, plus those who left during the month.
2. Unpaid days (LOP) = approved **LWP** leave in the month + days before joining + days after leaving.
3. Deductions are fixed per month (not prorated); adjustment is added to net (+ bonus / − recovery).
4. Re-running payroll for a draft month recalculates all **unpaid** payslips from current structures.
5. Draft → Approved (locked) → payments recorded; reopen only while nothing is paid.
6. Staff see only their own staff record, leave and approved payslips.

## Connects to
Logins (`school_members` via `staff.user_id`), Library (issue books to staff), future Staff attendance (LOP), future Accounts (salary expense).

## Tests
`standard_modules.test.sql` — HR adds staff, teacher sees only self, applies own leave, can't apply for others / approve own / overlap, principal approves, payroll maths (36 000 × 28/30 − 1 800 = 31 800), joining proration, adjustment, paid-before-approval refused, lock, reopen refused after payment, approved run can't be deleted, accountant can't reopen, teacher sees only own payslip.

## Gaps & ideas
Staff attendance / biometric import → LOP, PF / ESI / PT auto-calculation and statutory reports (ECR file), TDS / Form 16, salary revision history, advances & loans with EMI recovery, staff documents upload, experience / relieving letters, leave carry-forward, half-day LWP in payroll from attendance.

## Staff management (step 12, 12 Oct 2026) — migration `0014_people_management.sql`
- **Directory** (`/app/hr`): `staff_list()` — search (name, code, phone, email, designation, department), filters (type, department, status working / left / all, has ERP login, blocked), sort (name, code, newest joined, designation), 25 / 50 / 100 per page, counts and the gross salary computed in the database; CSV export `/app/hr/export` (salary column only with `hr.payroll.view`).
- **Block (ban)**: `hr.staff.block` (Principal, Office admin). Sets `staff.blocked_*` and, when the person has an ERP login, `school_members.blocked_at / blocked_till`. `perm_scope()` and `my_permissions()` return nothing for a blocked login and the app sends them to "Your access has been suspended" — it is enforced by the database, not only by the screens. You cannot block your own login. Logins without a staff record can be blocked from Settings → Staff & access (`set_member_blocked`).
- **Delete**: `delete_staff()` — full name typed to confirm; refused when the person has payslips, leave records or issued documents (mark Left instead).
- Platform admins are never blocked by this (they have no school login).

## Payroll v2 (step 24, migration `0026_payroll_v2.sql`)
- **Unpaid days from attendance**: with "use attendance" on, absent (A = 1) and half-day (H = 0.5) marks of the month become unpaid days (`payslips.att_lop`), except days already covered by approved leave without pay. Unmarked days count as present. When "working days" is left blank, the month's working days (school working weekdays minus holidays / vacations in the calendar) are used.
- **Statutory lines** (`payroll_settings`, per school; `staff.pf_applicable / esi_applicable / pt_applicable`): PF = rate % of earned basic capped at the wage ceiling (employer share the same rate); ESI = employee % of gross when gross is within the ceiling (+ employer %); professional tax by slab on gross. Lines are marked `auto` in `payslips.deductions` and rebuilt by `payslip_compute` whenever unpaid days or the structure change; approved payslips keep their figures.
- **Salary advances** (`/app/hr/advances`): amount, monthly recovery, balance. The instalment (never more than the balance or what is left of the pay) is a deduction line; **approving** the payroll reduces the balance (FIFO, recorded in `advance_recoveries`), **reopening** gives it back. An advance with recoveries cannot be cancelled.
- **Salary history**: every change of a staff member's earnings is logged (`staff_salary_history`) and shown on the profile.
- **Reports**: per-month `PF / ESI / PT` CSV with employee and employer shares and totals (`/app/hr/payroll/[id]/statutory`); the run page shows PF / ESI / PT / advance under deductions.
- Tests: `supabase/tests/payroll_v2.test.sql` (19 checks).
- Still open: Form 16 / TDS, ECR file format, arrears, leave encashment, loan with interest, bonus runs.

## Logins, reset password, letters and pagination (step 40, 16 Oct 2026) — migration `0042_hr_letters.sql`
- **Create a login while adding staff** (`/app/hr` → Add staff): email, gender, probation months and the tick *Create an ERP login now* with role checkboxes (needs `settings.users.create`). `saveStaff` → `grantStaffLogin()` (`src/lib/staff-login.ts`) finds / creates the sign-in, adds the person to the school with the roles and links `staff.user_id`. The temporary password is shown **once** (httpOnly cookie, 2 minutes, path `/app/hr`) in a green banner with *Copy message* on the list and on the profile. Staff who already have a login elsewhere are just linked.
- **Row actions** on every staff row (`src/components/hr/StaffActions.tsx`): Open · Letters · Create login (modal: email + roles) · **Reset password** (modal with confirmation) · Block (reason, until) / Unblock · Mark left (last working day) / Rejoin. They return to the same filtered page. The same buttons are in the profile header and in an *ERP login* card (login email, roles, link to Roles & access).
- **Reset password** (`resetStaffPassword`, `settings.users.edit`; also in Settings → Staff & access rows): refused for your own login, for a person who also belongs to another school or to the platform team (`passwordResetBlocker`), and when the school has no service key. Writes `user.password_reset` to the audit log. Create login writes `user.login_created`.
- **Letters & documents** card on the profile (`#letters`): the standard HR letters — appointment / joining, offer, confirmation, salary revision, salary certificate, experience, relieving, NOC, warning — as one-click *Issue* buttons (the joining letter first, relieving / experience highlighted once the person has left), plus the staff ID cards and any custom staff template. *Add standard HR letters* (`installHrLetters` / `ensureHrLetters()` in `src/lib/hr-letters.ts`) installs the ones the school lacks; adding a staff member does it automatically. The list of letters already issued to the person is paged and links to the printable copy. Letters take their data from the staff record (`document_data` wrapper in 0042: `staff.mr_ms / he_she / his_her / him_her / address / gross / gross_words / net / net_words / service_years / probation_months / earnings_html`); questions asked at issue (report-by date, new salary, conduct …) come from each template.
- **Pagination everywhere**: staff list (database-side), leave page (waiting, my leave, my payslips, all leave — separate pagers), payroll months, payslips of a run (totals still cover the whole run; *Mark all unpaid as paid* spans pages), and on the profile: salary revisions, leave, payslips, issued letters. Pagers use `pager()` (`src/components/ui/Pagination.tsx`) with their own `?xx=` keys so several can live on one page.
- **Tests**: `hr_letters.test.sql` (pronouns, gross / net in figures and words, service years, breakup table, escaping, issue numbering, teacher refused, probation range, isolation).
- **Gaps**: employee self-service download of own letters, e-sign / acknowledgement of a letter, bulk letters (increment to many), joining-checklist, password change forced on first sign-in.
