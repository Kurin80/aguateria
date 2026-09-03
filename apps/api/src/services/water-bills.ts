import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import { loadEnv } from "../env.js";
import { jsonError } from "../lib/errors.js";
import { todayAsuncion } from "../lib/time.js";
import { calculateConsumption, tariffRuleToCalc } from "./consumption.js";
import { buildWaterBillPdf } from "./bill-pdf.js";
import { billQrPng } from "./bill-qr.js";
import { nextBillStatus } from "./payments-apply.js";

export type GeneratedBill = {
  id: string;
  number: string;
  total: string;
};

export function resolveCreditAmount(requested: string | undefined, balance: string): number {
  const bal = Math.round(Number(balance));
  const amt = requested == null || requested === "" ? bal : Math.round(Number(requested));
  if (!Number.isFinite(bal) || bal <= 0) throw jsonError("VALIDATION_ERROR", "La boleta no tiene saldo para acreditar", 400);
  if (!Number.isFinite(amt) || amt <= 0) throw jsonError("VALIDATION_ERROR", "El importe de crédito debe ser un entero mayor a cero", 400);
  if (amt > bal) throw jsonError("VALIDATION_ERROR", "El crédito no puede superar el saldo de la boleta", 400);
  return amt;
}

function creditBillNumber(sourceNumber: string, attempt: number): string {
  const base = sourceNumber.startsWith("B-") ? `BC-${sourceNumber.slice(2)}` : `BC-${sourceNumber}`;
  return attempt <= 1 ? base : `${base}-${attempt}`;
}

async function tariffCalcForConnection(db: Database, connection: { tariffId: string | null }) {
  if (!connection.tariffId) return null;
  const [rule] = await db.select().from(t.tariffRules).where(eq(t.tariffRules.tariffId, connection.tariffId)).limit(1);
  if (!rule) return null;
  let taxRate = 0;
  let taxExempt = true;
  if (rule.taxRateId) {
    const [tr] = await db.select().from(t.taxRates).where(eq(t.taxRates.id, rule.taxRateId)).limit(1);
    taxRate = Number(tr?.rate ?? 0);
    taxExempt = Boolean(tr?.exempt);
  }
  return {
    tariffId: connection.tariffId,
    calcRule: tariffRuleToCalc(rule, { rate: taxRate, exempt: taxExempt }),
  };
}

