import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { paginationQuery, parseRucInput, readingInputSchema } from "@aguateria/shared";
import * as t from "../db/schema.js";
import { authenticate, requirePermission } from "../http/auth.js";
import type { AppEnv } from "../http/types.js";
import type { Database } from "../db/client.js";
import { jsonError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { loadEnv } from "../env.js";
import { nextMonthAsuncion, todayAsuncion } from "../lib/time.js";
import { calculateConsumption, tariffRuleToCalc } from "../services/consumption.js";
import { allocateFiscalNumber, formatFiscalNumber } from "../services/tax-stamp.js";
import { createSifenProvider } from "../tax/sifen-provider.js";
import { billQrPng } from "../services/bill-qr.js";
import { hashPassword } from "../lib/password.js";
import { recordMeterReading, startFieldReading } from "../services/readings.js";
import { createInstallmentPlan } from "../services/installments.js";
import { nextConnectionCode, nextCustomerCode, peekCustomerCode } from "../lib/connection-code.js";
import { createSignedDownload, createSignedUpload } from "../lib/storage.js";
import { isFieldOnlyUser, loadFieldSettings } from "../lib/field-settings.js";
import { registerCycle } from "./cycle.js";
import { applyPaymentToOpenBills, reversePayment } from "../services/payments-apply.js";
import { buildPaymentReceiptPdf } from "../services/payment-pdf.js";
import { findBillForReading, generateBillsForPeriod, issueCreditBill, renderWaterBillPdfBuffer, upsertBillForReading } from "../services/water-bills.js";
import { draftInvoiceFromPayment, ensureDraftInvoicesForPayments, invoiceIdForPayment, listOutstandingDebts, renderInvoicePdfBuffer } from "../services/invoice-from-payment.js";
import { buildOperationalAlerts } from "../services/operational-alerts.js";
import { listNotificationInbox, markAllNotificationsRead, markNotificationRead } from "../services/notification-inbox.js";
import { loadReportRows } from "../services/reports.js";
import { runDailyCron } from "../services/cron.js";

const idParam = z.object({ id: z.string().uuid() });

const customerDisplayName = sql<string>`coalesce(nullif(trim(${t.customers.legalName}), ''), nullif(trim(concat_ws(' ', ${t.customers.firstName}, ${t.customers.lastName})), ''), ${t.customers.code})`;

const customerInputSchema = z.object({
  code: z.string().min(1).max(40).optional(),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  legalName: z.string().max(200).optional(),
  ruc: z.string().max(20).optional(),
  dv: z.string().max(2).optional(),
  rucWithDv: z.string().max(24).optional().or(z.literal("")),
  idDocumentType: z.enum(["CI", "RUC", "PASAPORTE"]).optional(),
  ci: z.string().max(20).optional(),
  phone: z.string().max(40).optional(),
  mobile: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  department: z.string().max(120).optional(),
  neighborhood: z.string().max(120).optional(),
  referenceNote: z.string().max(300).optional(),
  zoneId: z.string().uuid().optional(),
  neighborhoodId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["ACTIVO", "INACTIVO", "INOPERATIVO", "MOROSO", "BAJA", "SUSPENDIDO", "DESCONECTADO"]).optional(),
});

function normalizeCustomerBody(body: z.infer<typeof customerInputSchema>) {
  const { rucWithDv, ...rest } = body;
  let ruc = rest.ruc;
  let dv = rest.dv;
  let legalName = rest.legalName;
  const docType = rest.idDocumentType;
  if (docType === "RUC") {
    const source = (rucWithDv ?? rest.ci ?? ruc ?? "").trim();
    if (source) {
      const parsed = parseRucInput(source);
      ruc = parsed.number || ruc;
      dv = parsed.dv || dv;
    }
  } else if (docType === "CI" || docType === "PASAPORTE") {
    ruc = "";
    dv = "";
    legalName = undefined;
  } else if (rucWithDv?.trim()) {
    const parsed = parseRucInput(rucWithDv);
    ruc = parsed.number || ruc;
    dv = parsed.dv || dv;
  } else if (ruc && !dv) {
    const parsed = parseRucInput(ruc);
    ruc = parsed.number || ruc;
    dv = parsed.dv || dv;
  }
  const status = rest.status === "INACTIVO" ? "INOPERATIVO" : rest.status;
  return { ...rest, ruc, dv, legalName, status };
}

async function resolveNeighborhood(
  db: Database,
  companyId: string,
  name?: string | null,
  city?: string | null,
  department?: string | null,
): Promise<{ neighborhood: string | null; neighborhoodId: string | null }> {
  const trimmed = name?.trim();
  if (!trimmed) return { neighborhood: null, neighborhoodId: null };
  const filters = [eq(t.neighborhoods.companyId, companyId), ilike(t.neighborhoods.name, trimmed)];
  if (city) filters.push(eq(t.neighborhoods.city, city));
  const [existing] = await db.select().from(t.neighborhoods).where(and(...filters)).limit(1);
  if (existing) return { neighborhood: existing.name, neighborhoodId: existing.id };
  const [created] = await db
    .insert(t.neighborhoods)
    .values({ companyId, name: trimmed, city: city || null, department: department || null })
    .returning();
  return { neighborhood: created?.name ?? trimmed, neighborhoodId: created?.id ?? null };
}

async function prepareCustomerValues(
  db: Database,
  companyId: string,
  body: z.infer<typeof customerInputSchema>,
  opts?: { isCreate?: boolean },
) {
  const normalized = normalizeCustomerBody(body);
  if (!opts?.isCreate && body.neighborhood === undefined) {
    return normalized;
  }
  const place = await resolveNeighborhood(db, companyId, normalized.neighborhood, normalized.city, normalized.department);
  return { ...normalized, ...place };
}

