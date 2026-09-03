import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import { loadEnv } from "../env.js";
import { todayAsuncion } from "../lib/time.js";
import { billQrPng } from "./bill-qr.js";
import { formatM3, isCollectableInstallment } from "./collectable-debts.js";
import { buildInvoicePdf } from "./invoice-pdf.js";

export type OutstandingDebt = {
  kind: "CONSUMO" | "CUOTA" | "CONEXION";
  description: string;
  amount: string;
  consumptionM3?: string | null;
  dueOn?: string | null;
};

export type InvoiceDraftResult = {
  invoiceId: string;
  created: boolean;
};

function money(n: number): string {
  return n.toFixed(2);
}

export async function listOutstandingDebts(
  db: Database,
  opts: { companyId: string; customerId: string; excludeBillIds?: string[]; excludePaymentIds?: string[]; today?: string },
): Promise<OutstandingDebt[]> {
  const exclude = new Set(opts.excludeBillIds ?? []);
  const today = opts.today ?? todayAsuncion();
  const debts: OutstandingDebt[] = [];

  const bills = await db
    .select({
      id: t.waterBills.id,
      number: t.waterBills.number,
      balance: t.waterBills.balance,
      status: t.waterBills.status,
      kind: t.waterBills.kind,
      dueOn: t.waterBills.dueOn,
      consumptionM3: t.consumptionCalculations.consumptionM3,
    })
    .from(t.waterBills)
    .leftJoin(t.consumptionCalculations, eq(t.consumptionCalculations.id, t.waterBills.calculationId))
    .where(and(eq(t.waterBills.companyId, opts.companyId), eq(t.waterBills.customerId, opts.customerId)));
  for (const bill of bills) {
    if (exclude.has(bill.id)) continue;
    if (bill.status === "ANULADA") continue;
    if (bill.kind === "CREDITO") continue;
    const bal = Number(bill.balance);
    if (bal > 0.009) {
      const m3n = Number(bill.consumptionM3);
      const m3 = Number.isFinite(m3n) && m3n > 0 ? formatM3(bill.consumptionM3) : "";
      debts.push({
        kind: "CONSUMO",
        description: m3 ? `Consumo ${m3} m³ · boleta ${bill.number}` : `Consumo · boleta ${bill.number}`,
        amount: money(bal),
        consumptionM3: bill.consumptionM3,
        dueOn: bill.dueOn,
      });
    }
  }

  const plans = await db
    .select()
    .from(t.installmentPlans)
    .where(and(eq(t.installmentPlans.companyId, opts.companyId), eq(t.installmentPlans.customerId, opts.customerId)));
  let cuotaPaid = 0;
  for (const plan of plans) {
    if (plan.status === "CANCELADO") continue;
    const items = await db.select().from(t.installmentItems).where(eq(t.installmentItems.planId, plan.id));
    if (plan.kind === "CONEXION" || plan.kind === "INSTALACION") {
      cuotaPaid += items.reduce((s, item) => s + Number(item.paidAmount), 0) + Number(plan.downPayment ?? 0);
    }
    if (plan.status === "SALDADO") continue;
    const unpaid = items
      .map((item) => ({ item, remaining: Number(item.amount) - Number(item.paidAmount) }))
      .filter((row) => row.remaining > 0.009)
      .sort((a, b) => a.item.dueOn.localeCompare(b.item.dueOn) || a.item.number - b.item.number);
    const dueSoon = unpaid.filter((row) => isCollectableInstallment(row.item.dueOn, today));
    const collect = dueSoon.length ? dueSoon : unpaid.slice(0, 1);
    const kindLabel = plan.kind === "CONEXION" || plan.kind === "INSTALACION" ? "conexión / instalación" : plan.kind.toLowerCase();
    const financed = unpaid.reduce((s, row) => s + row.remaining, 0);
    for (const row of collect) {
      debts.push({
        kind: "CUOTA",
        description: `Cuota ${row.item.number} de ${plan.installmentCount} (${kindLabel}) · saldo Gs. ${Math.round(financed).toLocaleString("es-PY")} · vence ${row.item.dueOn}`,
        amount: money(row.remaining),
        dueOn: row.item.dueOn,
      });
    }
  }

  const connections = await db
    .select()
    .from(t.connections)
    .where(and(eq(t.connections.companyId, opts.companyId), eq(t.connections.customerId, opts.customerId)));
  const skipPays = new Set(opts.excludePaymentIds ?? []);
  const pays = (
    await db
      .select()
      .from(t.payments)
      .where(and(eq(t.payments.companyId, opts.companyId), eq(t.payments.customerId, opts.customerId), isNull(t.payments.reversedAt)))
  ).filter((p) => !skipPays.has(p.id));
  let billedPaid = 0;
  for (const pay of pays) {
    const allocs = await db.select().from(t.paymentAllocations).where(eq(t.paymentAllocations.paymentId, pay.id));
    billedPaid += allocs.filter((a) => a.waterBillId).reduce((s, a) => s + Number(a.amount), 0);
  }
  const totalPaid = pays.reduce((s, p) => s + Number(p.amount), 0);
  const towardConnection = Math.max(0, totalPaid - billedPaid - cuotaPaid);

  for (const cn of connections) {
    const cost = Number(cn.connectionCost ?? 0);
    if (cost <= 0.009) continue;
    const hasPlan = plans.some((p) => p.connectionId === cn.id && (p.kind === "CONEXION" || p.kind === "INSTALACION") && p.status === "VIGENTE");
    if (hasPlan) continue;
    const remaining = Math.max(0, cost - towardConnection);
    if (remaining <= 0.009) continue;
    debts.push({
      kind: "CONEXION",
      description: `Costo de conexión e instalación ${cn.code}`,
      amount: money(remaining),
    });
  }

  return debts;
}