/** Calcula consumo y emite boleta para una lectura. No es DTE SIFEN. */
export async function upsertBillForReading(
  db: Database,
  opts: {
    companyId: string;
    reading: {
      id: string;
      connectionId: string;
      billingPeriodId: string | null;
      consumptionM3: string;
      billed: boolean;
    };
  },
): Promise<GeneratedBill | null> {
  const { companyId, reading } = opts;
  if (!reading.billingPeriodId || reading.billed) return null;

  const [connection] = await db.select().from(t.connections).where(eq(t.connections.id, reading.connectionId)).limit(1);
  if (!connection || connection.companyId !== companyId) return null;

  const [period] = await db.select().from(t.billingPeriods).where(eq(t.billingPeriods.id, reading.billingPeriodId)).limit(1);
  if (!period) return null;

  const tariff = await tariffCalcForConnection(db, connection);
  if (!tariff) return null;

  const calc = calculateConsumption(Number(reading.consumptionM3), tariff.calcRule);
  const [calcRow] = await db
    .insert(t.consumptionCalculations)
    .values({
      companyId,
      connectionId: connection.id,
      billingPeriodId: period.id,
      readingId: reading.id,
      tariffId: tariff.tariffId,
      consumptionM3: String(calc.consumptionM3),
      minM3: String(calc.minM3),
      excessM3: String(calc.excessM3),
      fixedCharge: calc.fixedCharge,
      consumptionAmount: calc.consumptionAmount,
      excessAmount: calc.excessAmount,
      surchargeAmount: calc.surchargeAmount,
      discountAmount: calc.discountAmount,
      taxAmount: calc.taxAmount,
      subtotal: calc.subtotal,
      total: calc.total,
      snapshot: calc,
    })
    .onConflictDoUpdate({
      target: [t.consumptionCalculations.connectionId, t.consumptionCalculations.billingPeriodId],
      set: {
        readingId: reading.id,
        total: calc.total,
        subtotal: calc.subtotal,
        taxAmount: calc.taxAmount,
        consumptionM3: String(calc.consumptionM3),
        minM3: String(calc.minM3),
        excessM3: String(calc.excessM3),
        fixedCharge: calc.fixedCharge,
        consumptionAmount: calc.consumptionAmount,
        excessAmount: calc.excessAmount,
        surchargeAmount: calc.surchargeAmount,
        discountAmount: calc.discountAmount,
        snapshot: calc,
      },
    })
    .returning();

  const number = `B-${period.code}-${connection.code}`;
  const [exists] = await db.select().from(t.waterBills).where(eq(t.waterBills.number, number)).limit(1);
  if (exists) {
    await db.update(t.meterReadings).set({ billed: true, updatedAt: new Date() }).where(eq(t.meterReadings.id, reading.id));
    return { id: exists.id, number: exists.number, total: exists.total };
  }

  const [bill] = await db
    .insert(t.waterBills)
    .values({
      companyId,
      number,
      customerId: connection.customerId,
      connectionId: connection.id,
      billingPeriodId: period.id,
      calculationId: calcRow?.id,
      issuedOn: todayAsuncion(),
      dueOn: period.dueOn ?? todayAsuncion(),
      subtotal: calc.subtotal,
      taxAmount: calc.taxAmount,
      total: calc.total,
      balance: calc.total,
      kind: "CONSUMO",
    })
    .returning();
  if (!bill) return null;

  const erssanPct = tariff.calcRule.erssanPercent ?? 2;
  const items = [
    {
      billId: bill.id,
      code: "AGUA",
      description: `Consumo de agua ${period.code}`,
      quantity: String(calc.billedLiters),
      unitAmount: calc.waterGross,
      taxAmount: calc.taxAmount,
      total: calc.waterGross,
    },
  ];
  if (Number(calc.erssanAmount) > 0.009) {
    items.push({
      billId: bill.id,
      code: "ERSSAN",
      description: `ERSSAN ${erssanPct}% ${period.code}`,
      quantity: "1",
      unitAmount: calc.erssanAmount,
      taxAmount: "0.00",
      total: calc.erssanAmount,
    });
  }
  if (Number(calc.fixedCharge) > 0.009) {
    items.push({
      billId: bill.id,
      code: "FIX",
      description: "Cargo fijo",
      quantity: "1",
      unitAmount: calc.fixedCharge,
      taxAmount: "0.00",
      total: calc.fixedCharge,
    });
  }
  await db.insert(t.waterBillItems).values(items);

  const [account] = await db.select().from(t.customerAccounts).where(eq(t.customerAccounts.customerId, connection.customerId)).limit(1);
  if (account) {
    await db.insert(t.accountMovements).values({
      accountId: account.id,
      movementType: "BOLETA",
      amount: calc.total,
      waterBillId: bill.id,
    });
    await db
      .update(t.customerAccounts)
      .set({ balance: sql`${t.customerAccounts.balance} + ${calc.total}`, status: "PENDIENTE", updatedAt: new Date() })
      .where(eq(t.customerAccounts.id, account.id));
  }

  await db.update(t.meterReadings).set({ billed: true, updatedAt: new Date() }).where(eq(t.meterReadings.id, reading.id));
  return { id: bill.id, number: bill.number, total: bill.total };
}

