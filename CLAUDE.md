# School ERP — notes for Claude

@AGENTS.md

**Before changing anything, read [docs/README.md](docs/README.md)**, then only the module doc you need (`docs/modules/<module>.md`). Architecture, patterns and known traps are in `docs/architecture.md`, `docs/conventions.md`, `docs/gotchas.md`; what to build next is in `docs/roadmap.md`.

- Multi-school SaaS on Next.js 16 + Supabase. Permissions and business rules live in Postgres (RLS + SQL functions in `supabase/migrations/`); pages and server actions also check `requirePerm()`.
- New database work = a new re-runnable migration `supabase/migrations/000N_*.sql`, then `npm run setup-sql`. Catalogue changes: edit `src/lib/catalog.json`, then `npm run catalog`.
- Add or adjust a SQL test in `supabase/tests/` for every permission or business rule; also run `npx tsc --noEmit` and `npm run build`.
- Never run experiments against the database in `.env.local` — it is the real project.
- **Update the module's doc in `docs/` in the same change** (routes, tables, rules, gaps).
