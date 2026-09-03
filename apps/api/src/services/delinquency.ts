import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import { todayAsuncion } from "../lib/time.js";

export type MoraRow = {
  customerId: string;
  unpaidPeriods: number;
  debt: string;
  status: string;
};

export async function unpaidPeriodCounts(db: Database, companyId: string): Promise<MoraRow[]> {
  const today = todayAsuncion();
  const rows = await db.execute(sql`
    select
      c.id as "customerId",
      coalesce(a.balance::text, '0') as debt,
      coalesce(a.status, 'AL_DIA') as status,
      (
        select count(distinct wb.billing_period_id)::int
        from water_bills wb
        where wb.customer_id = c.id
          and wb.balance::numeric > 0
          and wb.due_on < ${today}::date
          and wb.status <> 'ANULADA'
      ) as "unpaidPeriods"
    from customers c
    left join customer_accounts a on a.customer_id = c.id
    where c.company_id = ${companyId} and c.deleted_at is null
  `);
  return rows as unknown as MoraRow[];
}

export function moraBucket(unpaidPeriods: number): "AL_DIA" | "1_MES" | "2_MESES" | "3_O_MAS" {
  if (unpaidPeriods <= 0) return "AL_DIA";
  if (unpaidPeriods === 1) return "1_MES";
  if (unpaidPeriods === 2) return "2_MESES";
  return "3_O_MAS";
}

export async function scanDelinquency(db: Database, companyId: string, userId: string | null) {
  const [rule] = await db.select().from(t.delinquencyRules).where(eq(t.delinquencyRules.companyId, companyId)).limit(1);
  const threshold = rule?.unpaidPeriodsForDisconnect ?? 3;
  const rows = await unpaidPeriodCounts(db, companyId);
  const scheduled: string[] = [];
  for (const row of rows) {
    const periods = Number(row.unpaidPeriods ?? 0);
    const debt = Number(row.debt ?? 0);
    let status = "AL_DIA";
    if (debt > 0 && periods >= threshold) status = "MOROSO";
    else if (debt > 0) status = "VENCIDO";
    await db
      .update(t.customerAccounts)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(t.customerAccounts.companyId, companyId), eq(t.customerAccounts.customerId, row.customerId)));
    if (periods >= threshold && debt > 0) {
      const connections = await db
        .select()
        .from(t.connections)
        .where(and(eq(t.connections.customerId, row.customerId), eq(t.connections.companyId, companyId), eq(t.connections.status, "ACTIVA")));
      for (const cn of connections) {
        const [existing] = await db
          .select({ id: t.suspensions.id })
          .from(t.suspensions)
          .where(and(eq(t.suspensions.connectionId, cn.id), eq(t.suspensions.status, "PROGRAMADA")))
          .limit(1);
        if (existing) continue;
        await db.insert(t.suspensions).values({
          companyId,
          customerId: row.customerId,
          connectionId: cn.id,
          reason: `${periods} períodos impagos`,
          debtAmount: row.debt,
          userId,
          status: "PROGRAMADA",
          scheduledAt: new Date(),
        });
        await db.update(t.connections).set({ status: "DESCONEXION_PROGRAMADA", updatedAt: new Date() }).where(eq(t.connections.id, cn.id));
        scheduled.push(cn.id);
      }
    }
  }
  return { scanned: rows.length, scheduled: scheduled.length, threshold };
}
