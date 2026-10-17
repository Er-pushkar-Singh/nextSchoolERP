# Gotchas & lessons

Things that have already bitten this project. Check here before debugging something strange.

## Security / database

- **NULL is not false in plpgsql.** `if not some_bool_fn() then raise …` does *nothing* when the function returns NULL. `has_perm_school()` used to return NULL for users with no grant, so every guard in `collect_fee`, `generate_dues`, `promote_students`, `set_module_enabled`, `next_school_number`, `set_current_session`, `reset_role_to_template` let any signed-in user through via the API. Fixed 12 Oct 2026 (`coalesce(…, false)` in 0003 and 0007). Any new boolean helper must never return NULL; regression test in `standard_modules.test.sql`.
- **RLS recursion.** If table A's policy queries table B and B's policy queries A, Postgres loops forever ("infinite recursion detected in policy"). Use a `security definer` helper function for one side (`payroll_run_approved`, `has_my_payslip`).
- **Cascades vs guard triggers.** When a school is deleted, child rows are removed by cascade *after* the parent; a trigger that looks the parent up finds nothing. `guard_member_roles` used to raise "Role belongs to another school", so **deleting any school failed** — fixed 12 Oct 2026 (return early on DELETE when the role is gone). `guard_payroll_run` allows deleting approved runs only when the school itself is gone. Don't use `on delete restrict` on school data.
- **RLS-blocked UPDATE/DELETE is silent** (0 rows, no error). Use `.select("id")` and check.
- **Security-definer functions bypass RLS** — they must check permissions themselves, and must check the row belongs to `sid`.
- `fee_dues.unique(student_id, fee_plan_id)` does not stop duplicates when `fee_plan_id` is NULL (NULLs are distinct). Non-plan dues (transport) use `source_key` with a partial unique index instead.
- Writes are refused while a subscription is expired / pending / suspended (`school_writable()` inside `perm_scope()`), and for modules the plan doesn't license. A "permission denied" during testing is often one of these, not a role problem.
- Platform admins are read-only inside schools unless a **support session** is active.

- **`text[] || 'literal'` is parsed as an array literal.** `missing := missing || 'gender'` fails with "malformed array literal"; write `|| 'gender'::text`. Found by the step-6 test.
- **Student edit rights.** The `students` UPDATE policy must stay `can_student(..., 'students.profile.edit', id)`; an OR with other permissions let those holders change every column. Do special updates through `security definer` functions (`reset_portal_token`, `promote_students`).
- **Enrolment history is trigger-maintained.** Change class / status through `students` and the trigger records it; never insert into `student_enrolments` by hand. Promotion refuses to run in the same session as the open enrolments.
- **Audit masking**: `audit_row()` logs contact / address / health columns as "changed" (list in the function); add new sensitive columns to that list.
- **Private files**: documents are in the private `student-docs` bucket; only the secret-key client touches storage, after a permission check. Never put a storage URL in a page for people who may not view the document.

- **Security-definer functions are public API.** Anything in `public` that PostgREST can see is callable with the anon / authenticated key. A helper that takes an id and returns data (`build_board_snapshot`, `lwp_days`) or writes (`open_enrolment`, `bill_student_dues`) must be `revoke execute … from public, anon, authenticated` (other security-definer functions call it fine) or must check permission itself. Policies may call functions only if `authenticated` can execute them.
- **Aadhaar is never stored in the clear and never in the database's own encryption**: the app encrypts it (`encryptJson`) and the table check `aadhaar_enc is null or aadhaar_consent` enforces consent. Losing `SETTINGS_ENCRYPTION_KEY` makes stored Aadhaar numbers unreadable (last 4 stay).
- **Board rules change every year.** `board_subject_codes` and `src/lib/board-rules.ts` are written from the 2027 notices; re-read the new notice before each season.

- **Postgres regex: `` is a backspace, not a word boundary** — use `\y`. (Caught by the template sanitizer test.)

## App

- **Next 16**: `params` / `searchParams` are Promises; middleware lives in `src/proxy.ts`; read `node_modules/next/dist/docs/` for anything unfamiliar. `next dev` rewrites `AGENTS.md` — keep that block.
- Use `todayIST()` for dates; `new Date()` on the server is UTC and is a day off before 05:30 IST.
- PostgREST `.or()` strings break on commas / parentheses in user input — run search text through `cleanSearch()`, or use `.eq()`.
- PostgREST caps responses at 1000 rows by default; aggregates (dashboards, defaulters) are SQL functions for that reason. Add `.limit(n)` deliberately on big lists.
- `supabaseAdmin()` bypasses RLS — only in the parent page, login creation, integrations secrets, webhooks, cron. Never in normal pages.
- Integration secrets are AES-256-GCM encrypted with `SETTINGS_ENCRYPTION_KEY`; changing that key makes every saved secret unreadable.
- Forms with several submit buttons pass the clicked button's `name`/`value` (used for Approve / Reject).