export async function findBillForReading(
  db: Database,
  reading: { connectionId: string; billingPeriodId: string | null },
): Promise<GeneratedBill | null> {
  if (!reading.billingPeriodId) return null;
  const [bill] = await db
    .select()
    .from(t.waterBills)
    .where(
      and(
        eq(t.waterBills.connectionId, reading.connectionId),
        eq(t.waterBills.billingPeriodId, reading.billingPeriodId),
        sql`coalesce(${t.waterBills.kind}, 'CONSUMO') = 'CONSUMO'`,
      ),
    )
    .limit(1);
  return bill ? { id: bill.id, number: bill.number, total: bill.total } : null;
}

export async function issueCreditBill(
  db: Database,
  opts: { companyId: string; sourceBillId: string; amount?: string; reason?: string },
): Promise<GeneratedBill> {
  const [source] = await db.select().from(t.waterBills).where(eq(t.waterBills.id, opts.sourceBillId)).limit(1);
  if (!source || source.companyId !== opts.companyId) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
  if (source.kind === "CREDITO") throw jsonError("VALIDATION_ERROR", "No se emite crédito sobre otra boleta de crédito", 400);
  if (source.status === "ANULADA") throw jsonError("VALIDATION_ERROR", "No se puede acreditar una boleta anulada", 400);

  const amount = resolveCreditAmount(opts.amount, source.balance);
  const amountStr = amount.toFixed(2);
  const today = todayAsuncion();
  const ratio = Number(source.total) > 0 ? amount / Number(source.total) : 1;
  const taxAmount = Math.round(Number(source.taxAmount) * ratio).toFixed(2);
  const subtotal = Math.max(0, amount - Math.round(Number(taxAmount))).toFixed(2);

  let number = creditBillNumber(source.number, 1);
  for (let n = 1; n < 20; n++) {
    number = creditBillNumber(source.number, n);
    const [exists] = await db.select({ id: t.waterBills.id }).from(t.waterBills).where(eq(t.waterBills.number, number)).limit(1);
    if (!exists) break;
  }

  const [bill] = await db
    .insert(t.waterBills)
    .values({
      companyId: source.companyId,
      number,
      customerId: source.customerId,
      connectionId: source.connectionId,
      billingPeriodId: source.billingPeriodId,
      calculationId: null,
      issuedOn: today,
      dueOn: source.dueOn,
      subtotal,
      taxAmount,
      total: amountStr,
      balance: "0.00",
      status: "APLICADA",
      kind: "CREDITO",
      relatedBillId: source.id,
      reason: opts.reason?.trim() || `Crédito sobre ${source.number}`,
    })
    .returning();
  if (!bill) throw jsonError("INTERNAL", "No se pudo emitir la boleta de crédito", 500);

  await db.insert(t.waterBillItems).values({
    billId: bill.id,
    code: "CREDITO",
    description: `Crédito sobre boleta ${source.number}`,
    quantity: "1",
    unitAmount: amountStr,
    taxAmount,
    total: amountStr,
  });

  const newBalance = Math.max(0, Math.round(Number(source.balance)) - amount);
  await db
    .update(t.waterBills)
    .set({
      balance: newBalance.toFixed(2),
      status: nextBillStatus({
        total: Number(source.total),
        balance: newBalance,
        dueOn: source.dueOn,
        today,
        current: source.status,
      }),
    })
    .where(eq(t.waterBills.id, source.id));

  const [account] = await db.select().from(t.customerAccounts).where(eq(t.customerAccounts.customerId, source.customerId)).limit(1);
  if (account) {
    await db.insert(t.accountMovements).values({
      accountId: account.id,
      movementType: "BOLETA_CREDITO",
      amount: `-${amountStr}`,
      waterBillId: bill.id,
    });
    await db
      .update(t.customerAccounts)
      .set({ balance: sql`${t.customerAccounts.balance} - ${amountStr}::numeric`, updatedAt: new Date() })
      .where(eq(t.customerAccounts.id, account.id));
  }

  return { id: bill.id, number: bill.number, total: bill.total };
}

