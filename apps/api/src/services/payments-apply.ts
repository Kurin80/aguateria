import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import { todayAsuncion } from "../lib/time.js";
import { isCollectableInstallment } from "./collectable-debts.js";

export function nextBillStatus(input: {
  total: number;
  balance: number;
  dueOn: string;
  today: string;
  current: string;
}): string {
  if (input.current === "ANULADA") return "ANULADA";
  if (input.balance <= 0.009) return "PAGADA";
  if (input.balance < input.total - 0.009) return "PARCIAL";
  if (input.dueOn < input.today) return "VENCIDA";
  return input.current === "EMITIDA" ? "EMITIDA" : "PENDIENTE";
}

export async function reversePayment(
  db: Database,
  opts: { companyId: string; paymentId: string },
): Promise<void> {
  const today = todayAsuncion();
  const [pay] = await db
    .select()
    .from(t.payments)
    .where(and(eq(t.payments.id, opts.paymentId), eq(t.payments.companyId, opts.companyId)))
    .limit(1);
  if (!pay) throw new Error("Pago no encontrado");
  if (pay.reversedAt) throw new Error("Pago ya anulado");

  const allocations = await db.select().from(t.paymentAllocations).where(eq(t.paymentAllocations.paymentId, pay.id));
  for (const row of allocations) {
    if (!row.waterBillId) continue;
    const [bill] = await db.select().from(t.waterBills).where(eq(t.waterBills.id, row.waterBillId)).limit(1);
    if (!bill || bill.status === "ANULADA") continue;
    const restored = Math.min(Number(bill.total), Number(bill.balance) + Number(row.amount));
    await db
      .update(t.waterBills)
      .set({
        balance: restored.toFixed(2),
        status: nextBillStatus({
          total: Number(bill.total),
          balance: restored,
          dueOn: bill.dueOn,
          today,
          current: restored + 0.009 >= Number(bill.total) ? "PENDIENTE" : "PARCIAL",
        }),
      })
      .where(eq(t.waterBills.id, bill.id));
  }

  const items = await db
    .select()
    .from(t.installmentItems)
    .where(eq(t.installmentItems.paymentId, pay.id))
    .orderBy(sql`${t.installmentItems.number} desc`);
  let rest = Number(pay.amount);
  for (const item of items) {
    if (rest <= 0) break;
    const paid = Number(item.paidAmount);
    const take = Math.min(paid, rest);
    const newPaid = Math.max(0, paid - take);
    const status = newPaid <= 0.009 ? "PENDIENTE" : newPaid + 0.009 >= Number(item.amount) ? "PAGADA" : "PARCIAL";
    await db
      .update(t.installmentItems)
      .set({
        paidAmount: newPaid.toFixed(2),
        status,
        paymentId: newPaid <= 0.009 ? null : item.paymentId,
      })
      .where(eq(t.installmentItems.id, item.id));
    rest -= take;
  }

  const [account] = await db.select().from(t.customerAccounts).where(eq(t.customerAccounts.customerId, pay.customerId)).limit(1);
  if (account) {
    await db.insert(t.accountMovements).values({
      accountId: account.id,
      movementType: "ANULACION",
      amount: pay.amount,
      paymentId: pay.id,
    });
    await db
      .update(t.customerAccounts)
      .set({
        balance: sql`${t.customerAccounts.balance} + ${pay.amount}::numeric`,
        status: "VENCIDO",
        updatedAt: new Date(),
      })
      .where(eq(t.customerAccounts.id, account.id));
  }

  await db.update(t.payments).set({ reversedAt: new Date() }).where(eq(t.payments.id, pay.id));
}

export async function applyPaymentToOpenBills(
  db: Database,
  opts: {
    companyId: string;
    customerId: string;
    paymentId: string;
    amount: string;
    waterBillId?: string;
  },
): Promise<void> {
  const today = todayAsuncion();
  let remaining = Number(opts.amount);
  if (!Number.isFinite(remaining) || remaining <= 0) return;

  const filters = [
    eq(t.waterBills.companyId, opts.companyId),
    eq(t.waterBills.customerId, opts.customerId),
    sql`${t.waterBills.balance}::numeric > 0`,
    sql`${t.waterBills.status} <> 'ANULADA'`,
    sql`coalesce(${t.waterBills.kind}, 'CONSUMO') = 'CONSUMO'`,
  ];
  if (opts.waterBillId) filters.push(eq(t.waterBills.id, opts.waterBillId));

  const bills = await db
    .select()
    .from(t.waterBills)
    .where(and(...filters))
    .orderBy(asc(t.waterBills.dueOn), asc(t.waterBills.issuedOn));

  for (const bill of bills) {
    if (remaining <= 0) break;
    const due = Number(bill.balance);
    const take = Math.min(remaining, due);
    if (take <= 0) continue;
    await db.insert(t.paymentAllocations).values({
      paymentId: opts.paymentId,
      waterBillId: bill.id,
      amount: take.toFixed(2),
    });
    const newBalance = Math.max(0, due - take);
    await db
      .update(t.waterBills)
      .set({
        balance: newBalance.toFixed(2),
        status: nextBillStatus({
          total: Number(bill.total),
          balance: newBalance,
          dueOn: bill.dueOn,
          today,
          current: bill.status,
        }),
      })
      .where(eq(t.waterBills.id, bill.id));
    remaining -= take;
  }

  const items = await db.execute(sql`
    select i.id, i.amount, i.paid_amount as "paidAmount", i.due_on as "dueOn", i.number, p.id as "planId"
    from installment_items i
    join installment_plans p on p.id = i.plan_id
    where p.company_id = ${opts.companyId}
      and p.customer_id = ${opts.customerId}
      and p.status = 'VIGENTE'
      and i.status in ('PENDIENTE','PARCIAL')
    order by i.due_on, i.number
  `);
  const pending = items as unknown as Array<{ id: string; amount: string; paidAmount: string; dueOn: string; number: number; planId: string }>;
  const byPlan = new Map<string, typeof pending>();
  for (const item of pending) {
    const list = byPlan.get(item.planId) ?? [];
    list.push(item);
    byPlan.set(item.planId, list);
  }
  const collectable: typeof pending = [];
  for (const list of byPlan.values()) {
    const soon = list.filter((row) => isCollectableInstallment(row.dueOn, today));
    collectable.push(...(soon.length ? soon : list.slice(0, 1)));
  }
  let rest = remaining;
  for (const item of collectable) {
    if (rest <= 0) break;
    const amount = Number(item.amount);
    const paid = Number(item.paidAmount);
    const take = Math.min(rest, Math.max(0, amount - paid));
    if (take <= 0) continue;
    const newPaid = paid + take;
    const status = newPaid + 0.009 >= amount ? "PAGADA" : "PARCIAL";
    await db
      .update(t.installmentItems)
      .set({ paidAmount: newPaid.toFixed(2), status, paymentId: opts.paymentId })
      .where(eq(t.installmentItems.id, item.id));
    rest -= take;
  }
}
