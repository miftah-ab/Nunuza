// Applies pending Supabase migrations to production before the Worker deploys.
//
// Why not `supabase db push`: production history was recorded under different
// version numbers than the repo file names, so the CLI would try to re-run old
// migrations. This runner matches by migration NAME instead.
//
// Only timestamp-named files (YYYYMMDDHHMMSS_name.sql) are auto-applied. The
// numbered 0001-0021 files are the baseline already in production.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FILE_PATTERN = /^(\d{14})_(.+)\.sql$/;

/** Returns the timestamp-named migration files whose name is not yet applied. */
export function pickPending(files, appliedNames) {
  const applied = new Set(appliedNames);
  return files
    .map((file) => {
      const match = FILE_PATTERN.exec(file);
      return match ? { file, version: match[1], name: match[2] } : null;
    })
    .filter((m) => m && !applied.has(m.name))
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function query(ref, token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase API ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  const dryRun = process.argv.includes("--dry-run");
  if (!token || !ref) {
    console.log("::warning::SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF is not set. Database migrations were NOT applied.");
    return;
  }
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
  const rows = await query(ref, token, "select name from supabase_migrations.schema_migrations");
  const pending = pickPending(readdirSync(dir), rows.map((r) => r.name));
  if (pending.length === 0) {
    console.log("Database is up to date.");
    return;
  }
  for (const m of pending) {
    console.log(`${dryRun ? "Would apply" : "Applying"} ${m.version}_${m.name}`);
    if (dryRun) continue;
    const sql = readFileSync(path.join(dir, m.file), "utf8");
    const record = `insert into supabase_migrations.schema_migrations (version, name) values ('${m.version}', '${m.name.replace(/'/g, "''")}')`;
    await query(ref, token, `begin;\n${sql}\n;\n${record};\ncommit;`);
  }
  console.log(`Applied ${pending.length} migration(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::Migration failed, deploy stopped. ${error.message}`);
    process.exit(1);
  });
}
