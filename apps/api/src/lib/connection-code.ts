import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";

export function formatEntityCode(prefix: string, n: number): string {
  return `${prefix}-${String(Math.max(1, n)).padStart(6, "0")}`;
}

export function formatConnectionCode(n: number): string {
  return formatEntityCode("CON", n);
}

export function formatCustomerCode(n: number): string {
  return formatEntityCode("CLI", n);
}

async function nextNumericCode(db: Database, companyId: string, table: "connections" | "customers", prefix: string): Promise<string> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`${table}-code:${companyId}`}))`);
  const pattern = `^${prefix}-[0-9]+$`;
  const rows =
    table === "connections"
      ? await db.execute(sql`
          select coalesce(max(nullif(regexp_replace(code, '\\D', '', 'g'), '')::int), 0)::int as n
          from connections where company_id = ${companyId} and code ~ ${pattern}
        `)
      : await db.execute(sql`
          select coalesce(max(nullif(regexp_replace(code, '\\D', '', 'g'), '')::int), 0)::int as n
          from customers where company_id = ${companyId} and code ~ ${pattern}
        `);
  const row = (rows as unknown as Array<{ n?: number }>)[0];
  return formatEntityCode(prefix, Number(row?.n ?? 0) + 1);
}

export async function nextConnectionCode(db: Database, companyId: string): Promise<string> {
  return nextNumericCode(db, companyId, "connections", "CON");
}

export async function nextCustomerCode(db: Database, companyId: string): Promise<string> {
  return nextNumericCode(db, companyId, "customers", "CLI");
}

/** Vista previa del próximo código. No consume la secuencia; el alta sigue usando el lock. */
export async function peekCustomerCode(db: Database, companyId: string): Promise<string> {
  const pattern = "^CLI-[0-9]+$";
  const rows = await db.execute(sql`
    select coalesce(max(nullif(regexp_replace(code, '\\D', '', 'g'), '')::int), 0)::int as n
    from customers where company_id = ${companyId} and code ~ ${pattern}
  `);
  const row = (rows as unknown as Array<{ n?: number }>)[0];
  return formatEntityCode("CLI", Number(row?.n ?? 0) + 1);
}
