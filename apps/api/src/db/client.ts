import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { createSql } from "./connect.js";

let sql: ReturnType<typeof createSql> | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (dbInstance) return dbInstance;
  // En serverless (Vercel) cada invocación tiene su propio pool: 1 conexión por
  // instancia evita agotar el pooler de Supabase. En servidor persistente, 4.
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  sql = createSql(isServerless ? 1 : 4);
  dbInstance = drizzle(sql, { schema });
  return dbInstance;
}

export type Database = ReturnType<typeof getDb>;

export async function closeDb(): Promise<void> {
  if (sql) await sql.end();
  sql = null;
  dbInstance = null;
}