/** Borrador interno de factura a partir del cobro. No marca SIFEN APROBADO. */
export async function draftInvoiceFromPayment(
  db: Database,
  opts: { companyId: string; userId: string; paymentId: string },
): Promise<InvoiceDraftResult | null> {
  const [pay] = await db
    .select()
    .from(t.payments)
    .where(and(eq(t.payments.id, opts.paymentId), eq(t.payments.companyId, opts.companyId)))
    .limit(1);
  if (!pay || pay.reversedAt) return null;

  const allocations = await db.select().from(t.paymentAllocations).where(eq(t.paymentAllocations.paymentId, pay.id));
  const already = allocations.find((a) => a.invoiceId);
  if (already?.invoiceId) return { invoiceId: already.invoiceId, created: false };

  const items: Array<{ description: string; quantity: string; unitAmount: string; taxAmount: string; total: string }> = [];
  // Borrador interno: la tarifa de agua no discrimina IVA hasta la emisión fiscal (SIFEN).
  const taxAmount = 0;
  const billIds = allocations.map((a) => a.waterBillId).filter((id): id is string => Boolean(id));
  const primaryBillId = billIds[0] ?? null;

  for (const alloc of allocations) {
    if (!alloc.waterBillId) continue;
    const [bill] = await db.select().from(t.waterBills).where(eq(t.waterBills.id, alloc.waterBillId)).limit(1);
    if (!bill) continue;
    const [calc] = bill.calculationId
      ? await db.select().from(t.consumptionCalculations).where(eq(t.consumptionCalculations.id, bill.calculationId)).limit(1)
      : [];
    const m3 = formatM3(calc?.consumptionM3);
    items.push({
      description: m3 ? `Consumo ${m3} m³ · boleta ${bill.number}` : `Consumo · boleta ${bill.number}`,
      quantity: "1",
      unitAmount: alloc.amount,
      taxAmount: "0.00",
      total: alloc.amount,
    });
  }

  const cuotaRows = await db
    .select({
      number: t.installmentItems.number,
      paidAmount: t.installmentItems.paidAmount,
      dueOn: t.installmentItems.dueOn,
      kind: t.installmentPlans.kind,
    })
    .from(t.installmentItems)
    .innerJoin(t.installmentPlans, eq(t.installmentPlans.id, t.installmentItems.planId))
    .where(eq(t.installmentItems.paymentId, pay.id));
  for (const row of cuotaRows) {
    const kind = row.kind === "INSTALACION" ? "instalación" : "conexión / instalación";
    items.push({
      description: `Cuota ${row.number} (${kind}) vence ${row.dueOn}`,
      quantity: "1",
      unitAmount: row.paidAmount,
      taxAmount: "0.00",
      total: row.paidAmount,
    });
  }

  let leftover = Number(pay.amount) - items.reduce((s, i) => s + Number(i.total), 0);
  if (leftover > 0.009) {
    const pending = await listOutstandingDebts(db, {
      companyId: opts.companyId,
      customerId: pay.customerId,
      excludeBillIds: billIds,
      excludePaymentIds: [pay.id],
    });
    for (const debt of pending.filter((d) => d.kind === "CONEXION")) {
      if (leftover <= 0.009) break;
      const take = Math.min(leftover, Number(debt.amount));
      items.push({
        description: debt.description,
        quantity: "1",
        unitAmount: money(take),
        taxAmount: "0.00",
        total: money(take),
      });
      leftover -= take;
    }
  }
  if (!items.length) {
    items.push({
      description: pay.notes?.trim() || "Cobro de cuenta / consumo de agua",
      quantity: "1",
      unitAmount: pay.amount,
      taxAmount: "0.00",
      total: pay.amount,
    });
  }

  const subtotal = items.reduce((s, i) => s + Number(i.total), 0);
  const [inv] = await db
    .insert(t.invoices)
    .values({
      companyId: opts.companyId,
      customerId: pay.customerId,
      waterBillId: primaryBillId,
      subtotal: money(subtotal),
      taxAmount: money(taxAmount),
      total: money(Number(pay.amount)),
      businessStatus: "BORRADOR",
      sifenStatus: "NO_CONFIGURADO",
      createdBy: opts.userId,
    })
    .returning();
  if (!inv) return null;

  await db.insert(t.invoiceItems).values(items.map((item) => ({ ...item, invoiceId: inv.id })));
  if (allocations.length) {
    await db.update(t.paymentAllocations).set({ invoiceId: inv.id }).where(eq(t.paymentAllocations.paymentId, pay.id));
  } else {
    await db.insert(t.paymentAllocations).values({
      paymentId: pay.id,
      waterBillId: primaryBillId,
      invoiceId: inv.id,
      amount: pay.amount,
    });
  }
  if (primaryBillId) {
    await db.update(t.waterBills).set({ invoiceId: inv.id }).where(eq(t.waterBills.id, primaryBillId));
  }
  return { invoiceId: inv.id, created: true };
}