export function businessRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Cron interno. Se registra ANTES de `authenticate`: autorización propia por
  // CRON_SECRET (Vercel Cron envía `Authorization: Bearer <CRON_SECRET>`).
  const cronHandler = async (c: Context<AppEnv>) => {
    const env = loadEnv();
    const secret = c.req.header("authorization")?.replace("Bearer ", "");
    if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
      throw jsonError("UNAUTHORIZED", "Cron no autorizado", 401);
    }
    const result = await runDailyCron(c.get("db"));
    return c.json({ data: { ok: true, ...result } });
  };
  r.get("/internal/cron", cronHandler);
  r.post("/internal/cron", cronHandler);

  r.use("*", authenticate);

  r.get("/dashboard", requirePermission("dashboard.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const result = await db.execute(sql`
      select
        (select count(*) from customers where company_id = ${companyId} and deleted_at is null and status = 'ACTIVO') as customers,
        (select count(*) from connections where company_id = ${companyId} and deleted_at is null and status = 'ACTIVA') as connections,
        (select coalesce(sum(total),0) from water_bills where company_id = ${companyId} and issued_on >= date_trunc('month', now() at time zone 'America/Asuncion')) as billed_month,
        (select coalesce(sum(amount),0) from payments where company_id = ${companyId} and reversed_at is null and paid_on >= date_trunc('month', now() at time zone 'America/Asuncion')) as collected_month,
        (select coalesce(sum(balance),0) from customer_accounts where company_id = ${companyId}) as outstanding,
        (select count(*) from customer_accounts where company_id = ${companyId} and status in ('VENCIDO','MOROSO')) as delinquent,
        (select coalesce(sum(consumption_m3),0) from meter_readings where company_id = ${companyId} and server_captured_at >= date_trunc('month', now() at time zone 'America/Asuncion')) as consumption_month,
        (select count(*) from meter_readings where company_id = ${companyId} and server_captured_at >= date_trunc('month', now() at time zone 'America/Asuncion')) as readings_done,
        (select count(*) from meter_readings where company_id = ${companyId} and requires_review = true and reviewed_at is null) as readings_anomalous,
        (select count(*) from claims where company_id = ${companyId} and status <> 'CERRADO') as open_claims,
        (select count(*) from suspensions where company_id = ${companyId} and executed_at >= date_trunc('month', now() at time zone 'America/Asuncion')) as suspensions,
        (select count(*) from reconnections where company_id = ${companyId} and executed_at >= date_trunc('month', now() at time zone 'America/Asuncion')) as reconnections,
        (select count(*) from customers where company_id = ${companyId} and deleted_at is null) as customers_total,
        (select count(*) from customers where company_id = ${companyId} and deleted_at is null and status in ('INACTIVO','INOPERATIVO','BAJA','SUSPENDIDO')) as customers_inactive,
        (select count(*) from customers where company_id = ${companyId} and deleted_at is null and created_at >= date_trunc('month', now() at time zone 'America/Asuncion')) as customers_new,
        (select count(*) from connections where company_id = ${companyId} and deleted_at is null) as connections_total,
        (select count(*) from connections where company_id = ${companyId} and deleted_at is null and status = 'SUSPENDIDA') as connections_suspended,
        (select count(*) from connections cn where cn.company_id = ${companyId} and cn.deleted_at is null and cn.status = 'ACTIVA'
           and not exists (select 1 from meters m where m.connection_id = cn.id and m.status = 'INSTALADO' and m.deleted_at is null)) as connections_without_meter,
        (select count(*) from meters where company_id = ${companyId} and deleted_at is null) as meters_total,
        (select count(*) from meters where company_id = ${companyId} and deleted_at is null and status = 'INSTALADO') as meters_active,
        (select count(*) from meters where company_id = ${companyId} and deleted_at is null and status in ('DANADO','EN_TALLER')) as meters_incident,
        (select count(*) from connections cn
           join meters m on m.connection_id = cn.id and m.status = 'INSTALADO' and m.deleted_at is null
          where cn.company_id = ${companyId} and cn.deleted_at is null and cn.status = 'ACTIVA'
            and not exists (
              select 1 from meter_readings mr
              join billing_periods bp on bp.id = mr.billing_period_id
              where mr.meter_id = m.id and bp.company_id = ${companyId} and bp.status in ('ABIERTO','EN_PROCESO','EN_REVISION')
            )) as field_pending,
        (select count(*) from meter_readings where company_id = ${companyId} and photo_file_id is null and server_captured_at >= date_trunc('month', now() at time zone 'America/Asuncion')) as readings_missing_photo,
        (select count(*) from meter_readings where company_id = ${companyId} and anomaly_code = 'GPS_OUT_OF_RANGE' and reviewed_at is null) as readings_gps_out,
        (select count(*) from water_bills where company_id = ${companyId} and issued_on >= date_trunc('month', now() at time zone 'America/Asuncion')) as bills_issued,
        (select count(*) from water_bills where company_id = ${companyId} and status in ('EMITIDA','PENDIENTE') and balance::numeric > 0) as bills_pending,
        (select count(*) from water_bills where company_id = ${companyId} and due_on < (now() at time zone 'America/Asuncion')::date and balance::numeric > 0) as bills_overdue,
        (select coalesce(avg(consumption_m3),0) from meter_readings where company_id = ${companyId} and server_captured_at >= date_trunc('month', now() at time zone 'America/Asuncion')) as consumption_avg,
        (select coalesce(sum(consumption_m3),0) from meter_readings where company_id = ${companyId}
           and server_captured_at >= date_trunc('month', now() at time zone 'America/Asuncion') - interval '1 month'
           and server_captured_at < date_trunc('month', now() at time zone 'America/Asuncion')) as consumption_prev_month,
        (select count(*) from meter_readings where company_id = ${companyId} and server_captured_at >= (now() at time zone 'America/Asuncion')::date) as field_done_today,
        (select count(*) from meter_readings where company_id = ${companyId} and requires_review = true and reviewed_at is null) as field_observed,
        (select count(*) from customers where company_id = ${companyId} and deleted_at is null and status in ('DESCONECTADO','BAJA')) as customers_disconnected,
        (select count(*) from connections where company_id = ${companyId} and deleted_at is null and status = 'PENDIENTE') as connections_pending,
        (select count(*) from connections where company_id = ${companyId} and deleted_at is null and status in ('CORTADA','DESCONECTADA')) as connections_disconnected,
        (select count(*) from connections where company_id = ${companyId} and deleted_at is null and status = 'DESCONEXION_PROGRAMADA') as disconnect_scheduled,
        (select count(*) from connection_installations where company_id = ${companyId} and status = 'PENDIENTE') as installations_pending,
        (select count(*) from water_bills where company_id = ${companyId} and status = 'PAGADA' and issued_on >= date_trunc('month', now() at time zone 'America/Asuncion')) as bills_paid,
        (select count(*) from water_bills where company_id = ${companyId} and status = 'PARCIAL' and balance::numeric > 0) as bills_partial
    `);
    const rows = result as unknown as Array<Record<string, unknown>>;
    const user = c.get("user")!;
    let data = rows[0] ?? {};
    if (isFieldOnlyUser(user)) {
      const mine = await db.execute(sql`
        select
          (select count(*) from connections cn
             join meters m on m.connection_id = cn.id and m.status = 'INSTALADO' and m.deleted_at is null
            where cn.company_id = ${user.companyId} and cn.deleted_at is null and cn.status = 'ACTIVA'
              and not exists (
                select 1 from meter_readings mr
                join billing_periods bp on bp.id = mr.billing_period_id
                where mr.meter_id = m.id and bp.status in ('ABIERTO','EN_PROCESO','EN_REVISION')
              )) as field_pending,
          (select count(*) from meter_readings where reader_id = ${user.id} and server_captured_at >= (now() at time zone 'America/Asuncion')::date) as field_done_today,
          (select count(*) from meter_readings where reader_id = ${user.id} and requires_review = true and reviewed_at is null) as field_observed
      `);
      const scoped = (mine as unknown as Array<Record<string, unknown>>)[0] ?? {};
      data = { ...data, ...scoped, role: user.roles[0] ?? "CAMPO" };
    } else {
      data = { ...data, role: user.roles[0] ?? "OPERADOR" };
    }
    data = {
      ...data,
      alerts: buildOperationalAlerts(data, (p) => user.permissions.includes(p as typeof user.permissions[number])),
    };
    return c.json({ data });
  });

  r.get("/customers", requirePermission("clientes.ver"), zValidator("query", paginationQuery), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const { page, pageSize, q } = c.req.valid("query");
    const meter = c.req.query("meter");
    const filters = [eq(t.customers.companyId, companyId), isNull(t.customers.deletedAt)];
    if (q) {
      const like = `%${q}%`;
      filters.push(
        or(
          ilike(t.customers.code, like),
          ilike(t.customers.firstName, like),
          ilike(t.customers.lastName, like),
          ilike(t.customers.legalName, like),
          ilike(t.customers.ruc, like),
          ilike(t.customers.ci, like),
          ilike(t.customers.mobile, like),
          ilike(t.customers.phone, like),
          ilike(t.customers.address, like),
        )!,
      );
    }
    if (meter) {
      const found = await db
        .select({ customerId: t.connections.customerId })
        .from(t.meters)
        .innerJoin(t.connections, eq(t.connections.id, t.meters.connectionId))
        .where(and(eq(t.meters.companyId, companyId), or(ilike(t.meters.number, `%${meter}%`), ilike(t.meters.serial, `%${meter}%`))));
      const ids = found.map((f) => f.customerId);
      if (ids.length === 0) return c.json({ data: [], meta: { page, pageSize, total: 0 } });
      filters.push(sql`${t.customers.id} in ${ids}`);
    }
    const where = and(...filters);
    const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(t.customers).where(where);
    const rows = await db
      .select()
      .from(t.customers)
      .where(where)
      .orderBy(desc(t.customers.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return c.json({ data: rows, meta: { page, pageSize, total: countRow?.n ?? 0 } });
  });

  r.get("/customers/next-code", requirePermission("clientes.crear"), async (c) => {
    const code = await peekCustomerCode(c.get("db"), c.get("user")!.companyId);
    return c.json({ data: { code } });
  });

  r.get("/customers/by-document", requirePermission("clientes.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const number = (c.req.query("number") ?? "").trim();
    const type = (c.req.query("type") ?? "CI").trim().toUpperCase();
    if (!number) throw jsonError("VALIDATION_ERROR", "Indicá el número de documento", 400);
    const like = `%${number.replace(/-/g, "")}%`;
    const docMatch = or(ilike(t.customers.ci, `%${number}%`), ilike(t.customers.ruc, like))!;
    const filters = [eq(t.customers.companyId, companyId), isNull(t.customers.deletedAt), docMatch];
    let [row] =
      type === "CI" || type === "PASAPORTE" || type === "RUC"
        ? await db.select().from(t.customers).where(and(...filters, eq(t.customers.idDocumentType, type))).limit(1)
        : await db.select().from(t.customers).where(and(...filters)).limit(1);
    if (!row) {
      [row] = await db.select().from(t.customers).where(and(...filters)).limit(1);
    }
    return c.json({ data: row ?? null });
  });

  r.post(
    "/customers",
    requirePermission("clientes.crear"),
    zValidator("json", customerInputSchema),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = await prepareCustomerValues(db, user.companyId, c.req.valid("json"), { isCreate: true });
      const code = body.code?.trim() || (await nextCustomerCode(db, user.companyId));
      const email = body.email?.trim() || undefined;
      const [row] = await db
        .insert(t.customers)
        .values({ ...body, email, code, companyId: user.companyId, createdBy: user.id, status: body.status ?? "ACTIVO", idDocumentType: body.idDocumentType ?? "CI" })
        .returning();
      await db.insert(t.customerAccounts).values({ companyId: user.companyId, customerId: row!.id, balance: "0.00" });
      return c.json({ data: row }, 201);
    },
  );

  r.get("/customers/:id", requirePermission("clientes.ver"), zValidator("param", idParam), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const { id } = c.req.valid("param");
    const [row] = await db
      .select()
      .from(t.customers)
      .where(and(eq(t.customers.id, id), eq(t.customers.companyId, user.companyId)))
      .limit(1);
    if (!row) throw jsonError("NOT_FOUND", "Cliente no encontrado", 404);
    return c.json({ data: row });
  });

  r.patch(
    "/customers/:id",
    requirePermission("clientes.editar"),
    zValidator("param", idParam),
    zValidator("json", customerInputSchema.partial()),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const { id } = c.req.valid("param");
      const [row] = await db
        .update(t.customers)
        .set({ ...(await prepareCustomerValues(db, user.companyId, c.req.valid("json"))), updatedAt: new Date(), updatedBy: user.id })
        .where(and(eq(t.customers.id, id), eq(t.customers.companyId, user.companyId)))
        .returning();
      if (!row) throw jsonError("NOT_FOUND", "Cliente no encontrado", 404);
      return c.json({ data: row });
    },
  );

  r.delete("/customers/:id", requirePermission("clientes.baja"), zValidator("param", idParam), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const { id } = c.req.valid("param");
    await db
      .update(t.customers)
      .set({ deletedAt: new Date(), status: "BAJA", deactivatedAt: todayAsuncion(), updatedBy: user.id })
      .where(and(eq(t.customers.id, id), eq(t.customers.companyId, user.companyId)));
    return c.json({ data: { ok: true } });
  });

  registerSimpleCrud(r);
  registerReadings(r);
  registerBilling(r);
  registerField(r);
  registerCycle(r);
  registerOps(r);
  return r;
}

function registerSimpleCrud(r: Hono<AppEnv>): void {
  r.get("/connections", requirePermission("conexiones.ver"), zValidator("query", paginationQuery), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const { page, pageSize, q } = c.req.valid("query");
    const customerId = c.req.query("customerId");
    const filters = [eq(t.connections.companyId, companyId), isNull(t.connections.deletedAt)];
    if (customerId) filters.push(eq(t.connections.customerId, customerId));
    const search = q?.trim()
      ? or(
          ilike(t.connections.code, `%${q}%`),
          ilike(t.connections.accountNumber, `%${q}%`),
          ilike(t.connections.address, `%${q}%`),
          ilike(t.customers.code, `%${q}%`),
          ilike(t.customers.firstName, `%${q}%`),
          ilike(t.customers.lastName, `%${q}%`),
          ilike(t.customers.legalName, `%${q}%`),
          ilike(t.meters.number, `%${q}%`),
        )
      : undefined;
    const where = search ? and(...filters, search) : and(...filters);
    const rows = await db
      .select({
        id: t.connections.id,
        customerId: t.connections.customerId,
        code: t.connections.code,
        accountNumber: t.connections.accountNumber,
        address: t.connections.address,
        status: t.connections.status,
        installedAt: t.connections.installedAt,
        latitude: t.connections.latitude,
        longitude: t.connections.longitude,
        notes: t.connections.notes,
        tariffId: t.connections.tariffId,
        categoryId: t.connections.categoryId,
        customerCode: t.customers.code,
        customerName: customerDisplayName,
        meterNumber: t.meters.number,
        meterBrand: t.meters.brand,
        meterModel: t.meters.model,
        meterId: t.meters.id,
      })
      .from(t.connections)
      .innerJoin(t.customers, eq(t.customers.id, t.connections.customerId))
      .leftJoin(
        t.meters,
        and(
          eq(t.meters.connectionId, t.connections.id),
          sql`${t.meters.status} in ('INSTALADO','PENDIENTE')`,
          isNull(t.meters.deletedAt),
        ),
      )
      .where(where)
      .orderBy(desc(t.connections.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.connections)
      .innerJoin(t.customers, eq(t.customers.id, t.connections.customerId))
      .leftJoin(
        t.meters,
        and(
          eq(t.meters.connectionId, t.connections.id),
          sql`${t.meters.status} in ('INSTALADO','PENDIENTE')`,
          isNull(t.meters.deletedAt),
        ),
      )
      .where(where);
    return c.json({ data: rows, meta: { page, pageSize, total: countRow?.n ?? 0 } });
  });

  r.post(
    "/connections",
    requirePermission("conexiones.crear"),
    zValidator(
      "json",
      z.object({
        customerId: z.string().uuid().optional(),
        newCustomer: customerInputSchema.partial().optional(),
        code: z.string().min(1).optional(),
        accountNumber: z.string().optional(),
        address: z.string().optional(),
        zoneId: z.string().uuid().optional(),
        neighborhoodId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        tariffId: z.string().uuid().optional(),
        status: z.string().default("PENDIENTE"),
        installedAt: z.string().optional(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        notes: z.string().optional(),
        city: z.string().optional(),
        referenceNote: z.string().optional(),
        connectionCost: z.string().optional(),
        paymentMode: z.enum(["CONTADO", "CUOTAS"]).optional(),
        downPayment: z.string().optional(),
        installmentCount: z.coerce.number().int().min(1).max(60).optional(),
        firstDueOn: z.string().optional(),
        methodId: z.string().uuid().optional(),
        meter: z
          .object({
            number: z.string().min(1),
            brand: z.string().optional(),
            model: z.string().optional(),
            serial: z.string().optional(),
            initialReading: z.string().default("0"),
            installedAt: z.string().optional(),
          })
          .optional(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      let customerId = body.customerId ?? null;
      if (!customerId && body.newCustomer && !body.newCustomer.firstName && !body.newCustomer.lastName && !body.newCustomer.legalName) {
        throw jsonError("VALIDATION_ERROR", "El nuevo cliente necesita nombre o razón social", 400);
      }
      if (!customerId && body.newCustomer) {
        const incoming = await prepareCustomerValues(db, user.companyId, body.newCustomer, { isCreate: true });
        const code = incoming.code?.trim() || (await nextCustomerCode(db, user.companyId));
        const [created] = await db
          .insert(t.customers)
          .values({ ...incoming, code, companyId: user.companyId, createdBy: user.id, status: incoming.status ?? "ACTIVO", idDocumentType: incoming.idDocumentType ?? "CI" })
          .returning();
        await db.insert(t.customerAccounts).values({ companyId: user.companyId, customerId: created!.id, balance: "0.00" });
        customerId = created!.id;
      } else if (customerId) {
        const [owned] = await db
          .select({ id: t.customers.id })
          .from(t.customers)
          .where(and(eq(t.customers.id, customerId), eq(t.customers.companyId, user.companyId), isNull(t.customers.deletedAt)))
          .limit(1);
        if (!owned) throw jsonError("NOT_FOUND", "Cliente no encontrado", 404);
      }
      if (!customerId) throw jsonError("VALIDATION_ERROR", "Seleccioná un cliente o creá uno nuevo", 400);
      const code = await nextConnectionCode(db, user.companyId);
      const accountNumber = body.accountNumber?.trim() || code;
      const [row] = await db
        .insert(t.connections)
        .values({
          customerId,
          code,
          accountNumber,
          address: body.address,
          zoneId: body.zoneId,
          neighborhoodId: body.neighborhoodId,
          categoryId: body.categoryId,
          tariffId: body.tariffId,
          status: "PENDIENTE",
          installedAt: body.installedAt,
          latitude: body.latitude,
          longitude: body.longitude,
          notes: body.notes,
          city: body.city,
          referenceNote: body.referenceNote,
          requestedAt: todayAsuncion(),
          connectionCost: body.connectionCost,
          paymentMode: body.paymentMode,
          companyId: user.companyId,
          qrToken: crypto.randomUUID(),
        })
        .returning();
      await db.insert(t.connectionInstallations).values({
        companyId: user.companyId,
        connectionId: row!.id,
        customerId,
        status: "PENDIENTE",
        observations: body.notes || undefined,
      });
      if (body.connectionCost) {
        const [account] = await db.select().from(t.customerAccounts).where(and(eq(t.customerAccounts.customerId, customerId), eq(t.customerAccounts.companyId, user.companyId))).limit(1);
        if (account) {
          await db.insert(t.accountMovements).values({
            accountId: account.id,
            movementType: "CONEXION",
            amount: body.connectionCost,
          });
          await db
            .update(t.customerAccounts)
            .set({ balance: sql`${t.customerAccounts.balance} + ${body.connectionCost}::numeric`, updatedAt: new Date() })
            .where(eq(t.customerAccounts.id, account.id));
        }
        if (body.paymentMode === "CUOTAS" && body.installmentCount) {
          await createInstallmentPlan(db, {
            companyId: user.companyId,
            customerId,
            connectionId: row!.id,
            kind: "CONEXION",
            total: body.connectionCost,
            downPayment: body.downPayment ?? "0",
            count: body.installmentCount,
            firstDueOn: body.firstDueOn ?? nextMonthAsuncion(),
            createdBy: user.id,
          });
        }
        const payNow = body.paymentMode === "CUOTAS" ? Number(body.downPayment ?? 0) : Number(body.connectionCost);
        if (body.methodId && payNow > 0) {
          const [pay] = await db
            .insert(t.payments)
            .values({
              companyId: user.companyId,
              customerId,
              methodId: body.methodId,
              amount: payNow.toFixed(2),
              paidOn: todayAsuncion(),
              notes: body.paymentMode === "CUOTAS" ? "Anticipo conexión" : "Pago conexión de contado",
              userId: user.id,
              idempotencyKey: crypto.randomUUID(),
            })
            .returning();
          if (account) {
            await db.insert(t.accountMovements).values({
              accountId: account.id,
              movementType: "PAGO",
              amount: `-${payNow.toFixed(2)}`,
              paymentId: pay!.id,
            });
            await db
              .update(t.customerAccounts)
              .set({ balance: sql`${t.customerAccounts.balance} - ${payNow}::numeric`, updatedAt: new Date() })
              .where(eq(t.customerAccounts.id, account.id));
          }
          await draftInvoiceFromPayment(db, { companyId: user.companyId, userId: user.id, paymentId: pay!.id });
        }
      }
      await audit(db, {
        companyId: user.companyId,
        userId: user.id,
        action: "CONEXION_CREADA",
        module: "conexiones",
        entityType: "connection",
        entityId: row!.id,
        newValues: { code: row!.code, customerId, paymentMode: body.paymentMode, connectionCost: body.connectionCost },
      });
      return c.json({ data: row }, 201);
    },
  );

  r.get("/connections/by-qr/:token", requirePermission("conexiones.ver"), async (c) => {
    const db = c.get("db");
    const token = c.req.param("token");
    const [conn] = await db
      .select()
      .from(t.connections)
      .where(and(eq(t.connections.qrToken, token), eq(t.connections.companyId, c.get("user")!.companyId)))
      .limit(1);
    if (!conn) throw jsonError("NOT_FOUND", "QR no encontrado", 404);
    const [customer] = await db.select().from(t.customers).where(eq(t.customers.id, conn.customerId)).limit(1);
    const [meter] = await db
      .select()
      .from(t.meters)
      .where(and(eq(t.meters.connectionId, conn.id), eq(t.meters.status, "INSTALADO")))
      .limit(1);
    const [last] = await db
      .select()
      .from(t.meterReadings)
      .where(eq(t.meterReadings.connectionId, conn.id))
      .orderBy(desc(t.meterReadings.serverCapturedAt))
      .limit(1);
    return c.json({ data: { connection: conn, customer, meter, lastReading: last ?? null } });
  });

  const connectionPatchSchema = z
    .object({
      address: z.string().max(300).nullish(),
      zoneId: z.string().uuid().nullish(),
      neighborhoodId: z.string().uuid().nullish(),
      categoryId: z.string().uuid().nullish(),
      tariffId: z.string().uuid().nullish(),
      status: z.enum([
        "PENDIENTE",
        "ACTIVA",
        "SUSPENDIDA",
        "CORTADA",
        "DESCONECTADA",
        "DESCONEXION_PROGRAMADA",
        "BAJA",
      ]).optional(),
      installedAt: z.string().max(40).nullish(),
      latitude: z.string().max(40).nullish(),
      longitude: z.string().max(40).nullish(),
      notes: z.string().max(2000).nullish(),
      city: z.string().max(120).nullish(),
      referenceNote: z.string().max(300).nullish(),
      connectionCost: z.string().max(24).nullish(),
      paymentMode: z.enum(["CONTADO", "CUOTAS"]).nullish(),
    })
    .strict();

  r.patch(
    "/connections/:id",
    requirePermission("conexiones.editar"),
    zValidator("param", idParam),
    zValidator("json", connectionPatchSchema),
    async (c) => {
      const db = c.get("db");
      const body = c.req.valid("json");
      const [row] = await db
        .update(t.connections)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(t.connections.id, c.req.valid("param").id), eq(t.connections.companyId, c.get("user")!.companyId)))
        .returning();
      if (!row) throw jsonError("NOT_FOUND", "Conexión no encontrada", 404);
      return c.json({ data: row });
    },
  );

  r.get("/meters", requirePermission("medidores.ver"), zValidator("query", paginationQuery), async (c) => {
    const db = c.get("db");
    const { page, pageSize, q } = c.req.valid("query");
    const companyId = c.get("user")!.companyId;
    const where = q
      ? and(eq(t.meters.companyId, companyId), or(ilike(t.meters.number, `%${q}%`), ilike(t.meters.serial, `%${q}%`)))
      : eq(t.meters.companyId, companyId);
    const rows = await db.select().from(t.meters).where(where).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data: rows, meta: { page, pageSize } });
  });

  r.post(
    "/meters",
    requirePermission("medidores.crear"),
    zValidator(
      "json",
      z.object({
        connectionId: z.string().uuid().optional(),
        number: z.string().min(1),
        brand: z.string().optional(),
        model: z.string().optional(),
        serial: z.string().optional(),
        diameterMm: z.string().optional(),
        installedAt: z.string().optional(),
        initialReading: z.string().default("0"),
        status: z.string().default("INSTALADO"),
        locationNote: z.string().optional(),
        notes: z.string().optional(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const [row] = await db.insert(t.meters).values({ ...body, companyId: user.companyId }).returning();
      await db.insert(t.meterEvents).values({
        meterId: row!.id,
        eventType: "INSTALACION",
        reading: body.initialReading,
        userId: user.id,
      });
      if (body.connectionId && (body.status ?? "INSTALADO") !== "RETIRADO") {
        await db
          .update(t.connections)
          .set({ status: "ACTIVA", installedAt: body.installedAt ?? todayAsuncion(), updatedAt: new Date() })
          .where(and(eq(t.connections.id, body.connectionId), eq(t.connections.companyId, user.companyId)));
      }
      return c.json({ data: row }, 201);
    },
  );

  const meterPatchSchema = z
    .object({
      connectionId: z.string().uuid().nullish(),
      number: z.string().min(1).max(80).optional(),
      brand: z.string().max(80).nullish(),
      model: z.string().max(80).nullish(),
      serial: z.string().max(80).nullish(),
      diameterMm: z.string().max(20).nullish(),
      installedAt: z.string().max(40).nullish(),
      status: z.enum(["INSTALADO", "PENDIENTE", "RETIRADO", "DANADO", "EN_TALLER"]).optional(),
      locationNote: z.string().max(300).nullish(),
      notes: z.string().max(2000).nullish(),
    })
    .strict();

  r.patch(
    "/meters/:id",
    requirePermission("medidores.editar"),
    zValidator("param", idParam),
    zValidator("json", meterPatchSchema),
    async (c) => {
      const [row] = await c
        .get("db")
        .update(t.meters)
        .set({ ...c.req.valid("json"), updatedAt: new Date() })
        .where(and(eq(t.meters.id, c.req.valid("param").id), eq(t.meters.companyId, c.get("user")!.companyId)))
        .returning();
      if (!row) throw jsonError("NOT_FOUND", "Medidor no encontrado", 404);
      return c.json({ data: row });
    },
  );

  r.post(
    "/meters/:id/replace",
    requirePermission("medidores.editar"),
    zValidator("param", idParam),
    zValidator(
      "json",
      z.object({
        number: z.string().min(1),
        brand: z.string().optional(),
        model: z.string().optional(),
        serial: z.string().optional(),
        finalReading: z.string().min(1),
        initialReading: z.string().default("0"),
        notes: z.string().optional(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const [oldMeter] = await db
        .select()
        .from(t.meters)
        .where(and(eq(t.meters.id, id), eq(t.meters.companyId, user.companyId)))
        .limit(1);
      if (!oldMeter) throw jsonError("NOT_FOUND", "Medidor no encontrado", 404);
      await db
        .update(t.meters)
        .set({ status: "RETIRADO", notes: body.notes ?? oldMeter.notes, updatedAt: new Date() })
        .where(eq(t.meters.id, oldMeter.id));
      await db.insert(t.meterEvents).values({
        meterId: oldMeter.id,
        eventType: "RETIRO",
        reading: body.finalReading,
        notes: body.notes,
        userId: user.id,
      });
      const [created] = await db
        .insert(t.meters)
        .values({
          companyId: user.companyId,
          connectionId: oldMeter.connectionId,
          number: body.number,
          brand: body.brand,
          model: body.model,
          serial: body.serial,
          initialReading: body.initialReading,
          status: "INSTALADO",
        })
        .returning();
      await db.insert(t.meterEvents).values({
        meterId: created!.id,
        eventType: "INSTALACION",
        reading: body.initialReading,
        notes: `Reemplazo de ${oldMeter.number}`,
        userId: user.id,
      });
      return c.json({ data: { previous: oldMeter, current: created } }, 201);
    },
  );

  r.get("/meters/:id/events", requirePermission("medidores.ver"), zValidator("param", idParam), async (c) => {
    const db = c.get("db");
    const meterId = c.req.valid("param").id;
    const [meter] = await db
      .select({ id: t.meters.id })
      .from(t.meters)
      .where(and(eq(t.meters.id, meterId), eq(t.meters.companyId, c.get("user")!.companyId)))
      .limit(1);
    if (!meter) throw jsonError("NOT_FOUND", "Medidor no encontrado", 404);
    const rows = await db.select().from(t.meterEvents).where(eq(t.meterEvents.meterId, meterId));
    return c.json({ data: rows });
  });

  r.get("/zones", requirePermission("clientes.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.zones).where(eq(t.zones.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });
  r.post("/zones", requirePermission("configuracion.editar"), zValidator("json", z.object({ code: z.string(), name: z.string() })), async (c) => {
    const [row] = await c.get("db").insert(t.zones).values({ ...c.req.valid("json"), companyId: c.get("user")!.companyId }).returning();
    return c.json({ data: row }, 201);
  });
  r.get("/categories", requirePermission("clientes.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.customerCategories).where(eq(t.customerCategories.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });
  r.get("/neighborhoods", requirePermission("clientes.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const city = c.req.query("city")?.trim();
    const department = c.req.query("department")?.trim();
    const filters = [eq(t.neighborhoods.companyId, companyId)];
    if (city) filters.push(eq(t.neighborhoods.city, city));
    if (department) filters.push(eq(t.neighborhoods.department, department));
    const rows = await db.select().from(t.neighborhoods).where(and(...filters)).orderBy(t.neighborhoods.name);
    return c.json({ data: rows });
  });
  r.get("/tax-rates", requirePermission("tarifas.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.taxRates).where(eq(t.taxRates.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });
  r.get("/tariffs", requirePermission("tarifas.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const list = await db.select().from(t.tariffs).where(eq(t.tariffs.companyId, companyId));
    const rules = await db.select().from(t.tariffRules);
    return c.json({
      data: list.map((tariff) => ({ ...tariff, rules: rules.filter((x) => x.tariffId === tariff.id) })),
    });
  });
  r.post(
    "/tariffs",
    requirePermission("tarifas.crear"),
    zValidator(
      "json",
      z.object({
        name: z.string(),
        categoryId: z.string().uuid(),
        validFrom: z.string(),
        validTo: z.string().optional(),
        notes: z.string().optional(),
        rule: z.object({
          fixedCharge: z.string(),
          minConsumptionM3: z.string(),
          minAmount: z.string(),
          pricePerM3: z.string(),
          excessPricePerM3: z.string().optional(),
          surchargePercent: z.string().default("2"),
          discountPercent: z.string().default("0"),
          taxRateId: z.string().uuid().optional(),
          excessiveMultiplier: z.string().optional(),
        }),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const [tariff] = await db
        .insert(t.tariffs)
        .values({
          companyId: user.companyId,
          name: body.name,
          categoryId: body.categoryId,
          validFrom: body.validFrom,
          validTo: body.validTo,
          notes: body.notes,
        })
        .returning();
      await db.insert(t.tariffRules).values({ tariffId: tariff!.id, ...body.rule });
      await audit(db, { companyId: user.companyId, userId: user.id, action: "TARIFA_MODIFICADA", module: "tarifas", entityId: tariff!.id });
      return c.json({ data: tariff }, 201);
    },
  );
}

function registerReadings(r: Hono<AppEnv>): void {
  r.get("/field/config", requirePermission("lecturas.ver"), async (c) => {
    const settings = await loadFieldSettings(c.get("db"), c.get("user")!.companyId, loadEnv());
    return c.json({ data: settings });
  });

  r.post(
    "/field/start",
    requirePermission("lecturas.crear"),
    zValidator(
      "json",
      z.object({
        connectionId: z.string().uuid(),
      }),
    ),
    async (c) => {
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const data = await startFieldReading({
        db: c.get("db"),
        user,
        connectionId: body.connectionId,
        ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
      });
      return c.json({ data });
    },
  );

  r.get(
    "/field/queue",
    requirePermission("lecturas.ver"),
    zValidator(
      "query",
      z.object({
        q: z.string().optional(),
        status: z.enum(["pending", "done", "observed", "incident", "all"]).optional(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const { q, status } = c.req.valid("query");

      const rows = await db.execute(sql`
        with last_read as (
          select distinct on (meter_id)
            meter_id, current_reading, server_captured_at, anomaly_code, requires_review
          from meter_readings
          where company_id = ${user.companyId}
          order by meter_id, server_captured_at desc
        ),
        open_period as (
          select id from billing_periods
          where company_id = ${user.companyId} and status in ('ABIERTO','EN_PROCESO','EN_REVISION')
          order by starts_on desc
          limit 1
        )
        select
          cn.id as "connectionId",
          cn.code as "connectionCode",
          cn.account_number as "accountNumber",
          cn.status as "connectionStatus",
          coalesce(cn.address, cu.address) as address,
          cn.latitude as "supplyLat",
          cn.longitude as "supplyLng",
          cu.id as "customerId",
          cu.code as "customerCode",
          cu.first_name as "customerFirstName",
          cu.last_name as "customerLastName",
          cu.legal_name as "customerLegalName",
          coalesce(nullif(trim(cu.legal_name), ''), nullif(trim(concat_ws(' ', cu.first_name, cu.last_name)), ''), cu.code) as "customerName",
          cu.ruc as "customerRuc",
          cu.ci as "customerCi",
          coalesce(cu.mobile, cu.phone) as "customerPhone",
          cu.address as "customerAddress",
          m.id as "meterId",
          m.number as "meterNumber",
          m.brand as "meterBrand",
          m.model as "meterModel",
          m.status as "meterStatus",
          m.installed_at as "meterInstalledAt",
          m.initial_reading as "initialReading",
          lr.current_reading as "previousReading",
          lr.server_captured_at as "lastReadAt",
          lr.anomaly_code as "lastAnomaly",
          lr.requires_review as "lastRequiresReview",
          case
            when exists (
              select 1 from meter_readings mr, open_period op
              where mr.meter_id = m.id and mr.billing_period_id = op.id
            ) then 'REGISTRADA'
            else 'PENDIENTE'
          end as "itemStatus"
        from connections cn
        join customers cu on cu.id = cn.customer_id
        join lateral (
          select mx.*
          from meters mx
          where mx.connection_id = cn.id
            and mx.deleted_at is null
            and mx.status in ('INSTALADO', 'PENDIENTE')
          order by case when mx.status = 'INSTALADO' then 0 else 1 end, mx.created_at desc
          limit 1
        ) m on true
        left join last_read lr on lr.meter_id = m.id
        where cn.company_id = ${user.companyId}
          and cn.deleted_at is null
          and cn.status in ('ACTIVA', 'PENDIENTE')
        order by cu.last_name, cu.first_name, cn.code
      `);

      let list = rows as unknown as Array<Record<string, unknown>>;

      if (q && q.trim()) {
        const needle = q.trim().toLowerCase();
        list = list.filter((row) => {
          const meter = String(row.meterNumber ?? "");
          return [
            row.customerName,
            row.customerFirstName,
            row.customerLastName,
            row.customerLegalName,
            row.customerCode,
            row.customerRuc,
            row.customerCi,
            row.connectionCode,
            row.accountNumber,
            row.address,
            meter,
            meter.slice(-4),
          ]
            .map((v) => String(v ?? "").toLowerCase())
            .some((v) => v.includes(needle));
        });
      }

      if (status === "pending") list = list.filter((r) => r.itemStatus === "PENDIENTE");
      if (status === "done") list = list.filter((r) => r.itemStatus === "REGISTRADA");
      if (status === "observed" || status === "incident") {
        list = list.filter((r) => r.lastRequiresReview === true || (r.lastAnomaly && r.lastAnomaly !== "NONE"));
      }

      const pending = list.filter((r) => r.itemStatus === "PENDIENTE").length;
      const done = list.filter((r) => r.itemStatus === "REGISTRADA").length;
      const observed = list.filter((r) => r.lastRequiresReview === true).length;
      return c.json({ data: list, meta: { pending, done, observed, total: list.length } });
    },
  );

  r.get("/readings", requirePermission("lecturas.ver"), zValidator("query", paginationQuery.extend({ anomalous: z.string().optional(), customerId: z.string().uuid().optional() })), async (c) => {
    const db = c.get("db");
    const { page, pageSize, anomalous, customerId } = c.req.valid("query");
    const companyId = c.get("user")!.companyId;
    const user = c.get("user")!;
    const scope = isFieldOnlyUser(user)
      ? and(eq(t.meterReadings.companyId, companyId), eq(t.meterReadings.readerId, user.id))
      : eq(t.meterReadings.companyId, companyId);
    const where = and(
      scope,
      anomalous === "true" ? eq(t.meterReadings.requiresReview, true) : undefined,
      customerId ? eq(t.meterReadings.customerId, customerId) : undefined,
    );
    const rows = await db
      .select()
      .from(t.meterReadings)
      .where(where)
      .orderBy(desc(t.meterReadings.serverCapturedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return c.json({ data: rows, meta: { page, pageSize } });
  });

  r.post("/readings", requirePermission("lecturas.crear"), zValidator("json", readingInputSchema), async (c) => {
    const result = await recordMeterReading({
      db: c.get("db"),
      user: c.get("user")!,
      env: loadEnv(),
      body: c.req.valid("json"),
      ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
    });
    let bill = result.row ? await findBillForReading(c.get("db"), result.row) : null;
    if (!bill && result.row && result.evaluation && !result.evaluation.blockAutoBilling) {
      bill = await upsertBillForReading(c.get("db"), { companyId: c.get("user")!.companyId, reading: result.row });
    }
    return c.json(
      { data: { ...result.row, evaluation: result.evaluation, billId: bill?.id ?? null, billNumber: bill?.number ?? null }, meta: { idempotent: result.idempotent } },
      result.idempotent ? 200 : 201,
    );
  });

  r.post("/readings/:id/approve", requirePermission("lecturas.aprobar"), zValidator("param", idParam), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const [row] = await db
      .update(t.meterReadings)
      .set({ requiresReview: false, reviewedAt: new Date(), reviewedBy: user.id, updatedAt: new Date() })
      .where(and(eq(t.meterReadings.id, c.req.valid("param").id), eq(t.meterReadings.companyId, user.companyId)))
      .returning();
    if (!row) throw jsonError("NOT_FOUND", "Lectura no encontrada", 404);
    await audit(db, {
      companyId: user.companyId,
      userId: user.id,
      action: "LECTURA_MODIFICADA",
      module: "lecturas",
      entityId: row?.id,
    });
    if (row && !row.billed) {
      await upsertBillForReading(db, { companyId: user.companyId, reading: row });
    }
    return c.json({ data: row });
  });

  r.get("/readings/:id/boleta-pdf", requirePermission("lecturas.ver"), zValidator("param", idParam), async (c) => {
    const db = c.get("db");
    const [reading] = await db.select().from(t.meterReadings).where(eq(t.meterReadings.id, c.req.valid("param").id)).limit(1);
    if (!reading || reading.companyId !== c.get("user")!.companyId) throw jsonError("NOT_FOUND", "Lectura no encontrada", 404);
    const bill = await findBillForReading(db, reading);
    if (!bill) throw jsonError("NOT_FOUND", "Aún no hay boleta para esta lectura", 404);
    const doc = await renderWaterBillPdfBuffer(db, bill.id);
    if (!doc) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
    return new Response(new Uint8Array(doc.pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${doc.number}.pdf"` },
    });
  });
}

