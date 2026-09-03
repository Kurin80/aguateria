import { DateTime } from "luxon";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";

export function buildInstallmentSchedule(opts: {
  total: number;
  downPayment: number;
  count: number;
  firstDueOn: string;
  timezone?: string;
}): Array<{ number: number; dueOn: string; amount: string }> {
  const count = Math.max(1, Math.floor(opts.count));
  const remainder = Math.max(0, opts.total - opts.downPayment);
  const base = Math.floor(remainder / count);
  const leftover = remainder - base * count;
  const tz = opts.timezone ?? "America/Asuncion";
  let due = DateTime.fromISO(opts.firstDueOn, { zone: tz });
  if (!due.isValid) due = DateTime.now().setZone(tz).plus({ months: 1 }).startOf("day");
  const rows: Array<{ number: number; dueOn: string; amount: string }> = [];
  for (let i = 0; i < count; i++) {
    const amount = i === 0 ? base + leftover : base;
    rows.push({
      number: i + 1,
      dueOn: due.toISODate() ?? opts.firstDueOn,
      amount: amount.toFixed(2),
    });
    due = due.plus({ months: 1 });
  }
  return rows;
}

export async function createInstallmentPlan(
  db: Database,
  input: {
    companyId: string;
    customerId: string;
    connectionId?: string;
    kind: "CONEXION" | "DEUDA";
    total: string;
    downPayment: string;
    count: number;
    firstDueOn: string;
    createdBy: string;
    notes?: string;
  },
) {
  const schedule = buildInstallmentSchedule({
    total: Number(input.total),
    downPayment: Number(input.downPayment),
    count: input.count,
    firstDueOn: input.firstDueOn,
  });
  const [plan] = await db
    .insert(t.installmentPlans)
    .values({
      companyId: input.companyId,
      customerId: input.customerId,
      connectionId: input.connectionId,
      kind: input.kind,
      total: input.total,
      downPayment: input.downPayment,
      installmentCount: input.count,
      notes: input.notes,
      createdBy: input.createdBy,
    })
    .returning();
  if (schedule.length) {
    await db.insert(t.installmentItems).values(
      schedule.map((row) => ({
        planId: plan!.id,
        number: row.number,
        dueOn: row.dueOn,
        amount: row.amount,
      })),
    );
  }
  return { plan, items: schedule };
}
