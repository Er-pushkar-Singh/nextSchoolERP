// Builds supabase/setup.sql = every migration in order, for one paste into the Supabase SQL editor.
// Run: node scripts/build-setup.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const dir = root + "supabase/migrations/";
const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const last = files.at(-1).slice(0, 4);
const header = `-- School ERP: full database setup (migrations 0001–${last} combined).
-- Paste into Supabase SQL Editor and Run. Safe to run again; existing data and members are kept.
-- Works in its own Supabase project or next to the CodersDuniya website/CRM tables (no name clashes).

`;
const body = files.map((f) => fs.readFileSync(dir + f, "utf8").trimEnd()).join("\n\n");
// keep the "make yourself the owner" note at the very end
const ownerNote = body.match(/\n-- ─+ Make yourself the platform owner[\s\S]*?on conflict do nothing;\n?/);
const out = header + (ownerNote ? body.replace(ownerNote[0], "\n") + "\n" + ownerNote[0].trimEnd() : body) + "\n";
fs.writeFileSync(root + "supabase/setup.sql", out);
console.log(`setup.sql: ${files.length} migrations, ${out.length} bytes`);