function registerBilling(r: Hono<AppEnv>): void {
  r.get("/billing-periods", requirePermission("periodos.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.billingPeriods).where(eq(t.billingPeriods.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });
  r.post(
    "/billing-periods",
    requirePermission("periodos.crear"),
    zValidator(
      "json",
      z.object({
        code: z.string(),
        name: z.string(),
        startsOn: z.string(),
        endsOn: z.string(),
        dueOn: z.string().optional(),
      }),
    ),
    async (c) => {
      const [row] = await c
        .get("db")
        .insert(t.billingPeriods)
        .values({ ...c.req.valid("json"), companyId: c.get("user")!.companyId })
        .returning();
      return c.json({ data: row }, 201);
    },
  );

  r.post("/billing-periods/:id/transition", requirePermission("periodos.editar"), async (c) => {
    const body = z
      .object({ status: z.enum(["ABIERTO", "EN_PROCESO", "EN_REVISION", "CERRADO"]) })
      .parse(await c.req.json());
    const db = c.get("db");
    const user = c.get("user")!;
    const [current] = await db
      .select()
      .from(t.billingPeriods)
      .where(and(eq(t.billingPeriods.id, c.req.param("id")), eq(t.billingPeriods.companyId, user.companyId)))
      .limit(1);
    if (!current) throw jsonError("NOT_FOUND", "Periodo no encontrado", 404);
    if (current.status === "CERRADO" && body.status !== "CERRADO") {
      if (!user.permissions.includes("periodos.reabrir")) {
        throw jsonError("FORBIDDEN", "Periodo cerrado: se requiere autorización especial", 403);
      }
      await audit(db, { companyId: user.companyId, userId: user.id, action: "PERIODO_REABIERTO", module: "periodos", entityId: current.id });
    }
    const [row] = await db
      .update(t.billingPeriods)
      .set({ status: body.status, closedAt: body.status === "CERRADO" ? new Date() : null, updatedAt: new Date() })
      .where(eq(t.billingPeriods.id, current.id))
      .returning();
    return c.json({ data: row });
  });

  r.post("/billing-periods/:id/calculate", requirePermission("periodos.editar"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const periodId = c.req.param("id");
    const [period] = await db
      .select()
      .from(t.billingPeriods)
      .where(and(eq(t.billingPeriods.id, periodId), eq(t.billingPeriods.companyId, user.companyId)))
      .limit(1);
    if (!period) throw jsonError("NOT_FOUND", "Periodo no encontrado", 404);
    if (period.status === "CERRADO") throw jsonError("FISCAL_IMMUTABLE", "Periodo cerrado", 409);
    const readings = await db
      .select()
      .from(t.meterReadings)
      .where(and(eq(t.meterReadings.billingPeriodId, periodId), eq(t.meterReadings.requiresReview, false)));
    let count = 0;
    for (const reading of readings) {
      const [connection] = await db.select().from(t.connections).where(eq(t.connections.id, reading.connectionId)).limit(1);
      if (!connection?.tariffId) continue;
      const [rule] = await db.select().from(t.tariffRules).where(eq(t.tariffRules.tariffId, connection.tariffId)).limit(1);
      if (!rule) continue;
      let taxRate = 0;
      let taxExempt = true;
      if (rule.taxRateId) {
        const [tr] = await db.select().from(t.taxRates).where(eq(t.taxRates.id, rule.taxRateId)).limit(1);
        taxRate = Number(tr?.rate ?? 0);
        taxExempt = Boolean(tr?.exempt);
      }
      const calc = calculateConsumption(Number(reading.consumptionM3), tariffRuleToCalc(rule, { rate: taxRate, exempt: taxExempt }));
      await db
        .insert(t.consumptionCalculations)
        .values({
          companyId: user.companyId,
          connectionId: connection.id,
          billingPeriodId: periodId,
          readingId: reading.id,
          tariffId: connection.tariffId,
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
            total: calc.total,
            subtotal: calc.subtotal,
            taxAmount: calc.taxAmount,
            snapshot: calc,
          },
        });
      count += 1;
    }
    return c.json({ data: { calculated: count } });
  });

  r.post("/billing-periods/:id/generate-bills", requirePermission("boletas.emitir"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const periodId = c.req.param("id");
    const [period] = await db
      .select()
      .from(t.billingPeriods)
      .where(and(eq(t.billingPeriods.id, periodId), eq(t.billingPeriods.companyId, user.companyId)))
      .limit(1);
    if (!period) throw jsonError("NOT_FOUND", "Periodo no encontrado", 404);
    const created = await generateBillsForPeriod(db, { companyId: user.companyId, periodId });
    return c.json({ data: { created: created.length } });
  });

  r.post(
    "/bills/:id/credit",
    requirePermission("boletas.emitir"),
    zValidator(
      "json",
      z.object({
        amount: z.string().optional(),
        reason: z.string().max(400).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user")!;
      const bill = await issueCreditBill(c.get("db"), {
        companyId: user.companyId,
        sourceBillId: c.req.param("id"),
        amount: c.req.valid("json").amount,
        reason: c.req.valid("json").reason,
      });
      await audit(c.get("db"), {
        companyId: user.companyId,
        userId: user.id,
        action: "BOLETA_CREDITO",
        module: "boletas",
        entityId: bill.id,
        newValues: { number: bill.number, total: bill.total, sourceBillId: c.req.param("id") },
      });
      return c.json({ data: bill }, 201);
    },
  );

  r.get("/bills", requirePermission("boletas.ver"), zValidator("query", paginationQuery), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const { page, pageSize, q } = c.req.valid("query");
    const year = c.req.query("year");
    const month = c.req.query("month");
    const customerId = c.req.query("customerId");
    const connectionId = c.req.query("connectionId");
    const meter = c.req.query("meter");
    const kind = c.req.query("kind");
    const withBalance = c.req.query("withBalance");
    const filters = [eq(t.waterBills.companyId, companyId)];
    if (customerId) filters.push(eq(t.waterBills.customerId, customerId));
    if (connectionId) filters.push(eq(t.waterBills.connectionId, connectionId));
    if (kind === "CONSUMO" || kind === "CREDITO") filters.push(eq(t.waterBills.kind, kind));
    if (withBalance === "1") {
      filters.push(sql`cast(${t.waterBills.balance} as numeric) > 0`);
      filters.push(sql`${t.waterBills.kind} <> 'CREDITO'`);
    }
    if (year && month) {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      filters.push(sql`${t.waterBills.issuedOn} >= ${start}::date and ${t.waterBills.issuedOn} < (${start}::date + interval '1 month')`);
    } else if (year) {
      filters.push(sql`extract(year from ${t.waterBills.issuedOn}) = ${Number(year)}`);
    }
    const rows = await db
      .select({
        id: t.waterBills.id,
        number: t.waterBills.number,
        issuedOn: t.waterBills.issuedOn,
        dueOn: t.waterBills.dueOn,
        subtotal: t.waterBills.subtotal,
        taxAmount: t.waterBills.taxAmount,
        total: t.waterBills.total,
        balance: t.waterBills.balance,
        status: t.waterBills.status,
        kind: t.waterBills.kind,
        relatedBillId: t.waterBills.relatedBillId,
        reason: t.waterBills.reason,
        customerId: t.waterBills.customerId,
        connectionId: t.waterBills.connectionId,
        customerName: customerDisplayName,
        customerDoc: sql<string>`coalesce(${t.customers.ruc}, ${t.customers.ci})`,
        customerAddress: t.customers.address,
        connectionCode: t.connections.code,
        accountNumber: t.connections.accountNumber,
        connectionStatus: t.connections.status,
        connectionAddress: t.connections.address,
        consumptionM3: t.consumptionCalculations.consumptionM3,
        previousReading: t.meterReadings.previousReading,
        currentReading: t.meterReadings.currentReading,
        lastReadAt: t.meterReadings.serverCapturedAt,
        meterNumber: t.meters.number,
        periodName: t.billingPeriods.name,
        periodStartsOn: t.billingPeriods.startsOn,
        tariffName: t.tariffs.name,
        consumptionAmount: t.consumptionCalculations.consumptionAmount,
        fixedCharge: t.consumptionCalculations.fixedCharge,
        currentReadAt: t.meterReadings.serverCapturedAt,
      })
      .from(t.waterBills)
      .innerJoin(t.customers, eq(t.customers.id, t.waterBills.customerId))
      .innerJoin(t.connections, eq(t.connections.id, t.waterBills.connectionId))
      .leftJoin(t.consumptionCalculations, eq(t.consumptionCalculations.id, t.waterBills.calculationId))
      .leftJoin(t.meterReadings, eq(t.meterReadings.id, t.consumptionCalculations.readingId))
      .leftJoin(t.meters, eq(t.meters.id, t.meterReadings.meterId))
      .leftJoin(t.tariffs, eq(t.tariffs.id, t.consumptionCalculations.tariffId))
      .innerJoin(t.billingPeriods, eq(t.billingPeriods.id, t.waterBills.billingPeriodId))
      .where(and(...filters))
      .orderBy(desc(t.waterBills.issuedOn))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    let list = rows as unknown as Array<Record<string, unknown>>;
    if (q?.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((row) =>
        [row.customerName, row.connectionCode, row.accountNumber, row.meterNumber, row.number, row.customerDoc]
          .map((v) => String(v ?? "").toLowerCase())
          .some((v) => v.includes(needle)),
      );
    }
    if (meter?.trim()) {
      const needle = meter.trim().toLowerCase();
      list = list.filter((row) => String(row.meterNumber ?? "").toLowerCase().includes(needle));
    }
    return c.json({ data: list, meta: { page, pageSize } });
  });

  r.get("/bills/history", requirePermission("boletas.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const connectionId = c.req.query("connectionId");
    const customerId = c.req.query("customerId");
    if (!connectionId && !customerId) throw jsonError("VALIDATION_ERROR", "Indicá conexión o cliente", 400);
    const filters = [eq(t.waterBills.companyId, companyId)];
    if (connectionId) filters.push(eq(t.waterBills.connectionId, connectionId));
    if (customerId) filters.push(eq(t.waterBills.customerId, customerId));
    const rows = await db
      .select({
        id: t.waterBills.id,
        number: t.waterBills.number,
        issuedOn: t.waterBills.issuedOn,
        total: t.waterBills.total,
        status: t.waterBills.status,
        periodName: t.billingPeriods.name,
        periodStartsOn: t.billingPeriods.startsOn,
        consumptionM3: t.consumptionCalculations.consumptionM3,
        previousReading: t.meterReadings.previousReading,
        currentReading: t.meterReadings.currentReading,
      })
      .from(t.waterBills)
      .innerJoin(t.billingPeriods, eq(t.billingPeriods.id, t.waterBills.billingPeriodId))
      .leftJoin(t.consumptionCalculations, eq(t.consumptionCalculations.id, t.waterBills.calculationId))
      .leftJoin(t.meterReadings, eq(t.meterReadings.id, t.consumptionCalculations.readingId))
      .where(and(...filters))
      .orderBy(desc(t.billingPeriods.startsOn))
      .limit(24);
    return c.json({ data: rows });
  });

  r.get("/bills/:id/pdf", requirePermission("boletas.ver"), async (c) => {
    const db = c.get("db");
    const [bill] = await db.select().from(t.waterBills).where(eq(t.waterBills.id, c.req.param("id"))).limit(1);
    if (!bill) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
    if (bill.companyId !== c.get("user")!.companyId) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
    const doc = await renderWaterBillPdfBuffer(db, bill.id);
    if (!doc) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
    return new Response(new Uint8Array(doc.pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${doc.number}.pdf"` },
    });
  });

  r.get("/bills/:id/verify", requirePermission("boletas.ver"), async (c) => {
    const db = c.get("db");
    const [bill] = await db.select().from(t.waterBills).where(eq(t.waterBills.id, c.req.param("id"))).limit(1);
    if (!bill) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
    if (bill.companyId !== c.get("user")!.companyId) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
    return c.json({
      data: {
        kind: bill.kind === "CREDITO" ? "BOLETA_CREDITO" : "BOLETA_CONSUMO",
        id: bill.id,
        number: bill.number,
        issuedOn: bill.issuedOn,
        dueOn: bill.dueOn,
        total: bill.total,
        balance: bill.balance,
        status: bill.status,
      },
    });
  });

  r.get("/tax-stamps", requirePermission("timbrados.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.taxStamps).where(eq(t.taxStamps.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });
  r.post(
    "/tax-stamps",
    requirePermission("timbrados.crear"),
    zValidator(
      "json",
      z.object({
        number: z.string(),
        documentType: z.enum([
          "FACTURA_ELECTRONICA",
          "NOTA_CREDITO_ELECTRONICA",
          "NOTA_DEBITO_ELECTRONICA",
          "AUTOFACTURA_ELECTRONICA",
          "NOTA_REMISION_ELECTRONICA",
        ]),
        establishmentId: z.string().uuid(),
        salesPointId: z.string().uuid(),
        validFrom: z.string(),
        validTo: z.string(),
        rangeFrom: z.number().int().positive(),
        rangeTo: z.number().int().positive(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      if (body.rangeTo < body.rangeFrom) throw jsonError("VALIDATION_ERROR", "Rango inválido");
      const [row] = await c
        .get("db")
        .insert(t.taxStamps)
        .values({ ...body, companyId: c.get("user")!.companyId, nextNumber: body.rangeFrom })
        .returning();
      await audit(c.get("db"), {
        companyId: c.get("user")!.companyId,
        userId: c.get("user")!.id,
        action: "TIMBRADO_MODIFICADO",
        module: "timbrados",
        entityId: row?.id,
      });
      return c.json({ data: row }, 201);
    },
  );

  r.get("/invoices", requirePermission("facturas.ver"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    await ensureDraftInvoicesForPayments(db, { companyId: user.companyId, userId: user.id });
    const rows = await db
      .select({
        id: t.invoices.id,
        fiscalNumberFormatted: t.invoices.fiscalNumberFormatted,
        businessStatus: t.invoices.businessStatus,
        sifenStatus: t.invoices.sifenStatus,
        total: t.invoices.total,
        subtotal: t.invoices.subtotal,
        taxAmount: t.invoices.taxAmount,
        issuedAt: t.invoices.issuedAt,
        createdAt: t.invoices.createdAt,
        customerId: t.invoices.customerId,
        customerCode: t.customers.code,
        customerName: customerDisplayName,
        waterBillId: t.invoices.waterBillId,
        documentType: t.invoices.documentType,
      })
      .from(t.invoices)
      .innerJoin(t.customers, eq(t.customers.id, t.invoices.customerId))
      .where(eq(t.invoices.companyId, user.companyId))
      .orderBy(desc(t.invoices.createdAt));
    return c.json({
      data: rows.map((row) => ({
        ...row,
        fiscalNumberFormatted: row.fiscalNumberFormatted || "Pendiente de timbrado",
        statusLabel: row.businessStatus === "BORRADOR" ? "Pendiente" : row.businessStatus,
      })),
    });
  });

  r.post(
    "/invoices",
    requirePermission("facturas.crear"),
    zValidator(
      "json",
      z.object({
        customerId: z.string().uuid(),
        waterBillId: z.string().uuid().optional(),
        documentType: z
          .enum(["FACTURA_ELECTRONICA", "NOTA_CREDITO_ELECTRONICA", "NOTA_DEBITO_ELECTRONICA"])
          .optional(),
        relatedInvoiceId: z.string().uuid().optional(),
        items: z.array(
          z.object({
            description: z.string(),
            quantity: z.string(),
            unitAmount: z.string(),
            taxRateId: z.string().uuid().optional(),
            taxAmount: z.string().default("0"),
            total: z.string(),
          }),
        ),
        subtotal: z.string(),
        taxAmount: z.string(),
        total: z.string(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const [customer] = await db
        .select({ id: t.customers.id })
        .from(t.customers)
        .where(and(eq(t.customers.id, body.customerId), eq(t.customers.companyId, user.companyId)))
        .limit(1);
      if (!customer) throw jsonError("NOT_FOUND", "Cliente no encontrado", 404);
      if (body.waterBillId) {
        const [wb] = await db
          .select({ id: t.waterBills.id })
          .from(t.waterBills)
          .where(and(eq(t.waterBills.id, body.waterBillId), eq(t.waterBills.companyId, user.companyId)))
          .limit(1);
        if (!wb) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
      }
      const [inv] = await db
        .insert(t.invoices)
        .values({
          companyId: user.companyId,
          customerId: body.customerId,
          waterBillId: body.waterBillId,
          documentType: body.documentType ?? "FACTURA_ELECTRONICA",
          relatedInvoiceId: body.relatedInvoiceId,
          subtotal: body.subtotal,
          taxAmount: body.taxAmount,
          total: body.total,
          businessStatus: "BORRADOR",
          sifenStatus: "NO_CONFIGURADO",
          createdBy: user.id,
        })
        .returning();
      await db.insert(t.invoiceItems).values(body.items.map((item) => ({ ...item, invoiceId: inv!.id })));
      return c.json({ data: inv }, 201);
    },
  );

  r.get("/invoices/:id/pdf", requirePermission("facturas.ver"), async (c) => {
    const pdf = await renderInvoicePdfBuffer(c.get("db"), {
      companyId: c.get("user")!.companyId,
      invoiceId: c.req.param("id"),
    });
    if (!pdf) throw jsonError("NOT_FOUND", "Factura no encontrada", 404);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="factura-${c.req.param("id").slice(0, 8)}.pdf"` },
    });
  });

  r.get("/invoices/:id/verify", requirePermission("facturas.ver"), async (c) => {
    const [inv] = await c
      .get("db")
      .select()
      .from(t.invoices)
      .where(and(eq(t.invoices.id, c.req.param("id")), eq(t.invoices.companyId, c.get("user")!.companyId)))
      .limit(1);
    if (!inv) throw jsonError("NOT_FOUND", "Factura no encontrada", 404);
    return c.json({
      data: {
        kind: "FACTURA",
        id: inv.id,
        businessStatus: inv.businessStatus,
        sifenStatus: inv.sifenStatus,
        total: inv.total,
        fiscalNumber: inv.fiscalNumberFormatted,
      },
    });
  });

  r.post("/invoices/:id/issue", requirePermission("facturas.emitir"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const [inv] = await db
      .select()
      .from(t.invoices)
      .where(and(eq(t.invoices.id, c.req.param("id")), eq(t.invoices.companyId, user.companyId)))
      .limit(1);
    if (!inv) throw jsonError("NOT_FOUND", "Factura no encontrada", 404);
    if (inv.businessStatus !== "BORRADOR") throw jsonError("FISCAL_IMMUTABLE", "Solo se emiten borradores", 409);
    const stamps = await db
      .select()
      .from(t.taxStamps)
      .where(and(eq(t.taxStamps.companyId, user.companyId), eq(t.taxStamps.status, "ACTIVO")));
    const stamp = stamps.find((s) => s.documentType === inv.documentType) ?? stamps[0];
    if (!stamp) throw jsonError("STAMP_EXPIRED", "No hay timbrado activo", 409);
    if (inv.documentType === "NOTA_CREDITO_ELECTRONICA" && stamp.documentType !== "NOTA_CREDITO_ELECTRONICA") {
      throw jsonError("STAMP_EXPIRED", "No hay timbrado activo para nota de crédito electrónica", 409);
    }
    const allocated = allocateFiscalNumber({
      status: stamp.status,
      validFrom: stamp.validFrom,
      validTo: stamp.validTo,
      rangeFrom: stamp.rangeFrom,
      rangeTo: stamp.rangeTo,
      nextNumber: stamp.nextNumber,
      today: todayAsuncion(),
    });
    const [est] = await db.select().from(t.establishments).where(eq(t.establishments.id, stamp.establishmentId)).limit(1);
    const [sp] = await db.select().from(t.salesPoints).where(eq(t.salesPoints.id, stamp.salesPointId)).limit(1);
    await db.update(t.taxStamps).set({ nextNumber: allocated.nextNumber, updatedAt: new Date() }).where(eq(t.taxStamps.id, stamp.id));
    const [row] = await db
      .update(t.invoices)
      .set({
        taxStampId: stamp.id,
        establishmentId: stamp.establishmentId,
        salesPointId: stamp.salesPointId,
        fiscalNumber: allocated.number,
        fiscalNumberFormatted: formatFiscalNumber(est?.code ?? "001", sp?.code ?? "001", allocated.number),
        issuedAt: new Date(),
        businessStatus: "EMITIDA",
        sifenStatus: "PENDIENTE",
        updatedAt: new Date(),
      })
      .where(eq(t.invoices.id, inv.id))
      .returning();
    await audit(db, {
      companyId: user.companyId,
      userId: user.id,
      action: "FACTURA_EMITIDA",
      module: "facturas",
      entityId: inv.id,
      newValues: { fiscalNumber: allocated.number },
    });
    return c.json({ data: row });
  });

  r.post("/invoices/:id/send-sifen", requirePermission("sifen.enviar"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const env = loadEnv();
    const provider = createSifenProvider(env);
    const [inv] = await db
      .select()
      .from(t.invoices)
      .where(and(eq(t.invoices.id, c.req.param("id")), eq(t.invoices.companyId, user.companyId)))
      .limit(1);
    if (!inv) throw jsonError("NOT_FOUND", "Factura no encontrada", 404);
    if (inv.businessStatus !== "EMITIDA") throw jsonError("VALIDATION_ERROR", "Debe estar emitida internamente");
    const result = await provider.sendDe("<!-- XML conforme Manual Técnico v150 pendiente de certificado del contribuyente -->");
    await db.insert(t.sifenTransmissions).values({
      companyId: user.companyId,
      invoiceId: inv.id,
      environment: provider.environment,
      operation: "sendDe",
      responseCode: result.ok ? result.responseCode : result.code,
      responseBody: JSON.stringify(result),
      success: result.ok && "approved" in result && result.approved,
    });
    const sifenStatus = !result.ok
      ? result.code === "SIFEN_NOT_CONFIGURED"
        ? "NO_CONFIGURADO"
        : result.code === "SIFEN_REJECTED"
          ? "RECHAZADO"
          : "ENVIADO"
      : result.approved
        ? "APROBADO"
        : "ENVIADO";
    await db.update(t.invoices).set({ sifenStatus, updatedAt: new Date() }).where(eq(t.invoices.id, inv.id));
    return c.json({ data: { invoiceId: inv.id, sifen: result, sifenStatus } });
  });

  r.post(
    "/credit-notes",
    requirePermission("facturas.anular"),
    zValidator("json", z.object({ invoiceId: z.string().uuid(), reason: z.string(), total: z.string() })),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const [source] = await db.select().from(t.invoices).where(eq(t.invoices.id, body.invoiceId)).limit(1);
      if (!source || source.companyId !== user.companyId) throw jsonError("NOT_FOUND", "Factura no encontrada", 404);
      const [row] = await db.insert(t.creditNotes).values({ companyId: user.companyId, ...body }).returning();
      await db.insert(t.invoices).values({
        companyId: user.companyId,
        customerId: source.customerId,
        waterBillId: source.waterBillId,
        documentType: "NOTA_CREDITO_ELECTRONICA",
        relatedInvoiceId: source.id,
        subtotal: body.total,
        taxAmount: "0.00",
        total: body.total,
        businessStatus: "BORRADOR",
        sifenStatus: "NO_CONFIGURADO",
        createdBy: user.id,
      });
      await audit(db, { companyId: user.companyId, userId: user.id, action: "NOTA_CREDITO", module: "facturas", entityId: body.invoiceId });
      return c.json({ data: row }, 201);
    },
  );
  r.post(
    "/debit-notes",
    requirePermission("facturas.emitir"),
    zValidator("json", z.object({ invoiceId: z.string().uuid(), reason: z.string(), total: z.string() })),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const [source] = await db
        .select({ id: t.invoices.id })
        .from(t.invoices)
        .where(and(eq(t.invoices.id, body.invoiceId), eq(t.invoices.companyId, user.companyId)))
        .limit(1);
      if (!source) throw jsonError("NOT_FOUND", "Factura no encontrada", 404);
      const [row] = await db.insert(t.debitNotes).values({ companyId: user.companyId, ...body }).returning();
      await audit(db, { companyId: user.companyId, userId: user.id, action: "NOTA_DEBITO", module: "facturas", entityId: body.invoiceId });
      return c.json({ data: row }, 201);
    },
  );

  r.get("/tax/sifen/status", requirePermission("sifen.consultar"), async (c) => {
    const env = loadEnv();
    const provider = createSifenProvider(env);
    return c.json({
      data: {
        configured: provider.configured,
        environment: provider.environment,
        host: env.SIFEN_ENVIRONMENT === "production" ? "sifen.set.gov.py" : "sifen-test.set.gov.py",
        manualVersion: env.SIFEN_MANUAL_VERSION,
      },
    });
  });
}

function registerField(r: Hono<AppEnv>): void {
  r.get("/payments", requirePermission("pagos.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.payments).where(eq(t.payments.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });
  r.post(
    "/payments",
    requirePermission("pagos.crear"),
    zValidator(
      "json",
      z.object({
        customerId: z.string().uuid(),
        methodId: z.string().uuid(),
        amount: z.string(),
        paidOn: z.string(),
        waterBillId: z.string().uuid().optional(),
        invoiceId: z.string().uuid().optional(),
        referenceNote: z.string().optional(),
        notes: z.string().optional(),
        idempotencyKey: z.string().uuid(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        gpsAccuracyM: z.number().optional(),
        collectionRouteId: z.string().uuid().optional(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const [dup] = await db
        .select()
        .from(t.payments)
        .where(and(eq(t.payments.companyId, user.companyId), eq(t.payments.idempotencyKey, body.idempotencyKey)))
        .limit(1);
      if (dup) return c.json({ data: dup, meta: { idempotent: true } });
      const [customer] = await db
        .select({ id: t.customers.id })
        .from(t.customers)
        .where(and(eq(t.customers.id, body.customerId), eq(t.customers.companyId, user.companyId), isNull(t.customers.deletedAt)))
        .limit(1);
      if (!customer) throw jsonError("NOT_FOUND", "Cliente no encontrado", 404);
      const [method] = await db
        .select({ id: t.paymentMethods.id })
        .from(t.paymentMethods)
        .where(and(eq(t.paymentMethods.id, body.methodId), eq(t.paymentMethods.companyId, user.companyId)))
        .limit(1);
      if (!method) throw jsonError("NOT_FOUND", "Medio de pago no encontrado", 404);
      if (body.waterBillId) {
        const [wb] = await db
          .select({ id: t.waterBills.id })
          .from(t.waterBills)
          .where(and(eq(t.waterBills.id, body.waterBillId), eq(t.waterBills.companyId, user.companyId), eq(t.waterBills.customerId, body.customerId)))
          .limit(1);
        if (!wb) throw jsonError("NOT_FOUND", "Boleta no encontrada", 404);
      }
      if (body.invoiceId) {
        const [invRow] = await db
          .select({ id: t.invoices.id })
          .from(t.invoices)
          .where(and(eq(t.invoices.id, body.invoiceId), eq(t.invoices.companyId, user.companyId)))
          .limit(1);
        if (!invRow) throw jsonError("NOT_FOUND", "Factura no encontrada", 404);
      }
      if (body.collectionRouteId) {
        const [route] = await db
          .select({ id: t.collectionRoutes.id })
          .from(t.collectionRoutes)
          .where(and(eq(t.collectionRoutes.id, body.collectionRouteId), eq(t.collectionRoutes.companyId, user.companyId)))
          .limit(1);
        if (!route) throw jsonError("NOT_FOUND", "Recorrido no encontrado", 404);
      }
      const [pay] = await db
        .insert(t.payments)
        .values({
          companyId: user.companyId,
          customerId: body.customerId,
          methodId: body.methodId,
          amount: body.amount,
          paidOn: body.paidOn,
          referenceNote: body.referenceNote,
          notes: body.notes,
          userId: user.id,
          idempotencyKey: body.idempotencyKey,
          latitude: body.latitude != null ? String(body.latitude) : undefined,
          longitude: body.longitude != null ? String(body.longitude) : undefined,
          gpsAccuracyM: body.gpsAccuracyM != null ? String(body.gpsAccuracyM) : undefined,
          collectionRouteId: body.collectionRouteId,
        })
        .returning();
      if (body.invoiceId && !body.waterBillId) {
        await db.insert(t.paymentAllocations).values({
          paymentId: pay!.id,
          invoiceId: body.invoiceId,
          amount: body.amount,
        });
      }
      await applyPaymentToOpenBills(db, {
        companyId: user.companyId,
        customerId: body.customerId,
        paymentId: pay!.id,
        amount: body.amount,
        waterBillId: body.waterBillId,
      });
      const [account] = await db.select().from(t.customerAccounts).where(and(eq(t.customerAccounts.customerId, body.customerId), eq(t.customerAccounts.companyId, user.companyId))).limit(1);
      if (account) {
        await db.insert(t.accountMovements).values({
          accountId: account.id,
          movementType: "PAGO",
          amount: `-${body.amount}`,
          paymentId: pay!.id,
          waterBillId: body.waterBillId,
          invoiceId: body.invoiceId,
        });
        const newBalance = Number(account.balance) - Number(body.amount);
        await db
          .update(t.customerAccounts)
          .set({
            balance: sql`${t.customerAccounts.balance} - ${body.amount}::numeric`,
            status: newBalance <= 0.009 ? "AL_DIA" : account.status,
            updatedAt: new Date(),
          })
          .where(eq(t.customerAccounts.id, account.id));
      }
      if (body.collectionRouteId) {
        await db.insert(t.collectionVisits).values({
          routeId: body.collectionRouteId,
          customerId: body.customerId,
          result: Number(body.amount) > 0 ? "COBRADO" : "SIN_EXITO",
          paymentId: pay!.id,
          latitude: body.latitude != null ? String(body.latitude) : undefined,
          longitude: body.longitude != null ? String(body.longitude) : undefined,
        });
      }
      await audit(db, {
        companyId: user.companyId,
        userId: user.id,
        action: "PAGO_REGISTRADO",
        module: "pagos",
        entityType: "payment",
        entityId: pay!.id,
        newValues: { amount: body.amount, customerId: body.customerId, waterBillId: body.waterBillId },
      });
      const invoice = await draftInvoiceFromPayment(db, {
        companyId: user.companyId,
        userId: user.id,
        paymentId: pay!.id,
      });
      return c.json({ data: { ...pay, invoiceId: invoice?.invoiceId ?? null } }, 201);
    },
  );

  r.post("/payments/:id/reverse", requirePermission("pagos.anular"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const id = c.req.param("id");
    try {
      await reversePayment(db, { companyId: user.companyId, paymentId: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo anular";
      if (message.includes("no encontrado")) throw jsonError("NOT_FOUND", message, 404);
      if (message.includes("ya anulado")) throw jsonError("CONFLICT", message, 409);
      throw jsonError("VALIDATION_ERROR", message, 400);
    }
    await audit(db, {
      companyId: user.companyId,
      userId: user.id,
      action: "PAGO_ANULADO",
      module: "pagos",
      entityType: "payment",
      entityId: id,
    });
    return c.json({ data: { ok: true } });
  });

  r.get("/payments/:id/pdf", requirePermission("pagos.ver"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const [pay] = await db
      .select()
      .from(t.payments)
      .where(and(eq(t.payments.id, c.req.param("id")), eq(t.payments.companyId, user.companyId)))
      .limit(1);
    if (!pay) throw jsonError("NOT_FOUND", "Pago no encontrado", 404);
    const [company] = await db.select().from(t.companies).where(eq(t.companies.id, pay.companyId)).limit(1);
    const [customer] = await db.select().from(t.customers).where(eq(t.customers.id, pay.customerId)).limit(1);
    const [method] = await db.select().from(t.paymentMethods).where(eq(t.paymentMethods.id, pay.methodId)).limit(1);
    const allocations = await db
      .select({
        amount: t.paymentAllocations.amount,
        billNumber: t.waterBills.number,
      })
      .from(t.paymentAllocations)
      .leftJoin(t.waterBills, eq(t.waterBills.id, t.paymentAllocations.waterBillId))
      .where(eq(t.paymentAllocations.paymentId, pay.id));
    const verifyUrl = `${loadEnv().API_PUBLIC_URL.replace(/\/$/, "")}/api/payments/${pay.id}/verify`;
    const qrPng = await billQrPng(`AGUATERIA:PAGO:${pay.id}`);
    const pdf = await buildPaymentReceiptPdf({
      company: company!,
      customer: customer!,
      payment: pay,
      method,
      allocations,
      verifyUrl,
      qrPng,
    });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="pago-${pay.id.slice(0, 8)}.pdf"`,
      },
    });
  });

  r.get("/payments/:id/invoice-pdf", requirePermission("pagos.ver"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const paymentId = c.req.param("id");
    const invoiceId = await invoiceIdForPayment(db, paymentId, user.companyId);
    if (!invoiceId) throw jsonError("NOT_FOUND", "Aún no hay factura para este pago", 404);
    const pdf = await renderInvoicePdfBuffer(db, { companyId: user.companyId, invoiceId, paymentId });
    if (!pdf) throw jsonError("NOT_FOUND", "Factura no encontrada", 404);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="factura-${invoiceId.slice(0, 8)}.pdf"` },
    });
  });

  r.get("/payments/:id/verify", requirePermission("pagos.ver"), async (c) => {
    const db = c.get("db");
    const [pay] = await db
      .select()
      .from(t.payments)
      .where(and(eq(t.payments.id, c.req.param("id")), eq(t.payments.companyId, c.get("user")!.companyId)))
      .limit(1);
    if (!pay) throw jsonError("NOT_FOUND", "Pago no encontrado", 404);
    return c.json({
      data: {
        kind: "COMPROBANTE_PAGO",
        id: pay.id,
        amount: pay.amount,
        paidOn: pay.paidOn,
        reversed: Boolean(pay.reversedAt),
      },
    });
  });

  r.get("/accounts/outstanding", requirePermission("cuentas.ver"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    // Pre-filtro: sólo clientes que *pueden* tener deuda (saldo > 0, boleta impaga,
    // o cuota pendiente). Es un superconjunto exacto de lo que devolvería el loop
    // completo — cualquier cliente excluido daría `debts.length === 0`. Evita el N+1
    // sobre todo el padrón.
    const candidates = await db.execute(sql`
      select cu.id            as "customerId",
             cu.code          as "customerCode",
             cu.first_name    as "firstName",
             cu.last_name     as "lastName",
             cu.legal_name    as "legalName"
      from customers cu
      where cu.company_id = ${user.companyId}
        and cu.deleted_at is null
        and (
          exists (select 1 from customer_accounts a
                   where a.customer_id = cu.id and a.company_id = ${user.companyId}
                     and a.balance::numeric > 0.009)
          or exists (select 1 from water_bills wb
                      where wb.customer_id = cu.id and wb.company_id = ${user.companyId}
                        and wb.balance::numeric > 0.009
                        and wb.status <> 'ANULADA'
                        and coalesce(wb.kind, 'CONSUMO') <> 'CREDITO')
          or exists (select 1 from installment_items ii
                      join installment_plans ip on ip.id = ii.plan_id
                     where ip.customer_id = cu.id and ip.company_id = ${user.companyId}
                       and ip.status not in ('CANCELADO', 'SALDADO')
                       and ii.amount::numeric - ii.paid_amount::numeric > 0.009)
          or exists (select 1 from connections cn
                      where cn.customer_id = cu.id and cn.company_id = ${user.companyId}
                        and cn.deleted_at is null
                        and coalesce(cn.connection_cost, 0)::numeric > 0.009)
        )
    `);
    const rows = candidates as unknown as Array<{
      customerId: string;
      customerCode: string;
      firstName: string | null;
      lastName: string | null;
      legalName: string | null;
    }>;
    const data = [];
    for (const row of rows) {
      const debts = await listOutstandingDebts(db, { companyId: user.companyId, customerId: row.customerId });
      if (!debts.length) continue;
      const name =
        (row.legalName ?? "").trim() ||
        [row.firstName, row.lastName].filter(Boolean).join(" ").trim() ||
        row.customerCode;
      data.push({
        customerId: row.customerId,
        customerCode: row.customerCode,
        customerName: name,
        debts,
        total: debts.reduce((s, d) => s + Number(d.amount), 0).toFixed(2),
      });
    }
    return c.json({ data });
  });

  r.get("/accounts/:customerId", requirePermission("cuentas.ver"), zValidator("param", z.object({ customerId: z.string().uuid() })), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const customerId = c.req.valid("param").customerId;
    const [customer] = await db
      .select({ id: t.customers.id })
      .from(t.customers)
      .where(and(eq(t.customers.id, customerId), eq(t.customers.companyId, user.companyId)))
      .limit(1);
    if (!customer) throw jsonError("NOT_FOUND", "Cliente no encontrado", 404);
    const [account] = await db
      .select()
      .from(t.customerAccounts)
      .where(and(eq(t.customerAccounts.customerId, customerId), eq(t.customerAccounts.companyId, user.companyId)))
      .limit(1);
    const movements = account
      ? await db.select().from(t.accountMovements).where(eq(t.accountMovements.accountId, account.id))
      : [];
    const bills = await db
      .select()
      .from(t.waterBills)
      .where(and(eq(t.waterBills.customerId, customerId), eq(t.waterBills.companyId, user.companyId)));
    const pays = await db
      .select()
      .from(t.payments)
      .where(and(eq(t.payments.customerId, customerId), eq(t.payments.companyId, user.companyId)));
    const debts = await listOutstandingDebts(db, { companyId: user.companyId, customerId });
    return c.json({ data: { account, movements, bills, payments: pays, debts } });
  });

  r.get("/collections/delinquency", requirePermission("morosidad.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const { unpaidPeriodCounts, moraBucket } = await import("../services/delinquency.js");
    const rows = await unpaidPeriodCounts(db, companyId);
    const customers = await db.select().from(t.customers).where(eq(t.customers.companyId, companyId));
    const connections = await db.select().from(t.connections).where(eq(t.connections.companyId, companyId));
    const byC = new Map(customers.map((x) => [x.id, x]));
    const data = rows
      .filter((row) => Number(row.debt) > 0)
      .map((row) => {
        const customer = byC.get(row.customerId);
        const cn = connections.find((x) => x.customerId === row.customerId);
        return {
          customerId: row.customerId,
          code: customer?.code,
          firstName: customer?.firstName,
          lastName: customer?.lastName,
          balance: row.debt,
          status: row.status,
          unpaidPeriods: row.unpaidPeriods,
          bucket: moraBucket(Number(row.unpaidPeriods)),
          connectionCode: cn?.code,
          address: cn?.address ?? customer?.address,
        };
      });
    return c.json({ data });
  });
}

function registerOps(r: Hono<AppEnv>): void {
  r.get("/claims", requirePermission("reclamos.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.claims).where(eq(t.claims.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });
  r.post(
    "/claims",
    requirePermission("reclamos.crear"),
    zValidator(
      "json",
      z.object({
        customerId: z.string().uuid().optional(),
        connectionId: z.string().uuid().optional(),
        type: z.string(),
        priority: z.string().default("MEDIA"),
        description: z.string(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(t.claims).where(eq(t.claims.companyId, user.companyId));
      const number = `REC-${String((count?.n ?? 0) + 1).padStart(6, "0")}`;
      const [row] = await db.insert(t.claims).values({ ...c.req.valid("json"), companyId: user.companyId, number }).returning();
      return c.json({ data: row }, 201);
    },
  );

  r.get("/suspensions", requirePermission("suspensiones.ver"), async (c) => {
    return c.json({ data: await c.get("db").select().from(t.suspensions).where(eq(t.suspensions.companyId, c.get("user")!.companyId)) });
  });
  r.post("/suspensions", requirePermission("suspensiones.crear"), zValidator("json", z.object({
    customerId: z.string().uuid(),
    connectionId: z.string().uuid(),
    reason: z.string(),
    debtAmount: z.string().optional(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
    photoFileId: z.string().uuid().optional(),
    notes: z.string().optional(),
  })), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const [conn] = await db
      .select({ id: t.connections.id })
      .from(t.connections)
      .where(and(eq(t.connections.id, body.connectionId), eq(t.connections.customerId, body.customerId), eq(t.connections.companyId, user.companyId)))
      .limit(1);
    if (!conn) throw jsonError("NOT_FOUND", "Conexión no encontrada", 404);
    const [row] = await db.insert(t.suspensions).values({ ...body, companyId: user.companyId, userId: user.id }).returning();
    await db
      .update(t.connections)
      .set({ status: "SUSPENDIDA", updatedAt: new Date() })
      .where(and(eq(t.connections.id, body.connectionId), eq(t.connections.companyId, user.companyId)));
    return c.json({ data: row }, 201);
  });

  r.get("/reconnections", requirePermission("reconexiones.ver"), async (c) => {
    return c.json({ data: await c.get("db").select().from(t.reconnections).where(eq(t.reconnections.companyId, c.get("user")!.companyId)) });
  });
  r.post("/reconnections", requirePermission("reconexiones.crear"), zValidator("json", z.object({
    customerId: z.string().uuid(),
    connectionId: z.string().uuid(),
    suspensionId: z.string().uuid().optional(),
    latitude: z.string().optional(),
    longitude: z.string().optional(),
    photoFileId: z.string().uuid().optional(),
    cost: z.string().optional(),
    notes: z.string().optional(),
  })), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const [conn] = await db
      .select({ id: t.connections.id })
      .from(t.connections)
      .where(and(eq(t.connections.id, body.connectionId), eq(t.connections.customerId, body.customerId), eq(t.connections.companyId, user.companyId)))
      .limit(1);
    if (!conn) throw jsonError("NOT_FOUND", "Conexión no encontrada", 404);
    const [row] = await db.insert(t.reconnections).values({ ...body, companyId: user.companyId, userId: user.id }).returning();
    await db
      .update(t.connections)
      .set({ status: "ACTIVA", updatedAt: new Date() })
      .where(and(eq(t.connections.id, body.connectionId), eq(t.connections.companyId, user.companyId)));
    return c.json({ data: row }, 201);
  });

  r.get("/inventory", requirePermission("inventario.ver"), async (c) => {
    return c.json({ data: await c.get("db").select().from(t.inventoryItems).where(eq(t.inventoryItems.companyId, c.get("user")!.companyId)) });
  });
  r.post("/inventory", requirePermission("inventario.movimiento"), zValidator("json", z.object({ sku: z.string(), name: z.string(), unit: z.string().default("UN"), stock: z.string().default("0"), minStock: z.string().default("0") })), async (c) => {
    const [row] = await c.get("db").insert(t.inventoryItems).values({ ...c.req.valid("json"), companyId: c.get("user")!.companyId }).returning();
    return c.json({ data: row }, 201);
  });
  r.post("/inventory/movements", requirePermission("inventario.movimiento"), zValidator("json", z.object({ itemId: z.string().uuid(), movementType: z.string(), quantity: z.string(), notes: z.string().optional() })), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const [item] = await db
      .select({ id: t.inventoryItems.id })
      .from(t.inventoryItems)
      .where(and(eq(t.inventoryItems.id, body.itemId), eq(t.inventoryItems.companyId, user.companyId)))
      .limit(1);
    if (!item) throw jsonError("NOT_FOUND", "Ítem de inventario no encontrado", 404);
    const [mov] = await db.insert(t.inventoryMovements).values({ ...body, userId: user.id }).returning();
    const sign = body.movementType === "SALIDA" || body.movementType === "MERMA" ? -1 : 1;
    await db
      .update(t.inventoryItems)
      .set({ stock: sql`${t.inventoryItems.stock} + ${sign} * ${body.quantity}::numeric` })
      .where(and(eq(t.inventoryItems.id, body.itemId), eq(t.inventoryItems.companyId, user.companyId)));
    return c.json({ data: mov }, 201);
  });

  r.get("/suppliers", requirePermission("proveedores.ver"), async (c) => {
    return c.json({ data: await c.get("db").select().from(t.suppliers).where(eq(t.suppliers.companyId, c.get("user")!.companyId)) });
  });
  r.post("/suppliers", requirePermission("proveedores.crear"), zValidator("json", z.object({ legalName: z.string(), ruc: z.string().optional(), contactName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), address: z.string().optional() })), async (c) => {
    const [row] = await c.get("db").insert(t.suppliers).values({ ...c.req.valid("json"), companyId: c.get("user")!.companyId }).returning();
    return c.json({ data: row }, 201);
  });

  r.get("/expenses", requirePermission("gastos.ver"), async (c) => {
    return c.json({ data: await c.get("db").select().from(t.expenses).where(eq(t.expenses.companyId, c.get("user")!.companyId)) });
  });
  r.post("/expenses", requirePermission("gastos.crear"), zValidator("json", z.object({ supplierId: z.string().uuid().optional(), category: z.string(), concept: z.string(), expenseDate: z.string(), amount: z.string(), notes: z.string().optional() })), async (c) => {
    const user = c.get("user")!;
    const [row] = await c.get("db").insert(t.expenses).values({ ...c.req.valid("json"), companyId: user.companyId, userId: user.id }).returning();
    return c.json({ data: row }, 201);
  });

  r.get("/users", requirePermission("usuarios.ver"), async (c) => {
    const companyId = c.get("user")!.companyId;
    const rows = await c.get("db").select({
      id: t.users.id,
      email: t.users.email,
      username: t.users.username,
      fullName: t.users.fullName,
      phone: t.users.phone,
      active: t.users.active,
      lastLoginAt: t.users.lastLoginAt,
      roleCode: sql<string>`(select r.code from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${t.users.id} limit 1)`,
    }).from(t.users).where(and(eq(t.users.companyId, companyId), isNull(t.users.deletedAt))).orderBy(t.users.fullName);
    return c.json({ data: rows });
  });

  r.post(
    "/users",
    requirePermission("usuarios.crear"),
    zValidator(
      "json",
      z.object({
        email: z.string().email(),
        username: z.string().min(3).max(80),
        fullName: z.string().min(1).max(200),
        password: z.string().min(10).max(200),
        phone: z.string().optional(),
        roleCode: z.string().min(1),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const actor = c.get("user")!;
      const body = c.req.valid("json");
      const [role] = await db
        .select()
        .from(t.roles)
        .where(and(eq(t.roles.companyId, actor.companyId), eq(t.roles.code, body.roleCode)))
        .limit(1);
      if (!role) throw jsonError("VALIDATION_ERROR", "Rol no válido", 400);
      const email = body.email.trim().toLowerCase();
      const username = body.username.trim().toLowerCase();
      const [dup] = await db
        .select({ id: t.users.id })
        .from(t.users)
        .where(
          and(
            eq(t.users.companyId, actor.companyId),
            or(eq(t.users.email, email), eq(t.users.username, username)),
          ),
        )
        .limit(1);
      if (dup) throw jsonError("CONFLICT", "Ya existe un usuario con ese email o nombre de usuario", 409);
      const [created] = await db
        .insert(t.users)
        .values({
          companyId: actor.companyId,
          email,
          username,
          fullName: body.fullName,
          phone: body.phone,
          passwordHash: await hashPassword(body.password),
        })
        .returning();
      if (created) {
        await db.insert(t.userRoles).values({ userId: created.id, roleId: role.id });
      }
      await audit(db, {
        companyId: actor.companyId,
        userId: actor.id,
        action: "USUARIO_MODIFICADO",
        module: "usuarios",
        entityType: "users",
        entityId: created?.id,
        newValues: { email, username, roleCode: body.roleCode },
      });
      return c.json({ data: { id: created?.id, email: created?.email, username: created?.username, fullName: created?.fullName, roleCode: body.roleCode } }, 201);
    },
  );

  const userPatchSchema = z
    .object({
      fullName: z.string().min(1).max(200).optional(),
      phone: z.string().max(40).nullish(),
      active: z.boolean().optional(),
      roleCode: z.string().min(1).optional(),
      password: z.string().min(10).max(200).optional(),
    })
    .strict();

  async function countActiveSuperAdmins(db: Database, companyId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.userRoles)
      .innerJoin(t.roles, eq(t.roles.id, t.userRoles.roleId))
      .innerJoin(t.users, eq(t.users.id, t.userRoles.userId))
      .where(
        and(
          eq(t.roles.companyId, companyId),
          eq(t.roles.code, "SUPER_ADMIN"),
          eq(t.users.active, true),
          isNull(t.users.deletedAt),
        ),
      );
    return row?.n ?? 0;
  }

  r.patch(
    "/users/:id",
    requirePermission("usuarios.editar"),
    zValidator("param", idParam),
    zValidator("json", userPatchSchema),
    async (c) => {
      const db = c.get("db");
      const actor = c.get("user")!;
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const [target] = await db
        .select()
        .from(t.users)
        .where(and(eq(t.users.id, id), eq(t.users.companyId, actor.companyId), isNull(t.users.deletedAt)))
        .limit(1);
      if (!target) throw jsonError("NOT_FOUND", "Usuario no encontrado", 404);

      const [currentRole] = await db
        .select({ code: t.roles.code })
        .from(t.userRoles)
        .innerJoin(t.roles, eq(t.roles.id, t.userRoles.roleId))
        .where(eq(t.userRoles.userId, target.id))
        .limit(1);
      const wasSuperAdmin = currentRole?.code === "SUPER_ADMIN";
      const losesSuperAdmin =
        wasSuperAdmin && ((body.roleCode && body.roleCode !== "SUPER_ADMIN") || body.active === false);
      if (target.id === actor.id && body.active === false) {
        throw jsonError("VALIDATION_ERROR", "No podés desactivar tu propia cuenta", 400);
      }
      if (losesSuperAdmin && (await countActiveSuperAdmins(db, actor.companyId)) <= 1) {
        throw jsonError("CONFLICT", "Debe quedar al menos un Super Admin activo", 409);
      }

      let roleId: string | null = null;
      if (body.roleCode) {
        const [role] = await db
          .select({ id: t.roles.id })
          .from(t.roles)
          .where(and(eq(t.roles.companyId, actor.companyId), eq(t.roles.code, body.roleCode)))
          .limit(1);
        if (!role) throw jsonError("VALIDATION_ERROR", "Rol no válido", 400);
        roleId = role.id;
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.fullName !== undefined) patch.fullName = body.fullName;
      if (body.phone !== undefined) patch.phone = body.phone || null;
      if (body.active !== undefined) patch.active = body.active;
      if (body.password) {
        patch.passwordHash = await hashPassword(body.password);
        patch.failedLoginCount = 0;
        patch.lockedUntil = null;
      }
      const [updated] = await db.update(t.users).set(patch).where(eq(t.users.id, target.id)).returning();

      if (roleId) {
        await db.delete(t.userRoles).where(eq(t.userRoles.userId, target.id));
        await db.insert(t.userRoles).values({ userId: target.id, roleId });
      }
      if (body.active === false || body.password) {
        await db
          .update(t.refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(t.refreshTokens.userId, target.id), sql`${t.refreshTokens.revokedAt} is null`));
      }
      await audit(db, {
        companyId: actor.companyId,
        userId: actor.id,
        action: "USUARIO_MODIFICADO",
        module: "usuarios",
        entityType: "users",
        entityId: target.id,
        newValues: {
          fullName: body.fullName,
          active: body.active,
          roleCode: body.roleCode,
          passwordReset: Boolean(body.password),
        },
      });
      return c.json({
        data: {
          id: updated?.id,
          email: updated?.email,
          username: updated?.username,
          fullName: updated?.fullName,
          active: updated?.active,
          roleCode: body.roleCode ?? currentRole?.code ?? null,
        },
      });
    },
  );

  r.delete("/users/:id", requirePermission("usuarios.editar"), zValidator("param", idParam), async (c) => {
    const db = c.get("db");
    const actor = c.get("user")!;
    const { id } = c.req.valid("param");
    if (id === actor.id) throw jsonError("VALIDATION_ERROR", "No podés eliminar tu propia cuenta", 400);
    const [target] = await db
      .select()
      .from(t.users)
      .where(and(eq(t.users.id, id), eq(t.users.companyId, actor.companyId), isNull(t.users.deletedAt)))
      .limit(1);
    if (!target) throw jsonError("NOT_FOUND", "Usuario no encontrado", 404);
    const [role] = await db
      .select({ code: t.roles.code })
      .from(t.userRoles)
      .innerJoin(t.roles, eq(t.roles.id, t.userRoles.roleId))
      .where(eq(t.userRoles.userId, target.id))
      .limit(1);
    if (role?.code === "SUPER_ADMIN" && (await countActiveSuperAdmins(db, actor.companyId)) <= 1) {
      throw jsonError("CONFLICT", "Debe quedar al menos un Super Admin activo", 409);
    }
    await db
      .update(t.users)
      .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
      .where(eq(t.users.id, target.id));
    await db
      .update(t.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(t.refreshTokens.userId, target.id), sql`${t.refreshTokens.revokedAt} is null`));
    await audit(db, {
      companyId: actor.companyId,
      userId: actor.id,
      action: "USUARIO_MODIFICADO",
      module: "usuarios",
      entityType: "users",
      entityId: target.id,
      newValues: { deleted: true },
    });
    return c.json({ data: { ok: true } });
  });

  r.get("/roles", requirePermission("usuarios.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.roles).where(eq(t.roles.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });

  r.get("/payment-methods", requirePermission("pagos.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.paymentMethods).where(eq(t.paymentMethods.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });

  r.get("/establishments", requirePermission("timbrados.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.establishments).where(eq(t.establishments.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });

  r.get("/sales-points", requirePermission("timbrados.ver"), async (c) => {
    const db = c.get("db");
    const est = await db.select({ id: t.establishments.id }).from(t.establishments).where(eq(t.establishments.companyId, c.get("user")!.companyId));
    const ids = est.map((e) => e.id);
    if (ids.length === 0) return c.json({ data: [] });
    const rows = await db.select().from(t.salesPoints).where(inArray(t.salesPoints.establishmentId, ids));
    return c.json({ data: rows });
  });

  r.get("/accounts", requirePermission("cuentas.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const rows = await db
      .select({
        id: t.customerAccounts.id,
        customerId: t.customerAccounts.customerId,
        balance: t.customerAccounts.balance,
        status: t.customerAccounts.status,
        code: t.customers.code,
        firstName: t.customers.firstName,
        lastName: t.customers.lastName,
      })
      .from(t.customerAccounts)
      .innerJoin(t.customers, eq(t.customers.id, t.customerAccounts.customerId))
      .where(eq(t.customerAccounts.companyId, companyId));
    return c.json({ data: rows });
  });

  r.get("/audit-logs", requirePermission("auditoria.ver"), zValidator("query", paginationQuery), async (c) => {
    const { page, pageSize } = c.req.valid("query");
    const rows = await c.get("db").select().from(t.auditLogs).where(eq(t.auditLogs.companyId, c.get("user")!.companyId)).orderBy(desc(t.auditLogs.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data: rows });
  });

  r.get("/notifications", async (c) => {
    const inbox = await listNotificationInbox(c.get("db"), c.get("user")!);
    return c.json({ data: inbox.data, meta: { unreadCount: inbox.unreadCount } });
  });

  r.patch("/notifications/read-all", async (c) => {
    const result = await markAllNotificationsRead(c.get("db"), c.get("user")!);
    return c.json({ data: result });
  });

  r.patch("/notifications/:id/read", async (c) => {
    const result = await markNotificationRead(c.get("db"), c.get("user")!, c.req.param("id"));
    return c.json({ data: { ...result, readAt: new Date().toISOString() } });
  });

  r.get("/company", requirePermission("configuracion.ver"), async (c) => {
    const [row] = await c.get("db").select().from(t.companies).where(eq(t.companies.id, c.get("user")!.companyId)).limit(1);
    return c.json({ data: row });
  });
  r.patch(
    "/company",
    requirePermission("configuracion.editar"),
    zValidator(
      "json",
      z.object({
        legalName: z.string().max(200).optional(),
        tradeName: z.string().max(200).optional(),
        ruc: z.string().max(20).optional(),
        dv: z.string().max(2).optional(),
        address: z.string().max(300).optional(),
        phone: z.string().max(40).optional(),
        email: z.string().email().optional().or(z.literal("")),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };
      if (body.email === "") patch.email = null;
      const [row] = await c
        .get("db")
        .update(t.companies)
        .set(patch)
        .where(eq(t.companies.id, c.get("user")!.companyId))
        .returning();
      return c.json({ data: row });
    },
  );
  r.get("/settings", requirePermission("configuracion.ver"), async (c) => {
    const rows = await c.get("db").select().from(t.systemSettings).where(eq(t.systemSettings.companyId, c.get("user")!.companyId));
    return c.json({ data: Object.fromEntries(rows.map((s) => [s.key, s.value])) });
  });

  r.patch(
    "/settings",
    requirePermission("configuracion.editar"),
    zValidator(
      "json",
      z.object({
        "gps.maxAccuracyMeters": z.number().min(5).max(500).optional(),
        "gps.rejectMock": z.boolean().optional(),
        "gps.geofenceMeters": z.number().min(10).max(1000).optional(),
        "gps.geofenceBlock": z.boolean().optional(),
        "photo.required": z.boolean().optional(),
        "consumption.excessiveMultiplier": z.number().min(1).max(20).optional(),
        "mora.unpaidPeriods": z.number().int().min(1).max(24).optional(),
        "cobranza.gpsIntervalSeconds": z.number().int().min(15).max(300).optional(),
        "gps.geofencePolicy": z.enum(["PERMITIR", "ADVERTIR", "BLOQUEAR"]).optional(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const companyId = c.get("user")!.companyId;
      const body = c.req.valid("json");
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        const [existing] = await db
          .select()
          .from(t.systemSettings)
          .where(and(eq(t.systemSettings.companyId, companyId), eq(t.systemSettings.key, key)))
          .limit(1);
        if (existing) {
          await db.update(t.systemSettings).set({ value }).where(eq(t.systemSettings.id, existing.id));
        } else {
          await db.insert(t.systemSettings).values({ companyId, key, value });
        }
      }
      if (body["mora.unpaidPeriods"] != null) {
        await db
          .update(t.delinquencyRules)
          .set({ unpaidPeriodsForDisconnect: body["mora.unpaidPeriods"] })
          .where(eq(t.delinquencyRules.companyId, companyId));
      }
      if (body["gps.geofencePolicy"]) {
        const block = body["gps.geofencePolicy"] === "BLOQUEAR";
        const [existing] = await db
          .select()
          .from(t.systemSettings)
          .where(and(eq(t.systemSettings.companyId, companyId), eq(t.systemSettings.key, "gps.geofenceBlock")))
          .limit(1);
        if (existing) await db.update(t.systemSettings).set({ value: block }).where(eq(t.systemSettings.id, existing.id));
        else await db.insert(t.systemSettings).values({ companyId, key: "gps.geofenceBlock", value: block });
      }
      const rows = await db.select().from(t.systemSettings).where(eq(t.systemSettings.companyId, companyId));
      return c.json({ data: Object.fromEntries(rows.map((s) => [s.key, s.value])) });
    },
  );

  r.get("/map/features", requirePermission("mapa.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const customers = await db.select({ id: t.customers.id, lat: t.customers.latitude, lng: t.customers.longitude, name: t.customers.lastName, code: t.customers.code }).from(t.customers).where(eq(t.customers.companyId, companyId));
    const connections = await db.select({ id: t.connections.id, lat: t.connections.latitude, lng: t.connections.longitude, code: t.connections.code, status: t.connections.status }).from(t.connections).where(eq(t.connections.companyId, companyId));
    const readings = await db
      .select({
        id: t.meterReadings.id,
        lat: t.meterReadings.latitude,
        lng: t.meterReadings.longitude,
        anomaly: t.meterReadings.anomalyCode,
        requiresReview: t.meterReadings.requiresReview,
        capturedAt: t.meterReadings.serverCapturedAt,
      })
      .from(t.meterReadings)
      .where(and(eq(t.meterReadings.companyId, companyId), sql`${t.meterReadings.latitude} is not null`))
      .orderBy(desc(t.meterReadings.serverCapturedAt))
      .limit(500);
    const routes = await db
      .select({
        id: t.collectionRoutePoints.id,
        routeId: t.collectionRoutePoints.routeId,
        lat: t.collectionRoutePoints.latitude,
        lng: t.collectionRoutePoints.longitude,
        capturedAt: t.collectionRoutePoints.capturedAt,
      })
      .from(t.collectionRoutePoints)
      .innerJoin(t.collectionRoutes, eq(t.collectionRoutes.id, t.collectionRoutePoints.routeId))
      .where(eq(t.collectionRoutes.companyId, companyId))
      .orderBy(desc(t.collectionRoutePoints.capturedAt))
      .limit(1000);
    return c.json({ data: { customers, connections, readings, collectionPoints: routes } });
  });

  r.get("/reports/:type", requirePermission("reportes.ver"), async (c) => {
    const type = c.req.param("type");
    const format = c.req.query("format") ?? "json";
    let rows: unknown[];
    try {
      rows = await loadReportRows(c.get("db"), c.get("user")!.companyId, type, {
        from: c.req.query("from") || undefined,
        to: c.req.query("to") || undefined,
        q: c.req.query("q") || undefined,
        status: c.req.query("status") || undefined,
        department: c.req.query("department") || undefined,
        city: c.req.query("city") || undefined,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "UNSUPPORTED") throw jsonError("NOT_FOUND", "Reporte no soportado", 404);
      throw err;
    }
    if (format === "csv") {
      const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
      const headers = list[0] ? Object.keys(list[0]) : [];
      // Neutraliza inyección de fórmulas (=, +, -, @, tab/CR) al abrir el CSV en planillas.
      const csvCell = (value: unknown): string => {
        let s = value == null ? "" : String(value);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const csv = [
        headers.map(csvCell).join(","),
        ...list.map((row) => headers.map((h) => csvCell(row[h])).join(",")),
      ].join("\r\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="reporte-${type}.csv"`,
        },
      });
    }
    return c.json({ data: rows });
  });

  r.get("/regulation/documents", requirePermission("regulacion.ver"), async (c) => {
    return c.json({ data: await c.get("db").select().from(t.regulatoryDocuments).where(eq(t.regulatoryDocuments.companyId, c.get("user")!.companyId)) });
  });
  r.post("/regulation/documents", requirePermission("regulacion.editar"), zValidator("json", z.object({ title: z.string(), category: z.string(), source: z.string().optional(), notes: z.string().optional() })), async (c) => {
    const [row] = await c.get("db").insert(t.regulatoryDocuments).values({ ...c.req.valid("json"), companyId: c.get("user")!.companyId }).returning();
    return c.json({ data: row }, 201);
  });

  r.post("/files/upload-url", zValidator("json", z.object({
    purpose: z.enum(["meter-photo", "document", "regulation", "tax", "kude", "expense", "install-photo", "disconnect-photo"]),
    contentType: z.string().min(3).max(120),
    fileName: z.string().min(1).max(200),
  })), async (c) => {
    const user = c.get("user")!;
    const body = c.req.valid("json");
    const data = await createSignedUpload({
      env: loadEnv(),
      db: c.get("db"),
      companyId: user.companyId,
      userId: user.id,
      purpose: body.purpose,
      contentType: body.contentType,
      fileName: body.fileName,
    });
    return c.json({ data }, 201);
  });

  r.get("/files/:id/download-url", zValidator("param", idParam), async (c) => {
    const user = c.get("user")!;
    const data = await createSignedDownload({
      env: loadEnv(),
      db: c.get("db"),
      companyId: user.companyId,
      fileId: c.req.valid("param").id,
    });
    return c.json({ data });
  });

  r.post("/sync/push", requirePermission("lecturas.crear"), zValidator("json", z.object({
    operations: z.array(z.object({
      type: z.enum(["reading", "claim", "suspension", "reconnection"]),
      idempotencyKey: z.string().uuid(),
      payload: z.record(z.unknown()),
      baseVersion: z.number().optional(),
    })),
  })), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const env = loadEnv();
    const results: Array<{ idempotencyKey: string; type: string; ok: boolean; error?: string }> = [];
    for (const op of c.req.valid("json").operations) {
      try {
        if (op.type === "reading") {
          const parsed = readingInputSchema.safeParse({ ...op.payload, idempotencyKey: op.idempotencyKey });
          if (!parsed.success) throw jsonError("VALIDATION_ERROR", parsed.error.message, 400);
          await recordMeterReading({ db, user, env, body: parsed.data });
        } else {
          throw jsonError("VALIDATION_ERROR", `Tipo ${op.type} debe enviarse a su endpoint específico`, 400);
        }
        results.push({ idempotencyKey: op.idempotencyKey, type: op.type, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error de sync";
        results.push({ idempotencyKey: op.idempotencyKey, type: op.type, ok: false, error: message });
      }
    }
    return c.json({ data: { accepted: results.filter((r) => r.ok).length, results } });
  });

  r.get("/sync/pull", requirePermission("lecturas.ver"), zValidator("query", z.object({ since: z.string().optional() })), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const since = c.req.valid("query").since ? new Date(c.req.valid("query").since!) : new Date(0);
    const readings = await db
      .select()
      .from(t.meterReadings)
      .where(and(eq(t.meterReadings.companyId, companyId), sql`${t.meterReadings.updatedAt} > ${since}`))
      .orderBy(desc(t.meterReadings.updatedAt))
      .limit(200);
    return c.json({ data: { cursor: new Date().toISOString(), readings } });
  });

  r.get("/sync/conflicts", requirePermission("sync.resolver"), async (c) => {
    const rows = await c.get("db").select().from(t.syncConflicts).where(eq(t.syncConflicts.companyId, c.get("user")!.companyId));
    return c.json({ data: rows });
  });

  r.post("/devices/push-token", zValidator("json", z.object({ token: z.string(), platform: z.string().default("android") })), async (c) => {
    const user = c.get("user")!;
    await c.get("db").insert(t.pushDevices).values({ userId: user.id, ...c.req.valid("json") }).onConflictDoNothing();
    return c.json({ data: { ok: true } });
  });
}
