import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { ReadingInput } from "@aguateria/shared";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import type { Env } from "../env.js";
import type { AuthUser } from "../http/types.js";
import { jsonError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { isFieldOnlyUser, loadFieldSettings } from "../lib/field-settings.js";
import { todayAsuncion } from "../lib/time.js";
import { evaluateReading, haversineMeters } from "./reading-evaluation.js";

export async function recordMeterReading(opts: {
  db: Database;
  user: AuthUser;
  env: Env;
  body: ReadingInput;
  ip?: string | null;
}) {
  const { db, user, env, body } = opts;
  const settings = await loadFieldSettings(db, user.companyId, env);

  const [existing] = await db
    .select()
    .from(t.meterReadings)
    .where(and(eq(t.meterReadings.companyId, user.companyId), eq(t.meterReadings.idempotencyKey, body.idempotencyKey)))
    .limit(1);
  if (existing) return { row: existing, evaluation: null, idempotent: true as const };

  const [connection] = await db.select().from(t.connections).where(eq(t.connections.id, body.connectionId)).limit(1);
  const [meter] = await db.select().from(t.meters).where(eq(t.meters.id, body.meterId)).limit(1);
  if (!connection || !meter || connection.companyId !== user.companyId || meter.companyId !== user.companyId) {
    throw jsonError("NOT_FOUND", "Conexión o medidor no encontrado", 404);
  }
  if (connection.deletedAt) throw jsonError("NOT_FOUND", "Conexión no encontrada", 404);
  if (meter.connectionId !== connection.id) {
    throw jsonError("VALIDATION_ERROR", "El medidor no pertenece a esta conexión", 400);
  }

  let periodId = body.billingPeriodId ?? null;
  if (!periodId) {
    const [open] = await db
      .select()
      .from(t.billingPeriods)
      .where(and(eq(t.billingPeriods.companyId, user.companyId), sql`${t.billingPeriods.status} in ('ABIERTO','EN_PROCESO','EN_REVISION')`))
      .orderBy(desc(t.billingPeriods.startsOn))
      .limit(1);
    periodId = open?.id ?? null;
  }

  if (periodId && !body.meterReset) {
    const [dup] = await db
      .select({ id: t.meterReadings.id })
      .from(t.meterReadings)
      .where(
        and(
          eq(t.meterReadings.companyId, user.companyId),
          eq(t.meterReadings.meterId, meter.id),
          eq(t.meterReadings.billingPeriodId, periodId),
        ),
      )
      .limit(1);
    if (dup) {
      throw jsonError("CONFLICT", "Ya existe una lectura de este medidor para el período", 409);
    }
  }

  const [last] = await db
    .select()
    .from(t.meterReadings)
    .where(eq(t.meterReadings.meterId, meter.id))
    .orderBy(desc(t.meterReadings.serverCapturedAt))
    .limit(1);

  const previous = last ? Number(last.currentReading) : Number(meter.initialReading);
  const current = Number(body.currentReading);
  const [avgRow] = await db.execute(
    sql`select coalesce(avg(consumption_m3),0)::float as avg from meter_readings where meter_id = ${meter.id}`,
  );

  let geofenceDistanceM: number | null = null;
  const supplyLat = connection.latitude ?? null;
  const supplyLng = connection.longitude ?? null;
  if (body.gps && supplyLat && supplyLng) {
    geofenceDistanceM = haversineMeters(body.gps.latitude, body.gps.longitude, Number(supplyLat), Number(supplyLng));
  }

  if (isFieldOnlyUser(user) && !body.gps) {
    throw jsonError("VALIDATION_ERROR", "La lectura de campo requiere GPS del dispositivo", 400);
  }
  if (body.gps?.mocked && settings.gpsRejectMock) {
    throw jsonError("VALIDATION_ERROR", "No se acepta ubicación simulada", 400);
  }
  if (settings.gpsGeofenceBlock && geofenceDistanceM != null && geofenceDistanceM > settings.gpsGeofenceMeters) {
    throw jsonError(
      "VALIDATION_ERROR",
      `Ubicación fuera del área permitida (${Math.round(geofenceDistanceM)} m; tolerancia ${settings.gpsGeofenceMeters} m)`,
      400,
    );
  }

  const evalResult = evaluateReading({
    previousReading: previous,
    currentReading: current,
    meterReset: body.meterReset,
    isFirstReading: !last,
    meterChangedInPeriod: false,
    excessiveMultiplier: settings.excessiveMultiplier,
    historicalAverageM3: Number((avgRow as { avg?: number })?.avg ?? 0) || null,
    gpsAccuracyMeters: body.gps?.accuracyMeters ?? null,
    gpsMaxAccuracyMeters: settings.gpsMaxAccuracyMeters,
    gpsMocked: body.gps?.mocked,
    rejectMockLocation: settings.gpsRejectMock,
    photoRequired: settings.photoRequired,
    hasPhoto: Boolean(body.photoFileId),
    geofenceDistanceM,
    geofenceMaxMeters: settings.gpsGeofenceMeters,
    geofenceBlock: settings.gpsGeofenceBlock,
  });

  const [row] = await db
    .insert(t.meterReadings)
    .values({
      companyId: user.companyId,
      customerId: connection.customerId,
      connectionId: connection.id,
      meterId: meter.id,
      billingPeriodId: periodId,
      routeItemId: null,
      previousReading: String(previous),
      currentReading: String(current),
      consumptionM3: String(evalResult.consumptionM3),
      readerId: user.id,
      observations: [body.observations, ...evalResult.warnings].filter(Boolean).join(" | ") || null,
      photoFileId: body.photoFileId,
      latitude: body.gps ? String(body.gps.latitude) : null,
      longitude: body.gps ? String(body.gps.longitude) : null,
      gpsAccuracyM: body.gps ? String(body.gps.accuracyMeters) : null,
      gpsMocked: body.gps?.mocked ?? false,
      gpsDistanceM: geofenceDistanceM != null ? String(geofenceDistanceM.toFixed(2)) : null,
      anomalyCode: evalResult.anomalyCode,
      requiresReview: evalResult.requiresReview || evalResult.blockAutoBilling,
      billed: false,
      idempotencyKey: body.idempotencyKey,
      clientUuid: body.clientUuid,
      deviceCapturedAt: body.deviceCapturedAt ? new Date(body.deviceCapturedAt) : null,
      syncStatus: "SYNCED",
    })
    .returning();

  await db.insert(t.meterEvents).values({
    meterId: meter.id,
    eventType: "LECTURA",
    reading: String(current),
    userId: user.id,
  });

  await audit(db, {
    companyId: user.companyId,
    userId: user.id,
    action: "LECTURA_REGISTRADA",
    module: "lecturas",
    entityType: "meter_readings",
    entityId: row?.id,
    ip: opts.ip,
    newValues: {
      previous,
      current,
      consumption: evalResult.consumptionM3,
      anomaly: evalResult.anomalyCode,
      gps: body.gps ?? null,
      photoFileId: body.photoFileId ?? null,
      distanceM: geofenceDistanceM,
    },
  });

  return { row, evaluation: evalResult, idempotent: false as const, settings };
}

export async function startFieldReading(opts: {
  db: Database;
  user: AuthUser;
  connectionId: string;
  ip?: string | null;
}) {
  const { db, user, connectionId } = opts;

  const [connection] = await db.select().from(t.connections).where(eq(t.connections.id, connectionId)).limit(1);
  if (!connection || connection.companyId !== user.companyId || connection.deletedAt) {
    throw jsonError("NOT_FOUND", "Suministro no encontrado", 404);
  }
  if (["CORTADA", "SUSPENDIDA", "DESCONECTADA", "DESCONEXION_PROGRAMADA"].includes(connection.status)) {
    throw jsonError("VALIDATION_ERROR", "Este suministro no está habilitado para lectura", 400);
  }

  let [meter] = await db
    .select()
    .from(t.meters)
    .where(and(eq(t.meters.connectionId, connection.id), eq(t.meters.status, "INSTALADO"), isNull(t.meters.deletedAt)))
    .limit(1);
  if (!meter) {
    [meter] = await db
      .select()
      .from(t.meters)
      .where(and(eq(t.meters.connectionId, connection.id), eq(t.meters.status, "PENDIENTE"), isNull(t.meters.deletedAt)))
      .limit(1);
  }
  if (!meter) {
    throw jsonError("VALIDATION_ERROR", "El suministro no tiene medidor para leer. Completá la instalación o cargá el medidor.", 400);
  }
  if (meter.status === "PENDIENTE") {
    await db
      .update(t.meters)
      .set({
        status: "INSTALADO",
        installedAt: meter.installedAt ?? todayAsuncion(),
        updatedAt: new Date(),
      })
      .where(eq(t.meters.id, meter.id));
    meter = { ...meter, status: "INSTALADO" };
  }
  if (connection.status === "PENDIENTE") {
    await db
      .update(t.connections)
      .set({
        status: "ACTIVA",
        installedAt: connection.installedAt ?? todayAsuncion(),
        updatedAt: new Date(),
      })
      .where(eq(t.connections.id, connection.id));
  }

  const [openPeriod] = await db
    .select({ id: t.billingPeriods.id })
    .from(t.billingPeriods)
    .where(and(eq(t.billingPeriods.companyId, user.companyId), sql`${t.billingPeriods.status} in ('ABIERTO','EN_PROCESO','EN_REVISION')`))
    .orderBy(desc(t.billingPeriods.startsOn))
    .limit(1);
  if (openPeriod) {
    const [dup] = await db
      .select({ id: t.meterReadings.id })
      .from(t.meterReadings)
      .where(
        and(
          eq(t.meterReadings.companyId, user.companyId),
          eq(t.meterReadings.meterId, meter.id),
          eq(t.meterReadings.billingPeriodId, openPeriod.id),
        ),
      )
      .limit(1);
    if (dup) {
      throw jsonError("CONFLICT", "Ya existe una lectura de este medidor para el período", 409);
    }
  }

  const [last] = await db
    .select()
    .from(t.meterReadings)
    .where(eq(t.meterReadings.meterId, meter.id))
    .orderBy(desc(t.meterReadings.serverCapturedAt))
    .limit(1);

  await audit(db, {
    companyId: user.companyId,
    userId: user.id,
    action: "LECTURA_INICIADA",
    module: "lecturas",
    entityType: "connections",
    entityId: connection.id,
    ip: opts.ip,
    newValues: { event: "INICIO_LECTURA", meterId: meter.id },
  });

  return {
    connectionId: connection.id,
    meterId: meter.id,
    previousReading: last ? last.currentReading : meter.initialReading,
  };
}
