import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { gpsSchema as sharedGpsSchema } from "@aguateria/shared";
import * as t from "../db/schema.js";
import { requirePermission } from "../http/auth.js";
import type { AppEnv } from "../http/types.js";
import { jsonError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { loadEnv } from "../env.js";
import { todayAsuncion } from "../lib/time.js";
import { loadFieldSettings } from "../lib/field-settings.js";
import { haversineMeters } from "../services/reading-evaluation.js";
import { scanDelinquency, unpaidPeriodCounts, moraBucket } from "../services/delinquency.js";
import { createInstallmentPlan } from "../services/installments.js";

const gpsSchema = sharedGpsSchema.extend({
  capturedAt: z.string().datetime(),
});

export function registerCycle(r: Hono<AppEnv>): void {
  r.get("/installations", requirePermission("instalaciones.ver"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const status = c.req.query("status") ?? "PENDIENTE";
    const filters = [eq(t.connectionInstallations.companyId, user.companyId)];
    if (status !== "all") filters.push(eq(t.connectionInstallations.status, status));
    const privileged = user.roles.some((role) => ["SUPER_ADMIN", "ADMINISTRADOR", "GERENTE", "SUPERVISOR"].includes(role));
    if (!privileged && user.roles.includes("INSTALADOR")) {
      filters.push(or(eq(t.connectionInstallations.assignedTo, user.id), sql`${t.connectionInstallations.assignedTo} is null`)!);
    }
    const rows = await db
      .select({
        id: t.connectionInstallations.id,
        status: t.connectionInstallations.status,
        initialReading: t.connectionInstallations.initialReading,
        observations: t.connectionInstallations.observations,
        assignedTo: t.connectionInstallations.assignedTo,
        completedAt: t.connectionInstallations.completedAt,
        connectionId: t.connections.id,
        connectionCode: t.connections.code,
        connectionStatus: t.connections.status,
        address: t.connections.address,
        supplyLat: t.connections.latitude,
        supplyLng: t.connections.longitude,
        customerId: t.customers.id,
        customerCode: t.customers.code,
        customerName: sql<string>`coalesce(nullif(trim(${t.customers.legalName}), ''), nullif(trim(concat_ws(' ', ${t.customers.firstName}, ${t.customers.lastName})), ''), ${t.customers.code})`,
        customerFirstName: t.customers.firstName,
        customerLastName: t.customers.lastName,
        customerLegalName: t.customers.legalName,
        idDocumentType: t.customers.idDocumentType,
        ci: t.customers.ci,
        ruc: t.customers.ruc,
        dv: t.customers.dv,
        mobile: t.customers.mobile,
        phone: t.customers.phone,
        email: t.customers.email,
        customerAddress: t.customers.address,
        city: t.customers.city,
        department: t.customers.department,
        neighborhood: t.customers.neighborhood,
        requestedAt: t.connections.requestedAt,
        referenceNote: t.connections.referenceNote,
        meterId: t.meters.id,
        meterNumber: t.meters.number,
        meterBrand: t.meters.brand,
        meterModel: t.meters.model,
        meterInitial: t.meters.initialReading,
      })
      .from(t.connectionInstallations)
      .innerJoin(t.connections, eq(t.connections.id, t.connectionInstallations.connectionId))
      .innerJoin(t.customers, eq(t.customers.id, t.connectionInstallations.customerId))
      .leftJoin(t.meters, eq(t.meters.id, t.connectionInstallations.meterId))
      .where(and(...filters))
      .orderBy(desc(t.connectionInstallations.createdAt))
      .limit(200);
    return c.json({ data: rows });
  });

  r.get("/installations/config", requirePermission("instalaciones.ver"), async (c) => {
    const settings = await loadFieldSettings(c.get("db"), c.get("user")!.companyId, loadEnv());
    return c.json({ data: settings });
  });

  r.post(
    "/installations/:id/complete",
    requirePermission("instalaciones.registrar"),
    zValidator(
      "json",
      z.object({
        meterNumber: z.string().min(1).max(80),
        meterBrand: z.string().max(80).optional(),
        meterModel: z.string().max(80).optional(),
        meterSerial: z.string().max(80).optional(),
        initialReading: z.string().optional(),
        installedAt: z.string().optional(),
        observations: z.string().optional(),
        photoFileId: z.string().uuid().optional(),
        gps: gpsSchema,
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const env = loadEnv();
      const body = c.req.valid("json");
      const [job] = await db
        .select()
        .from(t.connectionInstallations)
        .where(and(eq(t.connectionInstallations.id, c.req.param("id")), eq(t.connectionInstallations.companyId, user.companyId)))
        .limit(1);
      if (!job) throw jsonError("NOT_FOUND", "Instalación no encontrada", 404);
      if (job.status !== "PENDIENTE") throw jsonError("CONFLICT", "La instalación ya fue registrada", 409);
      const settings = await loadFieldSettings(db, user.companyId, env);
      if (settings.photoRequired && !body.photoFileId) throw jsonError("VALIDATION_ERROR", "La fotografía es obligatoria", 400);
      if (settings.gpsRejectMock && body.gps.mocked) throw jsonError("VALIDATION_ERROR", "No se acepta ubicación simulada", 400);
      if (body.gps.accuracyMeters > settings.gpsMaxAccuracyMeters) {
        throw jsonError("VALIDATION_ERROR", `Precisión GPS insuficiente (${Math.round(body.gps.accuracyMeters)} m)`, 400);
      }
      const [connection] = await db.select().from(t.connections).where(eq(t.connections.id, job.connectionId)).limit(1);
      let distanceM: number | null = null;
      if (connection?.latitude && connection.longitude) {
        distanceM = haversineMeters(body.gps.latitude, body.gps.longitude, Number(connection.latitude), Number(connection.longitude));
        if (settings.gpsGeofenceBlock && distanceM > settings.gpsGeofenceMeters) {
          throw jsonError(
            "VALIDATION_ERROR",
            `Ubicación fuera del área permitida (${Math.round(distanceM)} m; tolerancia ${settings.gpsGeofenceMeters} m)`,
            400,
          );
        }
      }
      const reading = body.initialReading ?? job.initialReading ?? "0";
      const installedAt = body.installedAt || todayAsuncion();
      const [dup] = await db
        .select({ id: t.meters.id })
        .from(t.meters)
        .where(and(eq(t.meters.companyId, user.companyId), eq(t.meters.number, body.meterNumber), isNull(t.meters.deletedAt)))
        .limit(1);
      if (dup && dup.id !== job.meterId) throw jsonError("CONFLICT", "Ya existe un medidor con ese número", 409);
      let meterId = job.meterId;
      if (meterId) {
        await db
          .update(t.meters)
          .set({
            number: body.meterNumber,
            brand: body.meterBrand,
            model: body.meterModel,
            serial: body.meterSerial,
            status: "INSTALADO",
            initialReading: reading,
            installedAt,
            connectionId: job.connectionId,
            updatedAt: new Date(),
          })
          .where(eq(t.meters.id, meterId));
      } else {
        const [meter] = await db
          .insert(t.meters)
          .values({
            companyId: user.companyId,
            connectionId: job.connectionId,
            number: body.meterNumber,
            brand: body.meterBrand,
            model: body.meterModel,
            serial: body.meterSerial,
            initialReading: reading,
            installedAt,
            status: "INSTALADO",
          })
          .returning();
        meterId = meter!.id;
      }
      await db.insert(t.meterEvents).values({
        meterId,
        eventType: "INSTALACION",
        reading,
        userId: user.id,
      });
      await db
        .update(t.connectionInstallations)
        .set({
          meterId,
          installerId: user.id,
          initialReading: reading,
          observations: body.observations,
          photoFileId: body.photoFileId,
          latitude: String(body.gps.latitude),
          longitude: String(body.gps.longitude),
          gpsAccuracyM: String(body.gps.accuracyMeters),
          distanceM: distanceM != null ? String(distanceM.toFixed(2)) : null,
          status: "COMPLETADA",
          completedAt: new Date(),
        })
        .where(eq(t.connectionInstallations.id, job.id));
      await db
        .update(t.connections)
        .set({
          status: "ACTIVA",
          installedAt: todayAsuncion(),
          latitude: connection?.latitude ?? String(body.gps.latitude),
          longitude: connection?.longitude ?? String(body.gps.longitude),
          updatedAt: new Date(),
        })
        .where(eq(t.connections.id, job.connectionId));
      await audit(db, {
        companyId: user.companyId,
        userId: user.id,
        action: "INSTALACION_REGISTRADA",
        module: "instalaciones",
        entityType: "connection_installation",
        entityId: job.id,
        newValues: { connectionId: job.connectionId, gps: body.gps, photoFileId: body.photoFileId, distanceM },
        ip: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
      });
      return c.json({
        data: {
          ok: true,
          distanceM,
          withinFence: distanceM == null || distanceM <= settings.gpsGeofenceMeters,
          initialReading: reading,
        },
      });
    },
  );

  r.get("/collections/config", requirePermission("cobranza.ver"), async (c) => {
    const db = c.get("db");
    const settings = await loadFieldSettings(db, c.get("user")!.companyId, loadEnv());
    const rows = await db.select().from(t.systemSettings).where(eq(t.systemSettings.companyId, c.get("user")!.companyId));
    const map = Object.fromEntries(rows.map((s) => [s.key, s.value]));
    const interval = Number(map["cobranza.gpsIntervalSeconds"] ?? 30);
    return c.json({ data: { ...settings, gpsIntervalSeconds: Number.isFinite(interval) ? interval : 30 } });
  });

  r.get("/collections/queue", requirePermission("cobranza.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const q = c.req.query("q")?.trim();
    const rows = await db.execute(sql`
      select
        c.id as "customerId",
        c.code as "customerCode",
        coalesce(nullif(trim(c.legal_name), ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.code) as "customerName",
        c.address,
        c.mobile,
        cn.id as "connectionId",
        cn.code as "connectionCode",
        cn.status as "connectionStatus",
        cn.address as "connectionAddress",
        cn.latitude as "latitude",
        cn.longitude as "longitude",
        coalesce(a.balance::text, '0') as debt,
        coalesce(a.status, 'AL_DIA') as "accountStatus",
        (
          select count(*)::int from water_bills wb
          where wb.customer_id = c.id and wb.balance::numeric > 0 and wb.status <> 'ANULADA'
        ) as "pendingBills",
        (
          select max(p.paid_on) from payments p
          where p.customer_id = c.id and p.reversed_at is null
        ) as "lastPaidOn"
      from customers c
      join customer_accounts a on a.customer_id = c.id
      left join connections cn on cn.customer_id = c.id and cn.deleted_at is null
        and cn.id = (
          select id from connections x
          where x.customer_id = c.id and x.deleted_at is null
          order by case when x.status = 'ACTIVA' then 0 else 1 end, x.created_at desc
          limit 1
        )
      where c.company_id = ${companyId} and c.deleted_at is null and a.balance::numeric > 0
        ${q ? sql`and (
          c.code ilike ${"%" + q + "%"}
          or coalesce(c.legal_name,'') ilike ${"%" + q + "%"}
          or coalesce(c.first_name,'') ilike ${"%" + q + "%"}
          or coalesce(c.last_name,'') ilike ${"%" + q + "%"}
          or coalesce(cn.code,'') ilike ${"%" + q + "%"}
        )` : sql``}
      order by a.balance::numeric desc
      limit 200
    `);
    return c.json({ data: rows });
  });

  r.get("/collections/routes/active", requirePermission("cobranza.recorrido"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const [route] = await db
      .select()
      .from(t.collectionRoutes)
      .where(and(eq(t.collectionRoutes.collectorId, user.id), eq(t.collectionRoutes.status, "ACTIVO")))
      .orderBy(desc(t.collectionRoutes.startedAt))
      .limit(1);
    if (!route) return c.json({ data: null });
    const points = await db
      .select()
      .from(t.collectionRoutePoints)
      .where(eq(t.collectionRoutePoints.routeId, route.id))
      .orderBy(asc(t.collectionRoutePoints.capturedAt));
    const visits = await db.select().from(t.collectionVisits).where(eq(t.collectionVisits.routeId, route.id));
    return c.json({ data: { ...route, points, visits } });
  });

  r.post("/collections/routes/start", requirePermission("cobranza.recorrido"), zValidator("json", gpsSchema), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const gps = c.req.valid("json");
    const [existing] = await db
      .select()
      .from(t.collectionRoutes)
      .where(and(eq(t.collectionRoutes.collectorId, user.id), eq(t.collectionRoutes.status, "ACTIVO")))
      .limit(1);
    if (existing) return c.json({ data: existing });
    const [route] = await db
      .insert(t.collectionRoutes)
      .values({ companyId: user.companyId, collectorId: user.id })
      .returning();
    await db.insert(t.collectionRoutePoints).values({
      routeId: route!.id,
      latitude: String(gps.latitude),
      longitude: String(gps.longitude),
      accuracyM: String(gps.accuracyMeters),
    });
    await audit(db, {
      companyId: user.companyId,
      userId: user.id,
      action: "RECORRIDO_INICIADO",
      module: "cobranza",
      entityType: "collection_route",
      entityId: route!.id,
    });
    return c.json({ data: route }, 201);
  });

  r.post(
    "/collections/routes/:id/ping",
    requirePermission("cobranza.recorrido"),
    zValidator("json", gpsSchema),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const gps = c.req.valid("json");
      const [route] = await db
        .select()
        .from(t.collectionRoutes)
        .where(and(eq(t.collectionRoutes.id, c.req.param("id")), eq(t.collectionRoutes.collectorId, user.id), eq(t.collectionRoutes.status, "ACTIVO")))
        .limit(1);
      if (!route) throw jsonError("NOT_FOUND", "No hay recorrido activo", 404);
      await db.insert(t.collectionRoutePoints).values({
        routeId: route.id,
        latitude: String(gps.latitude),
        longitude: String(gps.longitude),
        accuracyM: String(gps.accuracyMeters),
      });
      return c.json({ data: { ok: true } });
    },
  );

  r.post("/collections/routes/:id/finish", requirePermission("cobranza.recorrido"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const [route] = await db
      .select()
      .from(t.collectionRoutes)
      .where(and(eq(t.collectionRoutes.id, c.req.param("id")), eq(t.collectionRoutes.collectorId, user.id)))
      .limit(1);
    if (!route) throw jsonError("NOT_FOUND", "Recorrido no encontrado", 404);
    await db.update(t.collectionRoutes).set({ status: "FINALIZADO", endedAt: new Date() }).where(eq(t.collectionRoutes.id, route.id));
    await audit(db, {
      companyId: user.companyId,
      userId: user.id,
      action: "RECORRIDO_FINALIZADO",
      module: "cobranza",
      entityType: "collection_route",
      entityId: route.id,
    });
    return c.json({ data: { ok: true } });
  });

  r.post(
    "/collections/visits",
    requirePermission("cobranza.ver"),
    zValidator(
      "json",
      z.object({
        routeId: z.string().uuid().optional(),
        customerId: z.string().uuid(),
        result: z.enum(["COBRADO", "PARCIAL", "SIN_EXITO", "AUSENTE"]),
        paymentId: z.string().uuid().optional(),
        notes: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      let routeId = body.routeId;
      if (!routeId) {
        const [active] = await db
          .select()
          .from(t.collectionRoutes)
          .where(and(eq(t.collectionRoutes.collectorId, user.id), eq(t.collectionRoutes.status, "ACTIVO")))
          .limit(1);
        routeId = active?.id;
      }
      if (!routeId) throw jsonError("VALIDATION_ERROR", "Iniciá el recorrido antes de registrar la visita", 400);
      const [row] = await db
        .insert(t.collectionVisits)
        .values({
          routeId,
          customerId: body.customerId,
          result: body.result,
          paymentId: body.paymentId,
          notes: body.notes,
          latitude: body.latitude != null ? String(body.latitude) : undefined,
          longitude: body.longitude != null ? String(body.longitude) : undefined,
        })
        .returning();
      return c.json({ data: row }, 201);
    },
  );

  r.post("/collections/scan", requirePermission("morosidad.gestionar"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const result = await scanDelinquency(db, user.companyId, user.id);
    await audit(db, {
      companyId: user.companyId,
      userId: user.id,
      action: "MORA_ESCANEADA",
      module: "morosidad",
      newValues: result,
    });
    return c.json({ data: result });
  });

  r.post(
    "/collections/plans",
    requirePermission("pagos.crear"),
    zValidator(
      "json",
      z.object({
        customerId: z.string().uuid(),
        connectionId: z.string().uuid().optional(),
        total: z.string(),
        downPayment: z.string().optional(),
        count: z.coerce.number().int().min(1).max(60),
        firstDueOn: z.string(),
        notes: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const data = await createInstallmentPlan(c.get("db"), {
        companyId: user.companyId,
        customerId: body.customerId,
        connectionId: body.connectionId,
        kind: "DEUDA",
        total: body.total,
        downPayment: body.downPayment ?? "0",
        count: body.count,
        firstDueOn: body.firstDueOn,
        createdBy: user.id,
        notes: body.notes,
      });
      return c.json({ data }, 201);
    },
  );

  r.get("/collections/plans", requirePermission("cuentas.ver"), async (c) => {
    const customerId = c.req.query("customerId");
    const db = c.get("db");
    const filters = [eq(t.installmentPlans.companyId, c.get("user")!.companyId)];
    if (customerId) filters.push(eq(t.installmentPlans.customerId, customerId));
    const plans = await db.select().from(t.installmentPlans).where(and(...filters)).orderBy(desc(t.installmentPlans.createdAt));
    const ids = plans.map((p) => p.id);
    const items = ids.length ? await db.select().from(t.installmentItems).where(inArray(t.installmentItems.planId, ids)) : [];
    return c.json({ data: plans.map((p) => ({ ...p, items: items.filter((i) => i.planId === p.id) })) });
  });

  r.post("/suspensions/:id/authorize", requirePermission("desconexiones.programar"), async (c) => {
    const db = c.get("db");
    const user = c.get("user")!;
    const [row] = await db
      .select()
      .from(t.suspensions)
      .where(and(eq(t.suspensions.id, c.req.param("id")), eq(t.suspensions.companyId, user.companyId)))
      .limit(1);
    if (!row) throw jsonError("NOT_FOUND", "Desconexión no encontrada", 404);
    if (row.status !== "PROGRAMADA") throw jsonError("CONFLICT", "Solo se autorizan desconexiones programadas", 409);
    await db
      .update(t.suspensions)
      .set({ status: "AUTORIZADA", authorizedBy: user.id, authorizedAt: new Date() })
      .where(eq(t.suspensions.id, row.id));
    await audit(db, {
      companyId: user.companyId,
      userId: user.id,
      action: "DESCONEXION_AUTORIZADA",
      module: "desconexiones",
      entityType: "suspension",
      entityId: row.id,
    });
    return c.json({ data: { ok: true } });
  });

  r.post(
    "/suspensions/:id/execute",
    requirePermission("desconexiones.ejecutar"),
    zValidator(
      "json",
      z.object({
        photoFileId: z.string().uuid().optional(),
        observations: z.string().optional(),
        gps: gpsSchema,
      }),
    ),
    async (c) => {
      const db = c.get("db");
      const user = c.get("user")!;
      const body = c.req.valid("json");
      const settings = await loadFieldSettings(db, user.companyId, loadEnv());
      if (settings.photoRequired && !body.photoFileId) throw jsonError("VALIDATION_ERROR", "La fotografía es obligatoria", 400);
      const [row] = await db
        .select()
        .from(t.suspensions)
        .where(and(eq(t.suspensions.id, c.req.param("id")), eq(t.suspensions.companyId, user.companyId)))
        .limit(1);
      if (!row) throw jsonError("NOT_FOUND", "Desconexión no encontrada", 404);
      if (row.status === "EJECUTADA") throw jsonError("CONFLICT", "Ya fue ejecutada", 409);
      if (row.status === "PROGRAMADA") throw jsonError("CONFLICT", "Requiere autorización previa", 409);
      await db
        .update(t.suspensions)
        .set({
          status: "EJECUTADA",
          executedAt: new Date(),
          userId: user.id,
          photoFileId: body.photoFileId,
          notes: body.observations,
          latitude: String(body.gps.latitude),
          longitude: String(body.gps.longitude),
          gpsAccuracyM: String(body.gps.accuracyMeters),
        })
        .where(eq(t.suspensions.id, row.id));
      await db.update(t.connections).set({ status: "CORTADA", updatedAt: new Date() }).where(eq(t.connections.id, row.connectionId));
      await db.update(t.customers).set({ status: "DESCONECTADO", updatedAt: new Date() }).where(eq(t.customers.id, row.customerId));
      await audit(db, {
        companyId: user.companyId,
        userId: user.id,
        action: "DESCONEXION_EJECUTADA",
        module: "desconexiones",
        entityType: "suspension",
        entityId: row.id,
        newValues: { gps: body.gps, photoFileId: body.photoFileId },
      });
      return c.json({ data: { ok: true } });
    },
  );

  r.get("/collections/delinquency/detail", requirePermission("morosidad.ver"), async (c) => {
    const db = c.get("db");
    const companyId = c.get("user")!.companyId;
    const counts = await unpaidPeriodCounts(db, companyId);
    const [rule] = await db.select().from(t.delinquencyRules).where(eq(t.delinquencyRules.companyId, companyId)).limit(1);
    const threshold = rule?.unpaidPeriodsForDisconnect ?? 3;
    const customers = await db.select().from(t.customers).where(eq(t.customers.companyId, companyId));
    const connections = await db.select().from(t.connections).where(eq(t.connections.companyId, companyId));
    const byCustomer = new Map(customers.map((row) => [row.id, row]));
    const data = counts
      .filter((row) => Number(row.debt) > 0 || Number(row.unpaidPeriods) > 0)
      .map((row) => {
        const customer = byCustomer.get(row.customerId);
        const cn = connections.find((x) => x.customerId === row.customerId);
        return {
          ...row,
          bucket: moraBucket(Number(row.unpaidPeriods)),
          scheduled: Number(row.unpaidPeriods) >= threshold,
          customerCode: customer?.code,
          customerName: customer?.legalName || [customer?.firstName, customer?.lastName].filter(Boolean).join(" "),
          address: cn?.address ?? customer?.address,
          connectionCode: cn?.code,
          connectionStatus: cn?.status,
        };
      });
    return c.json({ data, meta: { threshold } });
  });
}