## Tooling (Windows dev PC)

- `scripts/*.mjs` used `new URL(…).pathname`, which gives `/C:/…` on Windows and crashed `npm run catalog`. Fixed 12 Oct 2026 with `fileURLToPath`.
- No `psql` / Docker on the PC — see the PGlite harness note in [conventions.md](conventions.md#tests).
- The project is **not a git repository** yet; snapshots were kept as `.tgz` files in `../_to_delete/` (v1–v6). Set up git before the next big change.
- `.env.local` points at the real Supabase project — don't run tests or experiments against it.

## Fees 2.0 traps (step 10)
- `fee_dues` money columns are guarded by `guard_fee_due`: a PostgREST `update` from the app now fails. Change dues only through the RPCs (`adjust_due_amount`, `waive_due`, `reapply_concessions` …). The guard keys on `current_user` (`authenticated` / `anon`), so security-definer functions pass.
- `fee_dues.fine` is the TOTAL fine; `fine_auto` is the rule's share. Recompute with `apply_late_fines_core`, never add to `fine` by hand.
- Mode reports must read `fee_receipt_payments`, not `fee_receipts.mode` (a mixed receipt has mode `mixed`).
- A pending / rejected concession is ignored by `concession_for()`; after approving always call `reapply_concessions`.
- Fees online uses the **school's own** Razorpay only (`resolveIntegration(...).source === 'school'`); the webhook is `/api/razorpay/fees`, separate from the subscription webhook `/api/razorpay/webhook`.

## Step 11 traps
- Seed / maintenance scripts run as `postgres` have no `auth.uid()`: permission functions return false. `supabase/seed/demo_data.sql` sets `request.jwt.claims` to the school's Principal first; do the same in any new script. Never name a table alias like a plpgsql record variable (`r`).
- `bill_student_dues()` now also applies the sibling rule. It is only called from `admit_application()`.
- `admit_application()` does not check seats; the UI warns. Seat control is `admission_seats()` + `promote_waitlist()`.
- `fee_dues.kind = 'charge'` rows made by `split_due` have no `fee_plan_id` (the unique `(student_id, fee_plan_id)` index would otherwise clash).

## People management traps (step 12)
- `perm_scope()` / `my_permissions()` were redefined in 0014 (block check first). If you redefine them again, keep `member_blocked()`.
- `student_list()` / `staff_list()` are `SECURITY INVOKER` on purpose: RLS (assigned sections, own records) must apply. Do not make them definer.
- `like_escape()` is used for every search; never interpolate user text into `.or(ilike…)` any more — call the list functions.
- Page files in the App Router may export only the page itself (no extra `export const`); keep shared constants in `src/lib`.
- A `<form>` or block element inside `<p>` breaks hydration. `node scratchpad/nestcheck.mjs` (JSX nesting) and `schemacheck.mjs` (columns / RPC names vs the real schema) were used to audit the code; both are worth re-creating in `scripts/` if the screens grow.

## Admission flow traps (step 13)
- `students.class_id` is NULL while `status = 'admission_pending'`. Anything that joins students to classes with an inner join will not see them (intended). `bill_student_dues()` (class from the student) is for active students; applicants are billed with `bill_application_dues(sid, stu, class)`.
- Approval is gated inside `guard_application()` (needs `approval_blockers(new)`); do not approve with a plain update in new code unless `strict_workflow` is off for that school.
- `admit_application()` sets `app.admitting = '1'` before touching the application row; the "class is fixed once the admission started" guard honours that flag.
- `application_board()` recomputes the stage per row (no stored stage column) — keep the stage rules in sync with `application_progress()`.

## Step 14 traps
- **One foreign key per pair of tables** is the safest design for PostgREST embeds. Two FKs (e.g. `students.class_id` and `students.admission_class_id` → `classes`) make `classes(name)` ambiguous and the whole page returns "not found" (the code treated the error as "no row"). Either use one FK (the rest plain uuid columns) or write `classes!class_id(name)`.
- Pages that do `if (!row) notFound()` also swallow query errors. When a page 404s for a record that exists, check the select string first.
- Do not name a plpgsql parameter `kind` when the query touches a table that has a column `kind` (`fee_dues.kind`): use `p_kind`.

## `not` on a nullable permission helper (step 19)
`public.can_section()` / `can_student()` can return **null** (no role in that school). `if not public.can_section(...) then raise …` then silently *passes*, because `not null` is null. Always `if not coalesce(public.can_section(...), false)` (the attendance QR scan had exactly this hole; the cross-school test caught it).

## Device endpoints are service-role only
`device_scan` / `device_info` are granted to `service_role` only and checked with `is_service()`; the browser never calls them. The kiosk page and machines go through `/api/attendance/punch` with the device token.

## Steps 29–33 traps (15 Oct 2026)
- **Seed variables shadow table aliases.** `demo_scale.sql` declares `r`, `k`, `i` at the top; a subquery alias `r` or a `generate_series(...) k` inside it fails with "record r has no field" / "column k is ambiguous". Use distinct aliases (`hr`, `kk`) in new seed blocks.
- **Scoped permissions and report functions.** `has_perm_school()` is true only for school scope; `has_perm()` is true for any scope. A report function that must also serve an "assigned" teacher uses `has_perm()` and filters rows with `_report_class_ok()`; otherwise the page passes `requirePerm` and the RPC raises.
- **Pickers need their own lookup.** A librarian or warden has no access to the student profile, so `/api/lookup?kind=student` goes through the security-definer `student_lookup()` (each permission checked with its own scope) instead of reading `students` under RLS.
- **Several pickers with the same `name`.** An empty `EntityPicker` still submits `name=""`; when pairing rows with a role field (discipline incident), pair by position and drop empty ids afterwards.
- **`date`/`time` render rule.** `Date.now()` in a server page is flagged by the React purity lint; use `todayIST()` / `nowMs()` from `lib/format`.

## Step 40 traps (16 Oct 2026)
- **A school must never reset a shared login.** One sign-in can belong to several schools (and to the platform team). `resetStaffPassword` first checks, with the service key, that the person is a member of *this school only* and not in `platform_admins` (`passwordResetBlocker`); otherwise any school could take over another school's user.
- **One-time password cookie is path-scoped.** `showPasswordOnce("/app/hr", …)` is only sent to pages under `/app/hr`; resetting from Settings → Staff uses `/app/settings/staff`. `staffBack()` / the action choose the path from the `back` value — new screens that reset passwords must pass a `back` under one of those two paths.
- **Several pagers on one page.** Use `pager(sp, "xp", "xs")` per list (distinct keys); a pager keeps the other lists' query values. Order a paged list by a stable tie-breaker (`id`) too, or rows can repeat between pages.
- **Ordering by an embedded column.** `staff(name)` can't be relied on to order the parent; the payroll run page loads a light list, sorts by name in code and fetches full rows for the page ids. Paged payslips on a profile come from `payroll_runs` with `payslips!inner(...)` filtered by staff.
- **Letter wording.** `staff.his_her` is lower case (`his` / `her` / `the`) — never start a sentence with it; use `{{staff.name}}`.
- **"The teacher sees no students" = no `staff_assignments`.** Scope `assigned` is enforced in the database (`can_student` / `can_section`); creating a login with the Class teacher role is not enough — assign the section (HR profile → Classes & subjects).

## Step 41–43 traps (17 Oct 2026)
- **Permission answers are remembered per request.** `perm_scope`, `assigned_to_section`, `is_member`, `has_module_perm`, `is_platform_admin` keep their answer in a transaction-local setting (`erp.p…`), cleared by the `erp.gen` counter that statement triggers bump on every table a permission depends on (member_roles, role_permissions, member_overrides, school_modules, school_members, platform_admins, support_sessions, group_members, erp_modules, staff_assignments, schools status / group). **Change the rules in `perm_scope_calc` / `*_calc`, never in the wrapper**; if a new table feeds a permission, add it to the trigger list in `0045_performance.sql`. `perm_memo.test.sql` guards this.
- **Do not put `$$` in a JavaScript replacement string** (`String.replace` turns `$$` into `$`) when generating migrations — use a function replacement.
- **A document question named `exam_id` means a declared result** (marksheets); an admit card asks `exam_ref` so the result block is never built for an examination that has no result yet.
- **Parent logins are fake e-mails on purpose** (`@family.erp.local`, `@student.erp.local`): Supabase needs an e-mail, nothing is ever sent to it. Real e-mail addresses on the guardian are used when present.
- **The family portal reads with the service key** after `requireChild()`; any new family page must start with `requireChild(studentId)` (or `getFamily()`), never read by an id from the URL alone.
- **`student_list` has two paths**: the light one adds up fee dues only for the page; sort by dues / the dues filter use `student_list_dues` (the old full version). Keep their output columns identical.
