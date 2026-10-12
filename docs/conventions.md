# Conventions

Follow these so new code looks like the rest. Copy from the closest existing module (Homework is the smallest complete example; Transport the most typical CRUD one).

## Pages (`src/app/app/<module>/page.tsx`)

```tsx
export default async function Thing({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { supabase, school, session, can } = await requirePerm("module.sub.view");   // first line
  const sp = await searchParams;
  const [{ data: a }, { data: b }] = await Promise.all([ ...queries... ]);          // parallel queries
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon="..." title="..." subtitle="..." back={{ href, label }} actions={...} />
      <Flash ok={sp.ok} error={sp.error} />
      {can("module.sub.create") && <Card title="Add …"><form action={saveThing} className="grid gap-3 sm:grid-cols-4">…</form></Card>}
      {rows.length ? <Table head={[...]}>{rows.map(r => <tr><td className={td}>…</td></tr>)}</Table> : <Empty>…</Empty>}
    </div>
  );
}
```

- `params` and `searchParams` are **Promises** in Next 16 — `await` them.
- Validate ids from the URL with `/^[0-9a-f-]{36}$/` and `notFound()`.
- Always add `.eq("school_id", school.id)` even though RLS also filters.
- Hide buttons the user can't use with `can("…")`; the action re-checks.
- Edit forms use `?edit=<id>` in the URL and pre-fill `defaultValue`s; no client state.
- Embedded relations from PostgREST come back typed loosely — cast with `as unknown as Type[]`.
- Each module folder has `loading.tsx` (`<TableSkeleton />`).
- UI kit: `src/components/ui/ui.tsx` — `PageHeader, Card, Stat, Table, td, Input, Select, Textarea, Submit, Badge, Flash, Empty, ButtonLink`. `ClassSection` (class + dependent section select), `CopyButton`, `PrintButton`. Badge colours come from the `tone` map (value → good/info/warn/bad/neutral/muted).
- Icons: add to `ICONS` in `src/components/shell/icons.tsx` (Lucide set) and refer by name.
- Money `money()`, dates `fmtDate()`, today in India `todayIST()`, `addDays()`, WhatsApp `waLink(phone, text)` — all in `src/lib/format.ts`. Never use `new Date().toISOString()` for "today" (UTC ≠ IST).

## Server actions (`src/app/app/_actions/<module>.ts`)

```ts
"use server";
export async function saveThing(f: FormData) {
  const id = uuid(f, "id");
  const { supabase, school } = await requirePerm(id ? "m.s.edit" : "m.s.create");
  const name = str(f, "name", 80);
  if (!name) go(back, { error: "Name is required." });
  const { error } = id ? await supabase.from("t").update(row).eq("id", id).eq("school_id", school.id)
                       : await supabase.from("t").insert({ ...row, school_id: school.id });
  revalidatePath("/app/…");
  go(back, error ? { error: errMsg(error) } : { ok: "Saved." });
}
```

- `go(path, {ok|error})` redirects with a flash message (it throws — code after it doesn't run).
- `errMsg()` turns RLS / FK errors into plain English; map unique-constraint names to friendly messages.
- An UPDATE/DELETE blocked by RLS returns **no error and 0 rows** — add `.select("id")` and check `data.length` when it matters.
- Anything that must be atomic or needs rights beyond the user's goes in a **SQL function** (`security definer`) that checks `has_perm_school()` first and is called with `supabase.rpc(...)`. Examples: `collect_fee`, `generate_dues`, `generate_transport_dues`, `generate_payroll`.
- Text written for parents is plain, short and friendly (Indian school context, ₹, "Dear Parent").

## Database / migrations

- New work = **new migration file** `000N_name.sql`; never rename old ones. Make it re-runnable.
- Every school table: `id uuid pk default gen_random_uuid()`, `school_id … on delete cascade`, `created_at`.
- Enable RLS and write policies with the permission functions: read → `has_perm` / `can_student` / `can_class_item`; write → `has_perm_school(school_id, 'm.s.create')` etc. Policies for insert use `with check`, updates need both `using` and `with check`.
- Business invariants go in `before insert/update` **trigger functions** (`guard_*`), e.g. seat limits, copies available, payroll lock.
- Add new tables to the **audit trigger** loop and to the tenant export list (`src/app/platform/tenants/[id]/export/route.ts`).
- Avoid `on delete restrict` on school data — it breaks deleting a whole school (use the default NO ACTION).
- Two policies that query each other's tables recurse forever — break the loop with a `security definer` helper (see `payroll_run_approved`).
- Run `npm run setup-sql` after any migration change; `npm run catalog` after editing `catalog.json`.

## Tests

SQL tests in `supabase/tests/*.test.sql`: a transaction, fake users in `auth.users`, `pg_temp.act_as(uid)` to become a user, `pg_temp.check(cond, 'message')`, and `begin … exception when others` blocks for "must fail" cases; ends with `rollback`. Run on a **throwaway** database:

```bash
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/standard_modules.test.sql
```

No local Postgres on the dev PC? An in-memory PGlite harness with a Supabase auth shim was used on 12 Oct 2026 (Node, `@electric-sql/pglite`): create roles `anon/authenticated/service_role`, schema `auth` with `users`, `uid()`, `jwt()`, `role()`, default privileges, a `gen_random_bytes` shim (no pgcrypto), strip `create extension pgcrypto`, then exec `setup.sql` and each test.

Also run `npx tsc --noEmit`, `npx eslint <changed paths>` and `npm run build` before calling something done.

## New-module checklist

1. `catalog.json`: module/sub-modules/actions exist? add role grants; set `"built": true`; `npm run catalog`.
2. Migration: tables + RLS + guards + audit triggers + SQL functions; `npm run setup-sql`.
3. SQL test: allowed roles can, others can't, other school can't, module-off refuses writes, business rules.
4. `src/app/app/_actions/<module>.ts` + pages + `loading.tsx`.
5. Sidebar entry in `NAV` (`src/app/app/layout.tsx`) with the right `any:` permissions; icon in `icons.tsx`.
6. Parent page section (if families should see it) — gate on `school_modules` enabled.
7. Student / staff profile hooks if relevant; tenant export list; plan `modules` arrays in `0004` if a plan should include it.
8. Docs: `docs/modules/<module>.md`, row in `docs/README.md`, update `roadmap.md`; README product section.