export async function ensureDraftInvoicesForPayments(db: Database, opts: { companyId: string; userId: string }): Promise<void> {
  const pays = await db
    .select({ id: t.payments.id })
    .from(t.payments)
    .where(and(eq(t.payments.companyId, opts.companyId), isNull(t.payments.reversedAt)));
  for (const pay of pays) {
    try {
      await draftInvoiceFromPayment(db, { companyId: opts.companyId, userId: opts.userId, paymentId: pay.id });
    } catch (err) {
      console.error("No se pudo generar factura pendiente del cobro", pay.id, err);
    }
  }
}

export async function invoiceIdForPayment(db: Database, paymentId: string, companyId: string): Promise<string | null> {
  const allocations = await db.select().from(t.paymentAllocations).where(eq(t.paymentAllocations.paymentId, paymentId));
  const linked = allocations.find((row) => row.invoiceId)?.invoiceId;
  if (linked) return linked;
  for (const row of allocations) {
    if (!row.waterBillId) continue;
    const [bill] = await db
      .select()
      .from(t.waterBills)
      .where(and(eq(t.waterBills.id, row.waterBillId), eq(t.waterBills.companyId, companyId)))
      .limit(1);
    if (bill?.invoiceId) return bill.invoiceId;
  }
  const [pay] = await db
    .select()
    .from(t.payments)
    .where(and(eq(t.payments.id, paymentId), eq(t.payments.companyId, companyId)))
    .limit(1);
  if (!pay) return null;
  const [inv] = await db
    .select()
    .from(t.invoices)
    .where(and(eq(t.invoices.companyId, companyId), eq(t.invoices.customerId, pay.customerId)))
    .orderBy(sql`${t.invoices.createdAt} desc`)
    .limit(1);
  return inv?.id ?? null;
}

export async function renderInvoicePdfBuffer(
  db: Database,
  opts: { companyId: string; invoiceId: string; paymentId?: string },
): Promise<Buffer | null> {
  const [inv] = await db
    .select()
    .from(t.invoices)
    .where(and(eq(t.invoices.id, opts.invoiceId), eq(t.invoices.companyId, opts.companyId)))
    .limit(1);
  if (!inv) return null;
  const [company] = await db.select().from(t.companies).where(eq(t.companies.id, opts.companyId)).limit(1);
  const [customer] = await db.select().from(t.customers).where(eq(t.customers.id, inv.customerId)).limit(1);
  const items = await db.select().from(t.invoiceItems).where(eq(t.invoiceItems.invoiceId, inv.id));
  const paidBillIds = inv.waterBillId ? [inv.waterBillId] : [];
  const debts = await listOutstandingDebts(db, {
    companyId: opts.companyId,
    customerId: inv.customerId,
    excludeBillIds: paidBillIds,
  });
  let payment: { amount: string; paidOn: string } | undefined;
  let method: { name: string } | undefined;
  if (opts.paymentId) {
    const [pay] = await db.select().from(t.payments).where(eq(t.payments.id, opts.paymentId)).limit(1);
    if (pay) {
      payment = { amount: pay.amount, paidOn: pay.paidOn };
      const [m] = await db.select().from(t.paymentMethods).where(eq(t.paymentMethods.id, pay.methodId)).limit(1);
      if (m) method = { name: m.name };
    }
  }
  const verifyUrl = `${loadEnv().API_PUBLIC_URL.replace(/\/$/, "")}/api/invoices/${inv.id}/verify`;
  const qrPng = await billQrPng(`AGUATERIA:FACTURA:${inv.id}`);
  return buildInvoicePdf({
    company: company!,
    customer: customer!,
    invoice: inv,
    items,
    debts,
    payment,
    method,
    verifyUrl,
    qrPng,
  });
}
