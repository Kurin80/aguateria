import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import * as t from "../db/schema.js";
import type { Env } from "../env.js";

export type FieldSettings = {
  gpsMaxAccuracyMeters: number;
  gpsRejectMock: boolean;
  gpsGeofenceMeters: number;
  gpsGeofenceBlock: boolean;
  photoRequired: boolean;
  excessiveMultiplier: number;
};

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

export async function loadFieldSettings(db: Database, companyId: string, env: Env): Promise<FieldSettings> {
  const rows = await db.select().from(t.systemSettings).where(eq(t.systemSettings.companyId, companyId));
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    gpsMaxAccuracyMeters: asNumber(map["gps.maxAccuracyMeters"], env.GPS_MAX_ACCURACY_METERS),
    gpsRejectMock: asBool(map["gps.rejectMock"], Boolean(env.GPS_REJECT_MOCK)),
    gpsGeofenceMeters: asNumber(map["gps.geofenceMeters"], 50),
    gpsGeofenceBlock: asBool(map["gps.geofenceBlock"], false),
    photoRequired: asBool(map["photo.required"], true),
    excessiveMultiplier: asNumber(map["consumption.excessiveMultiplier"], env.EXCESSIVE_CONSUMPTION_MULTIPLIER),
  };
}

export function isFieldOnlyUser(user: { roles: string[] }): boolean {
  return fieldHomePath(user.roles) != null;
}

export function fieldHomePath(roles: string[]): "/campo" | "/instalaciones" | "/cobranza" | null {
  const privileged = ["SUPER_ADMIN", "ADMINISTRADOR", "GERENTE", "SUPERVISOR"];
  if (roles.some((r) => privileged.includes(r))) return null;
  if (roles.includes("COBRADOR")) return "/cobranza";
  if (roles.includes("INSTALADOR")) return "/instalaciones";
  if (roles.includes("LECTOR") || roles.includes("LECTORISTA")) return "/campo";
  return null;
}