export async function renderWaterBillPdfBuffer(db: Database, billId: string): Promise<{ pdf: Buffer; number: string } | null> {
  const [bill] = await db.select().from(t.waterBills).where(eq(t.waterBills.id, billId)).limit(1);
  if (!bill) return null;
  const [company] = await db.select().from(t.companies).where(eq(t.companies.id, bill.companyId)).limit(1);
  const [customer] = await db.select().from(t.customers).where(eq(t.customers.id, bill.customerId)).limit(1);
  const [connection] = await db.select().from(t.connections).where(eq(t.connections.id, bill.connectionId)).limit(1);
  const items = await db.select().from(t.waterBillItems).where(eq(t.waterBillItems.billId, bill.id));
  const [calc] = bill.calculationId
    ? await db.select().from(t.consumptionCalculations).where(eq(t.consumptionCalculations.id, bill.calculationId)).limit(1)
    : [];
  const [reading] = calc?.readingId
    ? await db.select().from(t.meterReadings).where(eq(t.meterReadings.id, calc.readingId)).limit(1)
    : [];
  const [period] = await db.select().from(t.billingPeriods).where(eq(t.billingPeriods.id, bill.billingPeriodId)).limit(1);
  const [establishment] = await db
    .select()
    .from(t.establishments)
    .where(and(eq(t.establishments.companyId, bill.companyId), eq(t.establishments.active, true)))
    .limit(1);
  const verifyUrl = `${loadEnv().API_PUBLIC_URL.replace(/\/$/, "")}/api/bills/${bill.id}/verify`;
  const qrPng = await billQrPng(verifyUrl);
  const snap = (calc?.snapshot ?? {}) as Partial<{
    minLiters: number;
    excessLiters: number;
    billedLiters: number;
    minPayable: string;
    excessPayable: string;
  }>;
  const [related] = bill.relatedBillId
    ? await db.select({ number: t.waterBills.number }).from(t.waterBills).where(eq(t.waterBills.id, bill.relatedBillId)).limit(1)
    : [];
  const pdf = await buildWaterBillPdf({
    company: company!,
    customer: customer!,
    connection: connection!,
    bill,
    items,
    reading: bill.kind === "CREDITO" ? undefined : reading,
    period,
    establishment,
    kind: bill.kind === "CREDITO" ? "CREDITO" : "CONSUMO",
    relatedBillNumber: related?.number,
    reason: bill.reason,
    charges:
      calc && snap.minLiters != null
        ? {
            minLiters: Number(snap.minLiters ?? Number(calc.minM3) * 1000),
            excessLiters: Number(snap.excessLiters ?? Number(calc.excessM3) * 1000),
            billedLiters: Number(snap.billedLiters ?? (Number(calc.minM3) + Number(calc.excessM3)) * 1000),
            minPayable: snap.minPayable ?? calc.consumptionAmount,
            excessPayable: snap.excessPayable ?? calc.excessAmount,
            total: calc.total,
          }
        : undefined,
    verifyUrl,
    qrPng,
  });
  return { pdf, number: bill.number };
}

export async function generateBillsForPeriod(db: Database, opts: { companyId: string; periodId: string }): Promise<GeneratedBill[]> {
  const calcs = await db.select().from(t.consumptionCalculations).where(eq(t.consumptionCalculations.billingPeriodId, opts.periodId));
  const created: GeneratedBill[] = [];
  for (const calc of calcs) {
    if (!calc.readingId) continue;
    const [reading] = await db.select().from(t.meterReadings).where(eq(t.meterReadings.id, calc.readingId)).limit(1);
    if (!reading) continue;
    const bill = await upsertBillForReading(db, { companyId: opts.companyId, reading });
    if (bill) created.push(bill);
  }
  const unread = await db
    .select()
    .from(t.meterReadings)
    .where(
      and(
        eq(t.meterReadings.companyId, opts.companyId),
        eq(t.meterReadings.billingPeriodId, opts.periodId),
        eq(t.meterReadings.billed, false),
      ),
    );
  for (const reading of unread) {
    const bill = await upsertBillForReading(db, { companyId: opts.companyId, reading });
    if (bill) created.push(bill);
  }
  return created;
}
