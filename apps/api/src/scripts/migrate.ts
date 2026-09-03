import "../../src/load-env-file.js";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSql } from "../db/connect.js";
import { loadEnv } from "../env.js";

const env = loadEnv();
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../../");
const sql = createSql(1);
const dir = join(root, "supabase/migrations");

await sql`
  create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`;

const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
for (const name of files) {
  if (name.includes("storage") && env.STORAGE_DRIVER !== "supabase") {
    console.log(`Migración ${name} omitida (STORAGE_DRIVER=${env.STORAGE_DRIVER}; requiere schema storage de Supabase)`);
    continue;
  }
  const applied = await sql`select 1 from schema_migrations where name = ${name} limit 1`;
  if (applied.length) {
    console.log(`Migración ${name} ya aplicada`);
    continue;
  }
  const contents = await readFile(join(dir, name), "utf8");
  await sql.unsafe(contents);
  await sql`insert into schema_migrations (name) values (${name})`;
  console.log(`Migración ${name} aplicada`);
}
await sql.end();
