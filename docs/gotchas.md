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
